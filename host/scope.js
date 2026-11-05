/**
 * Dashboard scope shared by the Host route and the store.
 *
 * `'all'` means the complete local history. A positive integer N means the last
 * N calendar days in the configured time zone. Unknown values fall back to
 * all-time, which is the plugin's default.
 */

export const ALL_TIME = 'all'
export const MAX_SCOPE_DAYS = 90

export function normalizeScope(value) {
  if (value === undefined || value === null || value === '' || value === ALL_TIME) return ALL_TIME
  const text = String(value)
  if (!/^\d+$/.test(text)) return ALL_TIME
  const days = Number(text)
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_SCOPE_DAYS) return ALL_TIME
  return days
}

export function isScoped(scope) {
  return typeof scope === 'number'
}
