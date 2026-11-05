import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../host/config.js'
import { createPricing } from '../host/pricing.js'
import { parseSessionLog } from '../host/session-log.js'
import { StatsStore, pickSessionFileName } from '../host/store.js'
import { dayKeyOf, dayStartMs, recentDayKeys } from '../host/time.js'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions')
const ZONE = 'Asia/Shanghai'

async function hasSessions() {
  try {
    const dirs = await readdir(SESSIONS_ROOT)
    return dirs.length > 0
  } catch {
    return false
  }
}

function createStore() {
  return new StatsStore(resolveConfig({
    scope: 'all',
    trendDays: 30,
    timeZone: ZONE,
    refreshMs: 0,
    runtimeSampleMs: 5000,
    historySize: 60,
    dshHome: DSH_HOME,
    sessionsRoot: SESSIONS_ROOT,
    maxSessions: 10_000,
    rankingLimit: 2000,
  }))
}

test('selects the highest compressed session-log generation', () => {
  assert.equal(pickSessionFileName(['session.v3.jsonl.zstd', 'session.v4.jsonl.zstd']), 'session.v4.jsonl.zstd')
  assert.equal(pickSessionFileName(['session.v4.jsonl', 'session.v4.jsonl.zstd']), 'session.v4.jsonl.zstd')
  assert.equal(pickSessionFileName(['session.v2.jsonl.zstd']), 'session.v2.jsonl.zstd')
  assert.equal(pickSessionFileName(['session.lock', 'notes.txt']), '')
})

test('partial pricing overrides inherit the built-in model prices', () => {
  const pricing = createPricing({ pricing: { 'deepseek-v4-pro': { peak: { output: 20 } } } })
  const model = pricing.summary().models['deepseek-v4-pro']
  assert.equal(model.peak.input, 9)
  assert.equal(model.peak.cacheRead, 0.3)
  assert.equal(model.peak.output, 20)
  assert.equal(model.peak.cacheWrite, 9)
  const peak = Date.UTC(2026, 10, 4, 2, 0)
  assert.equal(
    pricing.costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-v4-pro', 'deepseek-account', peak),
    29,
  )
})

test('invalid time zones fall back instead of crashing Intl', () => {
  const pricing = createPricing({ timeZone: 'Not/AZone' })
  assert.equal(pricing.timeZone, 'Asia/Shanghai')
})

test('calendar-day boundaries resolve in the configured zone', () => {
  assert.equal(dayStartMs('2026-11-05', 'Asia/Shanghai'), Date.UTC(2026, 10, 4, 16, 0))
  assert.equal(dayStartMs('2026-11-05', 'UTC'), Date.UTC(2026, 10, 5, 0, 0))
})

test('pricing distinguishes peak and idle windows', () => {
  const pricing = createPricing({ timeZone: ZONE })
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  // Wednesday 10:00 Asia/Shanghai (peak) vs 13:00 (idle).
  const peak = Date.UTC(2026, 10, 4, 2, 0)
  const idle = Date.UTC(2026, 10, 4, 5, 0)
  const peakCost = pricing.costOf(usage, 'deepseek-flash', 'deepseek-account', peak)
  const idleCost = pricing.costOf(usage, 'deepseek-flash', 'deepseek-account', idle)
  assert.equal(pricing.isPeak(peak), true)
  assert.equal(pricing.isPeak(idle), false)
  assert.equal(peakCost, 2)
  assert.equal(idleCost, 1)
})

test('parseSessionLog folds usage, day buckets and model attribution', () => {
  const time = Date.UTC(2026, 10, 4, 2, 0)
  const lines = [
    { type: 'session', version: 4, id: 'session-test', createdAt: time - 1000, cwd: '/tmp/demo', isSeeded: false },
    { type: 'session/title', seq: 1, time, data: { title: 'Demo session' } },
    { type: 'request/header', seq: 2, time, data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash' } } } },
    {
      type: 'assistant/message',
      seq: 3,
      time: time + 1000,
      data: {
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0 },
        message: { source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' } },
      },
    },
  ]
  const costOf = () => 0.5
  const session = parseSessionLog(lines.map((line) => JSON.stringify(line)).join('\n'), {
    costOf,
    timeZone: ZONE,
  })
  assert.equal(session.id, 'session-test')
  assert.equal(session.title, 'Demo session')
  assert.equal(session.usage.inputTokens, 10)
  assert.equal(session.usage.outputTokens, 20)
  assert.equal(session.usage.cacheReadTokens, 100)
  assert.equal(session.usage.totalTokens, 130)
  assert.equal(session.costCny, 0.5)
  assert.equal(session.models[0].model, 'deepseek-flash')
  assert.equal(session.days[dayKeyOf(time + 1000, ZONE)].totalTokens, 130)
})

test('forked sessions exclude the inherited prefix from usage and titles', () => {
  const time = Date.UTC(2026, 10, 4, 2, 0)
  const parentUsage = { inputTokens: 100, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 0 }
  const ownUsage = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 }
  const lines = [
    { type: 'session', version: 4, id: 'session-fork', createdAt: time, cwd: '/tmp/demo', isSeeded: true },
    { type: 'user/message', seq: 0, time, data: {} },
    { type: 'assistant/message', seq: 1, time: time + 1, data: { usage: parentUsage, message: { source: { model: 'deepseek-flash' } } } },
    { type: 'session/end-seed', seq: 2, time: time + 2, data: { inherited: true } },
    { type: 'session/title', seq: 3, time: time + 3, data: { title: 'Child title' } },
    { type: 'assistant/message', seq: 4, time: time + 4, data: { usage: ownUsage, message: { source: { model: 'deepseek-flash' } } } },
  ]
  const session = parseSessionLog(lines.map((line) => JSON.stringify(line)).join('\n'), {
    costOf: () => 0,
    timeZone: ZONE,
  })
  assert.equal(session.usage.inputTokens, ownUsage.inputTokens)
  assert.equal(session.usage.outputTokens, ownUsage.outputTokens)
  assert.equal(session.usage.cacheReadTokens, ownUsage.cacheReadTokens)
  assert.equal(session.usage.totalTokens, 6)
  assert.equal(session.title, 'Child title')
})

test('usage fold mirrors the official retry/replacement semantics', () => {
  const time = Date.UTC(2026, 10, 4, 2, 0)
  const usage = (input, output) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const stream = (value) => [{ type: 'chunk', time, chunk: { type: 'usage', usage: value } }]
  const settle = (seq, turn, step, value, extra = {}) => ({
    type: 'assistant/message',
    seq,
    time: time + seq,
    data: { turn, step, ...(value !== undefined ? { usage: value } : {}), ...extra, message: { source: { model: 'deepseek-flash' } } },
  })
  const events = [
    { type: 'session', version: 4, id: 'session-retry', createdAt: time, cwd: '/tmp/demo', isSeeded: false },
    // A first attempt with usage is unsettled until the replacement slot closes.
    { type: 'assistant/attempt', seq: 0, time: time + 1, data: { turn: 1, step: 1, stream: stream(usage(10, 0)) } },
    { type: 'assistant/attempt', seq: 1, time: time + 2, data: { turn: 1, step: 1, stream: stream(usage(30, 0)) } },
    // Replacement within one step: 30 wins over 10.
    // Retry boundary: the next attempt contributes in addition.
    { type: 'llm/retry-started', seq: 2, time: time + 3, data: { turn: 1, step: 1 } },
    settle(3, 1, 1, undefined, { stream: stream(usage(100, 20)) }),
    // A second step adds normally.
    settle(4, 1, 2, usage(7, 3)),
  ]
  const session = parseSessionLog(events.map((event) => JSON.stringify(event)).join('\n'), {
    costOf: (value) => value.totalTokens,
    timeZone: ZONE,
  })
  assert.equal(session.costCny, 160)
  assert.equal(session.usage.inputTokens, 30 + 100 + 7)
  assert.equal(session.usage.outputTokens, 0 + 20 + 3)
  assert.equal(session.usage.totalTokens, 160)
})

test('real store snapshot reconciles with the official tokenUsage projection', { skip: !(await hasSessions()) }, async () => {
  const store = createStore()
  await store.ensureFresh(true)
  const snapshot = await store.snapshot('all', true)
  assert.ok(snapshot.files > 0)
  assert.ok(snapshot.totals.totalTokens > 0)
  assert.equal(snapshot.ranking.length, Math.min(snapshot.files, 2000))

  const cacheDir = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
  let exact = 0
  let cacheStale = 0
  for (const row of snapshot.ranking) {
    let record
    try {
      record = JSON.parse(await readFile(path.join(cacheDir, `${row.id}.json`), 'utf8'))
    } catch {
      continue
    }
    const totals = record.record?.rows?.tokenUsage?.val?.totals
    if (!totals) continue
    const same = row.inputTokens === totals.uncachedInputTokens
      && row.outputTokens === totals.outputTokens
      && row.cacheReadTokens === totals.cacheReadTokens
      && row.cacheWriteTokens === totals.cacheWriteTokens
    if (same) {
      exact += 1
      continue
    }
    // A live session's durable log can be ahead of its last projection-cache
    // checkpoint. The log is the source of truth, so the fold may only be
    // ahead of the cache, never behind it.
    cacheStale += 1
    assert.ok(row.inputTokens >= totals.uncachedInputTokens, `${row.id} input regressed`)
    assert.ok(row.outputTokens >= totals.outputTokens, `${row.id} output regressed`)
    assert.ok(row.cacheReadTokens >= totals.cacheReadTokens, `${row.id} cacheRead regressed`)
  }
  assert.ok(exact >= snapshot.ranking.length * 0.5, `expected many sessions to reconcile exactly (${exact}/${snapshot.ranking.length})`)
  assert.ok(cacheStale < snapshot.ranking.length)

  const expectedDays = recentDayKeys(dayKeyOf(Date.now(), ZONE), 30)
  assert.deepEqual(snapshot.daily.map((day) => day.date), expectedDays)
  const windowTotal = snapshot.daily.reduce((sum, day) => sum + day.totalTokens, 0)
  const windowKeys = new Set(expectedDays)
  const windowExpected = store.parsed.reduce((sum, session) => {
    let sessionTotal = 0
    for (const [date, bucket] of Object.entries(session.days)) {
      if (windowKeys.has(date)) sessionTotal += bucket.totalTokens
    }
    return sum + sessionTotal
  }, 0)
  assert.ok(windowTotal > 0)
  assert.equal(windowTotal, windowExpected)
  assert.ok(snapshot.totals.cacheHitRate > 0 && snapshot.totals.cacheHitRate <= 1)
  assert.ok(snapshot.totals.costCny > 0)

  const scoped = await store.snapshot(7, true)
  assert.equal(scoped.scope, 7)
  assert.equal(scoped.daily.length, 7)
  assert.ok(scoped.ranking.every((row) => row.tokens > 0))
  assert.ok(scoped.totals.totalTokens > 0)
  assert.ok(scoped.totals.totalTokens <= snapshot.totals.totalTokens)
  assert.ok(scoped.totals.costCny <= snapshot.totals.costCny + 0.0001)
})
