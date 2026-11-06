import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { en, zh } from '../src/client/locale.js'

const root = path.resolve(import.meta.dirname, '..')

test('locale dictionaries stay in parity and cover the retry state', async () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.ok(zh['state.retrying'])
  assert.ok(en['state.retrying'])
})

test('theme tokens are real and the skeleton/accessibility primitives survive CSS edits', async () => {
  const css = (await Promise.all(['base.css', 'sections.css', 'charts.css'].map((file) => (
    readFile(path.join(root, 'src/client/styles', file), 'utf8')
  )))).join('\n')
  assert.ok(!css.includes('--dsw-alias-state-warning-primary'), 'use the real state-warn token')
  assert.ok(css.includes('--dsw-alias-state-warn-primary'))
  assert.ok(css.includes('.ss-sr-only'))
  assert.ok(css.includes('--ss-data-accent'))
  assert.ok(css.includes('data-platform="darwin"'))
  assert.ok(css.includes('@container stats-composition'))
})

test('the client build wrapper keeps the module-loader contract', async () => {
  const client = await readFile(path.join(root, 'client.js'), 'utf8')
  assert.ok(client.includes('window.__ModuleLoader__.load'))
  assert.ok(client.includes('id: "@local/dsh-session-stats"'))
  assert.ok(!client.includes('__STATS_CSS__'))
  assert.ok(!/require\(["'](?!react)/.test(client), 'only react may be external')
})
