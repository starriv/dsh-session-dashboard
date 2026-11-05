/**
 * Dashboard root. It owns only view state (range and the polling hook); every
 * section below receives a narrow slice of the snapshot, which keeps the page
 * composable and makes adding a card a one-file change.
 */

import * as React from 'react'
import { KpiGrid } from './KpiGrid.jsx'
import { RuntimeCard } from './RuntimeCard.jsx'
import { DailyUsageCard } from './DailyUsageCard.jsx'
import { CompositionCard } from './CompositionCard.jsx'
import { SessionRanking } from './SessionRanking.jsx'
import { Card, ErrorBanner, IconButton, Pill, Segmented } from './ui.jsx'
import { IconAlert, IconRefresh, IconStats } from '../icons.jsx'
import { useStatsSnapshot } from '../hooks.js'
import { formatClock } from '../format.js'
const EMPTY_TOTALS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  costCny: 0,
  sessions: 0,
  sessionsWithUsage: 0,
  averageTokensPerSession: 0,
  cacheHitRate: 0,
}

const EMPTY_SNAPSHOT = {
  scope: 'all',
  trendDays: 30,
  totals: EMPTY_TOTALS,
  composition: EMPTY_TOTALS,
  daily: [],
  ranking: [],
  rankingDuration: [],
  rankingTotal: 0,
  runtime: null,
  errors: 0,
  truncated: false,
  timeZone: undefined,
}


export function PageHeader({ t, locale, timeZone, scope, scopeOptions, onScopeChange, updatedAt, pending, refreshing, live, onRefresh }) {
  return React.createElement(
    'header',
    { className: 'ss-page-head' },
    React.createElement(
      'div',
      { className: 'ss-page-heading' },
      React.createElement('span', { className: 'ss-page-mark' }, React.createElement(IconStats, { size: 20 })),
      React.createElement(
        'div',
        null,
        React.createElement('h1', { className: 'ss-page-title' }, t('page.title')),
        React.createElement('p', { className: 'ss-page-subtitle' }, t('page.subtitle')),
      ),
    ),
    React.createElement(
      'div',
      { className: 'ss-page-tools' },
      React.createElement(Segmented, {
        className: 'ss-scope-selector',
        value: scope,
        options: scopeOptions,
        onChange: onScopeChange,
        ariaLabel: t('scope.label'),
      }),
      live || pending || updatedAt
        ? React.createElement(
            Pill,
            { tone: 'success', dot: true, title: t('page.live') },
            pending
              ? t('page.loading')
              : updatedAt
                ? `${t('page.updated')} ${formatClock(updatedAt, locale, timeZone)}`
                : t('page.live'),
          )
        : null,
      React.createElement(
        IconButton,
        { label: t('page.refresh'), onClick: onRefresh, className: refreshing ? 'is-spinning' : undefined },
        React.createElement(IconRefresh),
      ),
    ),
  )
}

function ErrorState({ t, error, onRetry, busy = false }) {
  return React.createElement(
    Card,
    { className: 'ss-fatal', role: 'alert', 'aria-busy': busy || undefined },
    React.createElement('span', { className: 'ss-fatal-icon' }, React.createElement(IconAlert, { size: 22 })),
    React.createElement('h2', null, t('state.error')),
    React.createElement('p', null, t('state.errorHint')),
    React.createElement('code', { className: 'ss-fatal-detail' }, error?.message || t('state.noData')),
    React.createElement(
      'button',
      { type: 'button', className: 'ss-primary-button', onClick: onRetry, disabled: busy, 'aria-busy': busy || undefined },
      busy ? t('state.retrying') : t('state.retry'),
    ),
  )
}

/** Presentational page body: everything below the header, driven by one snapshot. */
export function DashboardView({ data, pending = false, requestedScope, t, locale, rankingMode, onRankingModeChange }) {
  const totals = data.totals || {}
  const targetScope = pending ? requestedScope : data.scope
  const allTime = targetScope === 'all'
  const targetTrendDays = pending
    ? (requestedScope === 'all' ? (data.scope === 'all' ? (data.trendDays || 30) : 30) : Number(requestedScope))
    : data.trendDays

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(KpiGrid, {
      totals,
      previous: data.previous,
      since: data.since,
      pending,
      timeZone: data.timeZone,
      t,
      locale,
    }),
    React.createElement(
      'div',
      { className: 'ss-chart-grid' },
      React.createElement(DailyUsageCard, {
        daily: data.daily,
        previous: data.previousDaily,
        trendDays: targetTrendDays,
        allTime,
        pending,
        requestedScope,
        t,
        locale,
      }),
      React.createElement(CompositionCard, {
        totals: data.totals,
        allTime,
        pending,
        t,
        locale,
      }),
    ),
    React.createElement(SessionRanking, {
      ranking: data.ranking,
      rankingDuration: data.rankingDuration,
      rankingTotal: data.rankingTotal,
      totalTokens: totals.totalTokens || 0,
      pending,
      mode: rankingMode,
      onModeChange: onRankingModeChange,
      t,
      locale,
    }),
    React.createElement(RuntimeCard, {
      runtime: data.runtime,
      pending: pending && !data.runtime,
      t,
      locale,
    }),
    React.createElement(
      'footer',
      { className: 'ss-footer' },
      React.createElement('span', { title: t('page.source') }, t('page.sourceShort'), React.createElement('span', { className: 'ss-sr-only' }, ` ${t('page.source')}`)),
      React.createElement('span', { title: t('page.priceNote') }, t('page.priceShort'), React.createElement('span', { className: 'ss-sr-only' }, ` ${t('page.priceNote')}`)),
    ),
  )
}

/** Fallback rendered only when the page itself throws. */
export function StatsPageFallback({ t, error, onRetry }) {
  return React.createElement(
    'div',
    { className: 'ss-page' },
    React.createElement(
      'div',
      { className: 'ss-shell' },
      React.createElement(
        ErrorState,
        {
          t,
          error: error || new Error(t('state.noData')),
          onRetry: onRetry || (() => {
            if (typeof window !== 'undefined') window.location.reload()
          }),
        },
      ),
    ),
  )
}

export function StatsPage({ translate, localeStore }) {
  const t = translate
  const localeSnapshot = React.useSyncExternalStore(
    React.useCallback((listener) => localeStore.subscribe(listener), [localeStore]),
    React.useCallback(() => localeStore.getSnapshot(), [localeStore]),
    React.useCallback(() => localeStore.getSnapshot(), [localeStore]),
  )
  const locale = localeSnapshot?.active || 'en'
  const [scope, setScope] = React.useState('all')
  const [rankingMode, setRankingMode] = React.useState('tokens')
  const { data, pending, retrying, error, refreshing, updatedAt, refresh } = useStatsSnapshot(scope)
  const scopeOptions = React.useMemo(() => [
    { value: 'all', label: t('scope.all') },
    ...[7, 14, 30].map((days) => ({
      value: String(days),
      label: `${t('scope.last')} ${days} ${t('scope.daysUnit')}`.trim(),
    })),
  ], [t, locale])

  return React.createElement(
    'div',
    { className: 'ss-page' },
    React.createElement(
      'div',
      { className: 'ss-shell' },
      React.createElement(PageHeader, {
        t,
        locale,
        timeZone: data?.timeZone,
        scope,
        scopeOptions,
        onScopeChange: setScope,
        updatedAt: pending ? 0 : updatedAt,
        pending,
        refreshing,
        live: Boolean(data),
        onRefresh: refresh,
      }),
      !pending && error && data
        ? React.createElement(ErrorBanner, { message: t('page.stale'), onRetry: refresh, retryLabel: t('state.retry') })
        : null,
      !pending && data?.truncated
        ? React.createElement('div', { className: 'ss-notice', role: 'status' }, t('page.truncated'))
        : null,
      !pending && data?.errors > 0
        ? React.createElement('div', { className: 'ss-notice', role: 'status' }, `${data.errors} ${data.errors === 1 ? t('page.errors.one') : t('page.errors')}`)
        : null,
      !pending && !data && error ? React.createElement(ErrorState, { t, error, onRetry: refresh, busy: retrying }) : null,
      pending || data
        ? React.createElement(DashboardView, {
            data: data || EMPTY_SNAPSHOT,
            pending,
            requestedScope: scope,
            t,
            locale,
            rankingMode,
            onRankingModeChange: setRankingMode,
          })
        : null,
    ),
  )
}
