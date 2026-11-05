/**
 * Framework-independent session-log decoding.
 *
 * A session log is a concatenation of independently compressed zstd frames,
 * one per append batch, so `zstdDecompress` on the whole file only returns the
 * first frame. We locate frame magic bytes and decode each segment separately.
 *
 * False-positive magic bytes can occur inside compressed data. When a segment
 * fails to decode we extend it through the next candidate boundary and retry,
 * which keeps the real frame intact. A truncated tail (a session being written
 * right now) is skipped; the next scan sees a larger file and retries.
 */

import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const decompress = promisify(zstdDecompress)
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function frameStarts(buffer) {
  const starts = []
  let at = 0
  for (;;) {
    const found = buffer.indexOf(ZSTD_MAGIC, at)
    if (found < 0) break
    starts.push(found)
    at = found + 4
  }
  return starts
}

/** Check whether any later candidate frame still decodes (a corrupt middle frame). */
async function laterFrameDecodes(starts, from, buffer, maxOutputLength) {
  for (let index = from + 1; index < starts.length; index += 1) {
    const start = starts[index]
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    if (end <= start) continue
    try {
      const decoded = await decompress(buffer.subarray(start, end), { maxOutputLength })
      if (decoded.length > 0) return true
    } catch {
      // Try the next candidate.
    }
  }
  return false
}


/**
 * Parse one zstd frame header and block chain. Node < 24 can resolve a
 * truncated frame with partial output instead of throwing; validating the
 * frame structure and declared content size prevents torn tail text from
 * reaching the JSONL fold.
 */
function parseFrame(buffer, start, end) {
  let at = start + 4
  if (at >= end) return { complete: false }
  const descriptor = buffer[at++]
  const fcsFlag = descriptor >>> 6
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictFlag = descriptor & 0x03
  if (!singleSegment) {
    if (at + 1 > end) return { complete: false }
    at += 1
  }
  const dictSize = [0, 1, 2, 4][dictFlag]
  if (at + dictSize > end) return { complete: false }
  at += dictSize
  const fcsSize = fcsFlag === 0 ? (singleSegment ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
  if (at + fcsSize > end) return { complete: false }
  let contentSize = null
  if (fcsSize === 1) contentSize = buffer[at]
  else if (fcsSize === 2) contentSize = buffer.readUInt16LE(at) + 256
  else if (fcsSize === 4) contentSize = buffer.readUInt32LE(at)
  else if (fcsSize === 8) contentSize = Number(buffer.readBigUInt64LE(at))
  at += fcsSize

  for (;;) {
    if (at + 3 > end) return { complete: false }
    const header = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16)
    at += 3
    const last = (header & 1) !== 0
    const type = (header >>> 1) & 0x03
    const size = header >>> 3
    if (type === 3) return { complete: false }
    const dataSize = type === 0 ? size : type === 1 ? 1 : size
    if (at + dataSize > end) return { complete: false }
    at += dataSize
    if (last) break
  }
  if (checksum) {
    if (at + 4 > end) return { complete: false }
    at += 4
  }
  return { complete: true, end: at, contentSize }
}

/** Decode every complete frame in `buffer`; returns the concatenated text. */
export async function decompressZstdFrames(buffer, { maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
  const starts = frameStarts(buffer)
  if (starts.length === 0) throw new Error('invalid zstd: no frame magic')
  const chunks = []
  let totalBytes = 0
  let index = 0
  while (index < starts.length) {
    const start = starts[index]
    let boundary = index + 1
    let decoded = null
    while (boundary <= starts.length) {
      const end = boundary < starts.length ? starts[boundary] : buffer.length
      if (end > start) {
        const remaining = maxBytes - totalBytes
        if (remaining <= 0) throw new Error('zstd output exceeds maxDecodedBytes')
        const frame = parseFrame(buffer, start, end)
        if (!frame.complete) {
          boundary += 1
          continue
        }
        try {
          decoded = await decompress(buffer.subarray(start, end), { maxOutputLength: remaining })
          if (frame.contentSize !== null && decoded.length !== frame.contentSize) {
            boundary += 1
            continue
          }
          index = boundary
          break
        } catch (error) {
          if (error && error.code === 'ERR_BUFFER_TOO_LARGE') {
            throw new Error('zstd output exceeds maxDecodedBytes', { cause: error })
          }
          // Either this boundary is a false magic hit, or this frame is the
          // incomplete tail. Extend and try the next real frame boundary.
        }
      }
      boundary += 1
    }
    if (!decoded) {
      // A corrupt middle frame followed by valid frames must not be cached as a
      // silently truncated log. Only an incomplete final frame is tolerated.
      if (await laterFrameDecodes(starts, index, buffer, Math.max(1, maxBytes - totalBytes))) {
        throw new Error('corrupt zstd frame before a later valid frame')
      }
      break
    }
    totalBytes += decoded.length
    chunks.push(decoded.toString('utf8'))
  }
  if (chunks.length === 0) throw new Error('invalid zstd: no decodable frame')
  return chunks.join('')
}
