import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'
import { maxAlbumPhotos } from '../../src/shared/uploads'

// HistoryWidget::canSendFiles accepts a picture the clipboard itself holds (data->hasImage()) and sends it through the
// same box a dropped file uses. Such a picture has no file on disk, so its bytes are staged instead of a path.
const png = (fill: number, length = 64): Uint8Array => {
  const bytes = Buffer.alloc(length, fill)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 40]).copy(bytes)
  return new Uint8Array(bytes)
}
const mp4 = (length = 64): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(length, 2)]))
const allowed = (): boolean => true

test('a picture pasted from a page is staged and shown like a picked one', async () => {
  const staging = new AttachmentStaging()
  const draft = staging.receive('chat1', [{ name: '이미지.png', bytes: png(9) }], allowed)
  assert.equal(draft.chatId, 'chat1')
  assert.equal(draft.kind, 'image')
  assert.equal(draft.items.length, 1)
  assert.equal(draft.items[0]!.name, '이미지.png')
  assert.ok(draft.items[0]!.previewUrl, 'the box draws it from the staged bytes')
  const response = staging.response('chat1', `${draft.id}/${draft.items[0]!.id}`, new Request(draft.items[0]!.previewUrl!))
  assert.equal(response.status, 200)
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png(9))
  const { wire } = staging.prepare('me1', 'chat1', draft.id, '사진 설명', [draft.items[0]!.id], null)
  assert.equal(wire.type, 'image')
  assert.equal(wire.imageCaption, '사진 설명')
})

test('several pictures paste as one album, and anything else is refused', () => {
  const staging = new AttachmentStaging()
  const album = staging.receive('chat1', [{ name: 'a.png', bytes: png(1) }, { name: 'b.png', bytes: png(2) }], allowed)
  assert.equal(album.items.length, 2)
  assert.equal(album.kind, 'image')
  staging.clear()
  const video = staging.receive('chat1', [{ name: 'clip.mp4', bytes: mp4() }], allowed)
  assert.equal(video.kind, 'video')
  staging.clear()
  assert.throws(() => staging.receive('chat1', [{ name: 'a.png', bytes: png(1) }, { name: 'clip.mp4', bytes: mp4() }], allowed), /사진만/)
  assert.throws(() => staging.receive('chat1', [{ name: 'note.txt', bytes: new Uint8Array([104, 105, 33, 10, 104, 105, 33, 10, 104, 105, 33, 10, 104, 105, 33, 10, 104, 105, 33, 10]) }], allowed), /형식/)
  assert.throws(() => staging.receive('chat1', [{ name: 'big.png', bytes: png(3, 10 * 1024 * 1024) }], allowed), /10 MB/)
  assert.throws(() => staging.receive('chat1', [], allowed))
  assert.throws(() => staging.receive('chat1', Array.from({ length: maxAlbumPhotos + 1 }, (_, index) => ({ name: `${index}.png`, bytes: png(index) })), allowed))
  assert.throws(() => staging.receive('chat1', [{ name: 'a.png', bytes: png(1) }], () => false), /대화/)
  const kept = staging.receive('chat1', [{ name: 'a.png', bytes: png(4) }], allowed)
  assert.throws(() => staging.receive('chat1', [{ name: 'b.png', bytes: png(5) }], allowed), /취소/)
  assert.ok(kept.items[0]!.previewUrl)
})
