/**
 * Compact CPU history line. The chart deliberately has no axes: the runtime
 * card owns the labels, so the sparkline stays a single glanceable mark.
 */

import * as React from 'react'
import { max } from 'd3-array'
import { scaleLinear } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'
import { useMeasure, useReducedMotion } from '../hooks.js'
import { compactNumber } from '../format.js'

const HEIGHT = 64
const PADDING = { left: 2, right: 8, top: 8, bottom: 4 }

export function Sparkline({ points, color = '#1fbf9c', locale = 'en', peakLabel }) {
  const [measureRef, width] = useMeasure()
  const reducedMotion = useReducedMotion()
  const [entered, setEntered] = React.useState(false)
  const gradientId = `ss-spark-${React.useId().replace(/[:]/g, '')}`

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const rows = Array.isArray(points) ? points.filter((point) => Number.isFinite(point?.v) && Number.isFinite(point?.t)) : []
  const chartWidth = Math.max(160, width || 420)
  const innerWidth = chartWidth - PADDING.left - PADDING.right
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom
  const peak = Math.max(0.4, max(rows, (point) => point.v) || 0)
  const y = scaleLinear().domain([0, peak * 1.35]).range([innerHeight, 0])
  const first = rows[0]?.t ?? 0
  const last = rows[rows.length - 1]?.t ?? first + 1
  const span = Math.max(1, last - first)
  const x = (point) => PADDING.left + ((point.t - first) / span) * innerWidth
  const lineOf = line().x(x).y((point) => PADDING.top + y(point.v)).curve(curveMonotoneX)
  const areaOf = area().x(x).y0(PADDING.top + innerHeight).y1((point) => PADDING.top + y(point.v)).curve(curveMonotoneX)
  const path = rows.length > 1 ? lineOf(rows) : rows.length === 1
    ? `M${x(rows[0])},${PADDING.top + y(rows[0].v)} L${x(rows[0]) + 1},${PADDING.top + y(rows[0].v)}`
    : `M${PADDING.left},${PADDING.top + innerHeight} L${PADDING.left + innerWidth},${PADDING.top + innerHeight}`
  const fill = rows.length > 1 ? areaOf(rows) : null

  return React.createElement(
    'div',
    { className: 'ss-sparkline', ref: measureRef },
    React.createElement(
      'svg',
      {
        width: '100%',
        height: HEIGHT,
        viewBox: `0 0 ${chartWidth} ${HEIGHT}`,
        role: 'img',
        'aria-label': peakLabel || 'CPU history',
        preserveAspectRatio: 'none',
      },
      React.createElement(
        'defs',
        null,
        React.createElement(
          'linearGradient',
          { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 },
          React.createElement('stop', { offset: '0%', stopColor: color, stopOpacity: 0.32 }),
          React.createElement('stop', { offset: '100%', stopColor: color, stopOpacity: 0 }),
        ),
      ),
      React.createElement('line', {
        x1: PADDING.left,
        x2: PADDING.left + innerWidth,
        y1: PADDING.top + innerHeight,
        y2: PADDING.top + innerHeight,
        className: 'ss-axis-line',
      }),
      fill ? React.createElement('path', { d: fill, fill: `url(#${gradientId})` }) : null,
      React.createElement('path', {
        d: path,
        fill: 'none',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        pathLength: 1,
        style: {
          strokeDasharray: 1,
          strokeDashoffset: entered || reducedMotion ? 0 : 1,
          transition: reducedMotion ? 'none' : 'stroke-dashoffset .8s cubic-bezier(.22,.9,.24,1)',
        },
      }),
      rows.length > 0
        ? React.createElement('circle', {
            cx: x(rows[rows.length - 1]),
            cy: PADDING.top + y(rows[rows.length - 1].v),
            r: 3.2,
            fill: color,
            className: 'ss-spark-dot',
          })
        : null,
    ),
    rows.length === 0
      ? React.createElement('span', { className: 'ss-spark-empty' }, '· · ·')
      : null,
  )
}
