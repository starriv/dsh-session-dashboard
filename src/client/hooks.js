/** React hooks shared by the dashboard: polling data, element width, motion. */

import * as React from 'react'

const POLL_MS = 5000
const FETCH_TIMEOUT_MS = 15_000

/**
 * The browser's IANA zone is the user's real "today". The Host cannot infer
 * it, so every snapshot request carries it and the Host rebuckets calendar
 * days accordingly. A Host without a browser falls back to its configured zone.
 */
function browserTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' ? zone : ''
  } catch {
    return ''
  }
}

function endpoint(scope, force) {
  const params = new URLSearchParams({ scope: String(scope) })
  // Re-read the zone on every poll so a browser/OS zone change is picked up
  // without reloading the dashboard; the Host rebuilds buckets when it changes.
  const zone = browserTimeZone()
  if (zone) params.set('tz', zone)
  if (force) params.set('force', '1')
  return `/dsh-session-stats/snapshot?${params.toString()}`
}

/**
 * Poll the Host snapshot while the page is mounted and visible.
 *
 * A finished request schedules the next one (no overlapping polls), and every
 * re-render sees only the latest response. The previous snapshot stays on
 * screen during refreshes, so the dashboard never flickers back to a skeleton.
 */
export function useStatsSnapshot(scope) {
  const [state, setState] = React.useState({
    data: null,
    dataScope: null,
    requestedScope: scope,
    error: null,
    loading: true,
    refreshing: false,
    updatedAt: 0,
    pending: true,
    retrying: false,
  })
  const abortRef = React.useRef(null)
  const timerRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const sequenceRef = React.useRef(0)
  const manualRef = React.useRef(false)
  const failureRef = React.useRef(0)

  const load = React.useCallback(async (force) => {
    const sequence = ++sequenceRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (force) manualRef.current = true
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, FETCH_TIMEOUT_MS)
    setState((previous) => {
      const hasData = previous.data !== null
      const sameDataScope = previous.dataScope === scope
      const retryingFatal = previous.requestedScope === scope && previous.error !== null && !hasData
      return {
        ...previous,
        requestedScope: scope,
        // Keep old data mounted as a layout shell while the new scope loads;
        // components render content skeletons from `pending`, never stale values.
        pending: hasData ? !sameDataScope : !retryingFatal,
        loading: !hasData && !retryingFatal,
        retrying: force && !hasData,
        refreshing: force && hasData && sameDataScope,
        error: previous.error,
      }
    })
    try {
      const response = await fetch(endpoint(scope, force), {
        signal: controller.signal,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!mountedRef.current || sequence !== sequenceRef.current) return
      failureRef.current = 0
      setState({
        data,
        dataScope: scope,
        requestedScope: scope,
        error: null,
        loading: false,
        refreshing: false,
        updatedAt: data.generatedAt || Date.now(),
        pending: false,
        retrying: false,
      })
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return
      if (!mountedRef.current || sequence !== sequenceRef.current) return
      failureRef.current = Math.min(5, failureRef.current + 1)
      const failure = timedOut
        ? new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`)
        : error instanceof Error ? error : new Error(String(error))
      setState((previous) => {
        const sameDataScope = previous.dataScope === scope
        return {
          ...previous,
          data: sameDataScope ? previous.data : null,
          dataScope: sameDataScope ? previous.dataScope : null,
          requestedScope: scope,
          loading: false,
          refreshing: false,
          pending: false,
          retrying: false,
          error: failure,
        }
      })
    } finally {
      window.clearTimeout(timeout)
      if (force && sequence === sequenceRef.current) manualRef.current = false
    }
  }, [scope])

  React.useEffect(() => {
    mountedRef.current = true
    let stopped = false
    const backoff = () => Math.min(POLL_MS * 2 ** failureRef.current, 60_000)
    const schedule = (delay = backoff()) => {
      window.clearTimeout(timerRef.current)
      if (stopped) return
      timerRef.current = window.setTimeout(tick, delay)
    }
    const tick = async () => {
      if (document.visibilityState === 'hidden' || manualRef.current) {
        schedule(backoff())
        return
      }
      await load(false)
      schedule(backoff())
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !manualRef.current) {
        load(false)
        schedule(backoff())
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    load(false).finally(() => schedule(backoff()))
    return () => {
      stopped = true
      manualRef.current = false
      mountedRef.current = false
      window.clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      abortRef.current?.abort()
    }
  }, [load])

  const refresh = React.useCallback(() => load(true), [load])
  // Keep the old snapshot mounted while a different scope loads so the layout
  // and card frames stay stable; `pending` tells each component to skeletonize
  // its data-bearing content.
  const pending = state.pending || (state.data !== null && state.dataScope !== scope)
  return {
    data: state.data,
    dataScope: state.dataScope,
    pending,
    retrying: state.retrying,
    error: state.error,
    loading: state.loading,
    refreshing: state.refreshing,
    updatedAt: state.updatedAt,
    refresh,
    pollMs: POLL_MS,
  }
}

/** Observe an element's content width (charts are drawn at device-independent px). */
export function useMeasure() {
  const ref = React.useRef(null)
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect?.width || 0)
      setWidth((previous) => (previous === next ? previous : next))
    })
    observer.observe(element)
    setWidth(Math.floor(element.getBoundingClientRect().width))
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}
