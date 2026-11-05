/** Configuration normalization for the Host half. */
import os from 'node:os'
import path from 'node:path'
import { ALL_TIME, normalizeScope } from './scope.js'
import { resolveTimeZone } from './time.js'

export const DEFAULT_CONFIG = {
  scope: ALL_TIME,
  trendDays: 30,
  timeZone: 'Asia/Shanghai',
  refreshMs: 1500,
  runtimeSampleMs: 5000,
  historySize: 60,
}

function integer(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function resolveConfig(raw) {
  const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const dshHome = typeof config.dshHome === 'string' && config.dshHome
    ? config.dshHome
    : (process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
  const sessionsRoot = typeof config.sessionsRoot === 'string' && config.sessionsRoot
    ? config.sessionsRoot
    : path.join(dshHome, 'sessions')
  return {
    scope: normalizeScope(config.scope),
    trendDays: integer(config.trendDays, DEFAULT_CONFIG.trendDays, 1, 90),
    timeZone: resolveTimeZone(config.timeZone, DEFAULT_CONFIG.timeZone),
    refreshMs: integer(config.refreshMs, DEFAULT_CONFIG.refreshMs, 500, 60_000),
    backgroundScanMs: integer(config.backgroundScanMs, 60_000, 10_000, 3_600_000),
    runtimeSampleMs: integer(config.runtimeSampleMs, DEFAULT_CONFIG.runtimeSampleMs, 1000, 60_000),
    historySize: integer(config.historySize, DEFAULT_CONFIG.historySize, 2, 600),
    dshHome,
    sessionsRoot,
    pricing: config.pricing && typeof config.pricing === 'object' ? config.pricing : undefined,
    peakWindows: config.peakWindows,
    maxSessions: integer(config.maxSessions, 2000, 1, 10_000),
    maxFileBytes: integer(config.maxFileBytes, 256 * 1024 * 1024, 1024, 2 * 1024 * 1024 * 1024),
    maxDecodedBytes: integer(config.maxDecodedBytes, 128 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    rankingLimit: integer(config.rankingLimit, 100, 1, 2000),
    // Explicit opt-in for embedded/loopback-only compositions without the
    // connection service. Default false: metadata routes fail closed.
    allowUnauthenticated: config.allowUnauthenticated === true,
  }
}
