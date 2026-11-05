import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { after, test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const outfile = path.join(import.meta.dirname, '.dom-harness.cjs')

after(() => rm(outfile, { force: true }))

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1:54840/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  class ResizeObserver {
    observe() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserver
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0)
  window.cancelAnimationFrame = (id) => window.clearTimeout(id)
  Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true })
  globalThis.window = window
  globalThis.document = window.document
  globalThis.ResizeObserver = ResizeObserver
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return dom
}

test('StatsPage loads a snapshot and renders the full dashboard in the DOM', async () => {
  const dom = installDom()
  try {
    await build({
      absWorkingDir: root,
      entryPoints: ['test/dom-harness.jsx'],
      bundle: true,
      write: true,
      outfile,
      format: 'cjs',
      platform: 'browser',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
      logLevel: 'warning',
    })
    const harness = require(outfile)
    const makeSnapshot = (scope) => {
      const scoped = scope !== 'all'
      const days = scoped ? Number(scope) : 7
      return {
        ...harness.fixture,
        generatedAt: Date.now(),
        scope: scoped ? Number(scope) : 'all',
        trendDays: days,
        plugin: { name: '@local/dsh-session-stats', version: '1.0.0' },
        daily: harness.fixture.daily.slice(-Math.min(days, harness.fixture.daily.length)),
        totals: {
          ...harness.fixture.totals,
          totalTokens: scoped ? 900_000_000 : harness.fixture.totals.totalTokens,
          inputTokens: scoped ? 3_000_000 : harness.fixture.totals.inputTokens,
          cacheReadTokens: scoped ? 894_000_000 : harness.fixture.totals.cacheReadTokens,
          outputTokens: scoped ? 3_000_000 : harness.fixture.totals.outputTokens,
          cacheWriteTokens: 0,
          costCny: scoped ? 40 : harness.fixture.totals.costCny,
        },
      }
    }
    const mounted = await harness.mountDashboard(makeSnapshot)
    try {
      let html = mounted.getHtml()
      assert.ok(mounted.urls.some((url) => url.includes('scope=all')))
      assert.match(html, /1\.17B/)
      assert.match(html, /99\.65%/)
      assert.match(html, /全部时间/)
      assert.match(html, /近 7 天/)
      assert.match(html, /季度数据质量审计/)
      assert.match(html, /ss-bar-segment/)
      assert.match(html, /class="ss-bar-hit"/)
      assert.match(html, /aria-label="[^"]*tokens[^"]*"/)
      const barHits = html.match(/<rect[^>]*class="ss-bar-hit"[^>]*>/g) || []
      assert.equal(barHits.filter((tag) => tag.includes('tabindex="0"')).length, 1, 'day columns use one roving tab stop')
      assert.match(html, /ss-donut-slice/)
      assert.match(html, /ss-sparkline/)
      assert.match(html, /ss-ranking-head/)
      assert.ok(!html.includes('NaN'))
      assert.ok(!html.includes('正在读取本机会话日志'))

      await mounted.clickScope('近 7 天')
      html = mounted.getHtml()
      assert.ok(mounted.urls.some((url) => url.includes('scope=7')))
      assert.match(html, /900M/)
      assert.ok(!html.includes('1\.17B'))

      await mounted.setLocale('en')
      html = mounted.getHtml()
      assert.match(html, /Session Stats/)
      assert.match(html, /Last 7 days/)
    } finally {
      await mounted.cleanup()
    }

    const held = await harness.mountDashboard(makeSnapshot, { holdScope: '7' })
    try {
      await held.clickScope('近 7 天')
      const pendingHtml = held.getHtml()
      assert.match(pendingHtml, /ss-kpi-value-skeleton/)
      assert.match(pendingHtml, /ss-skeleton-bar/)
      assert.match(pendingHtml, /ss-donut-skeleton/)
      assert.match(pendingHtml, /ss-ranking-row is-skeleton/)
      assert.equal((pendingHtml.match(/ss-ranking-row is-skeleton/g) || []).length, harness.fixture.ranking.length)
      assert.equal((pendingHtml.match(/ss-skeleton-bar/g) || []).length, 7)
      assert.ok(!pendingHtml.includes('1\.17B'))
      await held.release()
      assert.match(held.getHtml(), /900M/)
    } finally {
      await held.cleanup()
    }

    const failing = await harness.mountDashboard(makeSnapshot, { failScope: '7' })
    try {
      await failing.clickScope('近 7 天')
      const errorHtml = failing.getHtml()
      assert.match(errorHtml, /统计加载失败/)
      assert.ok(!errorHtml.includes('1\.17B'))
    } finally {
      await failing.cleanup()
    }
  } finally {
    dom.window.close()
  }
})
