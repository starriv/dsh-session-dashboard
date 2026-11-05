/** Shared hover tooltip shell for the hand-drawn charts. */

import * as React from 'react'

export function ChartTooltip({ left, top, children, align = 'center' }) {
  const transform = align === 'below'
    ? 'translate(-50%, 0)'
    : align === 'left'
      ? 'translate(8px, -110%)'
      : align === 'right'
        ? 'translate(calc(-100% - 8px), -110%)'
        : 'translate(-50%, -110%)'
  return React.createElement(
    'div',
    {
      className: 'ss-chart-tooltip',
      style: { left, top, transform },
      // Exact values are also on each bar's aria-label; avoid live-region churn
      // while the pointer moves.
      'aria-hidden': true,
    },
    children,
  )
}

export function TooltipRow({ color, label, value, strong = false }) {
  return React.createElement(
    'div',
    { className: strong ? 'ss-tooltip-row is-strong' : 'ss-tooltip-row' },
    React.createElement(
      'span',
      { className: 'ss-tooltip-label' },
      color ? React.createElement('i', { className: 'ss-dot', style: { background: color } }) : null,
      label,
    ),
    React.createElement('span', { className: 'ss-tooltip-value' }, value),
  )
}
