import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { executeStickerReference } from '../../src/main/storage/sticker-reference-table'
import { executeUpload } from '../../src/main/storage/upload-table'
import { insertForwardMedia, forwardMediaDigest } from '../../src/main/storage/forward-media-table'
import { InquirySends } from '../../src/main/accounts/inquiry-sends'
import { executeInquirySend, type InquirySendCommand } from '../../src/main/storage/inquiry-send-table'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { stickerReferenceRefusals, definiteRejections, textDigest } from '../../src/main/messaging/text-identity'
import type { MediaSendWire } from '../../src/shared/model'
import type { PreparedForwardMedia } from '../../src/main/storage/forward-media-protocol'

// B246 (contracts/B195-B210-stickers.md «다시 보내는 id·문의방·전달», 22:4x): a sticker reference the server refuses —
// STICKER_NOT_FOUND or STICKER_REFERENCE_OFF — wrote nothing on the server (morse-message-authority :336-338 before
// :369-370), so the same message goes again by its bytes under the same id, where it stands; a forwarded reference goes
// as the reference (tdesktop forwards the document).
const me = 'RAk6me', chat = 'chat1'
const png = (seed: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.alloc(64, seed)]))
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('base64')

function chatQueue(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, wire TEXT, digest TEXT NOT NULL, created_at REAL NOT NULL,
      state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', upload TEXT, source BLOB, source_digest TEXT, upload_request_digest TEXT, forward_operation_id TEXT);
    CREATE TABLE upload_parts (intent_id TEXT NOT NULL, part_index INTEGER NOT NULL, descriptor TEXT NOT NULL, source BLOB NOT NULL, url TEXT, PRIMARY KEY(intent_id,part_index));`)
  return db
}
const reference = (id: string, bytes: Uint8Array, fields: Partial<MediaSendWire> = {}): MediaSendWire => ({ id, chatId: chat, senderId: me, type: 'sticker', text: '', mediaUrl: '',
  isSilent: false, isEncrypted: false, protocolVersion: 3, stickerId: sha(bytes), stickerKind: 'png', stickerSetId: 'set1', ...fields })
function bytesCommand(id: string, bytes: Uint8Array, fields: Partial<MediaSendWire> = {}) {
  const wire: MediaSendWire = { id, chatId: chat, senderId: me, type: 'sticker', text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3,
    mediaWidthPx: 512, mediaHeightPx: 512, ...fields }
  const upload = { id, chatId: chat, name: '스티커.png', kind: 'sticker' as const, size: bytes.byteLength, contentType: 'image/png', path: `chat_media/${chat}/${id}.png`, sha256: sha(bytes), md5: md5(bytes), session: null }
  return { kind: 'enqueue-attachment' as const, request: { id, chatId: chat, senderId: me, caption: '', itemIds: [id], reply: null, sticker: sha(bytes) }, wire, parts: [{ upload, bytes }], replacesReference: true as const }
}

test('both refusals are definite and take the sticker branch', () => {
  for (const reason of ['STICKER_NOT_FOUND', 'STICKER_REFERENCE_OFF']) assert.ok(stickerReferenceRefusals.has(reason) && definiteRejections.has(reason), reason)
})

test('a chat: the refused reference turns into its bytes upload under the same id, where it stands, keeping its reply', () => {
  for (const reason of ['STICKER_NOT_FOUND', 'STICKER_REFERENCE_OFF']) {
    const db = chatQueue(), bytes = png(1)
    executeStickerReference(db, me, { kind: 'enqueue-sticker-reference', wire: reference('M0', png(9)), reply: null })
    db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,reason) VALUES(?,?,?,?,?,'failed',?)")
      .run('M1', chat, JSON.stringify(reference('M1', bytes, { replyToId: 'r1' })), textDigest(reference('M1', bytes, { replyToId: 'r1' })), Date.now(), reason)
    executeStickerReference(db, me, { kind: 'enqueue-sticker-reference', wire: reference('M2', png(8)), reply: null })
    executeUpload(db, me, bytesCommand('M1', bytes, { replyToId: 'r1' }))
    const rows = db.prepare('SELECT id,state,reason,wire,upload FROM intents ORDER BY sequence').all() as { id: string; state: string; reason: string; wire: string; upload: string | null }[]
    assert.deepEqual(rows.map(row => row.id), ['M0', 'M1', 'M2'], `${reason}: the same place in the queue`)
    const row = rows[1]!, wire = JSON.parse(row.wire) as MediaSendWire
    assert.equal(row.state, 'uploading'); assert.equal(row.reason, '')
    assert.equal(wire.stickerId, undefined, 'the bytes go, not the reference'); assert.equal(wire.replyToId, 'r1')
    assert.equal(JSON.parse(row.upload!).path, `chat_media/${chat}/M1.png`, 'under the same id')
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM upload_parts WHERE intent_id=?').get('M1') as { n: number }).n, 1)
    executeUpload(db, me, bytesCommand('M1', bytes, { replyToId: 'r1' }))
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM upload_parts WHERE intent_id=?').get('M1') as { n: number }).n, 1, 'handed over twice: one message')
    assert.throws(() => executeUpload(db, me, bytesCommand('M2', png(1))), 'other bytes than the reference named are refused')
  }
})

test('a chat: a reference sent silently goes again by its bytes silently (the same message keeps its flag)', () => {
  const db = chatQueue(), bytes = png(2)
  const silent = reference('S1', bytes, { isSilent: true })
  db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,reason) VALUES(?,?,?,?,?,'failed','STICKER_REFERENCE_OFF')").run('S1', chat, JSON.stringify(silent), textDigest(silent), Date.now())
  executeUpload(db, me, bytesCommand('S1', bytes, { isSilent: true }))
  const wire = JSON.parse((db.prepare('SELECT wire FROM intents WHERE id=?').get('S1') as { wire: string }).wire) as MediaSendWire
  assert.equal(wire.isSilent, true)
  assert.equal(wire.stickerId, undefined)
  const loud = chatQueue()
  loud.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state,reason) VALUES(?,?,?,?,?,'failed','STICKER_REFERENCE_OFF')").run('S1', chat, JSON.stringify(silent), textDigest(silent), Date.now())
  assert.throws(() => executeUpload(loud, me, bytesCommand('S1', bytes)), 'the flag may not change on the way')
})

test('a forwarded sticker reference goes as the reference while the switch is on, else by its bytes', () => {
  const bytes = png(3)
  const media = (sticker?: PreparedForwardMedia['sticker']): PreparedForwardMedia => ({ kind: 'sticker', metadata: { mediaWidthPx: 512, mediaHeightPx: 512 }, caption: '', isSilent: false, blind: false,
    parts: [{ name: '스티커', contentType: 'image/png', extension: 'png', sha256: sha(bytes), md5: md5(bytes), bytes }], ...(sticker ? { sticker } : {}) })
  const request = { id: 'op1', source: { chatId: 'src', messageId: 's1', version: 'v' }, targets: [{ chatId: chat, messageId: 'F1' }] }
  const on = chatQueue()
  forwardMediaDigest(media({ id: sha(bytes), kind: 'png', setId: 'set1' }))
  insertForwardMedia(on, me, request as never, media({ id: sha(bytes), kind: 'png', setId: 'set1' }))
  const row = on.prepare('SELECT wire,state,upload FROM intents').get() as { wire: string; state: string; upload: string | null }
  const wire = JSON.parse(row.wire) as MediaSendWire
  assert.deepEqual([wire.stickerId, wire.stickerKind, wire.stickerSetId, wire.mediaUrl, row.state, row.upload], [sha(bytes), 'png', 'set1', '', 'queued', null], 'the three fields, nothing to upload')
  const off = chatQueue()
  insertForwardMedia(off, me, request as never, media())
  const bytesRow = off.prepare('SELECT wire,state FROM intents').get() as { wire: string; state: string }
  assert.equal((JSON.parse(bytesRow.wire) as MediaSendWire).stickerId, undefined); assert.equal(bytesRow.state, 'uploading', 'switch off: the bytes go up')
  assert.throws(() => forwardMediaDigest(media({ id: sha(png(4)), kind: 'png' })), 'a reference that names other bytes is refused')
  const quiet = chatQueue(), silentMedia = { ...media({ id: sha(bytes), kind: 'png' }), isSilent: true }
  forwardMediaDigest(silentMedia)
  insertForwardMedia(quiet, me, request as never, silentMedia)
  const quietWire = JSON.parse((quiet.prepare('SELECT wire FROM intents').get() as { wire: string }).wire) as MediaSendWire
  assert.deepEqual([quietWire.stickerId, quietWire.isSilent], [sha(bytes), true], 'a silent forward stays a reference, silent')
})

// The inquiry room's queue.
const uid = 'sub1', room = 'ch1_sub1'
const opened: InquirySends[] = []
after(async () => { for (const sends of opened) await sends.close() })
function inquiryQueue(send: (payload: Record<string, unknown>, call: number) => Promise<unknown>, bytes: Uint8Array | null) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE inquiry_sends (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, inquiry_id TEXT NOT NULL, digest TEXT NOT NULL,
    payload TEXT NOT NULL, media BLOB, media_url TEXT, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);`)
  const sent: Record<string, unknown>[] = [], uploads: string[] = [], offs: string[] = []
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const sends = new InquirySends(uid, auth, () => {}, async <T>(command: InquirySendCommand) => executeInquirySend(db, command) as T, () => {}, {
    send: async payload => { sent.push(payload); return send(payload, sent.length) },
    upload: async request => { uploads.push(request.messageId); return 'https://firebasestorage.googleapis.com/x?alt=media&token=t' }
  })
  sends.stickerBytes = async () => bytes
  sends.stickerReferenceOff = () => { offs.push('off') }
  opened.push(sends)
  return { sends, sent, uploads, offs }
}
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

for (const reason of ['STICKER_NOT_FOUND', 'STICKER_REFERENCE_OFF']) {
  test(`an inquiry room: a reference refused with ${reason} goes again under the same id by its bytes`, async () => {
    const bytes = png(5), messageId = randomUUID().toUpperCase()
    const { sends, sent, uploads, offs } = inquiryQueue(async (_payload, call) => {
      if (call === 1) throw new MorseCallableFailure('answered', 'FAILED_PRECONDITION', reason)
      return { ok: true }
    }, bytes)
    await sends.load()
    await sends.enqueue({ id: messageId, inquiryId: room, message: { senderType: 'subscriber', type: 'sticker', text: '', stickerId: sha(bytes), stickerKind: 'png', stickerSetId: 'set1' },
      preview: { kind: 'sticker', text: '스티커' } })
    await wait(80)
    assert.deepEqual(sent.map(payload => payload.clientMessageId), [messageId, messageId], 'the same id both times')
    assert.equal(sent[0]!.stickerId, sha(bytes))
    assert.equal(sent[1]!.stickerId, undefined); assert.equal(sent[1]!.mediaUrl, 'https://firebasestorage.googleapis.com/x?alt=media&token=t')
    assert.deepEqual(uploads, [messageId], 'its bytes went up under its id')
    assert.deepEqual(offs, reason === 'STICKER_REFERENCE_OFF' ? ['off'] : [])
    assert.deepEqual(sends.items().map(item => item.state), ['sent'])
  })
}

test('an inquiry room: a refused reference with no bytes to be had stays refused, saying so for a sticker', async () => {
  const messageId = randomUUID().toUpperCase()
  const { sends } = inquiryQueue(async () => { throw new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'STICKER_NOT_FOUND') }, null)
  await sends.load()
  await sends.enqueue({ id: messageId, inquiryId: room, message: { senderType: 'subscriber', type: 'sticker', text: '', stickerId: 'a'.repeat(64), stickerKind: 'png' },
    preview: { kind: 'sticker', text: '스티커' } })
  await wait(60)
  assert.deepEqual(sends.items().map(item => [item.state, item.reason]), [['failed', '이 스티커를 보내지 못했습니다. 스티커를 다시 골라 보내 주세요.']])
})
