import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { after, test } from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const outfile = path.join(import.meta.dirname, '.render-harness.cjs')

after(() => rm(outfile, { force: true }))

test('dashboard sections server-render with realistic data', async () => {
  await build({
    absWorkingDir: root,
    entryPoints: ['test/render-harness.jsx'],
    bundle: true,
    write: true,
    outfile,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
    logLevel: 'warning',
  })
  const harness = require(outfile)
  const html = harness.renderSections()

  assert.ok(html.includes('1.17B'), 'compact total tokens')
  assert.ok(html.includes('¥58.07'), 'estimated cost')
  assert.ok(html.includes('99.65%'), 'cache hit rate')
  assert.ok(html.includes('619 MB'), 'RSS')
  assert.ok(html.includes('121.2 ms'), 'event loop p99')
  assert.ok(html.includes('季度数据质量审计'), 'ranking title')
  assert.ok(html.includes('未命名会话'), 'untitled fallback')
  assert.ok(html.includes('deepseek-v4-pro'), 'model chip')
  assert.ok(html.includes('ss-bar-segment'), 'stacked bars')
  assert.ok(html.includes('ss-donut-slice'), 'donut slices')
  assert.ok(html.includes('ss-sparkline'), 'cpu sparkline')
  assert.ok(html.includes('ss-delta'), 'delta context')
  assert.ok(html.includes('ss-previous-line'), 'previous period line')
  assert.ok(html.includes('99.3%'), 'dominant donut share')
  assert.ok(html.includes('日均 44.9M'), 'daily average instead of duplicate total')
  assert.ok(html.includes('ss-row-share'), 'ranking share bars')
  assert.ok(html.includes('ss-ranking-head'), 'ranking table')
  assert.ok(!html.includes('NaN'), 'no NaN coordinates')

  const dashboard = harness.renderDashboard()
  assert.ok(dashboard.includes('ss-page') === false) // DashboardView is the body, not the page shell
  assert.ok(dashboard.includes('ss-kpi-strip'))
  assert.ok(dashboard.includes('ss-kpi-strip-grid'))
  assert.ok(dashboard.indexOf('ss-ranking') < dashboard.indexOf('ss-runtime'))
  assert.ok(dashboard.includes('ss-chart-grid'))
  assert.ok(dashboard.includes('ss-ranking'))
  assert.ok(dashboard.includes('本地日志'))
  assert.ok(!dashboard.includes('NaN'))
})
