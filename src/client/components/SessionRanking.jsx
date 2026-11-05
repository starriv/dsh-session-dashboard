/** Ranked breakdown with a slim share bar along each row's bottom edge. */

import * as React from 'react'
import { Card, CardHeader, EmptyState, Segmented, Skeleton } from './ui.jsx'
import { IconTable } from '../icons.jsx'
import { compactNumber, exactNumber, formatCost, formatDuration, shortModel } from '../format.js'

function rankingRows(ranking, durationRanking, mode) {
  const source = mode === 'duration' && Array.isArray(durationRanking) ? durationRanking : ranking
  const rows = Array.isArray(source) ? [...source] : []
  rows.sort((a, b) => (mode === 'duration'
    ? (b.durationMs || 0) - (a.durationMs || 0)
    : (b.tokens || 0) - (a.tokens || 0)))
  return rows
}

function shareLabel(share) {
  if (!(share > 0)) return '0%'
  if (share < 0.1) return '<0.1%'
  return `${share < 1 ? share.toFixed(1) : Math.round(share)}%`
}

function RankIndex({ index }) {
  return React.createElement('span', { className: 'ss-rank' }, String(index + 1).padStart(2, '0'))
}

function HeaderRow({ t }) {
  return React.createElement(
    'div',
    { className: 'ss-ranking-head', role: 'row' },
    React.createElement('span', { className: 'ss-col-rank', role: 'columnheader' }, t('ranking.rank')),
    React.createElement('span', { className: 'ss-col-session', role: 'columnheader' }, t('ranking.session')),
    React.createElement('span', { className: 'ss-col-token', role: 'columnheader' }, t('ranking.tokens')),
    React.createElement('span', { className: 'ss-col-cost', role: 'columnheader' }, t('ranking.cost')),
    React.createElement('span', { className: 'ss-col-duration', role: 'columnheader' }, t('ranking.duration')),
  )
}

function SkeletonBody({ t, count = 8 }) {
  return React.createElement(
    'div',
    { className: 'ss-ranking-body', role: 'rowgroup' },
    Array.from({ length: Math.max(1, count) }, (_, index) => React.createElement(
      'div',
      { key: index, className: 'ss-ranking-row is-skeleton', role: 'row' },
      React.createElement('span', { className: 'ss-col-rank', role: 'cell' }, React.createElement(Skeleton, { className: 'ss-rank-skeleton' })),
      React.createElement(
        'span',
        { className: 'ss-col-session', role: 'cell' },
        React.createElement(Skeleton, { className: 'ss-session-skeleton' }),
        React.createElement(Skeleton, { className: 'ss-session-sub-skeleton' }),
      ),
      React.createElement('span', { className: 'ss-col-token', role: 'cell' }, React.createElement(Skeleton, { className: 'ss-token-skeleton' })),
      React.createElement('span', { className: 'ss-col-cost', role: 'cell' }, React.createElement(Skeleton, { className: 'ss-cost-skeleton' })),
      React.createElement('span', { className: 'ss-col-duration', role: 'cell' }, React.createElement(Skeleton, { className: 'ss-duration-skeleton' })),
    )),
  )
}

export function SessionRanking({
  ranking,
  rankingDuration,
  rankingTotal,
  totalTokens = 0,
  pending = false,
  mode = 'tokens',
  onModeChange,
  t,
  locale,
}) {
  const rows = rankingRows(ranking, rankingDuration, mode)
  const changeMode = onModeChange || (() => {})
  const totalSessions = Number.isFinite(rankingTotal) ? rankingTotal : rows.length
  const metricOf = (row) => mode === 'duration' ? (row.durationMs || 0) : (row.tokens || 0)
  const maximum = Math.max(1, ...rows.map(metricOf))
  const options = [
    { value: 'tokens', label: t('ranking.byTokens') },
    { value: 'duration', label: t('ranking.byDuration') },
  ]

  return React.createElement(
    Card,
    {
      className: `ss-ranking${pending ? ' is-pending' : ''}`,
      'aria-busy': pending || undefined,
    },
    React.createElement(CardHeader, {
      title: t('ranking.title'),
      subtitle: pending
        ? t('page.loading')
        : rows.length < totalSessions
          ? `${rows.length} / ${totalSessions} ${t('ranking.sessions')}`
          : `${rows.length} ${t('ranking.sessions')}`,
      icon: React.createElement(IconTable),
      aside: React.createElement(Segmented, {
        value: mode,
        options,
        onChange: changeMode,
        ariaLabel: t('ranking.title'),
      }),
    }),
    pending
      ? React.createElement(
          'div',
          { className: 'ss-ranking-scroll', role: 'table', 'aria-label': t('ranking.title') },
          React.createElement(HeaderRow, { t }),
          React.createElement(SkeletonBody, { t, count: rows.length || 8 }),
        )
      : rows.length === 0
        ? React.createElement(EmptyState, { title: t('ranking.empty'), description: t('ranking.emptyHint') })
        : React.createElement(
            'div',
            { className: 'ss-ranking-scroll', role: 'table', 'aria-label': t('ranking.title') },
            React.createElement(HeaderRow, { t }),
            React.createElement(
              'div',
              { className: 'ss-ranking-body', role: 'rowgroup' },
              rows.map((row, index) => {
                const share = totalTokens > 0 ? ((row.tokens || 0) / totalTokens) * 100 : 0
                const bar = Math.max(1.5, Math.min(100, (metricOf(row) / maximum) * 100))
                return React.createElement(
                  'div',
                  {
                    key: row.id || `${row.title || 'session'}-${index}`,
                    className: 'ss-ranking-row',
                    role: 'row',
                    style: { '--ss-share': `${bar}%` },
                  },
                  React.createElement('span', { className: 'ss-row-share', 'aria-hidden': true }),
                  React.createElement('span', { className: 'ss-col-rank', role: 'cell' }, React.createElement(RankIndex, { index })),
                  React.createElement(
                    'span',
                    { className: 'ss-col-session', role: 'cell' },
                    React.createElement(
                      'span',
                      { className: 'ss-session-main' },
                      React.createElement('span', { className: 'ss-session-title', title: row.title || row.id }, row.title || t('ranking.untitled')),
                      row.model ? React.createElement('span', { className: 'ss-session-model' }, shortModel(row.model)) : null,
                    ),
                    React.createElement(
                      'span',
                      { className: 'ss-session-meta' },
                      row.workspace ? React.createElement('span', null, row.workspace) : null,
                      row.workspace ? React.createElement('i', { className: 'ss-meta-sep' }) : null,
                      React.createElement('span', { className: 'ss-session-id', title: row.id }, String(row.id || '').slice(0, 18)),
                    ),
                  ),
                  React.createElement(
                    'span',
                    { className: 'ss-col-token', role: 'cell' },
                    React.createElement('b', { title: `${row.tokens} ${t('token.tokens')}` }, compactNumber(row.tokens, locale)),
                    React.createElement('em', null, shareLabel(share)),
                    React.createElement('span', { className: 'ss-sr-only' }, `${exactNumber(row.tokens, locale)} ${t('token.tokens')}, ${shareLabel(share)}`),
                  ),
                  React.createElement('span', { className: 'ss-col-cost', role: 'cell' }, formatCost(row.costCny, locale)),
                  React.createElement('span', { className: 'ss-col-duration', role: 'cell' }, formatDuration(row.durationMs)),
                )
              }),
            ),
          ),
  )
}
