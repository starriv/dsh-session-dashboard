/**
 * The dashboard's derived read model.
 *
 * `StatsStore` owns the only mutable state in the Host half: a per-file parse
 * cache keyed by (mtimeMs, size) and a monotonically increasing sequence for
 * change detection. A request merely triggers an incremental scan and folds the
 * cached per-session records into a fresh view model. Nothing here writes to
 * session logs or storage.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { activityBounds, clipActivityIntervals } from './activity.js'
import { createPricing } from './pricing.js'
import { MAX_SCOPE_DAYS, normalizeScope } from './scope.js'
import { parseSessionLog } from './session-log.js'
import { loadCachedTitles } from './titles.js'
import { dayKeyOf, dayStartMs, recentDayKeys, resolveTimeZone, shiftDayKey } from './time.js'
import { decompressZstdFrames } from './zstd.js'

const SESSION_FILE = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function workspaceName(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
}

function addUsage(target, usage) {
  target.inputTokens += usage.inputTokens || 0
  target.outputTokens += usage.outputTokens || 0
  target.cacheReadTokens += usage.cacheReadTokens || 0
  target.cacheWriteTokens += usage.cacheWriteTokens || 0
  target.totalTokens += usage.totalTokens || 0
}

async function listEntries(directory) {
  try {
    return { entries: await readdir(directory, { withFileTypes: true }), ok: true }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { entries: [], ok: true }
    return { entries: [], ok: false }
  }
}

/** Discover every session log, preferring the compressed form. */
async function discoverSessionFiles(root, limit) {
  const files = []
  let truncated = false
  let incomplete = false
  let projectDirs
  try {
    projectDirs = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return { files, truncated, incomplete }
    throw error
  }
  projectDirs.sort((left, right) => left.name.localeCompare(right.name))
  for (const project of projectDirs) {
    if (!project.isDirectory()) continue
    const projectPath = path.join(root, project.name)
    const sessionListing = await listEntries(projectPath)
    if (!sessionListing.ok) {
      incomplete = true
      continue
    }
    sessionListing.entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const sessionDir of sessionListing.entries) {
      if (!sessionDir.isDirectory()) continue
      const sessionPath = path.join(projectPath, sessionDir.name)
      const entriesListing = await listEntries(sessionPath)
      if (!entriesListing.ok) {
        incomplete = true
        continue
      }
      const chosen = pickSessionFileName(entriesListing.entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name))
      if (chosen) {
        files.push(path.join(sessionPath, chosen))
        if (files.length > limit) {
          files.pop()
          truncated = true
          return { files, truncated, incomplete }
        }
      }
    }
  }
  return { files, truncated, incomplete }
}

/** Pick the numerically highest canonical generation, compressed preferred on a tie. */
export function pickSessionFileName(names) {
  let chosen = ''
  let chosenVersion = -1
  for (const name of names) {
    const match = SESSION_FILE.exec(name)
    if (!match) continue
    const version = match[1] ? Number(match[1]) : 0
    const compressed = match[2] ? 1 : 0
    const chosenCompressed = chosen.endsWith('.zstd') ? 1 : 0
    if (version > chosenVersion || (version === chosenVersion && compressed > chosenCompressed)) {
      chosen = name
      chosenVersion = version
    }
  }
  return chosen
}

function isCompressed(file, buffer) {
  return file.endsWith('.zstd') || buffer.subarray(0, 4).equals(ZSTD_MAGIC)
}

export class StatsStore {
  constructor(config) {
    this.config = config
    this.pricing = createPricing(config)
    // The active corpus is the parsed sessions plus their per-file cache for
    // one display zone. Day buckets are produced while parsing, so a corpus is
    // only valid for the zone it was built in.
    this.files = new Map() // file path -> { mtimeMs, ctimeMs, size, session }
    this.parsed = []
    this.cacheZone = this.pricing.timeZone
    this.cacheDays = new Set() // every day key present in `parsed`
    this.scannedAt = 0
    this.lastScanAt = 0
    this.truncated = false
    this.listingIncomplete = false
    this.errors = 0
    this.skipped = []
    // One spare corpus lets two browser zones alternate without a full
    // re-parse. More than two zones rebuild on demand, which bounds memory.
    this.alternateCorpus = null
    // Last whole-corpus rebuild caused by a display-zone switch. Several
    // calendars polling in turn must not turn every request into a re-scan.
    this.lastRebuildAt = 0
    this.sequence = 0
    this.scanPromise = null
    this.lastForcedAt = 0
    this.titleAttempted = new Set()
  }

  /** Snapshot the active corpus so it can be stashed or restored atomically. */
  activeCorpus() {
    return {
      zone: this.cacheZone,
      files: this.files,
      parsed: this.parsed,
      cacheDays: this.cacheDays,
      scannedAt: this.scannedAt,
      lastScanAt: this.lastScanAt,
      truncated: this.truncated,
      listingIncomplete: this.listingIncomplete,
      errors: this.errors,
      skipped: this.skipped,
    }
  }

  /** Make `corpus` the active one without copying its records. */
  loadCorpus(corpus) {
    this.cacheZone = corpus.zone
    this.files = corpus.files
    this.parsed = corpus.parsed
    this.cacheDays = corpus.cacheDays
    this.scannedAt = corpus.scannedAt
    this.lastScanAt = corpus.lastScanAt
    this.truncated = corpus.truncated
    this.listingIncomplete = corpus.listingIncomplete
    this.errors = corpus.errors
    this.skipped = corpus.skipped
  }

  /**
   * Switch the active corpus to `zone`. The previous corpus is kept as the
   * single alternate, so two zones polling in turn cost one rebuild each rather
   * than one rebuild per request. A third zone evicts the spare and rebuilds.
   */
  switchCorpus(zone) {
    const current = this.activeCorpus()
    const alternate = this.alternateCorpus
    this.alternateCorpus = current
    if (alternate && alternate.zone === zone) {
      this.loadCorpus(alternate)
      return 'restored'
    }
    this.loadCorpus({
      zone,
      files: new Map(),
      parsed: [],
      cacheDays: new Set(),
      scannedAt: 0,
      lastScanAt: 0,
      truncated: false,
      listingIncomplete: false,
      errors: 0,
      skipped: [],
    })
    return 'rebuilt'
  }

  /**
   * Whether a whole-corpus rebuild is allowed now. Deferring a rebuild serves
   * the current calendar until `zoneRebuildMs` has passed; two calendars that
   * merely alternate are already served by the spare corpus and never wait.
   */
  canRebuild() {
    const window = Number.isFinite(this.config.zoneRebuildMs)
      ? this.config.zoneRebuildMs
      : 30_000
    if (window <= 0 || this.lastRebuildAt === 0) return true
    return Date.now() - this.lastRebuildAt >= window
  }

  /**
   * Whether `zone` labels the cached corpus with exactly the same calendar days
   * as `cacheZone` for every day a snapshot can aggregate. Distinct identifiers
   * can share day boundaries all year (`Asia/Shanghai` and `Asia/Singapore` are
   * both UTC+8), so the parsed corpus only needs relabelling, not re-parsing.
   *
   * Scoped views aggregate at most the last `2 * MAX_SCOPE_DAYS` days (the
   * window and the previous window) and all-time totals are zone-independent,
   * so older buckets never re-enter a window and may keep their labels.
   * Future-dated buckets (clock skew) are checked too because they can enter a
   * window later.
   *
   * A truncated or partially listed corpus may hide sessions this check cannot
   * see, so such a corpus is rebuilt instead of relabelled.
   *
   * @param {string} zone IANA zone to compare against `cacheZone`
   * @returns {boolean}
   */
  sameCalendar(zone) {
    const cached = this.cacheZone
    if (zone === cached) return true
    if (this.truncated || this.listingIncomplete) return false
    const now = Date.now()
    const cachedToday = dayKeyOf(now, cached)
    if (dayKeyOf(now, zone) !== cachedToday) return false
    // Every day a window can address, plus the start of the next day.
    for (let offset = -2 * MAX_SCOPE_DAYS - 2; offset <= 1; offset += 1) {
      const key = shiftDayKey(cachedToday, offset)
      if (dayStartMs(key, cached) !== dayStartMs(key, zone)) return false
    }
    const tomorrowKey = shiftDayKey(cachedToday, 1)
    let future = 0
    for (const date of this.cacheDays) {
      if (date <= tomorrowKey) continue
      // A corrupt future clock must not make this check unbounded.
      future += 1
      if (future > 512) return false
      if (dayStartMs(date, cached) !== dayStartMs(date, zone)) return false
    }
    return true
  }

  /**
   * @param {boolean} [force] manual-refresh affordance
   * @param {string} [dayTimeZone] IANA zone used for calendar-day buckets
   * @returns {Promise<{ sessions: object[], zone: string }>} corpus and the
   *   calendar it is labelled in (the requested zone unless a rebuild is
   *   currently throttled)
   */
  async ensureFresh(force = false, dayTimeZone) {
    const requested = resolveTimeZone(dayTimeZone, this.cacheZone)
    // A running scan commits records for one zone. Wait for it before switching
    // zones so the cache can never mix two calendars; the retry loop also
    // covers a concurrent request that started another zone's scan meanwhile.
    while (this.scanPromise) {
      try {
        await this.scanPromise
      } catch {
        // The initiating request owns the error; a zone switch still retries.
      }
    }
    if (requested !== this.cacheZone) {
      if (this.sameCalendar(requested)) {
        // Same calendar under another identifier: relabel in place.
        this.cacheZone = requested
      } else {
        const spare = this.alternateCorpus
        if (spare && spare.zone === requested) {
          this.switchCorpus(requested)
        } else if (this.canRebuild()) {
          const outcome = this.switchCorpus(requested)
          if (outcome === 'rebuilt') this.lastRebuildAt = Date.now()
        }
        // Throttled: keep serving the current corpus/calendar for this request.
      }
    }
    const zone = this.cacheZone
    if (force) {
      // `force=1` is a manual refresh affordance, not a free unbounded rescan
      // primitive. Rapid authenticated requests still share the last scan.
      const now = Date.now()
      if (this.lastForcedAt > 0 && now - this.lastForcedAt < 1000) force = false
      else this.lastForcedAt = now
    }
    if (!force && this.lastScanAt > 0 && Date.now() - this.lastScanAt < this.config.refreshMs) {
      return { sessions: this.parsed, zone }
    }
    this.scanPromise = this.scan(zone).finally(() => {
      this.scanPromise = null
    })
    const sessions = await this.scanPromise
    return { sessions, zone }
  }

  async scan(dayTimeZone = this.cacheZone) {
    const zone = resolveTimeZone(dayTimeZone, this.cacheZone)
    const startedAt = Date.now()
    let discovered
    try {
      discovered = await discoverSessionFiles(this.config.sessionsRoot, this.config.maxSessions)
    } catch {
      // An unreadable root is not an empty root: keep the last good corpus
      // instead of making the dashboard silently drop every session.
      this.errors += 1
      this.lastScanAt = Date.now()
      return this.parsed || []
    }
    const files = discovered.files
    const truncated = discovered.truncated
    const incompleteListing = discovered.incomplete
    let changed = false
    let errors = 0
    const seen = new Set()
    const parsed = []
    const skipped = []
    const noteSkip = (file, reason) => {
      if (skipped.length < 20) skipped.push({ name: path.basename(file), reason })
    }

    for (const file of files) {
      seen.add(file)
      let fileStat
      try {
        fileStat = await stat(file)
      } catch {
        errors += 1
        noteSkip(file, 'unreadable')
        const cached = this.files.get(file)
        if (cached) parsed.push(cached.session)
        continue
      }
      const maxFileBytes = Number.isFinite(this.config.maxFileBytes) ? this.config.maxFileBytes : Number.MAX_SAFE_INTEGER
      if (fileStat.size > maxFileBytes) {
        errors += 1
        noteSkip(file, 'too-large')
        const oversized = this.files.get(file)
        if (oversized) parsed.push(oversized.session)
        continue
      }
      const cached = this.files.get(file)
      if (
        cached
        && cached.mtimeMs === fileStat.mtimeMs
        && cached.ctimeMs === fileStat.ctimeMs
        && cached.size === fileStat.size
      ) {
        parsed.push(cached.session)
        continue
      }
      try {
        const buffer = await readFile(file)
        const compressed = isCompressed(file, buffer)
        if (!compressed && buffer.length > this.config.maxDecodedBytes) {
          throw new Error('plain JSONL exceeds maxDecodedBytes')
        }
        const text = compressed
          ? await decompressZstdFrames(buffer, { maxBytes: this.config.maxDecodedBytes })
          : buffer.toString('utf8')
        const session = parseSessionLog(text, {
          costOf: this.pricing.costOf,
          timeZone: zone,
          idleGapMs: this.config.idleGapMs,
        })
        if (!session) throw new Error('session log has no header')
        if (!session.id) session.id = path.basename(path.dirname(file))
        this.files.set(file, {
          mtimeMs: fileStat.mtimeMs,
          ctimeMs: fileStat.ctimeMs,
          size: fileStat.size,
          session,
        })
        parsed.push(session)
        changed = true
      } catch (error) {
        errors += 1
        noteSkip(file, error && /maxDecodedBytes|too-large/.test(error.message) ? 'over-budget' : 'parse-failed')
        if (cached) parsed.push(cached.session)
      }
    }

    if (incompleteListing) {
      // A directory could not be listed: keep sessions we already parsed so a
      // transient permission/EMFILE failure cannot silently shrink totals.
      for (const [key, cached] of this.files) {
        if (!seen.has(key)) parsed.push(cached.session)
      }
      errors += 1
    }
    if (!truncated && !incompleteListing) {
      for (const key of Array.from(this.files.keys())) {
        if (!seen.has(key)) {
          this.files.delete(key)
          changed = true
        }
      }
    }

    // Old logs may predate title generation; enrich only the ones still blank.
    const untitled = parsed
      .filter((session) => !session.title && !this.titleAttempted.has(session.id))
      .map((session) => session.id)
    if (untitled.length > 0) {
      const titles = await loadCachedTitles(this.config.dshHome, untitled)
      for (const session of parsed) {
        if (!session.title && titles.has(session.id)) {
          session.title = titles.get(session.id)
          changed = true
        }
      }
      // Projection-cache titles for old logs are effectively immutable; a
      // miss is cached as a miss so every 5s/60s scan does not re-read them.
      for (const id of untitled) this.titleAttempted.add(id)
    }

    // Commit the corpus and its scan metadata together: a scan that raced a
    // zone switch must not leave records or diagnostics from another calendar.
    if (this.cacheZone === zone) {
      this.parsed = parsed
      const cacheDays = new Set()
      for (const session of parsed) {
        for (const date of Object.keys(session.days || {})) cacheDays.add(date)
      }
      this.cacheDays = cacheDays
      this.scannedAt = startedAt
      this.lastScanAt = Date.now()
      this.truncated = truncated
      this.listingIncomplete = incompleteListing
      this.errors = errors
      this.skipped = skipped
    }
    if (changed) this.sequence += 1
    return parsed
  }

  buildSnapshot(rawScope = this.config.scope, rawZone = this.cacheZone, sessionsInput) {
    const scope = normalizeScope(rawScope)
    // The display zone is the user's (browser) zone when supplied; the
    // configured zone stays the Host-side fallback and the pricing/peak zone.
    const timeZone = resolveTimeZone(rawZone, this.cacheZone)
    const rawSessions = Array.isArray(sessionsInput) ? sessionsInput : (this.parsed || [])
    // Copied/restored session directories can carry the same header id. Fold
    // each id once, keeping the freshest copy, so totals and React keys stay
    // unique.
    const byId = new Map()
    const withoutId = []
    for (const session of rawSessions) {
      if (!session.id) {
        withoutId.push(session)
        continue
      }
      const existing = byId.get(session.id)
      if (!existing || session.updatedAt > existing.updatedAt) byId.set(session.id, session)
    }
    const sessions = [...byId.values(), ...withoutId]
    const duplicates = rawSessions.length - sessions.length
    const scoped = typeof scope === 'number'
    const now = Date.now()
    const todayKey = dayKeyOf(now, timeZone)
    const trendDays = scoped
      ? scope
      : (Number.isInteger(this.config.trendDays) && this.config.trendDays > 0 ? this.config.trendDays : 30)
    const trendKeys = recentDayKeys(todayKey, trendDays)
    const scopeKeys = scoped ? recentDayKeys(todayKey, scope) : null
    const scopeKeySet = scopeKeys ? new Set(scopeKeys) : null
    const scopeStartMs = scoped ? dayStartMs(scopeKeys[0], timeZone) : 0
    // Scoped duration is also clipped at the end of today so a corrupt future
    // clock cannot make a 7-day view report more than seven days.
    const scopeEndMs = scoped ? dayStartMs(shiftDayKey(todayKey, 1), timeZone) : 0
    const previousTrendKeys = recentDayKeys(shiftDayKey(trendKeys[0], -1), trendDays)
    const previousTrendSet = new Set(previousTrendKeys)
    const daily = new Map(trendKeys.map((date) => [date, {
      date,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costCny: 0,
    }]))
    const totals = emptyUsage()
    const composition = emptyUsage()
    const previousDaily = new Map(previousTrendKeys.map((date) => [date, {
      date,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costCny: 0,
    }]))
    const previousTotals = emptyUsage()
    let previousCostCny = 0
    let previousWithUsage = 0
    let costCny = 0
    let withUsage = 0
    let newest = 0
    let since = 0
    const ranking = []

    for (const session of sessions) {
      // Lifetime or windowed usage for this session. Day buckets carry both
      // the token classes and the already-priced cost of their samples.
      let usage = session.usage
      let sessionCost = session.costCny
      let scopedModel = null
      if (scoped) {
        usage = emptyUsage()
        sessionCost = 0
        const modelTotals = Object.create(null)
        for (const [date, bucket] of Object.entries(session.days)) {
          if (!scopeKeySet.has(date)) continue
          addUsage(usage, bucket)
          sessionCost += bucket.costCny
          for (const model of Object.values(bucket.models || {})) {
            let aggregate = modelTotals[`${model.provider || ''}/${model.model || ''}`]
            if (!aggregate) {
              aggregate = modelTotals[`${model.provider || ''}/${model.model || ''}`] = {
                provider: model.provider,
                model: model.model,
                totalTokens: 0,
              }
            }
            aggregate.totalTokens += model.totalTokens
          }
        }
        scopedModel = Object.values(modelTotals).sort((a, b) => b.totalTokens - a.totalTokens)[0] || null
      }

      addUsage(totals, usage)
      addUsage(composition, usage)
      costCny += sessionCost
      if (usage.totalTokens > 0) withUsage += 1
      if (session.createdAt > 0 && (since === 0 || session.createdAt < since)) since = session.createdAt
      if ((!scoped || usage.totalTokens > 0) && session.updatedAt > newest) newest = session.updatedAt

      // The trend chart always draws the last `trendDays` calendar days; its
      // window is independent from the session ranking when scope is all-time.
      for (const [date, bucket] of Object.entries(session.days)) {
        const target = daily.get(date)
        if (target) {
          target.inputTokens += bucket.inputTokens
          target.outputTokens += bucket.outputTokens
          target.cacheReadTokens += bucket.cacheReadTokens
          target.cacheWriteTokens += bucket.cacheWriteTokens
          target.totalTokens += bucket.totalTokens
          target.costCny += bucket.costCny
        }
        const previous = previousDaily.get(date)
        if (previous) {
          previous.inputTokens += bucket.inputTokens
          previous.outputTokens += bucket.outputTokens
          previous.cacheReadTokens += bucket.cacheReadTokens
          previous.cacheWriteTokens += bucket.cacheWriteTokens
          previous.totalTokens += bucket.totalTokens
          previous.costCny += bucket.costCny
          addUsage(previousTotals, bucket)
          previousCostCny += bucket.costCny
        }
      }
      if (scoped) {
        let hadPreviousUsage = false
        for (const [date, bucket] of Object.entries(session.days)) {
          if (previousTrendSet.has(date) && bucket.totalTokens > 0) {
            hadPreviousUsage = true
            break
          }
        }
        if (hadPreviousUsage) previousWithUsage += 1
      }

      if (scoped && usage.totalTokens === 0) continue
      // Scoped rows describe activity inside the selected window only, so the
      // tooltip's span and first/last instants stay consistent with the
      // clipped active time.
      const durationIntervals = scoped
        ? clipActivityIntervals(session.activityIntervals, scopeStartMs, scopeEndMs)
        : session.activityIntervals
      const durationBounds = activityBounds(durationIntervals)
      const durationMs = scoped
        ? durationIntervals.reduce((sum, [from, to]) => sum + (to - from), 0)
        : (session.activeMs || 0)
      // Total time is the wall-clock span the session covers: creation to the
      // last actual activity. It deliberately stops at `lastActivityAt` rather
      // than `updatedAt`, because a trailing `session/end-seed` marker can be
      // written days later and would otherwise resurrect the old 100h+ artifact
      // (e.g. a 1.7h session reporting 266h). A scoped view intersects it with
      // the selected window.
      const activityEnd = session.lastActivityAt || 0
      const totalStart = scoped ? Math.max(session.createdAt, scopeStartMs) : session.createdAt
      const totalEnd = scoped ? Math.min(activityEnd, scopeEndMs) : activityEnd
      const totalValid = totalEnd > totalStart
      const totalMs = totalValid ? totalEnd - totalStart : 0
      ranking.push({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        workspace: workspaceName(session.cwd),
        model: scopedModel ? scopedModel.model : session.model,
        provider: scopedModel ? scopedModel.provider : session.provider,
        agentPreset: session.agentPreset,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        // `durationMs` is active time; `totalMs` keeps the wall-clock span so
        // the UI can show both metrics side by side. The first-to-last
        // activity span stays available for the explanatory tooltip.
        durationMs,
        totalMs,
        totalStartAt: totalValid ? totalStart : 0,
        totalEndAt: totalValid ? totalEnd : 0,
        spanMs: scoped ? durationBounds.spanMs : (session.spanMs || 0),
        firstActivityAt: scoped ? durationBounds.firstActivityAt : (session.firstActivityAt || 0),
        lastActivityAt: scoped ? durationBounds.lastActivityAt : (session.lastActivityAt || 0),
        tokens: usage.totalTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costCny: sessionCost,
        parentSession: session.parentSession || '',
      })
    }

    ranking.sort((a, b) => b.tokens - a.tokens)
    const rankingTotal = ranking.length
    const rankingLimit = Number.isInteger(this.config.rankingLimit) && this.config.rankingLimit > 0 ? this.config.rankingLimit : 100
    const rankingPage = ranking.slice(0, rankingLimit)
    // The UI also ranks by duration; slicing only the token order would make
    // that view incomplete for users with many sessions, so cap both orders.
    // Same ordering as the client's duration view: active time first, then the
    // wall-clock total, then spend. Keeping both sites identical makes the
    // sliced page and its rendered order agree.
    const rankingDuration = [...ranking]
      .sort((a, b) => (b.durationMs - a.durationMs) || (b.totalMs - a.totalMs) || (b.tokens - a.tokens))
      .slice(0, rankingLimit)
    const denominator = composition.cacheReadTokens + composition.inputTokens
    const cacheHitRate = denominator > 0 ? composition.cacheReadTokens / denominator : 0
    const avgTokensPerSession = withUsage > 0 ? totals.totalTokens / withUsage : 0
    const dayList = trendKeys.map((date) => daily.get(date))
    const previousDayList = previousTrendKeys.map((date) => previousDaily.get(date))
    const previousDenominator = previousTotals.cacheReadTokens + previousTotals.inputTokens
    const previousCacheHitRate = previousDenominator > 0 ? previousTotals.cacheReadTokens / previousDenominator : 0
    const previousAverage = previousWithUsage > 0 ? previousTotals.totalTokens / previousWithUsage : 0

    return {
      generatedAt: now,
      sequence: this.sequence,
      scannedAt: this.scannedAt,
      ageMs: this.scannedAt > 0 ? now - this.scannedAt : null,
      files: rawSessions.length,
      sessions: sessions.length,
      duplicates,
      truncated: this.truncated,
      errors: this.errors,
      skipped: this.skipped,
      timeZone,
      idleGapMs: this.config.idleGapMs,
      scope,
      trendDays,
      scopeRange: scopeKeys ? { from: scopeKeys[0], to: scopeKeys[scopeKeys.length - 1] } : null,
      range: { from: trendKeys[0], to: trendKeys[trendKeys.length - 1] },
      totals: {
        ...totals,
        costCny,
        sessions: scoped ? withUsage : sessions.length,
        sessionsWithUsage: withUsage,
        averageTokensPerSession: avgTokensPerSession,
        cacheHitRate,
        newestActivityAt: newest,
      },
      composition,
      previous: scoped
        ? {
            ...previousTotals,
            costCny: previousCostCny,
            sessionsWithUsage: previousWithUsage,
            averageTokensPerSession: previousAverage,
            cacheHitRate: previousCacheHitRate,
          }
        : null,
      daily: dayList,
      previousDaily: previousDayList,
      // In a scoped view the meaningful baseline is the window start, not the
      // first session ever recorded (which can predate the window by months).
      since: scoped ? scopeStartMs : (since || null),
      ranking: rankingPage,
      rankingDuration,
      rankingTotal,
      pricing: this.pricing.summary(),
    }
  }
  async snapshot(scope = this.config.scope, force = false, dayTimeZone) {
    // Store-level callers get the documented configured-zone fallback; the HTTP
    // layer resolves the browser zone before calling. Background scans call
    // `ensureFresh` directly so they keep warming the corpus in use.
    const requested = resolveTimeZone(dayTimeZone, this.pricing.timeZone)
    const { sessions, zone } = await this.ensureFresh(force, requested)
    // `zone` can differ from `requested` while a rebuild is throttled: the
    // snapshot must be labelled in the calendar it was actually built for.
    return this.buildSnapshot(scope, zone, sessions)
  }
}
