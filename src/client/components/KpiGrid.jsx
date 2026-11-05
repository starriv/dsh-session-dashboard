/** Four headline numbers in one divided strip, with context instead of sentences. */

import * as React from 'react'
import { Card, Skeleton } from './ui.jsx'
import { IconActivity, IconCoins, IconStats, IconTrend } from '../icons.jsx'
import { compactNumber, exactNumber, formatCost, formatMonthDay, percent } from '../format.js'

function deltaPercent(current, previous) {
  if (!Number.isFinite(previous) || previous <= 0) return null
  const change = ((current - previous) / previous) * 100
  const rounded = Math.round(change)
  if (rounded === 0) return { text: '±0%', tone: 'neutral' }
  if (Math.abs(change) > 999) return { text: change > 0 ? '10×+' : '−99%', tone: 'neutral' }
  return {
    text: `${change > 0 ? '▲' : '▼'} ${Math.abs(rounded)}%`,
    tone: 'neutral',
  }
}

function deltaPoints(current, previous) {
  if (!Number.isFinite(previous) || previous <= 0) return null
  const change = (current - previous) * 100
  if (Math.abs(change) < 0.05) return { text: '±0pp', tone: 'neutral' }
  return {
    text: `${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}pp`,
    tone: change > 0 ? 'up' : 'down',
  }
}

function DeltaLine({ delta, baseline, t }) {
  if (delta) {
    return React.createElement(
      'span',
      { className: `ss-kpi-context ss-delta-${delta.tone}` },
      React.createElement('span', { className: 'ss-delta' }, delta.text),
      React.createElement('span', { className: 'ss-delta-baseline' }, t('kpi.vsPrev')),
    )
  }
  return React.createElement('span', { className: 'ss-kpi-context' }, baseline)
}

export function KpiGrid({ totals, previous, since, pending = false, t, locale, timeZone }) {
  const safe = totals || {}
  const previousTotals = previous || null
  const hasPrevious = Boolean(previousTotals)
  const tokensDelta = hasPrevious ? deltaPercent(safe.totalTokens, previousTotals.totalTokens) : null
  const costDelta = hasPrevious ? deltaPercent(safe.costCny, previousTotals.costCny) : null
  const avgDelta = hasPrevious ? deltaPercent(safe.averageTokensPerSession, previousTotals.averageTokensPerSession) : null
  const cacheDelta = hasPrevious ? deltaPoints(safe.cacheHitRate, previousTotals.cacheHitRate) : null
  const sinceLabel = since ? formatMonthDay(since, locale, timeZone) : ''

  const cards = [
    {
      key: 'tokens',
      icon: React.createElement(IconStats),
      label: t('kpi.tokens'),
      value: compactNumber(safe.totalTokens, locale),
      delta: tokensDelta,
      baseline: sinceLabel ? `${t('kpi.since')} ${sinceLabel}` : t('scope.all'),
      title: `${exactNumber(safe.totalTokens, locale)} ${t('token.tokens')}\n${t('kpi.input')} ${exactNumber(safe.inputTokens, locale)} · ${t('kpi.output')} ${exactNumber(safe.outputTokens, locale)}\n${t('token.cacheRead')} ${exactNumber(safe.cacheReadTokens, locale)} · ${t('token.cacheWrite')} ${exactNumber(safe.cacheWriteTokens, locale)}`,
    },
    {
      key: 'cost',
      icon: React.createElement(IconCoins),
      label: t('kpi.cost'),
      value: formatCost(safe.costCny, locale),
      delta: costDelta,
      baseline: hasPrevious ? t('kpi.noPrev') : t('kpi.listPrice'),
      title: `${formatCost(safe.costCny, locale)} · ${t('kpi.listPrice')}\n${t('kpi.cost.title')}`,
    },
    {
      key: 'avg',
      icon: React.createElement(IconTrend),
      label: t('kpi.avg'),
      value: compactNumber(safe.averageTokensPerSession, locale),
      delta: avgDelta,
      baseline: `${safe.sessionsWithUsage || 0} ${t('kpi.sessions')}`,
      title: `${exactNumber(safe.averageTokensPerSession, locale)} ${t('token.tokens')} / ${safe.sessionsWithUsage || 0} ${t('kpi.sessions')}`,
    },
    {
      key: 'cache',
      icon: React.createElement(IconActivity),
      label: t('kpi.cacheHit'),
      value: percent(safe.cacheHitRate, 2),
      delta: cacheDelta,
      warn: Number(safe.cacheHitRate) < 0.95,
      baseline: `${t('kpi.cacheRead')} ${compactNumber(safe.cacheReadTokens, locale)}`,
      title: t('kpi.cache.title'),
    },
  ]

  return React.createElement(
    Card,
    {
      className: `ss-kpi-strip${pending ? ' is-pending' : ''}`,
      'aria-busy': pending || undefined,
    },
    React.createElement(
      'div',
      { className: 'ss-kpi-strip-grid' },
      cards.map((card) => React.createElement(
        'div',
        { key: card.key, className: 'ss-kpi-cell' },
        React.createElement(
          'div',
          { className: 'ss-kpi-top' },
          React.createElement('span', { className: 'ss-kpi-label' }, card.label),
          React.createElement('span', { className: 'ss-kpi-icon' }, card.icon),
        ),
        pending
          ? React.createElement(Skeleton, { className: 'ss-kpi-value-skeleton' })
          : React.createElement(
              'strong',
              { className: `ss-kpi-value${card.warn ? ' is-warn' : ''}`, title: card.title },
              card.value,
            ),
        pending
          ? React.createElement(Skeleton, { className: 'ss-kpi-sub-skeleton' })
          : React.createElement(DeltaLine, { delta: card.delta, baseline: card.baseline, t }),
        React.createElement('span', { className: 'ss-sr-only' }, card.title),
      )),
    ),
  )
}
