/** SSR harness used by `components.test.mjs` to exercise every dashboard section. */

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { zh } from '../src/client/locale.js'
import { KpiGrid } from '../src/client/components/KpiGrid.jsx'
import { RuntimeCard } from '../src/client/components/RuntimeCard.jsx'
import { DailyUsageCard } from '../src/client/components/DailyUsageCard.jsx'
import { CompositionCard } from '../src/client/components/CompositionCard.jsx'
import { SessionRanking } from '../src/client/components/SessionRanking.jsx'
import { DashboardView } from '../src/client/components/StatsPage.jsx'
import { fixture } from './fixture.js'

export { React, renderToString }

const t = (key) => zh[key] ?? key

export { fixture } from './fixture.js'
function localeStore() {
  return {
    getSnapshot: () => ({ active: 'zh', locales: [], revision: 0 }),
    subscribe: () => () => {},
  }
}

export function renderSections() {
  return renderToString(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(KpiGrid, {
        totals: fixture.totals,
        previous: fixture.previous,
        since: fixture.since,
        timeZone: 'Asia/Shanghai',
        t,
        locale: 'zh',
      }),
      React.createElement(RuntimeCard, { runtime: fixture.runtime, t, locale: 'zh' }),
      React.createElement(DailyUsageCard, {
        daily: fixture.daily,
        previous: fixture.previousDaily,
        trendDays: fixture.trendDays,
        allTime: true,
        t,
        locale: 'zh',
      }),
      React.createElement(CompositionCard, { totals: fixture.totals, t, locale: 'zh' }),
      React.createElement(SessionRanking, {
        ranking: fixture.ranking,
        rankingDuration: fixture.ranking,
        totalTokens: fixture.totals.totalTokens,
        timeZone: 'Asia/Shanghai',
        idleGapMs: fixture.idleGapMs,
        t,
        locale: 'zh',
      }),
    ),
  )
}

export function renderDashboard() {
  const data = {
    ...fixture,
    generatedAt: Date.now(),
    daily: fixture.daily,
  }
  return renderToString(
    React.createElement(DashboardView, {
      data,
      t,
      locale: 'zh',
    }),
  )
}

/** The single-day ("今日") variant of the daily card while its scope loads. */
export function renderTodayCardPending() {
  return renderToString(
    React.createElement(DailyUsageCard, {
      daily: fixture.daily.slice(-1),
      previous: fixture.previousDaily.slice(-1),
      trendDays: 1,
      allTime: false,
      pending: true,
      requestedScope: '1',
      t,
      locale: 'zh',
    }),
  )
}

/** The single-day ("今日") variant of the daily card, rendered without a scope switch. */
export function renderTodayCard() {
  return renderToString(
    React.createElement(DailyUsageCard, {
      daily: fixture.daily.slice(-1),
      previous: fixture.previousDaily.slice(-1),
      trendDays: 1,
      allTime: false,
      requestedScope: '1',
      t,
      locale: 'zh',
    }),
  )
}
