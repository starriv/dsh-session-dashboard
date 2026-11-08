/**
 * Formatting helpers shared by every dashboard section.
 *
 * Token counts are intentionally shown with Latin K/M/B suffixes (the same
 * grammar as the Host/CLI) while exact values stay available through `title`
 * tooltips. Currency is CNY because the price table is a DeepSeek list price.
 */

export function cx(...values) {
  return values.filter(Boolean).join(' ')
}

export function compactNumber(value, locale = 'en') {
  const number = Number.isFinite(value) ? value : 0
  const sign = number < 0 ? '-' : ''
  const abs = Math.abs(number)
  const units = [
    { divisor: 1e12, suffix: 'T' },
    { divisor: 1e9, suffix: 'B' },
    { divisor: 1e6, suffix: 'M' },
    { divisor: 1e3, suffix: 'K' },
  ]
  let index = units.findIndex((unit) => abs >= unit.divisor)
  if (index < 0) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(number)
  let text = trim(abs / units[index].divisor)
  // Rounding 999,999 to "1000K" reads wrong; promote to the next unit instead.
  if (Number(text) >= 1000 && index > 0) {
    index -= 1
    text = trim(abs / units[index].divisor)
  }
  return `${sign}${text}${units[index].suffix}`
}

function trim(value) {
  const fixed = value >= 1000 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
  return fixed.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')
}

export function exactNumber(value, locale = 'en') {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0)
}

export function formatCost(value, locale = 'en') {
  if (!Number.isFinite(value)) return '¥0.00'
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : 2
  return `¥${new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}`
}

export function percent(value, digits = 1) {
  const ratio = Number.isFinite(value) ? value : 0
  const fixed = (ratio * 100).toFixed(digits)
  return `${fixed.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')}%`
}

export function formatMs(ms) {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0
  if (value < 1000) return `${value.toFixed(1).replace(/\.0$/, '')} ms`
  const seconds = value / 1000
  if (seconds < 59.95) return `${seconds.toFixed(1).replace(/\.0$/, '')} s`
  return formatDuration(value)
}

export function formatUptime(ms) {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalSeconds = Math.floor(value / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m`
}

export function formatDuration(ms) {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalSeconds = Math.round(value / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatDayLabel(dateKey, locale = 'en') {
  if (typeof dateKey !== 'string' || !dateKey) return ''
  if (locale && locale.toLowerCase().startsWith('zh')) return dateKey.slice(5)
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateKey.slice(5)
  return new Intl.DateTimeFormat(locale || 'en', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(date)
}

export function formatMonthDay(ms, locale = 'en', timeZone) {
  if (!Number.isFinite(ms)) return ''
  const options = { month: 'short', day: '2-digit' }
  if (timeZone) options.timeZone = timeZone
  try {
    return new Intl.DateTimeFormat(locale || 'en', options).format(new Date(ms))
  } catch {
    return ''
  }
}

export function formatDayFull(dateKey, locale = 'en') {
  if (typeof dateKey !== 'string' || !dateKey) return ''
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateKey
  return new Intl.DateTimeFormat(locale || 'en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}

/** Compact date+clock for tooltips; returns '' for a missing/unusable instant. */
export function formatDateTime(ms, locale = 'en', timeZone) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }
  if (timeZone) options.timeZone = timeZone
  try {
    return new Intl.DateTimeFormat(locale || 'en', options).format(new Date(ms))
  } catch {
    delete options.timeZone
    try {
      return new Intl.DateTimeFormat(locale || 'en', options).format(new Date(ms))
    } catch {
      return ''
    }
  }
}

export function formatClock(ms, locale = 'en', timeZone) {
  if (!Number.isFinite(ms)) return '--:--:--'
  const options = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }
  if (timeZone) options.timeZone = timeZone
  try {
    return new Intl.DateTimeFormat(locale || 'en', options).format(new Date(ms))
  } catch {
    delete options.timeZone
    return new Intl.DateTimeFormat(locale || 'en', options).format(new Date(ms))
  }
}

export function shortModel(model) {
  if (!model) return ''
  const text = String(model)
  return text.startsWith('deepseek') ? text : text.split('/').pop()
}
