/**
 * Active-session duration.
 *
 * A session log is not a stopwatch. DSH keeps appending to the same session
 * file across days, so the wall-clock span between the header's `createdAt`
 * and the last event says how long the session stayed reachable, not how long
 * someone worked in it. Ranking by that span is how a two-hour conversation
 * with a week-long break ends up as "265h".
 *
 * This module turns the session's own event timestamps into merged activity
 * intervals: consecutive events closer than `idleGapMs` belong to the same
 * working stretch, and a longer gap starts a new one. The active duration is
 * the sum of those intervals, so idle gaps are excluded. A scoped snapshot can
 * clip the same intervals to the selected window without re-reading the log.
 */

/** Idle gaps longer than this are not counted as session time. */
export const DEFAULT_IDLE_GAP_MS = 10 * 60 * 1000

const MAX_EVENT_TIME = 8.64e15

/** Accept only a finite positive epoch; anything else is not a usable clock. */
export function normalizeEventTime(value) {
  return Number.isFinite(value) && value > 0 && value <= MAX_EVENT_TIME ? value : 0
}

/**
 * Merge event timestamps into `[start, end]` activity intervals.
 *
 * Timestamps are normalised, de-duplicated by sorting and merged while the
 * gap to the previous event stays at or below `idleGapMs`. Out-of-order events
 * are therefore supported; one corrupt timestamp cannot reorder the rest.
 *
 * @param {Iterable<number>} times raw event timestamps in ms
 * @param {number} [idleGapMs] gap that still counts as continuous activity
 * @returns {Array<[number, number]>} merged intervals, sorted by start
 */
export function mergeActivityIntervals(times, idleGapMs = DEFAULT_IDLE_GAP_MS) {
  const gap = Number.isFinite(idleGapMs) && idleGapMs > 0 ? idleGapMs : DEFAULT_IDLE_GAP_MS
  const sorted = []
  if (times) {
    for (const value of times) {
      const time = normalizeEventTime(value)
      if (time > 0) sorted.push(time)
    }
  }
  sorted.sort((left, right) => left - right)

  const intervals = []
  let current = null
  for (const time of sorted) {
    if (current && time - current[1] <= gap) {
      if (time > current[1]) current[1] = time
      continue
    }
    current = [time, time]
    intervals.push(current)
  }
  return intervals
}

/**
 * Clip activity intervals to a window.
 *
 * `clipStartMs` excludes activity before the window (used by scoped
 * snapshots); `clipEndMs` is optional and only trims a manually supplied
 * window. Non-finite bounds are treated as unbounded.
 */
export function clipActivityIntervals(intervals, clipStartMs = -Infinity, clipEndMs = Infinity) {
  const start = Number.isFinite(clipStartMs) ? clipStartMs : -Infinity
  const end = Number.isFinite(clipEndMs) ? clipEndMs : Infinity
  const clipped = []
  if (!Array.isArray(intervals) || !(end > start)) return clipped
  for (const interval of intervals) {
    if (!Array.isArray(interval) || interval.length < 2) continue
    const from = interval[0]
    const to = interval[1]
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue
    if (from === to) {
      // An isolated event carries no duration but still marks activity. Keep
      // the instant so first/last/span bounds in a scoped view stay truthful;
      // dropping it would fall back to the unclipped session creation time.
      if (from >= start && from < end) clipped.push([from, from])
      continue
    }
    const clippedStart = Math.max(from, start)
    const clippedEnd = Math.min(to, end)
    if (clippedEnd > clippedStart) clipped.push([clippedStart, clippedEnd])
  }
  return clipped
}

/** Total active time inside a clip window. */
export function clipDurationMs(intervals, clipStartMs = -Infinity, clipEndMs = Infinity) {
  let total = 0
  for (const interval of clipActivityIntervals(intervals, clipStartMs, clipEndMs)) {
    total += interval[1] - interval[0]
  }
  return total
}

/** First/last activity instant and the wall-clock span of merged intervals. */
export function activityBounds(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return { firstActivityAt: 0, lastActivityAt: 0, spanMs: 0 }
  }
  const firstActivityAt = intervals[0][0]
  const lastActivityAt = intervals[intervals.length - 1][1]
  return {
    firstActivityAt,
    lastActivityAt,
    spanMs: lastActivityAt > firstActivityAt ? lastActivityAt - firstActivityAt : 0,
  }
}
