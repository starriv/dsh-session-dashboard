/**
 * Model-price estimate (not an actual provider invoice).
 *
 * Prices are CNY per one million tokens. The existing DeepSeek snapshot and
 * fallback keep their original behavior. GPT-6 Astra uses a documented
 * Token Usage snapshot, with flat all-day rates and per-request context tiers.
 * Profile pricing overrides still take precedence over built-in entries.
 */

import { resolveTimeZone, zonedParts } from './time.js'
import { ASTRA_PRICE_ENTRY, ASTRA_PRICE_SOURCE } from './astra-price-snapshot.js'

// Official DeepSeek CNY table (checked 2026-11-10): flash cache-hit 0.04,
// cache-miss 2, output 8; pro cache-hit 0.3, cache-miss 9, output 27. The
// idle tier is half of peak, so pro output is 13.5 off-peak — 13.5 must never
// be written here as the PEAK output rate. DeepSeek has no cache-write charge
// (the bucket stays at the input rate for providers that do price it).
const PEAK_FLASH = { cacheRead: 0.04, input: 2, output: 8, cacheWrite: 2 }
const PEAK_PRO = { cacheRead: 0.3, input: 9, output: 27, cacheWrite: 9 }

/**
 * Built-in snapshot. Entries support peak/idle and per-request contextTiers.
 * A missing idle tier is half of peak for legacy entries; flat:true models
 * keep peak rates all day, including after partial profile overrides.
 */
export const DEFAULT_PRICE_TABLE = {
  'deepseek-flash': { peak: PEAK_FLASH },
  'deepseek-v4-flash': { peak: PEAK_FLASH },
  'deepseek-v4-flash-vision-exp': { peak: PEAK_FLASH },
  'deepseek-v4-pro': { peak: PEAK_PRO },
  'gpt-6-astra': ASTRA_PRICE_ENTRY,
  default: { peak: PEAK_FLASH },
}

/** Weekday 09:00-12:00 and 14:00-18:00 in the configured zone. */
export const DEFAULT_PEAK_WINDOWS = [
  { days: [1, 2, 3, 4, 5], start: 9 * 60, end: 12 * 60 },
  { days: [1, 2, 3, 4, 5], start: 14 * 60, end: 18 * 60 },
]

const WEEKDAY_NAMES = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
}

function finite(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function normalizeTier(raw, base, preserveCacheWrite = false) {
  const tier = raw && typeof raw === 'object' ? raw : {}
  const input = finite(tier.input, finite(base?.input, 0))
  return {
    cacheRead: finite(tier.cacheRead, finite(base?.cacheRead, 0)),
    input,
    output: finite(tier.output, finite(base?.output, 0)),
    // Legacy DeepSeek overrides retain their old input-rate fallback. Flat
    // model overrides preserve a separately priced cache-write bucket.
    cacheWrite: finite(tier.cacheWrite, preserveCacheWrite ? finite(base?.cacheWrite, input) : input),
  }
}

function normalizeRates(raw, baseEntry) {
  const flat = typeof raw.flat === 'boolean' ? raw.flat : baseEntry?.flat === true
  const factor = flat ? 1 : 0.5
  const basePeak = baseEntry?.peak ?? normalizeTier({}, PEAK_FLASH)
  const scaled = (tier) => Object.fromEntries(Object.entries(tier).map(([key, value]) => [key, value * factor]))
  const baseIdle = baseEntry?.idle ?? scaled(basePeak)
  const peakSource = raw.peak && typeof raw.peak === 'object' ? raw.peak : raw
  const peak = normalizeTier(peakSource, basePeak, flat)
  const idle = raw.idle && typeof raw.idle === 'object'
    ? normalizeTier(raw.idle, baseIdle, flat)
    : scaled(peak)
  return { peak, idle, flat }
}

function normalizeEntry(raw, baseEntry) {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rates = normalizeRates(raw, baseEntry)
  // Missing or non-array tiers inherit; an explicit [] disables them.
  // Invalid items in an explicit array are ignored.
  const source = Array.isArray(raw.contextTiers) ? raw.contextTiers : (baseEntry?.contextTiers ?? [])
  const thresholds = new Map()
  for (const tier of source) {
    if (!tier || typeof tier !== 'object' || !Number.isSafeInteger(tier.threshold) || tier.threshold < 0) continue
    if (thresholds.has(tier.threshold)) continue
    const inherited = baseEntry?.contextTiers?.find((item) => item.threshold === tier.threshold)
    thresholds.set(tier.threshold, {
      threshold: tier.threshold,
      ...normalizeRates(tier, inherited ?? rates),
    })
  }
  return { ...rates, contextTiers: [...thresholds.values()].sort((a, b) => a.threshold - b.threshold) }
}

function mergePriceTable(overrides) {
  const resolved = new Map()
  const keys = new Set([...Object.keys(DEFAULT_PRICE_TABLE), ...Object.keys(overrides || {})])
  for (const key of keys) {
    const override = overrides && Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined
    const raw = override === undefined ? DEFAULT_PRICE_TABLE[key] : override
    const builtin = DEFAULT_PRICE_TABLE[key]
      ?? (key.endsWith('/gpt-6-astra') && key.split('/').every(Boolean) ? ASTRA_PRICE_ENTRY : undefined)
    const base = builtin === undefined ? undefined : normalizeEntry(builtin)
    if (override === null) {
      resolved.set(key, null)
      continue
    }
    const normalized = normalizeEntry(raw, base)
    if (normalized === undefined) continue
    resolved.set(key, normalized)
  }
  return resolved
}


function minuteOfDay(text, fallback) {
  if (Number.isFinite(text)) return Math.max(0, Math.min(24 * 60, text))
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? ''))
  if (!match) return fallback
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return fallback
  return hour * 60 + minute
}

function normalizeWindows(raw) {
  const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_PEAK_WINDOWS
  const windows = []
  for (const item of source) {
    if (!item || typeof item !== 'object') continue
    const declaredDays = Array.isArray(item.days) && item.days.length > 0
      ? item.days.map((day) => (Number.isInteger(day) ? day : WEEKDAY_NAMES[String(day).slice(0, 3).toLowerCase()]))
      : [1, 2, 3, 4, 5]
    const days = [...new Set(declaredDays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))]
    if (days.length === 0) continue
    const start = minuteOfDay(item.start, -1)
    const end = minuteOfDay(item.end, -1)
    if (start < 0 || end < 0 || end <= start) continue
    windows.push({ days, start, end })
  }
  return windows.length > 0 ? windows : DEFAULT_PEAK_WINDOWS
}

/**
 * Build the pricing policy used by the folder.
 * @param {{ timeZone?: string, pricing?: object, peakWindows?: unknown }} config
 */
export function createPricing(config = {}) {
  const timeZone = resolveTimeZone(config.timeZone)
  const table = mergePriceTable(config.pricing)
  const windows = normalizeWindows(config.peakWindows)
  const fallback = table.get('default') || null

  function isPeak(timeMs) {
    const p = zonedParts(timeMs, timeZone)
    const minute = p.hour * 60 + p.minute
    return windows.some((window) => window.days.includes(p.weekday) && minute >= window.start && minute < window.end)
  }

  function resolve(model, provider) {
    const bare = typeof model === 'string' ? model : ''
    const namespaced = provider && bare ? `${provider}/${bare}` : ''
    const keys = [namespaced, bare].filter(Boolean)
    // Match only Astra's exact identity (case-insensitive/provider-prefixed),
    // never variants such as astra-fast. Explicit config keys win first.
    const parts = bare.split('/')
    if (parts.every(Boolean) && parts.at(-1).toLowerCase() === 'gpt-6-astra') {
      if (provider) keys.push(`${provider}/gpt-6-astra`)
      keys.push('gpt-6-astra')
    }
    for (const key of keys) {
      if (table.has(key)) {
        const entry = table.get(key)
        return { entry, key }
      }
    }
    return { entry: fallback, key: 'default' }
  }

  /** Price one provider usage sample. Returns CNY (unrounded). */
  function costOf(usage, model, provider, timeMs) {
    if (!usage) return 0
    const { entry } = resolve(model, provider)
    if (!entry) return 0
    const inputMiss = finite(usage.inputTokens, 0)
    const cacheRead = finite(usage.cacheReadTokens, 0)
    const cacheWrite = finite(usage.cacheWriteTokens, 0)
    const output = finite(usage.outputTokens, 0)
    const contextTokens = inputMiss + cacheRead + cacheWrite
    let effective = entry
    for (const candidate of entry.contextTiers) {
      if (candidate.threshold > contextTokens) break
      effective = candidate
    }
    const tier = isPeak(timeMs) ? effective.peak : effective.idle
    return (
      cacheRead * tier.cacheRead +
      inputMiss * tier.input +
      cacheWrite * tier.cacheWrite +
      output * tier.output
    ) / 1_000_000
  }

  return {
    timeZone,
    table,
    windows,
    isPeak,
    costOf,
    /** The resolved table actually used for this snapshot. */
    summary() {
      const models = {}
      for (const [key, entry] of table) {
        if (entry) models[key] = {
          peak: entry.peak,
          idle: entry.idle,
          ...(entry.flat ? { flat: true } : {}),
          ...(entry.contextTiers.length ? { contextTiers: entry.contextTiers } : {}),
        }
      }
      return {
        currency: 'CNY',
        unit: 'per 1M tokens',
        modelSources: { 'gpt-6-astra': ASTRA_PRICE_SOURCE },
        models,
        peakWindows: windows,
        timeZone,
      }
    },
  }
}
