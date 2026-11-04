import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'
import { overviewChosen, overviewTitle, sendGroups } from '../../src/shared/uploads'
import Database from 'better-sqlite3-multiple-ciphers'
import { executeUpload } from '../../src/main/storage/upload-table'
import { setLanguage } from '../../src/shared/i18n'

// B311 (user: «사진 또는 동영상에 여러 사진이나 동영상 포함이 기본적으로 돼있고 합쳐져야된다»): one «사진 또는 동영상»
// picks up to ten; photos alone are one album. B518 (user «권장대로», the three apps alike — reports/ios/2026-11-01-b518-ab-plan.md
// §3): with a video among them they are one selection in one box, no longer one box after another, and they go out in their
// order as tdesktop's GroupRanges cuts them — photos that follow one another as one album, every video on its own.
const crc = (bytes: Buffer): number => { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)) } return ~c >>> 0 }
const chunk = (type: string, data: Buffer): Buffer => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out }
const png = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
  chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))])
const mp4 = (): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(200, 1)])
const jpeg = (fill: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(40, fill)]))
const read = async (staging: AttachmentStaging, url: string): Promise<number | Buffer> => {
  const response = staging.response('chat1', url.slice('morse://app/__draft-media/'.length), new Request(url.replace('morse://', 'http://')))
  return response.status === 200 ? Buffer.from(await response.arrayBuffer()) : response.status
}

async function files(kinds: ('image' | 'video')[]) {
  const dir = await mkdtemp(join(tmpdir(), 'morse-b311-'))
  const paths = await Promise.all(kinds.map(async (kind, index) => {
    const path = join(dir, `${index}.${kind === 'image' ? 'png' : 'mp4'}`)
    await writeFile(path, kind === 'image' ? png() : mp4()); return path
  }))
  return { paths, done: () => rm(dir, { recursive: true, force: true }) }
}

test('the order they go in: photos that follow one another as one album of up to ten, every video on its own', () => {
  const item = (id: string) => ({ id, kind: id.startsWith('v') ? 'video' as const : 'image' as const })
  assert.deepEqual(sendGroups(['p1', 'p2', 'v1', 'p3'].map(item)), [['p1', 'p2'], ['v1'], ['p3']])
  assert.deepEqual(sendGroups(['v1', 'v2'].map(item)), [['v1'], ['v2']])
  const eleven = Array.from({ length: 11 }, (_, index) => item(`p${index}`))
  assert.deepEqual(sendGroups(eleven).map(group => group.length), [10, 1])
})

test('photos alone: one album of all of them, sent under the selection\'s own id', async () => {
  const { paths, done } = await files(['image', 'image', 'image'])
  const staging = new AttachmentStaging()
  try {
    const draft = (await staging.pick('chat1', 'media', () => true, async () => paths))!
    assert.equal(draft.kind, 'image'); assert.equal(draft.items.length, 3)
    assert.equal(staging.messageId(draft.id, draft.items.map(item => item.id)), draft.id)
  } finally { staging.clear(); await done() }
})

test('with a video among them: one selection of all of them in their order, each message under an id of its own', async () => {
  const { paths, done } = await files(['image', 'video', 'image'])
  const staging = new AttachmentStaging()
  try {
    const draft = (await staging.pick('chat1', 'media', () => true, async () => paths))!
    assert.equal(draft.kind, 'media')
    assert.deepEqual(draft.items.map(item => item.kind), ['image', 'video', 'image'])
    const [photo, video, last] = draft.items
    // No Mac helper here: a video without an original to cut again, as on Windows; a picture always has its own.
    assert.equal(video!.originalUrl, undefined); assert.match(photo!.originalUrl!, /\/original$/)
    const first = staging.messageId(draft.id, [photo!.id])
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.notEqual(first, draft.id)
    assert.equal(staging.messageId(draft.id, [photo!.id]), first, 'asked again, the same message')
    assert.notEqual(staging.messageId(draft.id, [video!.id]), first)
    assert.throws(() => staging.prepare('me', 'chat1', draft.id, '', [photo!.id, video!.id]), /사진만 묶어/)
    const prepared = staging.prepare('me', 'chat1', draft.id, '설명', [photo!.id], null, false, first)
    assert.equal(prepared.wire.id, first); assert.equal(prepared.wire.imageCaption, '설명')
    assert.ok(prepared.parts[0]!.upload.path.endsWith(`/${first}.png`))
    assert.equal(prepared.parts[0]!.upload.id, first, 'each part names its message, as the queue checks it')
    staging.sent(draft.id, [photo!.id])
    assert.equal(staging.holds(draft.id), true, 'the rest waits for its messages')
    assert.equal(staging.prepare('me', 'chat1', draft.id, '', [video!.id], null, false, staging.messageId(draft.id, [video!.id])).wire.type, 'video')
    staging.sent(draft.id, [video!.id])
    staging.sent(draft.id, [last!.id])
    assert.equal(staging.holds(draft.id), false, 'let go with its last message')
    assert.equal(staging.messageId(draft.id, [last!.id]), staging.messageId(draft.id, [last!.id]))
    assert.notEqual(staging.messageId(draft.id, [last!.id]), draft.id, 'a send asked again after the last still names its message')
  } finally { staging.clear(); await done() }
})

test('each message of a mixed selection is one the queue takes, and knows again by its id', async () => {
  const { paths, done } = await files(['image', 'image', 'video'])
  const staging = new AttachmentStaging(), db = new Database(':memory:')
  db.exec(`CREATE TABLE reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, wire TEXT, digest TEXT NOT NULL, created_at REAL NOT NULL,
      state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', upload TEXT, source BLOB, source_digest TEXT, upload_request_digest TEXT, forward_operation_id TEXT);
    CREATE TABLE upload_parts (intent_id TEXT NOT NULL, part_index INTEGER NOT NULL, descriptor TEXT NOT NULL, source BLOB NOT NULL, url TEXT, PRIMARY KEY(intent_id,part_index));`)
  try {
    const draft = (await staging.pick('chat1', 'media', () => true, async () => paths))!
    const groups = sendGroups(draft.items)
    assert.deepEqual(groups.map(group => group.length), [2, 1], '[album 2][video]')
    for (const [index, itemIds] of groups.entries()) {
      const id = staging.messageId(draft.id, itemIds), caption = index === 0 ? '설명' : ''
      const request = { id, chatId: 'chat1', senderId: 'me', caption, itemIds, reply: null }
      assert.equal(executeUpload(db, 'me', { kind: 'attachment-known', request }), false)
      const { wire, parts } = staging.prepare('me', 'chat1', draft.id, caption, itemIds, null, false, id)
      executeUpload(db, 'me', { kind: 'enqueue-attachment', request, wire, parts })
      assert.equal(executeUpload(db, 'me', { kind: 'attachment-known', request }), true, 'asked again, it is known')
      staging.sent(draft.id, itemIds)
    }
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM intents').get() as { n: number }).n, 2)
    assert.equal(staging.holds(draft.id), false)
  } finally { db.close(); staging.clear(); await done() }
})

test('letting the selection go drops all of it; a new pick starts afresh', async () => {
  const { paths, done } = await files(['video', 'image'])
  const staging = new AttachmentStaging()
  try {
    const first = (await staging.pick('chat1', 'media', () => true, async () => paths))!
    staging.discard(first.id)
    assert.equal(staging.holds(first.id), false)
    const again = (await staging.pick('chat1', 'media', () => true, async () => paths))!
    assert.equal(again.items.length, 2)
  } finally { staging.clear(); await done() }
})

test('an edit starts from the picture as picked, and «원래대로» puts it back', async () => {
  const { paths, done } = await files(['image', 'video'])
  const staging = new AttachmentStaging()
  try {
    const draft = (await staging.pick('chat1', 'media', () => true, async () => paths))!
    const photo = draft.items[0]!, picked = await read(staging, photo.originalUrl!)
    assert.deepEqual(picked, png())
    staging.replaceImage('chat1', draft.id, photo.id, jpeg(7))
    staging.replaceImage('chat1', draft.id, photo.id, jpeg(9))
    assert.deepEqual(await read(staging, photo.originalUrl!), png(), 'edited twice, the original stays')
    const restored = staging.restoreImage('chat1', draft.id, photo.id)
    assert.deepEqual(await read(staging, restored.items[0]!.previewUrl!), png())
    const prepared = staging.prepare('me', 'chat1', draft.id, '', [photo.id], null, false, staging.messageId(draft.id, [photo.id]))
    assert.equal(prepared.parts[0]!.upload.sha256, createHash('sha256').update(png()).digest('hex'))
    assert.equal(prepared.parts[0]!.upload.contentType, 'image/png')
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

test('the box: a tile opens its editor, the round mark chooses, a mixed send goes message by message and stops at a refusal', () => {
  const box = readFileSync('src/renderer/src/boxes/send-files-box.tsx', 'utf8')
  assert.match(box, /groups = draft\.kind === 'media' \? sendGroups\(going\)/)
  assert.match(box, /await sender\.send\(at === 0 \? text : '', group, video, \{ hd: pick, first: at === 0 \}\)/)
  assert.match(box, /itemIds: groups\.slice\(at\)\.flat\(\)/)
  assert.match(box, /className=\{`send-files-check/)
  assert.match(box, /showPhotoEditor\(item\.originalUrl \?\? urls\[item\.id\] \?\? item\.previewUrl!, photoEdits\[item\.id\] \?\? null/)
  assert.match(box, /if \(first\) await window\.morse\.pressAttachment/)
  assert.match(box, /first \? reply\(\) : null/)
  // An item's editor in a box of several leaves the quality to the box (the three apps alike); a single video keeps it.
  assert.match(box, /\}, \{ quality: !grid \}\)/)
  assert.match(readFileSync('src/renderer/src/media/video-editor.tsx', 'utf8'), /\{quality && <span className="video-editor-qualities"/)
  const outbox = readFileSync('src/main/messaging/outbox.ts', 'utf8')
  assert.match(outbox, /catch \(error\) \{ release\(\); throw error \}\n\s*if \(!this\.staging\.holds\(id\)\) release\(\)/)
})

test('a box of several is named by what it holds and how many; the send button and the quality stay as they were', () => {
  const kinds = (...list: ('image' | 'video')[]) => list.map(kind => ({ kind }))
  setLanguage('ko')
  assert.equal(overviewTitle(kinds('image', 'image', 'image')), '사진 3장')
  assert.equal(overviewTitle(kinds('video', 'video')), '영상 2개')
  assert.equal(overviewTitle(kinds('image', 'video', 'image')), '항목 3개')
  setLanguage('en')
  assert.deepEqual([overviewTitle(kinds('image', 'image')), overviewTitle(kinds('video', 'video')), overviewTitle(kinds('video', 'image'))], ['2 photos', '2 videos', '2 items'])
  setLanguage('ru')
  assert.deepEqual([overviewTitle(kinds('image', 'image')), overviewTitle(kinds('video', 'video')), overviewTitle(kinds('video', 'image'))], ['2 фото', 'Видео: 2', 'Медиа: 2'])
  setLanguage('ko')
  const box = readFileSync('src/renderer/src/boxes/send-files-box.tsx', 'utf8')
  // The title counts what the box holds, not what is ticked; one item keeps its own title.
  assert.match(box, /: grid \? overviewTitle\(items\) : items\[0\]\?\.kind === 'video' \? tr\('동영상 보내기'\) : tr\('사진 보내기'\)/)
  assert.match(box, /\{tr\('보내기'\)\}<\/button>/)
  assert.match(box, /hdOffered = sender\.highQuality === true && going\.some\(item => item\.kind === 'image'/)
})

test('under the title, how many are ticked, in the title\'s unit', () => {
  const kinds = (...list: ('image' | 'video')[]) => list.map(kind => ({ kind }))
  setLanguage('ko')
  assert.equal(overviewChosen(kinds('image', 'image', 'image'), 2), '2장 선택됨')
  assert.equal(overviewChosen(kinds('video', 'video'), 1), '1개 선택됨')
  assert.equal(overviewChosen(kinds('image', 'video'), 2), '2개 선택됨')
  setLanguage('en')
  assert.deepEqual([overviewChosen(kinds('image', 'image'), 1), overviewChosen(kinds('image', 'video'), 2)], ['1 selected', '2 selected'])
  setLanguage('ru')
  assert.deepEqual([overviewChosen(kinds('image', 'image'), 1), overviewChosen(kinds('image', 'video'), 2)], ['Выбрано: 1', 'Выбрано: 2'])
  setLanguage('ko')
  const box = readFileSync('src/renderer/src/boxes/send-files-box.tsx', 'utf8')
  assert.match(box, /\{grid && draft\.kind !== 'file' && <p className="send-files-chosen">\{overviewChosen\(items, going\.length\)\}<\/p>\}/)
})
