import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SendingMedia } from '../../src/main/messaging/sending-media'
import { localMediaMessage } from '../../src/renderer/src/history/local-media'

// B263 observation 3, in B269's one structure: a forwarded sticker is drawn while it is on its way from the bytes its
// original is drawn from — held once for every target of the forward in SendingMedia, served at its address, given to
// the server's copies, and let go when no message names it (tdesktop: the forward holds its original's document).
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const token = (url: string) => url.slice(url.lastIndexOf('/') + 1)

test('one forward to two chats holds one copy, drawn for both and for the server copies', async () => {
  const media = new SendingMedia(() => null), source = Buffer.from(png)
  const draw = media.holdSticker(['A', 'B'], source, 'image/png')!
  assert.match(draw.url, /^morse:\/\/app\/__sending-media\/[0-9a-f-]{36}$/)
  assert.equal(draw.video, false)
  assert.deepEqual(media.sticker('A'), draw); assert.deepEqual(media.sticker('B'), draw)
  source.fill(0) // the preview cache may let its bytes go; the forward keeps its own
  const response = media.response(token(draw.url), new Request(draw.url))
  assert.deepEqual([response.status, response.headers.get('content-type'), Buffer.from(await response.arrayBuffer())], [200, 'image/png', png])
  // The sending row is a sticker message, drawn by the same StickerView, which asks stickerPreview → SendingMedia.sticker.
  const local = localMediaMessage({ id: 'A', chatId: 'c1', createdAt: 1, media: { kind: 'sticker', parts: [{ index: 0, name: '', size: 0 }], caption: '', metadata: {} } })!
  assert.deepEqual([local.kind, local.attachments![0]!.kind], ['sticker', 'sticker'])
})

test('bytes go once no message names them; an MP4 plays as video; nothing to hold, nothing drawn', () => {
  const media = new SendingMedia(() => null)
  const draw = media.holdSticker(['A', 'B'], png, 'video/mp4')!
  assert.equal(draw.video, true)
  media.forget('A')
  assert.equal(media.response(token(draw.url), new Request(draw.url)).status, 200, 'B still names it')
  media.forget('B')
  assert.equal(media.response(token(draw.url), new Request(draw.url)).status, 404)
  assert.equal(media.holdSticker([], png, 'image/png'), null)
  assert.equal(media.holdSticker(['C'], Buffer.alloc(0), 'image/png'), null)
})

test('past the limit the oldest copy goes with the messages that name it', () => {
  const media = new SendingMedia(() => null)
  const first = media.holdSticker(['m0'], png, 'image/png')!
  for (let index = 1; index <= 48; index++) media.holdSticker([`m${index}`], png, 'image/png')
  assert.equal(media.sticker('m0'), null, 'the oldest loads as any other again')
  assert.equal(media.response(token(first.url), new Request(first.url)).status, 404)
  assert.ok(media.sticker('m48'))
  media.clear()
  assert.equal(media.sticker('m48'), null)
})
