/**
 * Token-composition donut.
 *
 * The ring uses d3-shape arcs and true proportions: cache reads are usually
 * more than 99% of a long session, so the tiny slivers are truthful rather than
 * padded to a fake minimum. The legend rows carry the readable exact numbers
 * and act as the hover target for those thin slices.
 */

import * as React from 'react'
import { arc, pie } from 'd3-shape'
import { compactNumber, formatCost } from '../format.js'

const SIZE = 220
const CENTER = SIZE / 2
const INNER = 72
const OUTER = 94

export function DonutChart({ segments, total, costCny, activeKey, onActiveKey, locale = 'en', centerValue, centerLabel, ariaLabel }) {
  const rows = (Array.isArray(segments) ? segments : []).filter((segment) => segment.value > 0)
  const sum = rows.reduce((accumulator, segment) => accumulator + segment.value, 0)
  const layout = pie()
    .value((segment) => segment.value)
    .sort(null)
    .padAngle(rows.length > 1 ? 0.012 : 0)(rows)
  const arcs = layout.map((slice) => {
    const active = activeKey === slice.data.key
    const shape = arc()
      .innerRadius(INNER)
      .outerRadius(active ? OUTER + 4 : OUTER)
      .cornerRadius(rows.length > 1 ? 2 : 0)(slice)
    return { slice, shape, active }
  })

  return React.createElement(
    'div',
    { className: 'ss-donut' },
    React.createElement(
      'svg',
      {
        viewBox: `0 0 ${SIZE} ${SIZE}`,
        width: '100%',
        height: '100%',
        role: 'img',
        'aria-label': ariaLabel,
        className: 'ss-donut-svg',
      },
      React.createElement('circle', {
        cx: CENTER,
        cy: CENTER,
        r: (INNER + OUTER) / 2,
        fill: 'none',
        className: 'ss-donut-track',
        strokeWidth: OUTER - INNER,
      }),
      React.createElement(
        'g',
        { transform: `translate(${CENTER},${CENTER})` },
        arcs.map(({ slice, shape, active }) => React.createElement('path', {
          key: slice.data.key,
          d: shape,
          fill: slice.data.color,
          opacity: activeKey === null || active ? 1 : 0.42,
          className: 'ss-donut-slice',
          onMouseEnter: () => onActiveKey(slice.data.key),
          onMouseLeave: () => onActiveKey(null),
        })),
      ),
    ),
    React.createElement(
      'div',
      { className: 'ss-donut-center', 'aria-hidden': true },
      React.createElement(
        'strong',
        { className: 'ss-donut-total', title: centerValue ? undefined : compactNumber(total, locale) },
        centerValue || compactNumber(sum || total, locale),
      ),
      React.createElement('span', { className: 'ss-donut-unit' }, centerLabel || 'tokens'),
      costCny !== undefined
        ? React.createElement('span', { className: 'ss-donut-cost' }, formatCost(costCny, locale))
        : null,
    ),
  )
}
