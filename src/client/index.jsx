/**
 * Client half of the Session Stats plugin.
 *
 * Two registrations, one page component:
 *  - `sidebar.panellist` adds the left-column entry. The list id is also the
 *    main-panel key the shell dispatches, so the sidebar owner handles selection.
 *  - `main#session-stats` renders the dashboard for that selection.
 *
 * The dictionary and the stylesheet are plugin-owned effects, so unloading the
 * plugin removes both without leaving global residue.
 */

import * as React from 'react'
import { NS, PANEL_ID, PANEL_ORDER } from './constants.js'
import { en, zh } from './locale.js'
import { StatsPage, StatsPageFallback } from './components/StatsPage.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { IconStats } from './icons.jsx'

export const inject = ['slots', 'locale']

const CSS = __STATS_CSS__

function PanelIcon({ size = 18 }) {
  return React.createElement(
    'span',
    { className: 'ss-nav-icon', 'aria-hidden': true },
    React.createElement(IconStats, { size }),
  )
}

export function apply(ctx) {
  const translate = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-stats: dictionaries')

  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    const tag = document.createElement('style')
    tag.dataset.plugin = '@local/dsh-session-stats'
    tag.dataset.pluginCss = '@local/dsh-session-stats/dashboard.css'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'session-stats: stylesheet')

  const localeStore = {
    getSnapshot: () => ctx.locale.getSnapshot(),
    subscribe: (listener) => ctx.locale.subscribe(listener),
  }

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: PANEL_ORDER,
    locale: NS,
    label: () => translate('nav.title'),
  }, PanelIcon))

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ translate, localeStore }),
  }, function SessionStatsPage(props) {
    return React.createElement(
      ErrorBoundary,
      {
        fallback: (error, reset) => React.createElement(StatsPageFallback, {
          t: translate,
          error,
          onRetry: reset,
        }),
      },
      React.createElement(StatsPage, props),
    )
  }))
}
