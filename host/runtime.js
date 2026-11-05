/**
 * Runtime sampler for the "DSH 运行状态" card.
 *
 * The sampler owns nothing but numbers: process CPU deltas over a fixed window,
 * RSS/heap at read time, and a rolling event-loop-delay histogram. The plugin
 * wires its lifetime, so unloading the plugin removes the timer with it.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks'
import os from 'node:os'

export class RuntimeMonitor {
  constructor({ sampleMs = 5000, historySize = 60 } = {}) {
    this.sampleMs = Math.max(1000, sampleMs)
    this.historySize = Math.max(2, historySize)
    this.history = []
    this.cpuCount = os.cpus().length || 1
    this.pid = process.pid
    this.nodeVersion = process.version
    this.lastCpu = process.cpuUsage()
    this.lastAt = Date.now()
    this.latest = this.initialSample()
    this.histogram = monitorEventLoopDelay({ resolution: 10 })
    this.histogram.enable()
    this.lastEventLoop = { p50: 0, p99: 0, max: 0 }
  }

  initialSample() {
    const uptimeMs = process.uptime() * 1000
    const cpu = process.cpuUsage()
    const usedMs = (cpu.user + cpu.system) / 1000
    const rawPercent = uptimeMs > 0 ? (usedMs / uptimeMs) * 100 : 0
    return {
      singlePercent: Math.min(100, rawPercent),
      machinePercent: rawPercent / this.cpuCount,
      rss: process.memoryUsage().rss,
    }
  }

  /** Take one sample and append it to the rolling history. */
  sample() {
    const now = Date.now()
    const elapsed = Math.max(1, now - this.lastAt)
    const cpu = process.cpuUsage(this.lastCpu)
    this.lastCpu = process.cpuUsage()
    this.lastAt = now
    const rawPercent = Math.max(0, ((cpu.user + cpu.system) / 1000 / elapsed) * 100)
    const singlePercent = Math.min(100, rawPercent)
    this.latest = {
      singlePercent,
      machinePercent: rawPercent / this.cpuCount,
      rss: process.memoryUsage().rss,
    }
    this.history.push({ t: now, v: Number(singlePercent.toFixed(2)) })
    if (this.history.length > this.historySize) this.history.splice(0, this.history.length - this.historySize)
    this.lastEventLoop = this.readEventLoop()
  }

  readEventLoop() {
    const toMs = (ns) => Number.isFinite(ns) ? ns / 1e6 : 0
    const result = {
      p50: toMs(this.histogram.percentile(50)),
      p99: toMs(this.histogram.percentile(99)),
      max: toMs(this.histogram.max),
    }
    this.histogram.reset()
    return result
  }

  snapshot() {
    const memory = process.memoryUsage()
    const peak = this.history.reduce((max, point) => Math.max(max, point.v), 0)
    return {
      pid: this.pid,
      nodeVersion: this.nodeVersion,
      cpuCount: this.cpuCount,
      loadAvg1: os.loadavg()[0],
      uptimeMs: process.uptime() * 1000,
      cpu: {
        singlePercent: this.latest.singlePercent,
        machinePercent: this.latest.machinePercent,
        peakPercent: peak,
        history: this.history.slice(),
      },
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
      },
      eventLoop: this.lastEventLoop,
      sampledAt: Date.now(),
    }
  }

  dispose() {
    try {
      this.histogram.disable()
    } catch {
      // Already disabled.
    }
  }
}
