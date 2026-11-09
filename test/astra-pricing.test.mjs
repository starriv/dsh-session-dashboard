import test from 'node:test'
import assert from 'node:assert/strict'
import { createPricing } from '../host/pricing.js'
import { parseSessionLog } from '../host/session-log.js'

// Portable, synthetic fixtures from the documented community feed v130.
// Never read session files, pricing mirrors, profile configuration, or secrets.
const MODEL = 'gpt-6-astra'
const ZONE = 'Asia/Shanghai'
const PEAK = Date.parse('2026-11-06T10:00:00+08:00') // Friday
const IDLE = Date.parse('2026-11-06T22:00:00+08:00')
const WEEKEND = Date.parse('2026-11-07T10:00:00+08:00')
const BASE = { input: 70, output: 350, cacheRead: 7, cacheWrite: 87.5 }
const LONG = { input: 140, output: 525, cacheRead: 14, cacheWrite: 175 }
const usage = (inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0) =>
  ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })
const policy = (config = {}) => createPricing({ timeZone: ZONE, ...config })
const close = (actual, expected, label = '') => assert.ok(
  Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)),
  `${label}: expected ${expected}, received ${actual}`,
)
const atRates = (u, r) => (u.inputTokens * r.input + u.outputTokens * r.output
  + u.cacheReadTokens * r.cacheRead + u.cacheWriteTokens * r.cacheWrite) / 1_000_000
const reference = (u) => atRates(u,
  u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens >= 272_000 ? LONG : BASE)
const cost = (u, pricing = policy(), time = PEAK, model = MODEL, provider = 'synthetic') =>
  pricing.costOf(u, model, provider, time)
const event = (type, data, time = PEAK) => ({ type, data, time })
const message = (u, step = 0, options = {}) => event('assistant/message', {
  turn: 1, step, usage: u,
  message: { source: { model: MODEL, provider: 'synthetic' } },
  ...options.data,
}, options.time ?? PEAK)
const attempt = (...samples) => event('assistant/attempt', {
  turn: 1, step: 0,
  message: { source: { model: MODEL, provider: 'synthetic' } },
  stream: samples.map((u) => ({ type: 'chunk', chunk: { type: 'usage', usage: u } })),
})
function fold(events, pricing = policy()) {
  const header = { type: 'session', id: 'synthetic-astra', createdAt: PEAK }
  const text = [header, ...events].map((e, seq) => JSON.stringify({ ...e, seq })).join('\n')
  return parseSessionLog(text, { costOf: pricing.costOf, timeZone: ZONE })
}
function assertFoldCost(record, expected) {
  close(record.costCny, expected, 'session')
  close(Object.values(record.days).reduce((sum, day) => sum + day.costCny, 0), expected, 'days')
  close(record.models.reduce((sum, model) => sum + model.costCny, 0), expected, 'models')
  close(Object.values(record.days).flatMap((day) => Object.values(day.models))
    .reduce((sum, model) => sum + model.costCny, 0), expected, 'day models')
}

test('Astra exact boundary selects whole-request rates at 272000', () => {
  close(cost(usage(271_999, 1_000)), 19.38993)
  close(cost(usage(272_000, 1_000)), 38.605)
  close(cost(usage(272_001, 1_000)), 38.60514)
  // At the boundary, both ALL input and output use the elevated rates.
  assert.notEqual(cost(usage(272_000, 1_000)), 272_000 * 70 / 1e6 + 1_000 * 350 / 1e6)
})

test('Astra cache-read and cache-write each contribute to the context threshold', () => {
  for (const u of [
    usage(271_999, 1_000, 1), usage(271_999, 1_000, 0, 1),
    usage(0, 1_000, 272_000), usage(0, 1_000, 0, 272_000),
    usage(100_000, 10_000, 100_000, 71_999),
    usage(100_000, 10_000, 100_000, 72_000),
  ]) close(cost(u), reference(u), JSON.stringify(u))
  close(cost(usage(100_000, 10_000, 100_000, 71_999)), 17.4999125)
  close(cost(usage(100_000, 10_000, 100_000, 72_000)), 33.25)
})

test('Astra output and reported totalTokens never determine context size', () => {
  close(cost(usage(0, 1_000_000)), 350)
  close(cost({ ...usage(1, 1_000_000), totalTokens: 9_000_000 }), 350.00007)
  close(cost({ ...usage(272_000, 1_000), totalTokens: 0 }), 38.605)
})

test('Astra has no weekday, idle, weekend, or timezone discount', () => {
  for (const config of [
    {}, { timeZone: 'UTC' }, { timeZone: 'America/New_York' },
    { peakWindows: [{ days: [6], start: 0, end: 1440 }] },
  ]) {
    const p = policy(config)
    for (const u of [usage(100, 200, 300, 400), usage(272_000, 1_000, 10, 20)]) {
      for (const time of [PEAK, IDLE, WEEKEND]) close(cost(u, p, time), reference(u))
    }
  }
})

test('Astra per-request fold does not select a tier from aggregate tokens', () => {
  const u = usage(136_000, 1_000)
  const record = fold([message(u, 0), message(u, 1)])
  assertFoldCost(record, 19.74)
  assert.equal(record.usage.inputTokens, 272_000)
  assert.equal(record.models[0].samples, 2)
  close(cost(usage(272_000, 2_000)), 39.13)
})

test('Astra attempt uses last stream usage and settlement replaces its old tier cost', () => {
  const old = usage(271_999, 1_000)
  const next = usage(272_000, 1_000)
  assertFoldCost(fold([attempt(usage(1), old)]), reference(old))
  const record = fold([attempt(usage(1), old), message(next), message(next)])
  assertFoldCost(record, 38.605)
  assert.equal(record.usage.inputTokens, 272_000)
  assert.equal(record.models[0].samples, 1)
})

test('Astra replacement can cross down through threshold and across days', () => {
  const record = fold([
    message(usage(272_000, 1_000)),
    message(usage(271_999, 1_000), 0, { time: WEEKEND }),
  ])
  assertFoldCost(record, 19.38993)
  close(record.days['2026-11-06'].costCny, 0)
  close(record.days['2026-11-07'].costCny, 19.38993)
})

test('Astra settlement can supply usage only in its embedded stream', () => {
  const u = usage(272_000, 1_000)
  const record = fold([message(undefined, 0, {
    data: { stream: [{ type: 'usage', usage: usage(1) }, { type: 'usage', usage: u }] },
  })])
  assertFoldCost(record, reference(u))
})

test('Astra retry closes replacement slot and charges both attempts', () => {
  const old = usage(271_999, 1_000)
  const next = usage(272_000, 1_000)
  const record = fold([
    attempt(old), event('llm/retry-started', { turn: 1, step: 0 }), message(next),
  ])
  assertFoldCost(record, reference(old) + reference(next))
  assert.equal(record.models[0].samples, 2)
})

test('Astra tagged inherited seed prefix is not charged in child session', () => {
  const own = usage(136_000, 1_000)
  const record = fold([
    message(usage(1_000_000, 1_000)),
    event('session/end-seed', { inherited: true }),
    message(own, 1),
  ])
  assertFoldCost(record, reference(own))
  assert.equal(record.usage.inputTokens, 136_000)
  assert.equal(record.models[0].samples, 1)
})

test('Astra explicit zero usage replaces prior cost and tokens', () => {
  const record = fold([attempt(usage(272_000, 1_000)), message(usage())])
  assertFoldCost(record, 0)
  assert.equal(record.usage.totalTokens, 0)
  assert.equal(record.models.length, 0)
})

test('Astra source model overrides request header; missing source uses header', () => {
  const header = event('request/header', { header: { config: { model: 'deepseek-flash', provider: 'synthetic' } } })
  assertFoldCost(fold([header, message(usage(272_000, 1_000))]), 38.605)
  const astraHeader = event('request/header', { header: { config: { model: MODEL, provider: 'synthetic' } } })
  assertFoldCost(fold([astraHeader, message(usage(272_000, 1_000), 0, { data: { message: {} } })]), 38.605)
})

test('Astra exact identity is case-insensitive and provider-prefix aware, not a fast alias', () => {
  const p = policy()
  for (const name of [MODEL, 'GPT-6-ASTRA', 'synthetic/gpt-6-astra', 'synthetic/GPT-6-ASTRA']) {
    close(cost(usage(272_000, 1_000), p, PEAK, name), 38.605, name)
  }
  for (const name of ['gpt-6-astra-fast', 'gpt-6-astra-extra', 'other-model', '/gpt-6-astra']) {
    close(cost(usage(1_000_000), p, PEAK, name), 2, name)
    close(cost(usage(1_000_000), p, IDLE, name), 1, name)
  }
})

test('Astra explicit namespaced override wins over bare model override', () => {
  const p = policy({ pricing: {
    [MODEL]: { input: 80 },
    [`synthetic/${MODEL}`]: { input: 90, contextTiers: [] },
  } })
  close(cost(usage(1_000), p), 0.09)
  close(cost(usage(1_000), p, IDLE), 0.09)
  close(cost(usage(1_000), p, PEAK, MODEL, 'other'), 0.08)
  close(cost(usage(1_000, 0, 0, 1_000), p), (90_000 + 87_500) / 1e6)
  close(cost(usage(272_000), p), 272_000 * 90 / 1e6)
})

test('Astra bare and namespaced null overrides disable rather than fall back', () => {
  const namespaced = policy({ pricing: { [`synthetic/${MODEL}`]: null } })
  close(cost(usage(272_000, 1_000), namespaced), 0)
  close(cost(usage(272_000, 1_000), namespaced, PEAK, MODEL, 'other'), 38.605)
  const bare = policy({ pricing: { [MODEL]: null } })
  close(cost(usage(272_000, 1_000), bare), 0)
  close(cost(usage(272_000, 1_000), bare, PEAK, 'GPT-6-ASTRA'), 0)
  assert.equal(bare.summary().models[MODEL], undefined)
})

test('Astra partial flat override retains cache-write premium, tiers and no discount', () => {
  const p = policy({ pricing: { [MODEL]: { input: 80 } } })
  const u = usage(1_000, 1_000, 1_000, 1_000)
  for (const time of [PEAK, IDLE, WEEKEND]) {
    close(cost(u, p, time), atRates(u, { ...BASE, input: 80 }))
    close(cost(usage(272_000, 1_000, 1_000, 1_000), p, time), reference(usage(272_000, 1_000, 1_000, 1_000)))
  }
  const entry = p.summary().models[MODEL]
  assert.equal(entry.peak.cacheWrite, 87.5)
  assert.equal(entry.contextTiers[0].peak.cacheWrite, 175)
})

test('Astra nested partial overrides inherit root/tier rates; explicit [] disables tiers', () => {
  const p = policy({ pricing: { [MODEL]: { peak: { output: 400 }, contextTiers: [{ threshold: 272_000, peak: { output: 600 } }] } } })
  const small = usage(1_000, 1_000, 1_000, 1_000)
  const large = usage(272_000, 1_000, 1_000, 1_000)
  for (const time of [PEAK, IDLE]) {
    close(cost(small, p, time), atRates(small, { ...BASE, output: 400 }))
    close(cost(large, p, time), atRates(large, { ...LONG, output: 600 }))
  }
  const disabled = policy({ pricing: { [MODEL]: { contextTiers: [] } } })
  close(cost(large, disabled), atRates(large, BASE))
  close(cost(large, disabled, IDLE), atRates(large, BASE))
})

test('Legacy DeepSeek built-ins, half-idle, fallback and override behavior are unchanged', () => {
  const u = usage(1_000_000, 1_000_000, 1_000_000, 1_000_000)
  for (const name of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'unknown']) {
    close(cost(u, policy(), PEAK, name), 12.04)
    close(cost(u, policy(), IDLE, name), 6.02)
  }
  close(cost(u, policy(), PEAK, 'deepseek-v4-pro'), 45.3)
  close(cost(u, policy(), WEEKEND, 'deepseek-v4-pro'), 22.65)
  const p = policy({ pricing: { 'deepseek-flash': { input: 4 } } })
  close(cost(u, p, PEAK, 'deepseek-flash'), 16.04)
  close(cost(u, p, IDLE, 'deepseek-flash'), 8.02)
  const disabled = policy({ pricing: { 'deepseek-flash': null } })
  close(cost(u, disabled, PEAK, 'deepseek-flash'), 0)
})

test('built-in DeepSeek rates match the official 2026-11-10 CNY table', () => {
  const models = policy().summary().models
  assert.deepEqual(models['deepseek-flash'].peak, { cacheRead: 0.04, input: 2, output: 8, cacheWrite: 2 })
  assert.deepEqual(models['deepseek-flash'].idle, { cacheRead: 0.02, input: 1, output: 4, cacheWrite: 1 })
  assert.deepEqual(models['deepseek-v4-pro'].peak, { cacheRead: 0.3, input: 9, output: 27, cacheWrite: 9 })
  assert.deepEqual(models['deepseek-v4-pro'].idle, { cacheRead: 0.15, input: 4.5, output: 13.5, cacheWrite: 4.5 })
  // 13.5 is the pro OFF-PEAK output rate; the peak rate is 27.0.
  close(cost(usage(0, 1_000_000), policy(), PEAK, 'deepseek-v4-pro'), 27)
  close(cost(usage(0, 1_000_000), policy(), IDLE, 'deepseek-v4-pro'), 13.5)
  // Retired flash ids are served by the current Flash model at Flash prices.
  for (const name of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    close(cost(usage(0, 1_000_000), policy(), PEAK, name), 8)
    close(cost(usage(0, 1_000_000), policy(), WEEKEND, name), 4)
  }
})

test('Astra invalid usage fields are finite and nonnegative; fold normalizes malformed samples', () => {
  close(cost({ inputTokens: -1, outputTokens: NaN, cacheReadTokens: Infinity, cacheWriteTokens: '272000' }), 0)
  assertFoldCost(fold([message({ inputTokens: -1, outputTokens: '1', cacheReadTokens: 0.5, cacheWriteTokens: 0 })]), 0)
})

test('Astra summary reports resolved base/tier rates and community snapshot provenance', () => {
  const summary = policy().summary()
  assert.equal(summary.currency, 'CNY')
  assert.equal(summary.unit, 'per 1M tokens')
  const entry = summary.models[MODEL]
  assert.deepEqual(entry.peak, BASE)
  assert.deepEqual(entry.idle, BASE)
  assert.equal(entry.flat, true)
  assert.equal(entry.contextTiers.length, 1)
  assert.equal(entry.contextTiers[0].threshold, 272_000)
  assert.deepEqual(entry.contextTiers[0].peak, LONG)
  assert.deepEqual(entry.contextTiers[0].idle, LONG)
  const source = summary.modelSources[MODEL]
  assert.equal(source.feedVersion, 130)
  assert.equal(source.updatedAt, 1793784668)
  assert.equal(source.currency, 'CNY')
  assert.match(source.basis, /community/i)
  assert.match(source.basis, /not actual gateway/i)
})
