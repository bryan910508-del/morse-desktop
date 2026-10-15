import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { readGrantedStorageObject } from '../../src/main/network/granted-storage-read'
import { storageBucket } from '../../src/main/media/media-document'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// B416: a granted Storage object is read in one request when the bytes' answer carries its description (md5,
// generation, the uploader's custom metadata, type) — every Storage request pays the server's access check. An answer
// that lacks part of it asks for the metadata while the bytes keep coming. Either way the bytes are kept only when
// they are what the description says.
const path = 'stories/user/ann/s1.jpg', picture = Buffer.from('picture bytes for b416')
const md5 = createHash('md5').update(picture).digest('base64')
const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) } as unknown as ReadCredentials
const check = { label: 'Story photo', custom: { storyId: 's1', ownerUid: 'ann' }, contentTypes: ['image/jpeg', 'image/png'], maxBytes: 1024, resend: true }
const carried = (overrides: Record<string, string | null> = {}): Record<string, string> => {
  const all: Record<string, string | null> = { 'content-length': String(picture.length), 'content-type': 'image/jpeg', 'x-goog-hash': `crc32c=AAAAAA==,md5=${md5}`,
    'x-goog-generation': '17', 'x-goog-metageneration': '1', 'x-goog-meta-storyId': 's1', 'x-goog-meta-ownerUid': 'ann', ...overrides }
  return Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== null))
}
function server(headers: Record<string, string>, meta: { md5?: string; custom?: Record<string, string>; status?: number } = {}) {
  const original = globalThis.fetch, log: string[] = []
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('authorizeMorseMediaRead')) { log.push('grant'); return new Response(JSON.stringify({ result: { ok: true, resourceURL: `gs://${storageBucket}/${path}` } }), { status: 200 }) }
    if (url.endsWith('?alt=media')) {
      log.push('media')
      // The bytes come a little after the answer's head, so a metadata read can start meanwhile.
      const stream = new ReadableStream<Uint8Array>({ async start(controller) {
        init?.signal?.addEventListener('abort', () => { log.push('media stopped'); try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* closed */ } })
        await wait(30); if (init?.signal?.aborted) return
        controller.enqueue(new Uint8Array(picture)); controller.close()
      } })
      return new Response(stream, { status: 200, headers })
    }
    log.push('meta')
    if (meta.status) return new Response('refused', { status: meta.status })
    const body = Buffer.from(JSON.stringify({ bucket: storageBucket, name: path, contentType: 'image/jpeg', size: String(picture.length), generation: '17', metageneration: '1',
      md5Hash: meta.md5 ?? md5, metadata: meta.custom ?? { storyId: 's1', ownerUid: 'ann' } }))
    return new Response(new Uint8Array(body), { status: 200, headers: { 'content-length': String(body.length) } })
  }) as typeof fetch
  return { log, restore: () => { globalThis.fetch = original } }
}
const read = (marks?: string[]) => readGrantedStorageObject(auth, path, check, new AbortController().signal, () => {}, () => {}, value => marks?.push(value))

test('an answer that carries the description is read in one request after the grant', async () => {
  const net = server(carried()), marks: string[] = []
  try {
    const value = await read(marks)
    assert.deepEqual([...value.bytes], [...picture])
    assert.equal(value.contentType, 'image/jpeg')
    assert.deepEqual(net.log, ['grant', 'media'], 'no metadata read')
    assert.match(marks[0]!, /^grant=\d+ token=\d+ headers=\d+ media=\d+ bytes=22 requests=one$/)
  } finally { net.restore() }
})

test('an answer without the custom metadata asks for the metadata while the bytes keep coming', async () => {
  const net = server(carried({ 'x-goog-meta-storyId': null, 'x-goog-meta-ownerUid': null })), marks: string[] = []
  try {
    const value = await read(marks)
    assert.deepEqual([...value.bytes], [...picture])
    assert.deepEqual(net.log, ['grant', 'media', 'meta'])
    assert.match(marks[0]!, /requests=two$/)
  } finally { net.restore() }
})

test('bytes that are not what the description says, or a description of another object, are not kept', async () => {
  let net = server(carried({ 'x-goog-hash': 'md5=AAAAAAAAAAAAAAAAAAAAAA==' }))
  try { await assert.rejects(read(), /Story photo changed during download/) } finally { net.restore() }
  net = server(carried({ 'x-goog-meta-storyId': 'other' }))
  try { await assert.rejects(read(), /Story photo metadata mismatch/); assert.ok(!net.log.includes('meta')) } finally { net.restore() }
  net = server(carried({ 'content-type': 'text/html' }))
  try { await assert.rejects(read(), /Story photo metadata mismatch/) } finally { net.restore() }
  net = server(carried({ 'x-goog-hash': null }), { custom: { storyId: 'other', ownerUid: 'ann' } })
  try { await assert.rejects(read(), /Story photo metadata mismatch/) } finally { net.restore() }
  net = server(carried({ 'x-goog-hash': null }), { md5: 'AAAAAAAAAAAAAAAAAAAAAA==' })
  try { await assert.rejects(read(), /Story photo changed during download/) } finally { net.restore() }
})

test('a metadata read that fails stops the bytes still on their way, and says why', async () => {
  const net = server(carried({ 'x-goog-hash': null }), { status: 403 })
  try {
    const started = Date.now()
    await assert.rejects(read(), /Invalid Story photo response/)
    assert.ok(net.log.includes('media stopped'), 'the bytes were stopped')
    assert.ok(Date.now() - started < 2000)
  } finally { net.restore() }
})

test('B360: under the person\'s own limit the size is weighed first, and a bigger object is not asked for', async () => {
  const net = server(carried())
  try {
    await assert.rejects(readGrantedStorageObject(auth, path, { ...check, maxBytes: 10, weighFirst: true }, new AbortController().signal, () => {}, () => {}), /Story photo metadata mismatch/)
    assert.deepEqual(net.log, ['grant', 'meta'], 'no bytes asked')
    const value = await readGrantedStorageObject(auth, path, { ...check, weighFirst: true }, new AbortController().signal, () => {}, () => {})
    assert.deepEqual([...value.bytes], [...picture])
    assert.deepEqual(net.log.slice(2), ['grant', 'meta', 'media'], 'weighed, then the bytes')
  } finally { net.restore() }
})
