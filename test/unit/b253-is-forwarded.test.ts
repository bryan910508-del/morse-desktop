import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { executeForward } from '../../src/main/storage/forward-table'
import { insertForwardMedia } from '../../src/main/storage/forward-media-table'
import { executeStickerReference } from '../../src/main/storage/sticker-reference-table'
import { executeUpload } from '../../src/main/storage/upload-table'
import { textDigest, textDigestMatches } from '../../src/main/messaging/text-identity'
import type { MediaSendWire, SendWire } from '../../src/shared/model'
import type { PreparedForwardMedia } from '../../src/main/storage/forward-media-protocol'

// B253: a forwarded copy carries isForwarded: true, which the server keeps only when true and uses to leave a forwarded
// sticker out of the sender's Recents (Telegram puts only sent stickers there; forwardMessages does not).
const me = 'RAk6me', chat = 'chat1'
const png = (seed: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.alloc(64, seed)]))
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('base64')
function db(): Database.Database {
  const value = new Database(':memory:')
  value.exec(`CREATE TABLE reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE forward_receipts (operation_id TEXT PRIMARY KEY, request_digest TEXT NOT NULL, content_digest TEXT NOT NULL);
    CREATE TABLE intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, wire TEXT, digest TEXT NOT NULL, created_at REAL NOT NULL,
      state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', upload TEXT, source BLOB, source_digest TEXT, upload_request_digest TEXT, forward_operation_id TEXT);
    CREATE TABLE upload_parts (intent_id TEXT NOT NULL, part_index INTEGER NOT NULL, descriptor TEXT NOT NULL, source BLOB NOT NULL, url TEXT, PRIMARY KEY(intent_id,part_index));`)
  return value
}
const wires = (value: Database.Database): MediaSendWire[] => (value.prepare('SELECT wire FROM intents ORDER BY sequence').all() as { wire: string }[]).map(row => JSON.parse(row.wire))
const request = { id: 'op1', source: { chatId: 'src', messageId: 's1', version: '1:0' }, targets: [{ chatId: chat, messageId: 'F1' }] }

test('every forwarded copy says so: text, a file\'s bytes, a sticker reference', () => {
  const text = db()
  executeForward(text, me, { kind: 'enqueue-forward', request, text: '안녕', isSilent: false })
  assert.equal(wires(text)[0]!.isForwarded, true, 'text')
  const bytes = png(1)
  const media = (sticker?: PreparedForwardMedia['sticker']): PreparedForwardMedia => ({ kind: 'sticker', metadata: { mediaWidthPx: 512, mediaHeightPx: 512 }, caption: '', isSilent: false, blind: false,
    parts: [{ name: '스티커', contentType: 'image/png', extension: 'png', sha256: sha(bytes), md5: md5(bytes), bytes }], ...(sticker ? { sticker } : {}) })
  const upload = db(); insertForwardMedia(upload, me, request as never, media())
  assert.equal(wires(upload)[0]!.isForwarded, true, 'bytes')
  const reference = db(); insertForwardMedia(reference, me, request as never, media({ id: sha(bytes), kind: 'png' }))
  assert.deepEqual([wires(reference)[0]!.isForwarded, wires(reference)[0]!.stickerId], [true, sha(bytes)], 'a sticker reference')
})

test('a sticker sent directly does not say it was forwarded', () => {
  const value = db(), bytes = png(2)
  executeStickerReference(value, me, { kind: 'enqueue-sticker-reference', reply: null,
    wire: { id: 'D1', chatId: chat, senderId: me, type: 'sticker', text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3, stickerId: sha(bytes), stickerKind: 'png' } })
  assert.equal(wires(value)[0]!.isForwarded, undefined)
})

test('the same forwarded reference, refused, goes again by bytes still saying it was forwarded', () => {
  const value = db(), bytes = png(3)
  insertForwardMedia(value, me, request as never, { kind: 'sticker', metadata: {}, caption: '', isSilent: false, blind: false,
    parts: [{ name: '스티커', contentType: 'image/png', extension: 'png', sha256: sha(bytes), md5: md5(bytes), bytes }], sticker: { id: sha(bytes), kind: 'png' } })
  value.prepare("UPDATE intents SET state='failed',reason='STICKER_REFERENCE_OFF'").run()
  const command = (isForwarded: boolean) => {
    const wire: MediaSendWire = { id: 'F1', chatId: chat, senderId: me, type: 'sticker', text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3,
      mediaWidthPx: 512, mediaHeightPx: 512, ...(isForwarded ? { isForwarded: true as const } : {}) }
    const upload = { id: 'F1', chatId: chat, name: '스티커.png', kind: 'sticker' as const, size: bytes.byteLength, contentType: 'image/png', path: `chat_media/${chat}/F1.png`, sha256: sha(bytes), md5: md5(bytes), session: null }
    return { kind: 'enqueue-attachment' as const, request: { id: 'F1', chatId: chat, senderId: me, caption: '', itemIds: ['F1'], reply: null, sticker: sha(bytes) }, wire, parts: [{ upload, bytes }], replacesReference: true as const }
  }
  assert.throws(() => executeUpload(value, me, command(false)), 'the flag may not be dropped on the way')
  executeUpload(value, me, command(true))
  assert.deepEqual([wires(value)[0]!.isForwarded, wires(value)[0]!.stickerId], [true, undefined])
})

test('the digest keeps the flag last when true, and a forwarded copy matches a server that does not know the field yet', () => {
  const base: SendWire = { id: 'T1', chatId: chat, senderId: me, type: 'text', text: '안녕', isSilent: false, isEncrypted: false, protocolVersion: 3 }
  const forwarded: SendWire = { ...base, isForwarded: true }
  const withFlag = createHash('sha256').update(JSON.stringify({ type: 'text', text: '안녕', isSilent: false, isEncrypted: false, isForwarded: true })).digest('hex')
  assert.equal(textDigest(forwarded), withFlag)
  assert.ok(textDigestMatches(forwarded, withFlag), 'a server that keeps it')
  assert.ok(textDigestMatches(forwarded, textDigest(base)), 'a server older than the field')
  assert.ok(!textDigestMatches(base, withFlag), 'a direct message never matches a forwarded digest')
})

test('the server\'s vectors (morse-message-authority canonical, isForwarded last, only when true)', () => {
  const base = { id: 'V1', chatId: chat, senderId: me, isSilent: false, isEncrypted: false as const, protocolVersion: 3 as const }
  const text = { ...base, type: 'text' as const, text: 'B253 forward vector' } as SendWire
  assert.equal(textDigest(text), 'a11466fe9e312535c00809622279888e262f512f95dc2753bf45b7b14e91fa5f')
  assert.equal(textDigest({ ...text, isForwarded: true } as SendWire), '7f8a65aaeede1c08da4abfe1efe74154ed524b9acf43712d406ee47f2c11aba1')
  const sticker = { ...base, type: 'sticker' as const, text: '', stickerId: 'a'.repeat(64), stickerKind: 'png' as const, stickerSetId: 'set_vector_b253' } as unknown as SendWire
  assert.equal(textDigest(sticker), '5e6b09f55fa779362d71be9987a2cf38786c327f4ace212db81501fa4903162d')
  assert.equal(textDigest({ ...sticker, isForwarded: true } as SendWire), 'c2fd69d8d132d1a272e4c87add76a50215a7f898b9b9715379e1fa6a3d0b373a')
})
