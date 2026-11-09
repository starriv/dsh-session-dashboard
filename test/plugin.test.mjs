import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { test } from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const HAS_SESSIONS = await readdir(path.join(DSH_HOME, 'sessions')).then((entries) => entries.length > 0).catch(() => false)

function fakeContext() {
  const routes = []
  const intervals = []
  const disposers = []
  const ctx = {
    connection: undefined,
    get(name) {
      return name === 'connection' ? this.connection : undefined
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(factory) {
      const disposer = factory()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
    setInterval(callback, delay) {
      intervals.push({ callback, delay })
      return () => {}
    },
  }
  return { ctx, routes, intervals, disposers }
}

async function call(route, url, method = 'GET') {
  const response = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || {}
    },
    end(chunk) {
      this.body = chunk ?? ''
    },
  }
  await route.handler({ method, url, headers: {} }, response)
  return { status: response.status, json: response.body ? JSON.parse(response.body) : null }
}

test('host apply registers routes and serves a complete snapshot', { skip: !HAS_SESSIONS }, async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx, {
    sessionsRoot: path.join(DSH_HOME, 'sessions'),
    dshHome: DSH_HOME,
    scope: 'all',
    trendDays: 7,
    rankingLimit: 2,
    timeZone: 'Asia/Shanghai',
    refreshMs: 0,
    allowUnauthenticated: true,
  })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/dsh-session-stats')

  const ping = await call(routes[0], '/dsh-session-stats/ping')
  assert.equal(ping.status, 200)
  assert.equal(ping.json.ok, true)

  const snapshot = await call(routes[0], '/dsh-session-stats/snapshot')
  assert.equal(snapshot.status, 200)
  assert.ok(snapshot.json.generatedAt > 0)
  assert.ok(snapshot.json.runtime.pid > 0)
  assert.ok(snapshot.json.runtime.cpuCount >= 1)
  assert.equal(snapshot.json.scope, 'all')
  assert.ok(Array.isArray(snapshot.json.daily))
  assert.equal(snapshot.json.daily.length, 7)
  assert.ok(Array.isArray(snapshot.json.ranking))
  assert.ok(snapshot.json.ranking.length <= 2)
  assert.ok(snapshot.json.rankingTotal >= snapshot.json.ranking.length)
  assert.ok(snapshot.json.totals.totalTokens > 0)
  assert.equal(snapshot.json.plugin.name, 'dsh-session-dashboard')

  const scoped = await call(routes[0], '/dsh-session-stats/snapshot?scope=7')
  assert.equal(scoped.status, 200)
  assert.equal(scoped.json.scope, 7)
  assert.equal(scoped.json.daily.length, 7)
  assert.equal(scoped.json.previousDaily.length, 7)
  assert.equal(snapshot.json.previous, null)
  assert.equal(typeof scoped.json.previous, 'object')
  assert.ok(scoped.json.previous.costCny >= 0)
  const scopedDaily = scoped.json.daily.reduce((sum, day) => sum + day.totalTokens, 0)
  assert.equal(scopedDaily, scoped.json.totals.totalTokens)
  const previousDailyTotal = scoped.json.previousDaily.reduce((sum, day) => sum + day.totalTokens, 0)
  assert.equal(previousDailyTotal, scoped.json.previous.totalTokens)
  assert.ok(scoped.json.totals.totalTokens <= snapshot.json.totals.totalTokens)
  assert.ok(scoped.json.since > 0)
  assert.ok(snapshot.json.since > 0)
  assert.ok(snapshot.json.previousDaily.length === 7)

  const invalidScope = await call(routes[0], '/dsh-session-stats/snapshot?scope=bogus')
  assert.equal(invalidScope.status, 200)
  assert.equal(invalidScope.json.scope, 'all')

  // An invalid zone resolves back to the configured zone.
  const invalidZone = await call(routes[0], '/dsh-session-stats/snapshot?scope=1&tz=Not/AZone')
  assert.equal(invalidZone.status, 200)
  assert.equal(invalidZone.json.timeZone, 'Asia/Shanghai')
  assert.equal(invalidZone.json.daily.length, 1)

  const todayInZone = await call(routes[0], '/dsh-session-stats/snapshot?scope=1&tz=Asia/Tokyo')
  assert.equal(todayInZone.status, 200)
  assert.equal(todayInZone.json.scope, 1)
  assert.equal(todayInZone.json.timeZone, 'Asia/Tokyo')
  assert.equal(todayInZone.json.daily.length, 1)
  assert.equal(todayInZone.json.previousDaily.length, 1)
  assert.equal(typeof todayInZone.json.previous, 'object')
  assert.equal(
    todayInZone.json.daily.reduce((sum, day) => sum + day.totalTokens, 0),
    todayInZone.json.totals.totalTokens,
  )

  const head = await call(routes[0], '/dsh-session-stats/ping', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.json, null)

  const rejected = await call(routes[0], '/dsh-session-stats/ping', 'POST')
  assert.equal(rejected.status, 405)

  const missing = await call(routes[0], '/dsh-session-stats/nope')
  assert.equal(missing.status, 404)
})

test('snapshot defers to the connection service browser auth', { skip: !HAS_SESSIONS }, async () => {
  const { ctx, routes } = fakeContext()
  ctx.connection = { requestRejection: () => 401 }
  apply(ctx, {
    sessionsRoot: path.join(DSH_HOME, 'sessions'),
    dshHome: DSH_HOME,
    scope: 'all',
    trendDays: 7,
    timeZone: 'Asia/Shanghai',
    refreshMs: 0,
  })
  const rejected = await call(routes[0], '/dsh-session-stats/snapshot')
  assert.equal(rejected.status, 401)
  assert.equal(rejected.json.error, 'unauthorized')
  const rejectedPing = await call(routes[0], '/dsh-session-stats/ping')
  assert.equal(rejectedPing.status, 401)
  assert.equal(rejectedPing.json.error, 'unauthorized')

  const { ctx: allowedCtx, routes: allowedRoutes } = fakeContext()
  allowedCtx.connection = { requestRejection: () => undefined }
  apply(allowedCtx, {
    sessionsRoot: path.join(DSH_HOME, 'sessions'),
    dshHome: DSH_HOME,
    scope: 'all',
    trendDays: 7,
    timeZone: 'Asia/Shanghai',
    refreshMs: 0,
  })
  const allowed = await call(allowedRoutes[0], '/dsh-session-stats/snapshot')
  assert.equal(allowed.status, 200)
  const allowedPing = await call(allowedRoutes[0], '/dsh-session-stats/ping')
  assert.equal(allowedPing.status, 200)
})

test('metadata routes fail closed when the connection service is absent', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx, {
    sessionsRoot: '/definitely/not/a/sessions/root',
    dshHome: DSH_HOME,
    scope: 'all',
    trendDays: 3,
    timeZone: 'Asia/Shanghai',
    refreshMs: 0,
  })
  const ping = await call(routes[0], '/dsh-session-stats/ping')
  assert.equal(ping.status, 503)
  assert.equal(ping.json.error, 'auth-unavailable')
  const snapshot = await call(routes[0], '/dsh-session-stats/snapshot')
  assert.equal(snapshot.status, 503)
  assert.equal(snapshot.json.error, 'auth-unavailable')
  assert.equal(snapshot.json.totals, undefined)
})

test('host apply tolerates a missing sessions root', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx, {
    sessionsRoot: '/definitely/not/a/sessions/root',
    dshHome: DSH_HOME,
    scope: 'all',
    trendDays: 3,
    timeZone: 'Asia/Shanghai',
    refreshMs: 0,
    allowUnauthenticated: true,
  })
  const snapshot = await call(routes[0], '/dsh-session-stats/snapshot')
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.json.files, 0)
  assert.equal(snapshot.json.totals.totalTokens, 0)
  assert.equal(snapshot.json.daily.length, 3)
})
