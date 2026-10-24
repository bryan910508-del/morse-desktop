import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ChatMessage } from '../../src/shared/model'

// B-menu-now (0.241.44): a message's menu opens at once from what is already known, as Telegram Desktop decides
// «Translate» and «Add to / Remove from Favorites» while it builds the menu (history_view_context_menu.cpp:480-489,
// :1901-1910; Ui::SkipTranslate translate_box.cpp:491-520) — before, it waited up to 800 ms for the language answer and
// 600 ms more for a sticker's favourite state. And a pressed inquiry notification of another account opens once that
// account is shown, as a chat's already did.
const asked: string[] = []
let answer: (messageId: string) => Promise<boolean> = async () => true
let favourite: () => Promise<{ id: string; favourite: boolean }> = async () => ({ id: 'sha-1', favourite: false })
;(globalThis as unknown as { window: unknown }).window = {
  morse: {
    translationGate: (_uid: string, _room: string, messageId: string) => { asked.push(messageId); return answer(messageId) },
    stickerMessageFavourite: () => favourite()
  }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
const text = (id: string, words: string): ChatMessage => ({ id, kind: 'text', text: words, senderId: 'u2', reactions: [] } as unknown as ChatMessage)

test('«번역» is decided at once: known from the screen, left out while unknown, always on the server\'s route', async () => {
  const { learnTranslationGates, translationMenuEntry } = await import('../../src/renderer/src/app/translations')
  const english = text('m1', 'Hello there'), korean = text('m2', '안녕하세요')
  answer = async id => id === 'm1'
  // Not asked yet: the menu leaves «번역» out without waiting, and asks for the next time.
  assert.equal(translationMenuEntry('me', 'c1', english, 'direct', 'device', false), null)
  assert.deepEqual(asked, ['m1'])
  await settle()
  const entry = translationMenuEntry('me', 'c1', english, 'direct', 'device', false)
  assert.ok(entry && entry !== 'separator' && entry.label === '번역', 'known now')
  // The messages on screen ask beforehand, once each.
  learnTranslationGates('me', 'c1', [english, korean, korean], 'direct', 'device')
  await settle()
  assert.deepEqual(asked, ['m1', 'm2'], 'the one already known is not asked again')
  assert.equal(translationMenuEntry('me', 'c1', korean, 'direct', 'device', false), null, 'the same language: no «번역»')
  // A changed text is asked again.
  learnTranslationGates('me', 'c1', [{ ...korean, text: 'Edited in English' }], 'direct', 'device')
  await settle()
  assert.deepEqual(asked, ['m1', 'm2', 'm2'])
  // The server judges the language itself: offered at once, nothing asked here.
  assert.ok(translationMenuEntry('me', 'c9', text('m9', 'x'), 'direct', 'server', false))
  learnTranslationGates('me', 'c9', [text('m9', 'x')], 'direct', 'server')
  await settle()
  assert.equal(asked.includes('m9'), false)
  assert.equal(translationMenuEntry('me', 'c9', text('m9', 'x'), 'secret', 'server', false), null, 'never in a secret chat')
})

test('a sticker\'s favourite state is read from the favourites list once its id is known; unknown, the add is offered', async () => {
  const { learnStickerId, stickerFavouriteNow } = await import('../../src/renderer/src/history/sticker-favourite')
  assert.equal(stickerFavouriteNow('me', 'c1', 's1', 'v1', []), null, 'not learned: the menu offers the add')
  await settle()
  assert.deepEqual(stickerFavouriteNow('me', 'c1', 's1', 'v1', []), { id: 'sha-1', favourite: false })
  assert.deepEqual(stickerFavouriteNow('me', 'c1', 's1', 'v1', [{ id: 'sha-1', kind: 'png', size: 1, url: '' }]), { id: 'sha-1', favourite: true }, 'the list decides, as it changes')
  let calls = 0
  favourite = async () => { calls++; return { id: 'sha-2', favourite: true } }
  learnStickerId('me', 'c1', 's2', 'v1'); learnStickerId('me', 'c1', 's2', 'v1')
  await settle()
  assert.equal(calls, 1, 'once per message')
  learnStickerId('me', 'c1', 's3', undefined)
  assert.equal(calls, 1, 'a sticker not on the server yet has nothing to learn')
})

test('a pressed notification of another account — a chat or an inquiry room — opens once that account is shown', async () => {
  const { accountShown, notificationArrived, pendingNotificationMs } = await import('../../src/renderer/src/app/notification-open')
  const room = { kind: 'inquiry' as const, channelId: 'ch1', inquiryId: 'ch1_sub1' }
  assert.deepEqual(notificationArrived('a', 'a', room, 0), { open: room, pending: null }, 'its account shown: at once')
  const held = notificationArrived('a', 'b', room, 1000)
  assert.deepEqual(held, { open: null, pending: { accountUid: 'b', target: room, at: 1000 } }, 'switching: kept')
  assert.deepEqual(accountShown(held.pending, 'a', 1500), { open: null, pending: held.pending }, 'another account shown: still kept')
  assert.deepEqual(accountShown(held.pending, 'b', 2000), { open: room, pending: null }, 'its account shown: opened')
  assert.deepEqual(accountShown(held.pending, 'b', 1000 + pendingNotificationMs), { open: null, pending: null }, 'too old: dropped')
  const chat = notificationArrived('a', 'b', { kind: 'chat', chatId: 'c1' }, 0)
  assert.deepEqual(accountShown(chat.pending, 'b', 10).open, { kind: 'chat', chatId: 'c1' }, 'a chat the same way')
})

test('no menu waits for an answer, and both notifications go one way', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../src/renderer/src', path), 'utf8')
  const widget = read('history/history-widget.tsx'), inquiry = read('channels/channel-inquiry-panel.tsx'), translations = read('app/translations.ts'), main = read('main.tsx')
  assert.doesNotMatch(translations, /Promise\.race|setTimeout\(\(\) => resolve\(false\)/)
  assert.doesNotMatch(widget, /stickerMessageFavourite|setTimeout\(\(\) => resolve\(null\), 600\)/)
  assert.match(widget, /open\(translationMenuEntry\(accountUid, chatId, message, owner\?\.kind, desktop\.value\?\.translationRoute, autoTranslateRef\.current\)\)/)
  assert.match(widget, /learnTranslationGates\(accountUid, chatId, menuTextOnScreen/)
  assert.match(inquiry, /showMenu\(item, point, translationMenuEntry\(/)
  assert.match(main, /event\.type === 'open-notification-chat' \|\| event\.type === 'open-notification-inquiry'/)
  assert.match(main, /const next = accountShown\(pendingNotification, account, Date\.now\(\)\)/)
})
