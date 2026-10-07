import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { uploadAttachment, uploadTimingLine } from '../../src/main/network/media-upload-api'
import { storageBucket } from '../../src/main/media/media-document'
import type { UploadDescriptor } from '../../src/main/storage/upload-protocol'

// B185 A3: the Storage bucket is far away (US-EAST1), so every request counts. A fresh send asks nothing before its
// session (none of its bytes can be up yet), sends a picture in one request, and takes the object's metadata — its
// download token — from the finishing answer; only a resumed send, or a finishing answer without what is needed, asks
// again. The integrity checks are the same either way.
const uid = 'me1'
const bytes = Buffer.from('a small picture')
const upload: UploadDescriptor = { id: 'up1', name: 'p.jpg', kind: 'image', size: bytes.length, chatId: 'c1', contentType: 'image/jpeg',
  path: `chat_media/c1/${uid}/up1.jpg`, sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64'), session: null } as UploadDescriptor
const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
const object = (token: string | null) => ({ bucket: storageBucket, name: upload.path, size: String(upload.size), contentType: upload.contentType, md5Hash: upload.md5,
  generation: '1', metadata: { ownerUid: uid, morseUploadId: upload.id, morseSourceSHA256: upload.sha256 }, ...(token ? { downloadTokens: token } : {}) })
const sessionUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodeURIComponent(upload.path)}&upload_id=u1`

function server(finalBody: object | null, existing: object | null = null) {
  const seen: string[] = []
  globalThis.fetch = (async (url: string, init: { method: string; headers: Record<string, string> }) => {
    const command = init.headers?.['X-Goog-Upload-Command']
    if (url.includes('prepareMorseChatMedia')) { seen.push('prepare'); return new Response(JSON.stringify({ result: { ok: true, chatId: 'c1' } }), { status: 200 }) }
    if (init.method === 'GET') { seen.push('get'); return existing ? new Response(JSON.stringify(existing), { status: 200 }) : new Response('', { status: 404 }) }
    if (command === 'start') { seen.push('start'); return new Response('', { status: 200, headers: { 'X-Goog-Upload-URL': sessionUrl, 'X-Goog-Upload-Status': 'active' } }) }
    if (command === 'query') { seen.push('query'); return new Response('', { status: 200, headers: { 'X-Goog-Upload-Status': 'active', 'X-Goog-Upload-Size-Received': '0' } }) }
    if (command === 'upload, finalize') { seen.push('bytes'); return new Response(finalBody ? JSON.stringify(finalBody) : '', { status: 200, headers: { 'X-Goog-Upload-Status': 'final' } }) }
    seen.push(`?${init.method} ${command}`); return new Response('', { status: 500 })
  }) as typeof fetch
  return seen
}
const url = (token: string) => `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(upload.path)}?alt=media&token=${token}`

test('B185 A3: a fresh picture goes as prepare, start, one request of bytes — no look before, no read after', async () => {
  const seen = server(object('tok1'))
  const got = await uploadAttachment(auth as never, uid, upload, bytes, async () => {}, () => {}, new AbortController().signal)
  assert.equal(got, url('tok1'))
  assert.deepEqual(seen, ['prepare', 'start', 'bytes'])
})

test('B185 A3: a finishing answer without the token is read again, and the address is the same', async () => {
  const seen = server(object(null))
  // The read after answers with the token.
  const fetchWith = globalThis.fetch
  globalThis.fetch = (async (target: string, init: { method: string; headers: Record<string, string> }) =>
    init.method === 'GET' ? (seen.push('get'), new Response(JSON.stringify(object('tok2')), { status: 200 })) : fetchWith(target, init as never)) as typeof fetch
  const got = await uploadAttachment(auth as never, uid, upload, bytes, async () => {}, () => {}, new AbortController().signal)
  assert.equal(got, url('tok2'))
  assert.deepEqual(seen, ['prepare', 'start', 'bytes', 'get'])
})

test('B185 A3: a resumed send still asks what is there and how far it got', async () => {
  const seen = server(object('tok3'))
  const got = await uploadAttachment(auth as never, uid, { ...upload, session: sessionUrl }, bytes, async () => {}, () => {}, new AbortController().signal)
  assert.equal(got, url('tok3'))
  assert.deepEqual(seen, ['prepare', 'get', 'query', 'bytes'])
})

test('B185 A5: one timing line per upload — steps in ms, the size and the requests, nothing else', () => {
  assert.equal(uploadTimingLine([['prepare', 211], ['start', 380], ['bytes', 4100]], 64 * 1024, 3), 'prepare=211 start=380 bytes=4100 total=4691 kb=64 req=3')
})
