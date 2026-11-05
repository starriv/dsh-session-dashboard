/**
 * Best-effort title enrichment from the persisted projection cache.
 *
 * The authoritative title is the latest `session/title` event in the log. Old
 * logs may predate title generation, and the projection cache usually carries a
 * folded title for them. This is a read-only hint: a missing or malformed cache
 * simply leaves the title empty, and the UI falls back to a short session id.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

function titleFromRecord(value) {
  const title = value && value.record && value.record.rows && value.record.rows.title
  const candidate = title && title.val
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : ''
}

function titleFromFlatMap(value, sessionId) {
  if (!value || typeof value !== 'object') return ''
  const direct = value[sessionId]
  if (typeof direct === 'string') return direct.trim()
  if (direct && typeof direct === 'object') {
    const candidate = direct.title ?? direct.val
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

/**
 * Load the titles of the requested session ids from the projection cache.
 * Supports both the per-session directory layout and the older flat file.
 */
export async function loadCachedTitles(dshHome, sessionIds) {
  const wanted = new Set(sessionIds.filter(Boolean))
  const result = new Map()
  if (wanted.size === 0 || typeof dshHome !== 'string' || dshHome.length === 0) return result

  const storages = path.join(dshHome, 'storages')
  const directory = path.join(storages, 'session_projcache', 'sessions')

  try {
    const files = await readdir(directory)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const id = file.slice(0, -'.json'.length)
      if (!wanted.has(id) || result.has(id)) continue
      try {
        result.set(id, titleFromRecord(JSON.parse(await readFile(path.join(directory, file), 'utf8'))))
      } catch {
        // Best effort only.
      }
    }
  } catch {
    // Directory layout absent in older profiles.
  }

  if (result.size < wanted.size) {
    try {
      const flat = JSON.parse(await readFile(path.join(storages, 'session_projcache.json'), 'utf8'))
      for (const id of wanted) {
        if (result.has(id)) continue
        const title = titleFromFlatMap(flat, id)
        if (title) result.set(id, title)
      }
    } catch {
      // Older flat cache absent.
    }
  }

  for (const [id, title] of result) {
    if (!title) result.delete(id)
  }
  return result
}
