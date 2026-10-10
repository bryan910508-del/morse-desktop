import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { pendingText } from '../../src/main/messaging/outbox'
import { StickerDraws } from '../../src/main/messaging/sticker-draws'
import { stickerLibraryURL } from '../../src/shared/stickers'
import { stickerPackItemURL } from '../../src/shared/sticker-packs'
import { LocalStickerView, localSticker } from '../../src/renderer/src/history/local-sticker'
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

test('the picture a sticker is sent from goes with its sending row, in a chat and in an inquiry room, and the server\'s copy reuses it', () => {
  const draws = new StickerDraws()
  draws.note('m1', { url: stickerLibraryURL(sha), video: false })
  draws.note('q1', { url: stickerPackItemURL('set', 'item'), video: true })
  const chatRows = draws.decorate([{ id: 'm1', text: '스티커' }, { id: 'm2', text: 'hello' }])
  assert.deepEqual(chatRows[0]!.sticker, { url: `morse://app/__sticker/${sha}`, video: false })
  assert.equal(chatRows[1]!.sticker, undefined, 'a text message is untouched')
  const inquiryRows = draws.decorate([{ id: 'q1', inquiryId: 'i1', text: '스티커' }])
  assert.deepEqual(inquiryRows[0]!.sticker, { url: 'morse://app/__sticker-pack/set/item', video: true }, 'an inquiry room\'s sticker (a set\'s, as MP4)')
  // The server's copy of the same message id is drawn from the same picture: no second download (session.stickerPreview).
  assert.deepEqual(draws.get('m1'), { url: `morse://app/__sticker/${sha}`, video: false })
  assert.equal(draws.get('other'), null, 'a sticker another device sent loads as before')
  draws.forget('m1')
  assert.equal(draws.get('m1'), null, 'a send that was not queued leaves nothing behind')
  const many = new StickerDraws()
  for (let i = 0; i < 305; i++) many.note(`m${i}`, { url: 'u', video: false })
  assert.equal(many.get('m0'), null, 'only the newest few hundred are kept')
  assert.ok(many.get('m304'))
})

test('a sticker on its way is drawn as the sticker, not a text bubble; a forward keeps its labelled bubble', () => {
  setLanguage('ko')
  const draw = { url: stickerLibraryURL(sha), video: false }
  // LocalMessageView (message.tsx) draws «bubble media-only round» + LocalStickerView for these, the text bubble otherwise.
  assert.deepEqual(localSticker({ sticker: draw }), draw)
  assert.equal(localSticker({}), null, 'a text message keeps its bubble')
  assert.equal(localSticker({ sticker: draw, forwarded: true }), null)
  const html = renderToStaticMarkup(createElement(LocalStickerView, { draw }))
  assert.match(html, /class="sticker-view"/)
  assert.match(html, new RegExp(`<img src="morse://app/__sticker/${sha}" alt="스티커"`))
  assert.doesNotMatch(html, /스티커\.png|bubble-text/)
  assert.match(renderToStaticMarkup(createElement(LocalStickerView, { draw: { url: stickerPackItemURL('set', 'item'), video: true } })), /<video src="morse:\/\/app\/__sticker-pack\/set\/item"/, 'an MP4 one plays')
})
