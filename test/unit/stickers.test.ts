import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { executeSticker } from '../../src/main/storage/sticker-table'
import { executeUpload } from '../../src/main/storage/upload-table'
import { stickerKind } from '../../src/shared/stickers'
import { readFileSync as readDescriptor } from 'node:fs'
import { join as joinPath } from 'node:path'
import { fromJSON } from '@grpc/proto-loader'
import { ownedStickerPacksQuery, stickerIndexCreateWrite, stickerPackAddWrite, stickerPackCreateWrite } from '../../src/main/network/sticker-pack-write'
import { documents as firestoreDocuments } from '../../src/main/network/firestore-values'

const png = (seed: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.alloc(64, seed)]))
function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE stickers (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data BLOB NOT NULL, created_at REAL NOT NULL);
    CREATE TABLE reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, wire TEXT, digest TEXT NOT NULL, created_at REAL NOT NULL,
      state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', upload TEXT, source BLOB, source_digest TEXT, upload_request_digest TEXT, forward_operation_id TEXT);
    CREATE TABLE upload_parts (intent_id TEXT NOT NULL, part_index INTEGER NOT NULL, descriptor TEXT NOT NULL, source BLOB NOT NULL, url TEXT, PRIMARY KEY(intent_id,part_index));`)
  return db
}

// MorseStickerLibrary: PNG, GIF or MP4, kept once by content.
test('the sticker library keeps a file once and refuses what is not a sticker', () => {
  const db = database()
  const first = executeSticker(db, { kind: 'sticker-add', data: png(1) }) as { id: string; kind: string }
  const again = executeSticker(db, { kind: 'sticker-add', data: png(1) }) as { id: string }
  assert.equal(first.kind, 'png'); assert.equal(again.id, first.id)
  assert.equal((executeSticker(db, { kind: 'stickers-list' }) as unknown[]).length, 1)
  assert.throws(() => executeSticker(db, { kind: 'sticker-add', data: new Uint8Array([1, 2, 3, 4, 5]) }))
  assert.equal(stickerKind(new Uint8Array(Buffer.from('GIF89a......'))), 'gif')
})

// ChatRoomView.sendStickerMessage + MorsePendingMediaUploadManager: a PNG sticker goes to chat_media at 512 by 512.
test('a sticker send is accepted with its library id and refused when its bytes differ', () => {
  const db = database(), bytes = png(2), sticker = createHash('sha256').update(bytes).digest('hex')
  const id = 'S1', chatId = 'chat1'
  const request = { id, chatId, senderId: 'me', caption: '', itemIds: [id], reply: null, sticker }
  const wire = { id, chatId, senderId: 'me', type: 'sticker', text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3, mediaWidthPx: 512, mediaHeightPx: 512 }
  const upload = { id, chatId, name: '스티커.png', kind: 'sticker', size: bytes.length, contentType: 'image/png', path: `chat_media/${chatId}/${id}.png`,
    sha256: sticker, md5: createHash('md5').update(bytes).digest('base64'), session: null }
  executeUpload(db, 'me', { kind: 'enqueue-attachment', request, wire, parts: [{ upload, bytes: Buffer.from(bytes) }] } as never)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM intents').get() as { n: number }).n, 1)
  const other = png(3)
  assert.throws(() => executeUpload(db, 'me', { kind: 'enqueue-attachment', request: { ...request, id: 'S2', itemIds: ['S2'] }, wire: { ...wire, id: 'S2' },
    parts: [{ upload: { ...upload, id: 'S2', path: `chat_media/${chatId}/S2.png`, sha256: createHash('sha256').update(other).digest('hex'), md5: createHash('md5').update(other).digest('base64') }, bytes: Buffer.from(other) }] } as never))
})

// Sticker sets this account makes (iOS MorseStickerSetStore.createSet / addSticker), sent through the real
// Firestore descriptor so a shape the server cannot read never ships.

test('a new sticker set, an added sticker and its hash index serialize the way iOS writes them', () => {
  const definition = fromJSON(JSON.parse(readDescriptor(joinPath(process.cwd(), 'resources/firestore-v1.json'), 'utf8')), { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
  const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer; requestDeserialize(value: Buffer): any }>
  const method = (name: string) => service[Object.keys(service).find(key => key.toLowerCase() === name)!]!
  const trip = (name: string, request: unknown): any => method(name).requestDeserialize(method(name).requestSerialize(request))
  const database = firestoreDocuments.slice(0, -'/documents'.length), hash = 'a'.repeat(64)
  const created = trip('commit', { database, writes: [stickerPackCreateWrite('SET1', 'me', '나', '내 팩')] }).writes[0]
  assert.equal(created.update.fields.count.integerValue, '0')
  assert.deepEqual(created.update.fields.stickers.arrayValue.values ?? [], [])
  assert.equal(created.currentDocument.exists, false)
  const added = trip('commit', { database, writes: [stickerPackAddWrite('SET1', { id: hash, kind: 'png', path: `sticker_sets/SET1/${hash}.png`, emoji: '', bytes: 2048 })] }).writes[0]
  const [stickers, count] = added.transform.fieldTransforms
  assert.equal(stickers.appendMissingElements.values[0].mapValue.fields.path.stringValue, `sticker_sets/SET1/${hash}.png`)
  assert.equal(stickers.appendMissingElements.values[0].mapValue.fields.bytes.integerValue, '2048')
  assert.equal(count.increment.integerValue, '1')
  const indexed = trip('commit', { database, writes: [stickerIndexCreateWrite(hash, 'SET1', 'me')] }).writes[0]
  assert.equal(indexed.update.name, `${firestoreDocuments}/stickerIndex/${hash}`)
  const query = trip('runquery', { parent: firestoreDocuments, structuredQuery: ownedStickerPacksQuery('me', 50) })
  assert.equal(query.structuredQuery.limit.value, 50)
  assert.equal(query.structuredQuery.where.fieldFilter.value.stringValue, 'me')
})
