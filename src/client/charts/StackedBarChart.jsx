/**
 * Seven-day (or 14/30-day) stacked consumption chart.
 *
 * d3-scale supplies the bands and the linear domain; the marks are plain SVG so
 * the chart can use host theme tokens for every non-data surface and keep its
 * hover tooltip as React DOM (crisp text in both themes).
 */

import * as React from 'react'
import { max } from 'd3-array'
import { scaleBand, scaleLinear } from 'd3-scale'
import { curveMonotoneX, line } from 'd3-shape'
import { TOKEN_KINDS } from '../theme.js'
import { compactNumber, cx, exactNumber, formatCost, formatDayFull, formatDayLabel } from '../format.js'
import { useMeasure } from '../hooks.js'
import { ChartTooltip, TooltipRow } from './ChartTooltip.jsx'

const HEIGHT = 232
const MARGIN = { top: 16, right: 10, bottom: 30, left: 10 }

function roundedTopRect(x, y, width, height, radius) {
  if (height <= 0 || width <= 0) return ''
  const r = Math.min(radius, width / 2, height)
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`
}

function segmentsOf(day) {
  return TOKEN_KINDS.map((kind) => ({ ...kind, value: Number(day?.[kind.key] ?? 0) }))
}

export function StackedBarChart({ data, previous, t, locale }) {
  const [measureRef, width] = useMeasure()
  const [hover, setHover] = React.useState(null)
  const [focusIndex, setFocusIndex] = React.useState(0)

  const chartWidth = Math.max(280, width || 520)
  const innerWidth = chartWidth - MARGIN.left - MARGIN.right
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const rows = Array.isArray(data) ? data.filter((row) => row && typeof row.date === 'string') : []
  const previousRows = Array.isArray(previous) ? previous.filter((row) => row && typeof row.date === 'string') : []
  const hasPrevious = previousRows.some((row) => (row?.totalTokens || 0) > 0)
  const maximum = Math.max(
    1,
    max(rows, (row) => row.totalTokens || 0) || 1,
    hasPrevious ? max(previousRows, (row) => row.totalTokens || 0) || 1 : 1,
  )
  const y = scaleLinear().domain([0, maximum * 1.08]).nice(4).range([innerHeight, 0])
  const band = scaleBand()
    .domain(rows.map((row) => row.date))
    .range([0, innerWidth])
    .paddingInner(0.34)
    .paddingOuter(0.16)
  const bandWidth = Math.max(8, band.bandwidth())
  const ticks = y.ticks(4)
  // Derive label density from the actual pixel width instead of the row count:
  // the same 14-day range needs a different step in a 340px and a 900px panel.
  const labelPx = locale && locale.toLowerCase().startsWith('zh') ? 34 : 44
  const labelStep = Math.max(1, Math.ceil((rows.length * labelPx) / Math.max(1, innerWidth)))
  const lastIndex = Math.max(0, rows.length - 1)
  const lastShown = Math.floor(lastIndex / labelStep) * labelStep
  const showLastLabel = lastIndex % labelStep === 0 || (lastIndex - lastShown) * bandWidth >= labelPx
  const activeFocus = Math.min(focusIndex, Math.max(0, rows.length - 1))
  const onKeyDown = (event, index) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key) || rows.length === 0) return
    let next = index
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = rows.length - 1
    event.preventDefault()
    setFocusIndex(next)
    setHover(focusPoint(next))
    const svg = event.currentTarget.ownerSVGElement
    window.requestAnimationFrame(() => {
      svg?.querySelector(`[data-ss-index="${next}"]`)?.focus()
    })
  }

  const previousPath = hasPrevious
    ? line()
        .x((_, index) => (band(rows[index]?.date) || 0) + bandWidth / 2)
        .y((row) => y(row.totalTokens || 0))
        .curve(curveMonotoneX)(previousRows.slice(0, rows.length))
    : null
  const focusPoint = (index) => ({
    index,
    x: (band(rows[index].date) || 0) + bandWidth / 2,
    y: innerHeight * 0.6,
  })

  const onMove = (event, index) => {
    const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect()
    setHover({
      index,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    })
  }

  return React.createElement(
    'div',
    { className: 'ss-stacked-chart', ref: measureRef },
    React.createElement(
      'svg',
      {
        width: '100%',
        height: HEIGHT,
        viewBox: `0 0 ${chartWidth} ${HEIGHT}`,
        role: 'group',
        'aria-label': t('daily.chart.aria'),
      },
      React.createElement(
        'g',
        { transform: `translate(${MARGIN.left},${MARGIN.top})` },
        ticks.map((tick) => React.createElement(
          'g',
          { key: tick },
          React.createElement('line', {
            x1: 0,
            x2: innerWidth,
            y1: y(tick),
            y2: y(tick),
            className: tick === 0 ? 'ss-axis-line' : 'ss-grid-line',
          }),
          tick > 0
            ? React.createElement('text', {
                x: innerWidth,
                y: y(tick) - 5,
                textAnchor: 'end',
                className: 'ss-axis-label',
              }, compactNumber(tick, locale))
            : null,
        )),
        previousPath
          ? React.createElement('path', {
              d: previousPath,
              fill: 'none',
              stroke: 'var(--dsw-alias-label-secondary)',
              strokeWidth: 1.5,
              strokeDasharray: '4 5',
              opacity: 0.65,
              className: 'ss-previous-line',
            })
          : null,
        rows.map((row, index) => {
          const active = hover?.index === index
          const columnX = band(row.date) || 0
          let cumulative = 0
          const parts = segmentsOf(row)
          const lastVisible = parts.map((part) => part.value > 0).lastIndexOf(true)
          return React.createElement(
            'g',
            { key: row.date },
            parts.map((part, partIndex) => {
              if (part.value <= 0) return null
              const bottom = y(cumulative)
              const top = y(cumulative + part.value)
              cumulative += part.value
              const height = Math.max(1, bottom - top)
              const x = columnX + (bandWidth - bandWidth) / 2
              return React.createElement('path', {
                key: part.key,
                d: roundedTopRect(x, top, bandWidth, height, partIndex === lastVisible ? 2 : 0),
                fill: part.color,
                fillOpacity: hover === null || active ? 0.58 : 0.36,
                stroke: 'var(--dsw-alias-bg-layer-1)',
                strokeWidth: 0.5,
                className: 'ss-bar-segment',
              })
            }),
            row.totalTokens > 0
              ? React.createElement('path', {
                  d: roundedTopRect(columnX, y(row.totalTokens), bandWidth, Math.min(6, innerHeight), 3),
                  fill: 'var(--ss-data-accent)',
                  className: 'ss-bar-cap',
                })
              : null,
          )
        }),
        rows.map((row, index) => React.createElement(
          'g',
          { key: `hit-${row.date}` },
          React.createElement('rect', {
            x: (band(row.date) || 0) - 2,
            y: 0,
            width: bandWidth + 4,
            height: innerHeight,
            fill: 'transparent',
            onMouseMove: (event) => onMove(event, index),
            onMouseLeave: () => setHover(null),
            onFocus: () => {
              setFocusIndex(index)
              setHover(focusPoint(index))
            },
            onBlur: () => setHover(null),
            onKeyDown: (event) => onKeyDown(event, index),
            'data-ss-index': index,
            tabIndex: activeFocus === index ? 0 : -1,
            role: 'img',
            'aria-label': `${formatDayFull(row.date, locale)}: ${exactNumber(row.totalTokens, locale)} ${t('token.tokens')}, ${formatCost(row.costCny, locale)}${hasPrevious ? `, ${t('daily.previous')} ${exactNumber(previousRows[index]?.totalTokens || 0, locale)}` : ''}`,
            className: cx('ss-bar-hit', hover?.index === index && 'is-active'),
          }),
          React.createElement('line', {
            x1: (band(row.date) || 0) + bandWidth / 2,
            x2: (band(row.date) || 0) + bandWidth / 2,
            y1: innerHeight,
            y2: innerHeight + 6,
            className: 'ss-tick-line',
          }),
          index % labelStep === 0 || (index === lastIndex && showLastLabel)
            ? React.createElement('text', {
                x: (band(row.date) || 0) + bandWidth / 2,
                y: innerHeight + 22,
                textAnchor: 'middle',
                className: cx('ss-day-label', hover?.index === index && 'is-active', index === rows.length - 1 && 'is-today'),
              }, formatDayLabel(row.date, locale))
            : null,
        )),
      ),
    ),
    hover && rows[hover.index]
      ? React.createElement(
          ChartTooltip,
          {
            left: Math.min(chartWidth - 120, Math.max(120, hover.x)),
            top: hover.y < 120 ? hover.y + 16 : hover.y,
            align: hover.y < 120 ? 'below' : 'center',
          },
          React.createElement('div', { className: 'ss-tooltip-title' }, formatDayFull(rows[hover.index].date, locale)),
          React.createElement('div', { className: 'ss-tooltip-total' },
            `${compactNumber(rows[hover.index].totalTokens, locale)} ${t('token.tokens')}`,
            React.createElement('span', null, formatCost(rows[hover.index].costCny, locale))),
          hasPrevious && previousRows[hover.index]
            ? React.createElement(TooltipRow, {
                label: t('daily.previous'),
                value: compactNumber(previousRows[hover.index].totalTokens || 0, locale),
              })
            : null,
          segmentsOf(rows[hover.index]).map((part) => React.createElement(TooltipRow, {
            key: part.key,
            color: part.color,
            label: t(part.labelKey),
            value: compactNumber(part.value, locale),
          })),
        )
      : null,
  )
}

export { segmentsOf }
