import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'

// B311 (user: «사진 또는 동영상에 여러 사진이나 동영상 포함이 기본적으로 돼있고 합쳐져야된다»; iOS «앨범» / Android
// AccountMediaSelection.kt): one «사진 또는 동영상» picks up to ten. Photos alone are one album; with a video among them,
// each goes on its own in the picked order — the next once the one before is sent; letting one go drops the rest.
const crc = (bytes: Buffer): number => { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)) } return ~c >>> 0 }
const chunk = (type: string, data: Buffer): Buffer => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out }
const png = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
  chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))])
const mp4 = (): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(200, 1)])

async function files(kinds: ('image' | 'video')[]) {
  const dir = await mkdtemp(join(tmpdir(), 'morse-b311-'))
  const paths = await Promise.all(kinds.map(async (kind, index) => {
    const path = join(dir, `${index}.${kind === 'image' ? 'png' : 'mp4'}`)
    await writeFile(path, kind === 'image' ? png() : mp4()); return path
  }))
  return { paths, done: () => rm(dir, { recursive: true, force: true }) }
}

test('photos alone: one album of all of them', async () => {
  const { paths, done } = await files(['image', 'image', 'image'])
  const staging = new AttachmentStaging()
  try {
    const draft = await staging.pick('chat1', 'media', () => true, async () => paths)
    assert.equal(draft!.kind, 'image'); assert.equal(draft!.items.length, 3)
    assert.equal(await staging.next('chat1', () => true), null, 'nothing left after an album')
  } finally { staging.clear(); await done() }
})

test('with a video among them: each item on its own, in the picked order, the next after the one before', async () => {
  const { paths, done } = await files(['image', 'video', 'image'])
  const staging = new AttachmentStaging()
  try {
    const first = await staging.pick('chat1', 'media', () => true, async () => paths)
    assert.deepEqual([first!.kind, first!.items.length], ['image', 1])
    assert.equal(await staging.next('chat1', () => true), null, 'not while the first is still open')
    staging.clear(first!.id) // sent: the queue lets the selection go by its id, as enqueuePressed does
    const second = await staging.next('chat1', () => true)
    assert.equal(second!.kind, 'video')
    assert.equal(await staging.next('chat2', () => true), null, 'another chat has nothing')
    staging.clear(second!.id)
    const third = await staging.next('chat1', () => true)
    assert.equal(third!.kind, 'image')
    staging.clear(third!.id)
    assert.equal(await staging.next('chat1', () => true), null)
  } finally { staging.clear(); await done() }
})

test('letting one go without sending drops the rest; a new pick starts afresh', async () => {
  const { paths, done } = await files(['video', 'image'])
  const staging = new AttachmentStaging()
  try {
    const first = await staging.pick('chat1', 'media', () => true, async () => paths)
    staging.discard(first!.id)
    assert.equal(await staging.next('chat1', () => true), null)
    await staging.pick('chat1', 'media', () => true, async () => paths)
    staging.discard()
    assert.equal(await staging.next('chat1', () => true), null, 'the chat closing drops it too')
  } finally { staging.clear(); await done() }
})

test('at most ten; one item is picked as before', async () => {
  const many = await files(Array.from({ length: 11 }, () => 'image' as const))
  const staging = new AttachmentStaging()
  try {
    await assert.rejects(staging.pick('chat1', 'media', () => true, async () => many.paths), /최대 10개/)
    const one = await staging.pick('chat1', 'media', () => true, async () => many.paths.slice(0, 1))
    assert.deepEqual([one!.kind, one!.items.length], ['image', 1])
  } finally { staging.clear(); await many.done() }
})
