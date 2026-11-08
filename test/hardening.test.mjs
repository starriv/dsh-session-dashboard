import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { resolveConfig } from '../host/config.js'
import { normalizeScope } from '../host/scope.js'
import { parseSessionLog } from '../host/session-log.js'
import { StatsStore } from '../host/store.js'
import { dayKeyOf, dayStartMs } from '../host/time.js'

const ZONE = 'Asia/Shanghai'
const time = Date.UTC(2026, 10, 4, 2, 0)
const JSONL = (events) => events.map((event) => JSON.stringify(event)).join('\n')

function parse(lines) {
  return parseSessionLog(JSONL(lines), {
    costOf: (usage) => (usage.totalTokens > 0 ? 0.5 : 0),
    timeZone: ZONE,
  })
}

function session(id, updatedAt, tokens) {
  return {
    id,
    title: id,
    cwd: '/tmp/demo',
    model: 'deepseek-flash',
    provider: 'deepseek-account',
    usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens },
    costCny: 0.5,
    days: {},
    createdAt: time - 10_000,
    updatedAt,
    activeMs: 0,
    spanMs: 0,
    firstActivityAt: 0,
    lastActivityAt: 0,
    activityIntervals: [],
  }
}

test('malformed usage is clamped and a zero settlement replaces the prior attempt', () => {
  const sessionLog = parse([
    { type: 'session', version: 4, id: 'hardening-usage', createdAt: time - 1000, cwd: '/tmp/demo' },
    { type: 'assistant/message', seq: 1, time, data: { turn: 1, step: 1, usage: { inputTokens: -50, outputTokens: 1e308, cacheReadTokens: 10, cacheWriteTokens: 0 } } },
  ])
  assert.equal(sessionLog.usage.inputTokens, 0)
  assert.equal(sessionLog.usage.outputTokens, 0)
  assert.equal(sessionLog.usage.cacheReadTokens, 10)
  assert.equal(sessionLog.usage.totalTokens, 10)
  assert.ok(Number.isFinite(sessionLog.costCny))

  const zeroed = parse([
    { type: 'session', version: 4, id: 'hardening-zero', createdAt: time - 1000, cwd: '/tmp/demo' },
    { type: 'assistant/message', seq: 1, time, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { type: 'assistant/message', seq: 2, time: time + 1, data: { turn: 1, step: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ])
  assert.equal(zeroed.usage.totalTokens, 0)
  assert.equal(zeroed.costCny, 0)
})

test('an out-of-range event timestamp does not drop the rest of the session', () => {
  const parsed = parse([
    { type: 'session', version: 4, id: 'hardening-time', createdAt: time - 1000, cwd: '/tmp/demo' },
    { type: 'assistant/message', seq: 1, time: 1e20, data: { turn: 1, step: 1, usage: { inputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { type: 'assistant/message', seq: 2, time: time + 1000, data: { turn: 2, step: 1, usage: { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ])
  assert.equal(parsed.usage.inputTokens, 12)
  assert.ok(parsed.days[dayKeyOf(time + 1000, ZONE)])
})

test('duplicate header ids are folded once, keeping the freshest copy', () => {
  const config = resolveConfig({
    scope: 'all', trendDays: 7, timeZone: ZONE, refreshMs: 0, dshHome: '/tmp/dsh-hardening', sessionsRoot: '/tmp/dsh-hardening/sessions',
  })
  const store = new StatsStore(config)
  store.parsed = [
    session('dup-id', time, 10),
    session('dup-id', time + 1000, 20),
    session('unique-id', time + 500, 3),
  ]
  const snapshot = store.buildSnapshot('all')
  assert.equal(snapshot.files, 3)
  assert.equal(snapshot.sessions, 2)
  assert.equal(snapshot.duplicates, 1)
  assert.equal(snapshot.totals.totalTokens, 23)
  assert.deepEqual(snapshot.ranking.map((row) => row.id).sort(), ['dup-id', 'unique-id'])
})

test('store ranks active duration and clips it to the selected scope', () => {
  const config = resolveConfig({
    scope: 'all', trendDays: 7, timeZone: 'UTC', refreshMs: 0,
    dshHome: '/tmp/dsh-hardening', sessionsRoot: '/tmp/dsh-hardening/sessions', rankingLimit: 10,
  })
  const store = new StatsStore(config)
  const todayStart = dayStartMs(dayKeyOf(Date.now(), 'UTC'), 'UTC')
  const threeDaysAgo = todayStart - 3 * 86_400_000
  const morning = 10 * 3_600_000
  const hour = 3_600_000
  const tomorrow = todayStart + 86_400_000
  store.parsed = [{
    ...session('active-session', tomorrow + morning, 100),
    createdAt: threeDaysAgo + morning,
    activityIntervals: [
      [threeDaysAgo + morning, threeDaysAgo + morning + hour],
      [todayStart + morning, todayStart + morning + hour],
      // An isolated in-window event: zero duration, but it still sets the
      // scoped first/last activity bounds.
      [todayStart + 20 * hour, todayStart + 20 * hour],
      // A clock-skewed future stretch must not leak into a scoped window.
      [tomorrow + 5 * 60_000, tomorrow + 65 * 60_000],
    ],
    activeMs: 3 * hour,
    spanMs: 3 * 86_400_000 + 6 * hour,
    firstActivityAt: threeDaysAgo + morning,
    lastActivityAt: tomorrow + 65 * 60_000,
    days: {
      [dayKeyOf(todayStart + morning, 'UTC')]: {
        inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100, costCny: 0, models: {},
      },
    },
  }]

  assert.equal(store.buildSnapshot('all').idleGapMs, 10 * 60 * 1000)
  const all = store.buildSnapshot('all')
  assert.equal(all.ranking[0].durationMs, 3 * hour)
  assert.equal(all.ranking[0].totalMs, 3 * 86_400_000 + 15 * 3_600_000 + 5 * 60_000)
  assert.equal(all.ranking[0].spanMs, 3 * 86_400_000 + 6 * hour)
  assert.equal(all.rankingDuration[0].durationMs, 3 * hour)

  // "Last 2 days" starts yesterday, so only today's stretch counts.
  const scoped = store.buildSnapshot(2)
  assert.equal(scoped.ranking[0].durationMs, hour)
  assert.equal(scoped.ranking[0].totalMs, 2 * 86_400_000)
  assert.equal(scoped.ranking[0].totalStartAt, todayStart - 86_400_000)
  assert.equal(scoped.ranking[0].totalEndAt, tomorrow)
  assert.equal(scoped.ranking[0].spanMs, 10 * hour)
  assert.equal(scoped.ranking[0].firstActivityAt, todayStart + morning)
  assert.equal(scoped.ranking[0].lastActivityAt, todayStart + 20 * hour)
})

test('trailing end-seed markers do not extend total time', () => {
  const config = resolveConfig({
    scope: 'all', trendDays: 7, timeZone: ZONE, refreshMs: 0,
    dshHome: '/tmp/dsh-hardening', sessionsRoot: '/tmp/dsh-hardening/sessions', rankingLimit: 10,
  })
  const store = new StatsStore(config)
  const hour = 3_600_000
  store.parsed = [{
    ...session('marker-tail', time + 265 * hour, 10),
    createdAt: time,
    activityIntervals: [[time, time + 2 * hour]],
    activeMs: 2 * hour,
    spanMs: 2 * hour,
    firstActivityAt: time,
    lastActivityAt: time + 2 * hour,
  }]
  const row = store.buildSnapshot('all').ranking[0]
  // updatedAt still records the later marker for freshness/dedupe, but the
  // displayed total stops at the last real activity.
  assert.ok(row.updatedAt > row.lastActivityAt)
  assert.equal(row.totalMs, 2 * hour)
  assert.equal(row.totalEndAt, time + 2 * hour)
})

test('duration ranking ties break by total time before spend', () => {
  const config = resolveConfig({
    scope: 'all', trendDays: 7, timeZone: ZONE, refreshMs: 0,
    dshHome: '/tmp/dsh-hardening', sessionsRoot: '/tmp/dsh-hardening/sessions', rankingLimit: 10,
  })
  const store = new StatsStore(config)
  const hour = 3_600_000
  // Same active time; "larger-total" has the longer wall-clock span but less
  // spend, so a total-time tie breaker must rank it before a token tie breaker.
  store.parsed = [
    { ...session('smaller-total', time + 3 * hour, 100), createdAt: time, lastActivityAt: time + 3 * hour, activeMs: 2 * hour },
    { ...session('larger-total', time + 5 * hour, 50), createdAt: time, lastActivityAt: time + 5 * hour, activeMs: 2 * hour },
  ]
  const snapshot = store.buildSnapshot('all')
  assert.deepEqual(snapshot.ranking.map((row) => row.id), ['smaller-total', 'larger-total'])
  assert.deepEqual(snapshot.rankingDuration.map((row) => row.id), ['larger-total', 'smaller-total'])
  assert.equal(snapshot.rankingDuration[0].totalMs, 5 * hour)
})

test('scope parsing rejects partially numeric and exponent values', () => {
  assert.equal(normalizeScope('7'), 7)
  assert.equal(normalizeScope('07'), 7)
  assert.equal(normalizeScope('7abc'), 'all')
  assert.equal(normalizeScope('1e3'), 'all')
  assert.equal(normalizeScope('0'), 'all')
  assert.equal(normalizeScope('91'), 'all')
})

test('plain JSONL larger than the decoded budget is skipped and reported', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-stats-hardening-'))
  const sessionDir = path.join(home, 'sessions', 'proj', 'session-big')
  await mkdir(sessionDir, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 4, id: 'big-log', createdAt: time, cwd: '/tmp/demo' })
  await writeFile(path.join(sessionDir, 'session.v4.jsonl'), `${header}\n${'x'.repeat(2048)}\n`)
  try {
    const store = new StatsStore(resolveConfig({
      scope: 'all', trendDays: 7, timeZone: ZONE, refreshMs: 0, dshHome: home,
      sessionsRoot: path.join(home, 'sessions'), maxDecodedBytes: 1024,
    }))
    await store.scan()
    const snapshot = store.buildSnapshot('all')
    assert.equal(store.errors, 1)
    assert.equal(snapshot.files, 0)
    assert.equal(snapshot.skipped[0].reason, 'over-budget')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('dayStartMs returns a finite instant for a DST boundary', () => {
  const start = dayStartMs('2026-09-06', 'America/Santiago')
  assert.ok(Number.isFinite(start))
  assert.ok(Number.isFinite(dayStartMs('2026-03-08', 'America/Havana')))
})
