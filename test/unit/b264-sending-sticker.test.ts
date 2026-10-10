import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localMediaOf, pendingText } from '../../src/main/messaging/outbox'
import { SendingMedia } from '../../src/main/messaging/sending-media'
import { stickerLibraryURL } from '../../src/shared/stickers'
import { stickerPackItemURL } from '../../src/shared/sticker-packs'
import { localMediaMessage } from '../../src/renderer/src/history/local-media'
import { setLanguage } from '../../src/shared/i18n'

// B264 (user 0.241.19 «스티커 전송하면 텍스트에서 스티커로 바뀌는데»): a sticker on its way showed its upload's name
// («스티커.png») in a text bubble, then a spinner while the server's copy loaded the same picture again. tdesktop draws the
// local message with its document from the start (api_sending.cpp:182 SendExistingMedia → :284 addNewLocalMessage).
const sha = 'a'.repeat(64)
const wire = (extra: object) => ({ id: 'm1', chatId: 'c1', senderId: 'me', type: 'sticker', text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3, ...extra }) as never

test('a sticker on its way is «스티커», never its file name — by its bytes or by reference', () => {
  setLanguage('ko')
  assert.equal(pendingText({ wire: wire({}), upload: { name: '스티커.png' } as never, parts: undefined, text: '' } as never), '스티커', 'by its bytes (a set\'s sticker, outbox.ts:842)')
  assert.equal(pendingText({ wire: wire({ stickerId: sha, stickerKind: 'png' }), upload: undefined, parts: undefined, text: '' } as never), '스티커', 'by reference (a favourite)')
  assert.equal(pendingText({ wire: { ...wire({}), type: 'voice' }, upload: { name: '음성 메시지.m4a' } as never, parts: undefined, text: '' } as never), '음성 메시지.m4a', 'voice unchanged')
})

// B269: B264's StickerDraws is one kind of SendingMedia; a sticker on its way is a LocalMedia of kind sticker, drawn by the
// same StickerView as the server's copy, which asks session.stickerPreview — answered from the same note.
test('the picture a sticker is sent from goes with its message, in a chat and in an inquiry room, and the server\'s copy reuses it', () => {
  const media = new SendingMedia(() => null)
  media.noteSticker('m1', { url: stickerLibraryURL(sha), video: false })
  media.noteSticker('q1', { url: stickerPackItemURL('set', 'item'), video: true })
  assert.deepEqual(media.sticker('m1'), { url: `morse://app/__sticker/${sha}`, video: false })
  assert.deepEqual(media.sticker('q1'), { url: 'morse://app/__sticker-pack/set/item', video: true }, 'an inquiry room\'s sticker (a set\'s, as MP4)')
  assert.equal(media.sticker('other'), null, 'a sticker another device sent loads as before')
  media.forget('m1')
  assert.equal(media.sticker('m1'), null, 'a send that was not queued leaves nothing behind')
  const many = new SendingMedia(() => null)
  for (let i = 0; i < 305; i++) many.noteSticker(`m${i}`, { url: 'u', video: false })
  assert.equal(many.sticker('m0'), null, 'only the newest few hundred are kept')
  assert.ok(many.sticker('m304'))
})

test('a sticker on its way is drawn as a sticker message, not a text bubble — by its bytes or by reference', () => {
  setLanguage('ko')
  for (const row of [{ wire: wire({ stickerId: sha, stickerKind: 'png' }), parts: undefined },
    { wire: wire({ mediaWidthPx: 512, mediaHeightPx: 512 }), parts: [{ index: 0, upload: { name: '스티커.png', size: 10 }, url: null }] }]) {
    const media = localMediaOf(row as never)!
    assert.equal(media.kind, 'sticker')
    const message = localMediaMessage({ id: 'm1', chatId: 'c1', createdAt: 1, media })!
    assert.equal(message.kind, 'sticker')
    assert.deepEqual(message.attachments!.map(part => [part.kind, part.available]), [['sticker', true]])
  }
})
