/** Small host-matched primitives used across the dashboard. */

import * as React from 'react'
import { cx } from '../format.js'

export function Card({ className, children, ...rest }) {
  return React.createElement('section', { className: cx('ss-card', className), ...rest }, children)
}

export function CardHeader({ icon, title, subtitle, aside, className }) {
  return React.createElement(
    'header',
    { className: cx('ss-card-head', className) },
    React.createElement(
      'div',
      { className: 'ss-card-head-main' },
      icon ? React.createElement('span', { className: 'ss-card-head-icon' }, icon) : null,
      React.createElement(
        'div',
        { className: 'ss-card-head-text' },
        React.createElement('h2', { className: 'ss-card-title' }, title),
        subtitle ? React.createElement('p', { className: 'ss-card-subtitle' }, subtitle) : null,
      ),
    ),
    aside ? React.createElement('div', { className: 'ss-card-head-aside' }, aside) : null,
  )
}

export function Pill({ tone = 'neutral', dot = false, children, className, title }) {
  return React.createElement(
    'span',
    { className: cx('ss-pill', `ss-pill-${tone}`, className), title },
    dot ? React.createElement('span', { className: 'ss-pill-dot', 'aria-hidden': true }) : null,
    children,
  )
}

export function Segmented({ value, options, onChange, ariaLabel, className }) {
  return React.createElement(
    'div',
    { className: cx('ss-segmented', className), role: 'group', 'aria-label': ariaLabel },
    options.map((option) => React.createElement(
      'button',
      {
        key: option.value,
        type: 'button',
        className: cx('ss-segmented-item', value === option.value && 'is-active'),
        'aria-pressed': value === option.value,
        onClick: () => onChange(option.value),
      },
      option.label,
    )),
  )
}

export function Skeleton({ className, style }) {
  return React.createElement('span', { className: cx('ss-skeleton', className), style, 'aria-hidden': true })
}

export function IconButton({ label, onClick, children, className, disabled }) {
  return React.createElement(
    'button',
    {
      type: 'button',
      className: cx('ss-icon-button', className),
      onClick,
      disabled,
      title: label,
      'aria-label': label,
    },
    children,
  )
}

export function EmptyState({ icon, title, description, action }) {
  return React.createElement(
    'div',
    { className: 'ss-empty' },
    icon ? React.createElement('span', { className: 'ss-empty-icon' }, icon) : null,
    React.createElement('strong', null, title),
    description ? React.createElement('p', null, description) : null,
    action || null,
  )
}

export function ErrorBanner({ message, onRetry, retryLabel }) {
  return React.createElement(
    'div',
    { className: 'ss-error-banner', role: 'alert' },
    React.createElement('span', { className: 'ss-error-text' }, message),
    onRetry
      ? React.createElement('button', { type: 'button', className: 'ss-text-button', onClick: onRetry }, retryLabel)
      : null,
  )
}
