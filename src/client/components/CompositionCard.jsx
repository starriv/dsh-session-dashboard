/** Token composition ring plus an interactive legend with exact values. */

import * as React from 'react'
import { Card, CardHeader, EmptyState, Skeleton } from './ui.jsx'
import { IconLayers } from '../icons.jsx'
import { DonutChart } from '../charts/DonutChart.jsx'
import { DonutSkeleton } from '../charts/ChartSkeletons.jsx'
import { tokenSegments } from '../theme.js'
import { compactNumber, exactNumber, formatCost, percent } from '../format.js'

export function CompositionCard({ totals, allTime = true, pending = false, t, locale }) {
  const [activeKey, setActiveKey] = React.useState(null)
  const safe = totals || {}
  const sum = (safe.inputTokens || 0) + (safe.cacheReadTokens || 0) + (safe.cacheWriteTokens || 0) + (safe.outputTokens || 0)
  const segments = tokenSegments(t, pending ? {} : safe)
  const dominant = segments.reduce((largest, segment) => segment.value > largest.value ? segment : largest, segments[0])
  const dominantShare = sum > 0 ? dominant.value / sum : 0

  return React.createElement(
    Card,
    { className: `ss-composition${pending ? ' is-pending' : ''}${sum > 0 ? ' has-data' : ''}`, 'aria-busy': pending || undefined },
    React.createElement(CardHeader, {
      title: t('composition.title'),
      subtitle: allTime ? t('composition.subtitle') : t('composition.subtitleScoped'),
      icon: React.createElement(IconLayers),
    }),
    sum <= 0 && !pending
      ? React.createElement(EmptyState, {
          title: t('state.noData'),
          description: t('composition.emptyHint'),
        })
      : React.createElement(
      'div',
      { className: 'ss-composition-body' },
      pending
        ? React.createElement(DonutSkeleton)
        : React.createElement(DonutChart, {
            segments,
            total: sum,
            centerValue: percent(dominantShare, 1),
            centerLabel: dominant.label,
            activeKey,
            onActiveKey: setActiveKey,
            locale,
            ariaLabel: t('composition.title'),
          }),
      React.createElement(
        'div',
        { className: 'ss-composition-legend' },
        segments.map((segment) => {
          const share = sum > 0 ? segment.value / sum : 0
          const active = activeKey === segment.key
          return React.createElement(
            'div',
            {
              key: segment.key,
              className: `ss-composition-row${active ? ' is-active' : ''}`,
              onMouseEnter: () => setActiveKey(segment.key),
              onMouseLeave: () => setActiveKey(null),
              title: `${exactNumber(segment.value, locale)} ${t('token.tokens')}`,
            },
            React.createElement(
              'span',
              { className: 'ss-composition-label' },
              React.createElement('i', { className: 'ss-dot', style: { background: segment.color } }),
              segment.label,
            ),
            React.createElement(
              'span',
              { className: 'ss-composition-value' },
              pending
                ? React.createElement(Skeleton, { className: 'ss-composition-value-skeleton' })
                : React.createElement(
                    React.Fragment,
                    null,
                    compactNumber(segment.value, locale),
                    React.createElement('em', null, percent(share, share > 0 && share < 0.001 ? 2 : 1)),
                  ),
            ),
          )
        }),
        React.createElement(
          'div',
          { className: 'ss-composition-foot' },
          pending
            ? React.createElement(Skeleton, { className: 'ss-composition-foot-skeleton' })
            : React.createElement(
                'span',
                { className: 'ss-composition-estimate', title: t('page.priceNote') },
                formatCost(safe.costCny, locale),
                React.createElement('em', null, t('composition.estimate')),
              ),
        ),
      ),
    ),
  )
}
