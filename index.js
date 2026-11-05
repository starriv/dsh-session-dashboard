/**
 * Host half entry point.
 *
 * Responsibilities, in order: normalize config, own the runtime sampler and the
 * incremental session store, warm the store in the background, and register the
 * read-only routes. Every optional dependency is accessed defensively so a
 * missing sampler or session directory produces an empty/partial dashboard
 * instead of a failed plugin activation.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from './host/config.js'
import { registerStatsRoutes } from './host/http.js'
import { RuntimeMonitor } from './host/runtime.js'
import { StatsStore } from './host/store.js'

export const name = '@local/dsh-session-stats'
export const inject = ['timer', 'webServer']

function readVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const version = readVersion()

  const monitor = new RuntimeMonitor({
    sampleMs: config.runtimeSampleMs,
    historySize: config.historySize,
  })
  const store = new StatsStore(config)

  // The first dashboard request must not pay for the full cold scan. This
  // timer is owned by the plugin effect, so unload cancels it.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      store.ensureFresh().catch(() => {
        // A missing sessions root is a valid empty state.
      })
    }, 0)
    return () => clearTimeout(timer)
  })


  const setIntervalCompat = (callback, delay) => {
    const schedule = typeof ctx.interval === 'function' ? ctx.interval.bind(ctx) : ctx.setInterval.bind(ctx)
    return schedule(callback, delay)
  }

  ctx.effect(() => {
    const dispose = setIntervalCompat(() => {
      try {
        monitor.sample()
      } catch {
        // Sampling must never break the route.
      }
    }, config.runtimeSampleMs)
    return () => {
      if (typeof dispose === 'function') dispose()
      monitor.dispose()
    }
  })

  ctx.effect(() => {
    const dispose = setIntervalCompat(() => {
      store.ensureFresh().catch(() => {})
    }, config.backgroundScanMs)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  })

  ctx.effect(() => registerStatsRoutes(ctx, { store, monitor, version }))

  const log = ctx.logger && typeof ctx.logger.info === 'function' ? ctx.logger.info.bind(ctx.logger) : null
  if (log) log(`[session-stats] host active · zone=${config.timeZone}`)
  else console.log(`[session-stats] host active · zone=${config.timeZone}`)
}
