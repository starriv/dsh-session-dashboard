/** Layout-preserving placeholders for charts while a new range loads. */

import * as React from 'react'

const HEIGHTS = [42, 63, 51, 78, 58, 86, 69, 74, 55, 82, 61, 71]

export function BarChartSkeleton({ days = 7 }) {
  const bars = Math.max(1, Math.min(90, Number.isFinite(days) ? days : 7))
  return React.createElement(
    'div',
    { className: 'ss-chart-skeleton ss-chart-skeleton-bars', 'aria-hidden': true, style: { height: 232 } },
    Array.from({ length: bars }, (_, index) => React.createElement('span', {
      key: index,
      className: 'ss-skeleton ss-skeleton-bar',
      style: { height: `${HEIGHTS[index % HEIGHTS.length]}%` },
    })),
  )
}

export function SparklineSkeleton() {
  return React.createElement(
    'div',
    { className: 'ss-chart-skeleton ss-spark-skeleton', 'aria-hidden': true },
    React.createElement('span', { className: 'ss-skeleton ss-spark-skeleton-line' }),
  )
}

export function DonutSkeleton() {
  return React.createElement(
    'div',
    { className: 'ss-donut-skeleton', 'aria-hidden': true },
    React.createElement('span', { className: 'ss-skeleton ss-donut-skeleton-ring' }),
    React.createElement(
      'div',
      { className: 'ss-donut-skeleton-center' },
      React.createElement('span', { className: 'ss-skeleton ss-skeleton-value' }),
      React.createElement('span', { className: 'ss-skeleton ss-skeleton-sub' }),
    ),
  )
}
