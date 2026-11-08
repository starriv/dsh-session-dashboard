import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compactNumber,
  exactNumber,
  formatClock,
  formatCost,
  formatDateTime,
  formatDayFull,
  formatDayLabel,
  formatDuration,
  formatMs,
  formatUptime,
  percent,
} from '../src/client/format.js'

test('token and cost formatting stays compact and exact', () => {
  assert.equal(compactNumber(1_165_878_448), '1.17B')
  assert.equal(compactNumber(764_900_000), '764.9M')
  assert.equal(compactNumber(3_380_000), '3.38M')
  assert.equal(exactNumber(1_165_878_448, 'en'), '1,165,878,448')
  assert.equal(formatCost(59.7, 'en'), '¥59.70')
  assert.equal(percent(0.99652, 2), '99.65%')
})

test('time and duration formatting is bounded', () => {
  assert.equal(formatMs(121.2), '121.2 ms')
  assert.equal(formatUptime(29 * 60 * 1000), '29m')
  assert.equal(formatDuration(5_400_000), '1h 30m')
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(59_999), '1m 00s')
  assert.equal(formatDuration(3_599_999), '1h 00m')
})

test('dates and clocks use the requested time zone with a safe fallback', () => {
  const instant = Date.UTC(2026, 10, 4, 17, 0)
  assert.equal(formatClock(instant, 'en', 'Asia/Shanghai'), '01:00:00')
  assert.doesNotThrow(() => formatClock(instant, 'en', 'Not/AZone'))
  assert.equal(formatDayLabel('2026-11-05', 'zh'), '11-05')
  assert.match(formatDayFull('2026-11-05', 'en'), /Nov/)
  assert.match(formatDateTime(instant, 'en', 'Asia/Shanghai'), /11\/05\/2026/)
  assert.equal(formatDateTime(0, 'en', 'Asia/Shanghai'), '')
  assert.doesNotThrow(() => formatDateTime(instant, 'en', 'Not/AZone'))
})
