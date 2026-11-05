/** Daily stacked consumption + scope-aware subtitle + legend. */

import * as React from 'react'
import { Card, CardHeader, EmptyState, Skeleton } from './ui.jsx'
import { IconStats } from '../icons.jsx'
import { StackedBarChart } from '../charts/StackedBarChart.jsx'
import { BarChartSkeleton } from '../charts/ChartSkeletons.jsx'
import { TOKEN_KINDS } from '../theme.js'
import { compactNumber, formatCost } from '../format.js'

export function DailyUsageCard({ daily, previous, trendDays, allTime, pending = false, requestedScope, t, locale }) {
  const rows = Array.isArray(daily) ? daily : []
  const days = Number.isFinite(trendDays) ? trendDays : rows.length
  const targetDays = pending && requestedScope && requestedScope !== 'all'
    ? Number(requestedScope)
    : days
  const targetAllTime = pending ? requestedScope === 'all' : allTime
  const previousRows = Array.isArray(previous) ? previous : []
  const hasPrevious = previousRows.some((row) => (row?.totalTokens || 0) > 0)
  const rangeTotal = rows.reduce((sum, row) => sum + (row.totalTokens || 0), 0)
  const rangeCost = rows.reduce((sum, row) => sum + (row.costCny || 0), 0)
  const averageTokens = rows.length > 0 ? rangeTotal / rows.length : 0
  const averageCost = rows.length > 0 ? rangeCost / rows.length : 0
  const subtitle = targetAllTime
    ? `${t('daily.subtitle')} · ${t('daily.trend')} ${targetDays} ${t('daily.days')}`
    : `${t('daily.subtitle')} · ${t('scope.last')} ${targetDays} ${t('daily.days')}`

  return React.createElement(
    Card,
    { className: `ss-daily${pending ? ' is-pending' : ''}`, 'aria-busy': pending || undefined },
    React.createElement(CardHeader, {
      title: t('daily.title'),
      subtitle,
      icon: React.createElement(IconStats),
    }),
    pending
      ? React.createElement(BarChartSkeleton, { days: targetDays })
      : rangeTotal > 0
        ? React.createElement(StackedBarChart, { data: rows, previous: previousRows, t, locale })
        : React.createElement(EmptyState, {
            title: t('state.noData'),
            description: t('daily.emptyHint'),
          }),
    React.createElement(
      'div',
      { className: 'ss-legend' },
      TOKEN_KINDS.map((kind) => React.createElement(
        'span',
        { key: kind.key, className: 'ss-legend-item' },
        React.createElement('i', { className: 'ss-dot', style: { background: kind.color } }),
        t(kind.labelKey),
      )),
      hasPrevious
        ? React.createElement(
            'span',
            { className: 'ss-legend-item' },
            React.createElement('i', { className: 'ss-legend-dash', 'aria-hidden': true }),
            t('daily.previous'),
          )
        : null,
      pending
        ? React.createElement(Skeleton, { className: 'ss-legend-summary-skeleton' })
        : React.createElement(
            'span',
            { className: 'ss-legend-summary' },
            `${t('daily.avg')} ${compactNumber(averageTokens, locale)} ${t('token.tokens')} · ${formatCost(averageCost, locale)}`,
          ),
    ),
  )
}
