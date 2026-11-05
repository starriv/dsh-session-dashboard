import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToString } = require('react-dom/server')

async function loadClient() {
  const code = await readFile(path.resolve(import.meta.dirname, '..', 'client.js'), 'utf8')
  let factory = null
  const tags = []
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    AbortController,
    Intl,
    fetch: async () => {
      throw new Error('fetch is not expected during SSR')
    },
    document: {
      visibilityState: 'visible',
      head: { appendChild: (tag) => tags.push(tag), removeChild: () => {} },
      createElement: () => ({ dataset: {}, textContent: '' }),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    window: {
      __ModuleLoader__: {
        load: (definition) => {
          factory = definition.factory
        },
      },
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback) => callback(0),
      cancelAnimationFrame: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  }
  vm.runInNewContext(code, sandbox, { filename: 'client.js' })
  return { sandbox, factory, tags }
}

test('client bundle exposes apply/inject and registers sidebar + main entries', async () => {
  const { sandbox, factory, tags } = await loadClient()
  assert.equal(typeof factory, 'function')
  const module = factory(require)
  assert.deepEqual(Array.from(module.inject), ['slots', 'locale'])

  const registrations = []
  const effects = []
  const dictionaries = new Map()
  const locale = {
    register(ns, value) {
      dictionaries.set(ns, value)
    },
    bind(ns) {
      return (key) => dictionaries.get(ns)?.[this.getSnapshot().active]?.[key] ?? key
    },
    getSnapshot() {
      return { active: 'zh', locales: [], revision: 0 }
    },
    subscribe() {
      return () => {}
    },
  }
  const ctx = {
    locale,
    effect(factory) {
      const disposer = factory()
      if (typeof disposer === 'function') effects.push(disposer)
      return () => {}
    },
    slots: {
      inject(owner, callback) {
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  module.apply(ctx)
  assert.ok(dictionaries.has('session-stats'))
  assert.equal(registrations.length, 2)

  const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  assert.ok(sidebar)
  assert.equal(sidebar.options.id, 'session-stats')
  assert.equal(sidebar.options.label(), '会话统计')

  const main = registrations.find((entry) => entry.options.name === 'main')
  assert.ok(main)
  assert.equal(main.options.key, 'session-stats')
  const injected = main.options.inject()
  assert.equal(typeof injected.translate, 'function')
  assert.equal(injected.translate('page.title'), '会话统计')
  assert.equal(typeof injected.localeStore.getSnapshot, 'function')

  const html = renderToString(React.createElement(main.component, injected))
  assert.match(html, /class="ss-page"/)
  assert.match(html, /ss-kpi-value-skeleton/)
  assert.match(html, /ss-kpi-strip/)
  assert.ok(tags.some((tag) => String(tag.textContent).includes('.ss-page')))
  assert.ok(effects.length >= 1)

})
