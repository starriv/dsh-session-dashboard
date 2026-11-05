/**
 * The only Host-facing edge: two read-only JSON routes.
 *
 * `/ping` is a harmless health probe. `/snapshot` carries session titles,
 * working directories and spend, so it reuses the Host connection service's
 * browser-trust/cookie admission when that service is present. No mutating
 * verbs are accepted.
 */

import { normalizeScope } from './scope.js'

const ROUTE_PREFIX = '/dsh-session-stats'

function json(res, status, value, head = false, headers = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(head ? undefined : body)
}

/**
 * @param {object} ctx Cordis Host context (requires webServer)
 * @param {{ store: import('./store.js').StatsStore, monitor: import('./runtime.js').RuntimeMonitor, version: string }} services
 * @returns {() => void} route disposer
 */
export function registerStatsRoutes(ctx, { store, monitor, version }) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
  return ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const head = req.method === 'HEAD'
      if (req.method !== 'GET' && !head) {
        json(res, 405, { error: 'method-not-allowed' }, false, { allow: 'GET, HEAD' })
        return
      }
      let url
      try {
        url = new URL(req.url || '/', 'http://session-stats.local')
      } catch {
        json(res, 400, { error: 'bad-request' })
        return
      }
      const pathname = url.pathname
      try {
        // The snapshot carries session titles, cwd and spend; ping is kept on
        // the same admission path so it cannot become an unauthenticated
        // plugin/activity oracle. A missing connection service fails closed
        // unless the composition explicitly opts into unauthenticated local use.
        const gate = connection
          || (typeof ctx.get === 'function' ? ctx.get('connection') : undefined)
        if (gate && typeof gate.requestRejection === 'function') {
          let rejection
          try {
            rejection = gate.requestRejection({ headers: req.headers })
          } catch {
            rejection = 403
          }
          if (rejection) {
            json(res, rejection, { error: 'unauthorized' })
            return
          }
        } else if (store.config.allowUnauthenticated !== true) {
          json(res, 503, { error: 'auth-unavailable' })
          return
        }

        if (pathname === `${ROUTE_PREFIX}/ping`) {
          json(res, 200, {
            ok: true,
            name: '@local/dsh-session-stats',
            version,
            sequence: store.sequence,
            scannedAt: store.scannedAt || null,
          }, head)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/snapshot`) {
          const scope = normalizeScope(url.searchParams.get('scope'))
          const force = url.searchParams.get('force') === '1'
          const snapshot = await store.snapshot(scope, force)
          json(res, 200, {
            ...snapshot,
            runtime: monitor.snapshot(),
            plugin: { name: '@local/dsh-session-stats', version },
          }, head)
          return
        }
        json(res, 404, { error: 'not-found' })
      } catch (error) {
        // Keep internal paths/messages out of the response; the Host console is
        // the place to diagnose a failed snapshot.
        console.error('[session-stats] snapshot failed', error)
        json(res, 500, { error: 'snapshot-failed' })
      }
    },
  })
}
