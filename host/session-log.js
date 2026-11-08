/**
 * One session log in, one immutable usage record out.
 *
 * The fold mirrors the official `tokenUsage` projection: usage comes from the
 * provider sample on an `assistant/message` settlement, or the last usage chunk
 * embedded in an `assistant/message`/`assistant/attempt` stream. A later sample
 * for the same `(turn, step)` replaces the earlier one, while
 * `llm/retry-started` closes that slot so a retried attempt is billed again.
 * Model attribution comes from the sample's own `message.source`, with the
 * latest `request/header` config as a fallback.
 */

import { DEFAULT_IDLE_GAP_MS, activityBounds, clipDurationMs, mergeActivityIntervals } from './activity.js'
import { dayKeyOf } from './time.js'

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
}

function addUsage(target, usage) {
  target.inputTokens += usage.inputTokens || 0
  target.outputTokens += usage.outputTokens || 0
  target.cacheReadTokens += usage.cacheReadTokens || 0
  target.cacheWriteTokens += usage.cacheWriteTokens || 0
  target.totalTokens =
    target.inputTokens + target.outputTokens + target.cacheReadTokens + target.cacheWriteTokens
}

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
const MAX_SAMPLE_TOKENS = 2 ** 40

/** Keep one sample finite and non-negative; invalid fields are treated as 0. */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  // A present usage object with an all-zero body is meaningful: it can replace
  // an earlier attempt for the same (turn, step) instead of being ignored.
  if (!USAGE_FIELDS.some((field) => raw[field] !== undefined)) return null
  const usage = {}
  for (const field of USAGE_FIELDS) {
    const value = raw[field]
    usage[field] = Number.isSafeInteger(value) && value >= 0
      ? Math.min(value, MAX_SAMPLE_TOKENS)
      : 0
  }
  usage.totalTokens = USAGE_FIELDS.reduce((sum, field) => sum + usage[field], 0)
  return usage
}

function emptyDay() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costCny: 0,
    models: Object.create(null),
  }
}

function addToDay(day, usage, cost) {
  day.inputTokens += usage.inputTokens
  day.outputTokens += usage.outputTokens
  day.cacheReadTokens += usage.cacheReadTokens
  day.cacheWriteTokens += usage.cacheWriteTokens
  day.totalTokens += usage.totalTokens
  day.costCny += cost
}

function subtractUsage(target, usage) {
  target.inputTokens -= usage.inputTokens
  target.outputTokens -= usage.outputTokens
  target.cacheReadTokens -= usage.cacheReadTokens
  target.cacheWriteTokens -= usage.cacheWriteTokens
  target.totalTokens =
    target.inputTokens + target.outputTokens + target.cacheReadTokens + target.cacheWriteTokens
}

function subtractFromDay(day, usage, cost) {
  day.inputTokens -= usage.inputTokens
  day.outputTokens -= usage.outputTokens
  day.cacheReadTokens -= usage.cacheReadTokens
  day.cacheWriteTokens -= usage.cacheWriteTokens
  day.totalTokens -= usage.totalTokens
  day.costCny -= cost
}

function sameUsage(left, right) {
  return left.inputTokens === right.inputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

/** Official `usageOf`: a settlement may carry usage only in its embedded stream. */
function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (!record) continue
    const chunk = record.type === 'chunk' ? record.chunk : record
    if (chunk && chunk.type === 'usage' && chunk.usage) return chunk.usage
  }
  return undefined
}

function usageOf(event) {
  const data = event.data || {}
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastStreamUsage(data.stream)
}

/**
 * Discover the inherited prefix cut from the current format's tagged
 * `session/end-seed` marker. The marker's seq is the number of copied parent
 * events (the child's first own event follows it). A plain `{}` marker at the
 * end of a normal session is not an inherited marker and is ignored.
 */
function inheritedCutOf(lines) {
  let cut = 0
  for (const line of lines) {
    if (!line.includes('session/end-seed')) continue
    try {
      const event = JSON.parse(line)
      if (event && event.type === 'session/end-seed' && event.data && event.data.inherited === true) {
        if (Number.isSafeInteger(event.seq)) cut = Math.max(cut, event.seq)
      }
    } catch {
      // A partial line is handled by the main fold.
    }
  }
  return cut
}

/**
 * Parse a decoded JSONL session log.
 *
 * @param {string} text decoded JSONL
 * @param {object} options
 * @param {(usage: object, model: string, provider: string, timeMs: number) => number} options.costOf
 * @param {string} options.timeZone IANA zone used for day buckets
 * @param {number} [options.idleGapMs] gap still counted as continuous activity
 */
const MAX_EVENT_TIME = 8.64e15

function safeEventTime(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_EVENT_TIME ? value : 0
}

export function parseSessionLog(text, { costOf, timeZone, idleGapMs = DEFAULT_IDLE_GAP_MS }) {
  const lines = text.split('\n')
  let header = null
  let inheritedCut = inheritedCutOf(lines)
  let title = ''
  let firstTime = 0
  let lastTime = 0
  const eventTimes = []
  let requestModel = ''
  let requestProvider = ''
  let lastModel = ''
  let lastProvider = ''
  const usage = emptyUsage()
  const days = Object.create(null)
  const models = Object.create(null)
  let lastSlot = null

  for (const line of lines) {
    if (!line) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      // A partial last line while the session is being written.
      continue
    }
    if (!header) {
      if (event && event.type === 'session') {
        header = event
        // Historical seeded headers used a numeric seedLength instead of the
        // tagged marker; accept it as a best-effort cut.
        for (const field of ['inheritedEventCount', 'seedLength']) {
          if (Number.isFinite(header[field])) inheritedCut = Math.max(inheritedCut, header[field])
        }
        continue
      }
      // Tolerate a log that begins with another envelope: treat it as data.
      header = { id: '', createdAt: 0 }
    }

    // Forked sessions begin with the source prefix. Its inherited events are
    // not this session's own spend: the tagged marker's seq is the prefix cut.
    if (inheritedCut > 0 && Number.isSafeInteger(event.seq) && event.seq < inheritedCut) continue

    const eventTime = safeEventTime(event.time)
    if (eventTime > 0) {
      // Seed boundary markers are bookkeeping, not activity; a plain tail
      // marker written at the end of a normal session must not extend a span.
      if (event.type !== 'session/end-seed') eventTimes.push(eventTime)
      if (firstTime === 0 || eventTime < firstTime) firstTime = eventTime
      if (eventTime > lastTime) lastTime = eventTime
    }

    switch (event.type) {
      case 'session/title': {
        const next = event.data && event.data.title
        if (typeof next === 'string' && next.trim()) title = next.trim()
        break
      }
      case 'request/header': {
        const config = event.data && event.data.header && event.data.header.config
        if (config) {
          if (typeof config.model === 'string') requestModel = config.model
          if (typeof config.provider === 'string') requestProvider = config.provider
        }
        break
      }
      case 'llm/retry-started': {
        const data = event.data || {}
        if (lastSlot && lastSlot.turn === data.turn && lastSlot.step === data.step) lastSlot = null
        break
      }
      case 'assistant/message':
      case 'assistant/attempt': {
        const data = event.data || {}
        const sample = normalizeUsage(usageOf(event))
        if (!sample) break
        const source = (data.message && data.message.source) || {}
        const model = typeof source.model === 'string' && source.model ? source.model : requestModel
        const provider = typeof source.provider === 'string' && source.provider ? source.provider : requestProvider
        const timeMs = eventTime || lastTime || safeEventTime(header && header.createdAt) || 0
        const turn = Number.isInteger(data.turn) ? data.turn : -1
        const step = Number.isInteger(data.step) ? data.step : -1
        lastModel = model
        lastProvider = provider
        const modelKey = model ? `${provider ? `${provider}/` : ''}${model}` : 'unknown'

        if (lastSlot && lastSlot.turn === turn && lastSlot.step === step) {
          if (sameUsage(lastSlot.usage, sample)) break
          // Remove the sample this slot replaced before adding the newer one.
          subtractUsage(usage, lastSlot.usage)
          if (days[lastSlot.dayKey]) subtractFromDay(days[lastSlot.dayKey], lastSlot.usage, lastSlot.cost)
          const previousModel = models[lastSlot.modelKey]
          if (previousModel) {
            subtractUsage(previousModel, lastSlot.usage)
            previousModel.costCny -= lastSlot.cost
            previousModel.samples -= 1
          }
          const previousDay = days[lastSlot.dayKey]
          const previousDayModel = previousDay && previousDay.models[lastSlot.modelKey]
          if (previousDayModel) {
            subtractUsage(previousDayModel, lastSlot.usage)
            previousDayModel.costCny -= lastSlot.cost
            previousDayModel.samples -= 1
          }
        }

        const cost = costOf(sample, model, provider, timeMs)
        const dayKey = dayKeyOf(timeMs, timeZone)
        let day = days[dayKey]
        if (!day) day = days[dayKey] = emptyDay()
        addUsage(usage, sample)
        addToDay(day, sample, cost)

        let bucket = models[modelKey]
        if (!bucket) {
          bucket = models[modelKey] = {
            key: modelKey,
            provider,
            model,
            ...emptyUsage(),
            costCny: 0,
            samples: 0,
          }
        }
        addUsage(bucket, sample)
        bucket.costCny += cost
        bucket.samples += 1

        // Scoped snapshots need the model that dominated inside the window,
        // not necessarily the session's all-time primary model.
        let dayBucket = day.models[modelKey]
        if (!dayBucket) {
          dayBucket = day.models[modelKey] = {
            provider,
            model,
            ...emptyUsage(),
            costCny: 0,
            samples: 0,
          }
        }
        addUsage(dayBucket, sample)
        dayBucket.costCny += cost
        dayBucket.samples += 1
        lastSlot = {
          turn,
          step,
          usage: sample,
          cost,
          dayKey,
          modelKey,
        }
        break
      }
      default:
        break
    }
  }

  if (!header) return null

  const id = typeof header.id === 'string' ? header.id : ''
  const declaredCreatedAt = safeEventTime(header.createdAt) > 0 ? safeEventTime(header.createdAt) : 0
  const createdAt = declaredCreatedAt || firstTime || lastTime || 0
  const modelEntries = Object.values(models)
    .filter((entry) => entry.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens)
  const primary = modelEntries[0]
  let costCny = 0
  for (const value of Object.values(days)) costCny += value.costCny
  // Duration is derived from this session's own events only: the wall-clock
  // span from first to last event is kept for context, while `activeMs`
  // excludes idle gaps and is what the dashboard ranks and displays.
  const activityIntervals = mergeActivityIntervals(eventTimes, idleGapMs)
  const activeMs = clipDurationMs(activityIntervals)
  const { firstActivityAt, lastActivityAt, spanMs } = activityBounds(activityIntervals)

  return {
    id,
    title: title || '',
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    createdAt,
    updatedAt: lastTime || createdAt,
    activeMs,
    spanMs,
    firstActivityAt,
    lastActivityAt,
    activityIntervals,
    isSeeded: Boolean(header.isSeeded),
    parentSession: typeof header.parentSession === 'string' ? header.parentSession : '',
    agentPreset: typeof header.agentPreset === 'string' ? header.agentPreset : '',
    model: primary ? primary.model : lastModel,
    provider: primary ? primary.provider : lastProvider,
    models: modelEntries,
    usage,
    costCny,
    days,
  }
}

