/** Live DSH process health: CPU, RSS, event-loop latency, uptime and history. */

import * as React from 'react'
import { Card, CardHeader, EmptyState, Pill, Skeleton } from './ui.jsx'
import { IconClock, IconCpu, IconMemory, IconActivity } from '../icons.jsx'
import { Sparkline } from '../charts/Sparkline.jsx'
import { SparklineSkeleton } from '../charts/ChartSkeletons.jsx'
import { formatMs, formatUptime, percent } from '../format.js'

function bytesToMb(bytes) {
  return `${(Math.max(0, bytes || 0) / (1024 * 1024)).toFixed(0)} MB`
}

function Metric({ icon, label, value, detail }) {
  return React.createElement(
    'div',
    { className: 'ss-metric' },
    React.createElement(
      'div',
      { className: 'ss-metric-label' },
      React.createElement('span', { className: 'ss-metric-icon' }, icon),
      label,
    ),
    React.createElement('strong', { className: 'ss-metric-value' }, value),
    React.createElement('span', { className: 'ss-metric-detail' }, detail),
  )
}

export function RuntimeCard({ runtime, pending = false, t, locale }) {
  const header = React.createElement(CardHeader, {
    title: t('runtime.title'),
    icon: React.createElement(IconActivity),
    aside: runtime
      ? React.createElement(
          'div',
          { className: 'ss-runtime-aside' },
          React.createElement(Pill, { tone: 'success', dot: true }, t('runtime.live')),
          React.createElement(
            'span',
            { className: 'ss-runtime-meta' },
            `${runtime.cpuCount} ${t('runtime.cores')} · ${t('runtime.load')} ${Number(runtime.loadAvg1 || 0).toFixed(2)}`,
          ),
        )
      : null,
  })

  if (!runtime && pending) {
    return React.createElement(
      Card,
      { className: 'ss-runtime is-pending', 'aria-busy': true },
      header,
      React.createElement(
        'div',
        { className: 'ss-metric-grid' },
        [
          { icon: React.createElement(IconCpu), label: t('runtime.cpu') },
          { icon: React.createElement(IconMemory), label: t('runtime.memory') },
          { icon: React.createElement(IconActivity), label: t('runtime.eventLoop') },
          { icon: React.createElement(IconClock), label: t('runtime.uptime') },
        ].map((metric) => React.createElement(
          'div',
          { key: metric.label, className: 'ss-metric' },
          React.createElement(
            'div',
            { className: 'ss-metric-label' },
            React.createElement('span', { className: 'ss-metric-icon' }, metric.icon),
            metric.label,
          ),
          React.createElement(Skeleton, { className: 'ss-metric-value-skeleton' }),
          React.createElement(Skeleton, { className: 'ss-metric-detail-skeleton' }),
        )),
      ),
      React.createElement(
        'div',
        { className: 'ss-cpu-panel' },
        React.createElement(
          'div',
          { className: 'ss-cpu-head' },
          React.createElement('span', null, t('runtime.cpuHistory')),
          React.createElement('span', { className: 'ss-cpu-peak' }, t('page.loading')),
        ),
        React.createElement(SparklineSkeleton),
      ),
    )
  }

  if (!runtime) {
    return React.createElement(Card, { className: 'ss-runtime' }, header,
      React.createElement(EmptyState, { title: t('runtime.empty') }))
  }

  const cpu = runtime.cpu || { singlePercent: 0, machinePercent: 0, peakPercent: 0, history: [] }
  const memory = runtime.memory || { rss: 0, heapUsed: 0 }
  const eventLoop = runtime.eventLoop || { p50: 0, p99: 0 }
  const history = Array.isArray(cpu.history) ? cpu.history : []

  return React.createElement(
    Card,
    { className: 'ss-runtime' },
    header,
    React.createElement(
      'div',
      { className: 'ss-metric-grid' },
      React.createElement(Metric, {
        icon: React.createElement(IconCpu),
        label: t('runtime.cpu'),
        value: percent(cpu.singlePercent / 100, 1),
        detail: `${t('runtime.cpu.machine')} ${percent(cpu.machinePercent / 100, 1)} · ${runtime.cpuCount} ${t('runtime.cores')}`,
      }),
      React.createElement(Metric, {
        icon: React.createElement(IconMemory),
        label: t('runtime.memory'),
        value: bytesToMb(memory.rss),
        detail: `${t('runtime.memory.heap')} ${bytesToMb(memory.heapUsed)}`,
      }),
      React.createElement(Metric, {
        icon: React.createElement(IconActivity),
        label: t('runtime.eventLoop'),
        value: formatMs(eventLoop.p99),
        detail: `${t('runtime.eventLoop.avg')} p50 ${formatMs(eventLoop.p50)}`,
      }),
      React.createElement(Metric, {
        icon: React.createElement(IconClock),
        label: t('runtime.uptime'),
        value: formatUptime(runtime.uptimeMs),
        detail: `${t('runtime.pid')} ${runtime.pid} · Node ${runtime.nodeVersion}`,
      }),
    ),
    React.createElement(
      'div',
      { className: 'ss-cpu-panel' },
      React.createElement(
        'div',
        { className: 'ss-cpu-head' },
        React.createElement('span', null, t('runtime.cpuHistory')),
        React.createElement(
          'span',
          { className: 'ss-cpu-peak' },
          `${t('runtime.cpuPeak')} ${percent((cpu.peakPercent || 0) / 100, 1)}`,
        ),
      ),
      React.createElement(Sparkline, {
        points: history,
        locale,
        color: 'var(--ss-data-accent)',
        peakLabel: t('runtime.cpuHistory'),
      }),
      history.length < 2
        ? React.createElement('span', { className: 'ss-cpu-hint' }, t('runtime.sampling'))
        : null,
    ),
  )
}
