/**
 * Time helpers: every bucket the plugin produces is keyed in one configured
 * IANA time zone, never in the Host process's local zone. Keeping this in one
 * module makes the "same instant, same day" rule shared by pricing and charts.
 */

const formatterCache = new Map()

function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/** Validate an IANA zone once; invalid patch values fall back instead of crashing Intl. */
export function resolveTimeZone(value, fallback = 'Asia/Shanghai') {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return fallback
  }
}

const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** Read one timestamp's wall-clock parts in `timeZone`. */
function safeDate(timeMs) {
  return Number.isFinite(timeMs) && Math.abs(timeMs) <= 8.64e15 ? new Date(timeMs) : new Date(0)
}

export function zonedParts(timeMs, timeZone) {
  const date = safeDate(timeMs)
  let parts
  try {
    parts = formatterFor(timeZone).formatToParts(date)
  } catch {
    // An unknown zone must never take the dashboard down.
    try {
      parts = formatterFor('UTC').formatToParts(date)
    } catch {
      parts = formatterFor('UTC').formatToParts(new Date(0))
    }
  }
  const values = {}
  for (const part of parts) values[part.type] = part.value
  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour)
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    weekday: WEEKDAY_INDEX[values.weekday] || 1,
  }
}

/** `YYYY-MM-DD` for one timestamp in `timeZone`. */
export function dayKeyOf(timeMs, timeZone) {
  const p = zonedParts(timeMs, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Add `delta` calendar days to a `YYYY-MM-DD` key, zone-free. */
export function shiftDayKey(key, delta) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + delta))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function offsetMsAt(timeMs, timeZone) {
  const p = zonedParts(timeMs, timeZone)
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return localAsUtc - timeMs
}

/** The instant at which `YYYY-MM-DD` starts in `timeZone`. */
export function dayStartMs(dayKey, timeZone) {
  const [year, month, day] = dayKey.split('-').map(Number)
  const utcMidnight = Date.UTC(year, month - 1, day)
  let candidate = utcMidnight - offsetMsAt(utcMidnight, timeZone)
  for (let pass = 0; pass < 2; pass += 1) {
    const next = utcMidnight - offsetMsAt(candidate, timeZone)
    if (next === candidate) break
    candidate = next
  }
  return candidate
}

/** Inclusive list of the last `days` day keys ending at `endKey`. */
export function recentDayKeys(endKey, days) {
  const keys = []
  for (let offset = days - 1; offset >= 0; offset -= 1) keys.push(shiftDayKey(endKey, -offset))
  return keys
}

export function formatClock(ms, timeZone) {
  const p = zonedParts(ms, timeZone)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}
