import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zstdCompressSync } from 'node:zlib'
import { decompressZstdFrames } from '../host/zstd.js'

const frame = (text) => zstdCompressSync(Buffer.from(text, 'utf8'))

test('decodes every concatenated frame in append order', async () => {
  const text = await decompressZstdFrames(Buffer.concat([
    frame('{"type":"session"}\n'),
    frame('{"type":"assistant/message"}\n'),
    frame('{"type":"assistant/message"}\n'),
  ]))
  assert.equal(text, '{"type":"session"}\n{"type":"assistant/message"}\n{"type":"assistant/message"}\n')
})

test('a torn tail frame contributes no partial text', async () => {
  const first = frame('hello\n')
  const second = frame('world\n')
  const text = await decompressZstdFrames(Buffer.concat([first, second.subarray(0, second.length - 3)]))
  assert.equal(text, 'hello\n')
})

test('rejects a corrupt middle frame instead of silently truncating', async () => {
  const first = frame('one\n')
  const broken = Buffer.from(frame('broken\n'))
  broken[5] ^= 0xff
  const last = frame('two\n')
  await assert.rejects(
    decompressZstdFrames(Buffer.concat([first, broken, last])),
    /corrupt zstd frame/,
  )
})

test('rejects decompression past the byte budget', async () => {
  const compressed = frame('x'.repeat(4096))
  await assert.rejects(decompressZstdFrames(compressed, { maxBytes: 1024 }), /maxDecodedBytes/)
})

test('rejects a buffer without a zstd frame', async () => {
  await assert.rejects(decompressZstdFrames(Buffer.from('not compressed')), /no frame magic/)
})
