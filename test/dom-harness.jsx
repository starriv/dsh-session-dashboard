/** DOM harness: mount the real container in jsdom, expose scope switching. */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { StatsPage } from '../src/client/components/StatsPage.jsx'
import { en, zh } from '../src/client/locale.js'
import { fixture } from './fixture.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function mountDashboard(snapshotForScope, { failScope, holdScope } = {}) {
  const urls = []
  let releaseHold = null
  const held = holdScope === undefined ? null : new Promise((resolve) => { releaseHold = resolve })
  globalThis.fetch = async (input) => {
    const url = String(input)
    urls.push(url)
    const scope = new URL(url, 'http://session-stats.local').searchParams.get('scope') || 'all'
    if (failScope !== undefined && failScope === scope) throw new Error('simulated network failure')
    if (held && scope === holdScope) await held
    return { ok: true, json: async () => snapshotForScope(scope) }
  }
  let active = 'zh'
  let revision = 0
  let localeSnapshot = { active, locales: [], revision }
  const listeners = new Set()
  const localeStore = {
    getSnapshot: () => localeSnapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const translate = (key) => (active === 'zh' ? zh : en)[key] ?? key
  const setLocale = async (locale) => {
    active = locale
    revision += 1
    localeSnapshot = { active, locales: [], revision }
    await act(async () => {
      for (const listener of listeners) listener()
      await wait(10)
    })
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(StatsPage, { translate, localeStore }))
  })
  await act(async () => { await wait(30) })

  const getHtml = () => container.innerHTML
  const clickScope = async (label) => {
    const buttons = Array.from(container.querySelectorAll('.ss-scope-selector button'))
    const button = buttons.find((candidate) => candidate.textContent.includes(label))
    if (!button) throw new Error(`scope button not found: ${label}`)
    await act(async () => {
      button.click()
      await wait(30)
    })
  }
  const release = async () => {
    if (releaseHold) releaseHold()
    releaseHold = null
    await act(async () => { await wait(30) })
  }
  const cleanup = async () => {
    await act(async () => { root.unmount() })
    container.remove()
  }
  return { getHtml, urls, clickScope, setLocale, release, cleanup }
}

export { fixture }
