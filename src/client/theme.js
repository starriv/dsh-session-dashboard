/** Presentation constants for charts. Colors are artwork; layout uses theme tokens. */

export const TOKEN_KINDS = [
  { key: 'inputTokens', color: 'var(--ss-data-input)', labelKey: 'token.input', shortKey: 'token.input.short' },
  { key: 'cacheReadTokens', color: 'var(--ss-data-accent)', labelKey: 'token.cacheRead', shortKey: 'token.cacheRead.short' },
  { key: 'cacheWriteTokens', color: 'var(--ss-data-write)', labelKey: 'token.cacheWrite', shortKey: 'token.cacheWrite.short' },
  { key: 'outputTokens', color: 'var(--ss-data-money)', labelKey: 'token.output', shortKey: 'token.output.short' },
]


export function tokenSegments(t, values) {
  return TOKEN_KINDS.map((kind) => ({
    key: kind.key,
    color: kind.color,
    label: t(kind.labelKey),
    short: t(kind.shortKey),
    value: Number(values?.[kind.key] ?? 0),
  }))
}
