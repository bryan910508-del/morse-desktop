import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { definiteRejections, deliveryReason, stickerReferenceRefusals, textDigest } from '../../src/main/messaging/text-identity'
import { executeStickerReference, stickerReferenceWire } from '../../src/main/storage/sticker-reference-table'
import { stickerEntry, stickerFileOf, stickerPrefsOf } from '../../src/main/network/sticker-files'
import { plannedMigration, StickerLibrary, stickerSendRoute } from '../../src/main/accounts/sticker-library'
import { featureOn } from '../../src/main/api/feature-switch'
import { mediaResources } from '../../src/main/media/media-document'
import { stickerReference, documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { MediaSendWire } from '../../src/shared/model'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'

// B195·B210 (contracts/B195-B210-stickers.md): a sticker the server holds a copy of is sent as a reference to it
// (tdesktop SendExistingDocument → MTP_inputMediaDocument, api_sending.cpp:701-716), and the favourites and recents are
// the server's lists (getFavedStickers / getRecentStickers, faveSticker / saveRecentSticker).
const me = 'RAk6me', sha = (n: number) => createHash('sha256').update(String(n)).digest('hex')
const reference = (fields: Partial<MediaSendWire> = {}): MediaSendWire => ({ id: 'M1', chatId: 'chat1', senderId: me, type: 'sticker', text: '', mediaUrl: '',
  isSilent: false, isEncrypted: false, protocolVersion: 3, stickerId: sha(1), stickerKind: 'png', stickerSetId: 'set1', ...fields })

test('the digest of a reference is the server\'s: its sticker fields come first (morse-message-authority strings order)', () => {
  // canonical(): type, text, isSilent, isEncrypted, then the strings in order — stickerId, stickerKind, stickerSetId … mediaUrl … categoryId, replyToId.
  const server = { type: 'sticker', text: '', isSilent: false, isEncrypted: false, stickerId: sha(1), stickerKind: 'png', stickerSetId: 'set1', mediaUrl: '', categoryId: 'c1', replyToId: 'r1' }
  assert.equal(textDigest(reference({ replyToId: 'r1', categoryId: 'c1' })), createHash('sha256').update(JSON.stringify(server)).digest('hex'))
})

test('a reference carries no bytes and no address: only its document, the set and the reply', () => {
  assert.equal(stickerReferenceWire(reference(), me).stickerId, sha(1))
  for (const bad of [{ mediaUrl: 'https://x' }, { text: 'x' }, { stickerId: 'nothex' }, { stickerKind: 'webp' as never }, { stickerSetId: 'a/b' },
    { senderId: 'other' }, { mediaKeys: ['k'] }, { isSilent: true }]) assert.throws(() => stickerReferenceWire(reference(bad), me), JSON.stringify(bad))
})

function queue(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, wire TEXT, digest TEXT NOT NULL, created_at REAL NOT NULL,
      state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', upload TEXT, source BLOB, source_digest TEXT, upload_request_digest TEXT, forward_operation_id TEXT);`)
  return db
}
test('a reference is queued once, as a message with nothing to upload; another under its id is refused', () => {
  const db = queue()
  executeStickerReference(db, me, { kind: 'enqueue-sticker-reference', wire: reference(), reply: null })
  executeStickerReference(db, me, { kind: 'enqueue-sticker-reference', wire: reference(), reply: null })
  const rows = db.prepare('SELECT state, upload, wire FROM intents').all() as { state: string; upload: string | null; wire: string }[]
  assert.equal(rows.length, 1); assert.equal(rows[0]!.state, 'queued'); assert.equal(rows[0]!.upload, null)
  assert.equal(JSON.parse(rows[0]!.wire).stickerId, sha(1))
  assert.throws(() => executeStickerReference(db, me, { kind: 'enqueue-sticker-reference', wire: reference({ stickerId: sha(2) }), reply: null }))
})

const doc = (name: string, fields: Record<string, WireObject>): FirestoreDocument => ({ name, fields, updateTime: { seconds: '1', nanos: 0 } }) as unknown as FirestoreDocument
const list = (...values: string[]): WireObject => ({ arrayValue: { values: values.map(value => ({ stringValue: value })) } }) as WireObject
test('the server\'s lists are read in its order, newest first; a malformed or repeated entry is passed over', () => {
  const prefs = stickerPrefsOf(doc('p', { faved: list(`${sha(1)}.png`, 'junk', `${sha(2)}.mp4`, `${sha(1)}.png`), recent: list(`${sha(3)}.gif`) }))
  assert.deepEqual(prefs.faved, [{ id: sha(1), kind: 'png' }, { id: sha(2), kind: 'mp4' }])
  assert.deepEqual(prefs.recent, [{ id: sha(3), kind: 'gif' }])
  assert.deepEqual(stickerPrefsOf(null), { faved: [], recent: [] }, 'no document yet: empty lists')
  assert.equal(stickerEntry(`${sha(1)}.webp`), null)
})

test('a registry entry is a document only when ready, of a known kind, with the server\'s https address', () => {
  const ready = doc('r', { state: { stringValue: 'ready' }, kind: { stringValue: 'png' }, mediaUrl: { stringValue: 'https://firebasestorage.googleapis.com/x' }, bytes: { integerValue: '42' } })
  assert.deepEqual(stickerFileOf(ready, sha(1)), { id: sha(1), kind: 'png', mediaUrl: 'https://firebasestorage.googleapis.com/x', bytes: 42 })
  assert.equal(stickerFileOf(doc('c', { state: { stringValue: 'copying' }, kind: { stringValue: 'png' }, mediaUrl: { stringValue: 'https://x' } }), sha(1)), null)
  assert.equal(stickerFileOf(null, sha(1)), null)
})

test('the device\'s favourites that move: the newest five (ten with premium), the oldest of them first', () => {
  const newestFirst = Array.from({ length: 12 }, (_, i) => `s${i}`)
  assert.deepEqual(plannedMigration(newestFirst, false), ['s4', 's3', 's2', 's1', 's0'])
  assert.deepEqual(plannedMigration(newestFirst, true), ['s9', 's8', 's7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'])
  assert.deepEqual(plannedMigration(['a', 'b'], false), ['b', 'a'])
})

const png = (seed: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.alloc(64, seed)]))
function migrationRig(stored: Uint8Array[], refuse: (index: number) => boolean, offline = false) {
  const calls: string[] = [], cleared: boolean[] = []
  const ids = stored.map(bytes => createHash('sha256').update(bytes).digest('hex'))
  let last = ''
  globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string>; body?: unknown }) => {
    if (offline) throw new TypeError('fetch failed')
    if (init?.headers?.['X-Goog-Upload-Command'] === 'start') return new Response(null, { status: 200, headers: { 'X-Goog-Upload-Status': 'active', 'X-Goog-Upload-URL': 'https://firebasestorage.googleapis.com/session' } })
    last = createHash('sha256').update(init!.body as Uint8Array).digest('hex')
    return new Response(null, { status: 200, headers: { 'X-Goog-Upload-Status': 'final' } })
  }) as typeof fetch
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'ac' }) }
  let registered = 0
  const call = async (name: string, data: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (name === 'registerStickerFile') {
      if (refuse(registered++)) throw new MorseCallableFailure('answered', 'INVALID_ARGUMENT', 'not-512')
      calls.push(`register ${ids.indexOf(last)}`)
      return { stickerId: last, stickerKind: 'png' }
    }
    calls.push(`${name} ${ids.indexOf(String(data.stickerId))}`)
    return { ok: true }
  }
  const legacy = {
    list: async () => stored.map((_, i) => ({ id: ids[i]!, kind: 'png' as const })),
    read: async (id: string) => ({ kind: 'png' as const, data: stored[ids.indexOf(id)]! }),
    clear: async () => { cleared.push(true) }
  }
  const library = new StickerLibrary(me, auth as never, call, () => {}, () => false, legacy)
  return { library, calls, cleared }
}

test('moving the favourites: each goes up and is faved, oldest first; a refused one is left out; the list then empties', async () => {
  // Newest first, as the device lists them: index 0 is the newest; the second registration (index 1) is refused.
  const { library, calls, cleared } = migrationRig([png(1), png(2), png(3)], index => index === 1)
  await (library as unknown as { migrate(): Promise<void> }).migrate()
  assert.deepEqual(calls, ['register 2', 'faveSticker 2', 'register 0', 'faveSticker 0'])
  assert.deepEqual(cleared, [true])
  library.close()
})

test('moving the favourites waits for the network: nothing is cleared when the upload cannot go', async () => {
  const { library, cleared } = migrationRig([png(1)], () => false, true)
  await (library as unknown as { migrate(): Promise<void> }).migrate()
  assert.deepEqual(cleared, [])
  library.close()
})

test('a sticker sent as a reference names its document and is drawn from the server\'s copy', () => {
  assert.deepEqual(stickerReference({ stickerId: { stringValue: sha(1) }, stickerKind: { stringValue: 'mp4' }, stickerSetId: { stringValue: 'set1' } }),
    { sticker: { id: sha(1), kind: 'mp4', setId: 'set1' } })
  assert.deepEqual(stickerReference({ stickerId: { stringValue: 'x' }, stickerKind: { stringValue: 'png' } }), {}, 'an older sticker has only its bytes')
  const copy = `https://firebasestorage.googleapis.com/v0/b/talky-a38c3.firebasestorage.app/o/${encodeURIComponent(`sticker_files/${sha(1)}.png`)}?alt=media&token=t`
  const message = (type: string, url: string) => doc(`${documents}/chats/chat1/messages/m1`, { type: { stringValue: type }, mediaUrl: { stringValue: url } })
  assert.equal(mediaResources(message('sticker', copy), 'chat1', 'sticker', false)[0]?.path, `sticker_files/${sha(1)}.png`)
  assert.equal(mediaResources(message('image', copy), 'chat1', 'image', false)[0]?.path, null, 'only a sticker is drawn from sticker_files')
  const other = copy.replace(encodeURIComponent(`sticker_files/${sha(1)}.png`), encodeURIComponent('sticker_files/x.png'))
  assert.equal(mediaResources(message('sticker', other), 'chat1', 'sticker', false)[0]?.path, null, 'a name that is not a document')
})

test('an answer lost: the reference sent again under its id carries the digest the server stored, so no CONFLICT', () => {
  // The server (talky-shared/morse-message-authority.js:190) stores sha256(JSON.stringify(canonical(data))) as payloadDigest
  // and refuses a second send of the id whose digest differs (:312). The queue keeps the wire as JSON and sends it again,
  // and the lookup after a lost answer compares that same digest (outbox.ts reconcile, payloadDigest !== textDigest).
  const wire = reference({ categoryId: 'c1' })
  const db = queue()
  executeStickerReference(db, me, { kind: 'enqueue-sticker-reference', wire, reply: null })
  const stored = JSON.parse((db.prepare('SELECT wire FROM intents WHERE id=?').get('M1') as { wire: string }).wire) as MediaSendWire
  const server = createHash('sha256').update(JSON.stringify({ type: 'sticker', text: '', isSilent: false, isEncrypted: false, stickerId: sha(1), stickerKind: 'png', stickerSetId: 'set1', mediaUrl: '', categoryId: 'c1' })).digest('hex')
  assert.equal(textDigest(stored), server, 'the resent wire, read back from the queue')
  assert.equal(textDigest(stored), textDigest(wire))
  executeStickerReference(db, me, { kind: 'enqueue-sticker-reference', wire: stored, reply: null })
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM intents').get() as { n: number }).n, 1, 'the same message, queued once')
})

test('sticker_reference_send: off sends the bytes, on sends the reference of a registered copy', () => {
  const doc = (fields: Record<string, WireObject>) => ({ name: 'x', fields } as unknown as FirestoreDocument)
  const on = { enabled: { booleanValue: true } }, account = { stickerReferenceSend: { booleanValue: true } }
  assert.equal(featureOn('sticker_reference_send', null, null), false, 'no document: off')
  assert.equal(featureOn('sticker_reference_send', doc(on), null), true, 'on for everyone')
  assert.equal(featureOn('sticker_reference_send', doc({}), doc(account)), true, 'on for this account')
  assert.equal(stickerSendRoute(false, true), 'bytes', 'off: the bytes, as before the reference')
  assert.equal(stickerSendRoute(true, true), 'reference')
  assert.equal(stickerSendRoute(true, false), 'bytes', 'on but no copy registered yet')
})

test('a reference the server refuses — no copy, or the switch off — is a definite refusal the account sends again by bytes', () => {
  for (const reason of ['STICKER_NOT_FOUND', 'STICKER_REFERENCE_OFF']) {
    assert.ok(definiteRejections.has(reason) && stickerReferenceRefusals.has(reason), reason)
    assert.equal(deliveryReason(reason), '서버에 없는 스티커라 보내지 못했습니다.')
  }
})
