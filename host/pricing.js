/**
 * DeepSeek list-price estimate.
 *
 * Prices are CNY per one million tokens and are deliberately data, not logic:
 * the default table is the shipped list-price snapshot, and a patch can replace
 * or disable single models without touching code. Each usage sample is priced
 * at its own timestamp because DeepSeek bills peak and idle windows
 * differently (idle defaults to half price).
 */

import { resolveTimeZone, zonedParts } from './time.js'

const PEAK_FLASH = { cacheRead: 0.04, input: 2, output: 8, cacheWrite: 2 }
const PEAK_PRO = { cacheRead: 0.3, input: 9, output: 13.5, cacheWrite: 9 }

/**
 * Built-in snapshot. Shape: model key -> { peak, idle? }. A missing `idle`
 * entry is resolved to half of `peak`, the published off-peak rule.
 */
export const DEFAULT_PRICE_TABLE = {
  'deepseek-flash': { peak: PEAK_FLASH },
  'deepseek-v4-flash': { peak: PEAK_FLASH },
  'deepseek-v4-flash-vision-exp': { peak: PEAK_FLASH },
  'deepseek-v4-pro': { peak: PEAK_PRO },
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

function normalizeTier(raw, base) {
  const tier = raw && typeof raw === 'object' ? raw : {}
  const input = finite(tier.input, finite(base?.input, 0))
  return {
    cacheRead: finite(tier.cacheRead, finite(base?.cacheRead, 0)),
    input,
    output: finite(tier.output, finite(base?.output, 0)),
    cacheWrite: finite(tier.cacheWrite, input),
  }
}

function normalizeEntry(raw, baseEntry) {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object') return undefined
  const basePeak = baseEntry?.peak ?? normalizeTier({}, PEAK_FLASH)
  const baseIdle = baseEntry?.idle
    ?? { cacheRead: basePeak.cacheRead / 2, input: basePeak.input / 2, output: basePeak.output / 2, cacheWrite: basePeak.cacheWrite / 2 }
  // Flat object form means "peak"; `peak`/`idle` form is explicit. Missing
  // fields inherit the built-in entry for this model, not another model's price.
  const peakSource = raw.peak && typeof raw.peak === 'object' ? raw.peak : raw
  const peak = normalizeTier(peakSource, basePeak)
  const idle = raw.idle && typeof raw.idle === 'object'
    ? normalizeTier(raw.idle, baseIdle)
    : { cacheRead: peak.cacheRead / 2, input: peak.input / 2, output: peak.output / 2, cacheWrite: peak.cacheWrite / 2 }
  return { peak, idle }
}

function mergePriceTable(overrides) {
  const resolved = new Map()
  const keys = new Set([...Object.keys(DEFAULT_PRICE_TABLE), ...Object.keys(overrides || {})])
  for (const key of keys) {
    const override = overrides && Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined
    const raw = override === undefined ? DEFAULT_PRICE_TABLE[key] : override
    const base = DEFAULT_PRICE_TABLE[key] === undefined
      ? undefined
      : normalizeEntry(DEFAULT_PRICE_TABLE[key])
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
    const tier = isPeak(timeMs) ? entry.peak : entry.idle
    const inputMiss = finite(usage.inputTokens, 0)
    const cacheRead = finite(usage.cacheReadTokens, 0)
    const cacheWrite = finite(usage.cacheWriteTokens, 0)
    const output = finite(usage.outputTokens, 0)
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
        if (entry) models[key] = { peak: entry.peak, idle: entry.idle }
      }
      return {
        currency: 'CNY',
        unit: 'per 1M tokens',
        models,
        peakWindows: windows,
        timeZone,
      }
    },
  }
}
