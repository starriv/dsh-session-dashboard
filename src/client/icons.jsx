/** Minimal line icons; all inherit `currentColor` and use one 24px grid. */

import * as React from 'react'

function icon(paths, { size = 16, strokeWidth = 1.8 } = {}) {
  return function Icon(props) {
    const edge = props.size ?? size
    return React.createElement(
      'svg',
      {
        width: edge,
        height: edge,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: props.strokeWidth ?? strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        ...props,
      },
      paths.map((path, index) => React.createElement('path', { key: index, d: path })),
    )
  }
}

export const IconStats = icon([
  'M4 20V10',
  'M10 20V4',
  'M16 20v-7',
  'M22 20v-3',
  'M2 20h20',
])

export const IconRefresh = icon([
  'M20 11a8 8 0 1 0-2.3 5.7',
  'M20 4v7h-7',
])

export const IconCpu = icon([
  'M6 6h12v12H6z',
  'M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3',
])

export const IconMemory = icon([
  'M3 8h18v8H3z',
  'M6 16v3M10 16v3M14 16v3M18 16v3',
  'M7 11h2M11 11h2M15 11h2',
])

export const IconClock = icon(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'])

export const IconActivity = icon(['M3 12h4l2.5-6 4 12 2.5-6h5'])

export const IconCoins = icon([
  'M12 7c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z',
  'M4 4v6c0 1.7 3.6 3 8 3s8-1.3 8-3V4',
  'M4 10v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
])

export const IconLayers = icon([
  'M12 3 3 8l9 5 9-5-9-5z',
  'm3 13 9 5 9-5',
  'm3 18 9 5 9-5',
])

export const IconTrend = icon(['M3 17l6-6 4 4 7-8', 'M15 7h5v5'])

export const IconTable = icon([
  'M4 4h16v16H4z',
  'M4 9h16M4 14h16M9 4v16',
])

export const IconAlert = icon(['M12 3 2 21h20L12 3z', 'M12 9v5', 'M12 18h.01'])

export const IconSpinner = icon(['M12 3a9 9 0 1 0 9 9'])
