import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { translationRoom, translationTarget } from '../../src/shared/translation'
import { ServerTranslator } from '../../src/main/messaging/server-translation'
import type { ChatMessage } from '../../src/shared/model'

// B343b (reports/desktop/2026-10-14-b343b-plan.md, review 10-14 01:4x): the message menu's «번역» in a 1:1 inquiry room too,
// on the chat's one path — tdesktop offers it in any room (history_view_context_menu.cpp:1901-1909, v7.3.1 6fed91ff);
// translateMorseMessages takes {kind: 'inquiry'} (morse-translation.js:7, :51, :146, a6f1d0e3). «전체번역» stays with chats.
test('one key names the room: a chat by its id, an inquiry room by its inquiryQueueChatId', () => {
  assert.deepEqual(translationRoom('chat1'), { kind: 'chat', roomId: 'chat1' })
  assert.deepEqual(translationRoom('sub_inq_Q1'), { kind: 'inquiry', roomId: 'Q1' })
})

test('the server is asked with the room\'s kind; a chat\'s cached result keeps its key; the two kinds never share one', async () => {
  const asked: Record<string, unknown>[] = []
  const translator = new ServerTranslator('me', async (_name, data) => { asked.push(data); return { results: (data.messageIds as string[]).map(messageId => ({ messageId, status: 'translated', text: `T:${data.kind}` })) } })
  const inquiry = await translator.translate('sub_inq_Q1', [{ id: 'm1', text: 'hello' }])
  const chat = await translator.translate('Q1', [{ id: 'm1', text: 'hello' }])
  assert.deepEqual(asked.map(data => [data.kind, data.roomId, data.expectedUid]), [['inquiry', 'Q1', 'me'], ['chat', 'Q1', 'me']])
  assert.deepEqual([inquiry.get('m1'), chat.get('m1')], [{ status: 'translated', text: 'T:inquiry' }, { status: 'translated', text: 'T:chat' }], 'same ids, different rooms')
  // The chat key as it was before B343b (target, chat id, message id, text): what is kept for a chat is found again.
  const before = createHash('sha256').update(translationTarget()).update('\0').update('Q1').update('\0').update('m1').update('\0').update('hello').digest('hex')
  assert.equal((translator as unknown as { key(room: string, item: { id: string; text: string }): string }).key('Q1', { id: 'm1', text: 'hello' }), before)
  assert.notEqual((translator as unknown as { key(room: string, item: { id: string; text: string }): string }).key('sub_inq_Q1', { id: 'm1', text: 'hello' }), before)
  await translator.translate('Q1', [{ id: 'm1', text: 'hello' }])
  assert.equal(asked.length, 2, 'a chat\'s kept result is used, not asked again')
})

// The menu row, one function for a chat and an inquiry room.
const calls: unknown[][] = []
;(globalThis as unknown as { window: unknown }).window = { morse: {
  translationGate: async (...args: unknown[]) => { calls.push(['gate', ...args]); return true },
  translateMessage: async (...args: unknown[]) => { calls.push(['translate', ...args]); return { status: 'translated', text: '번역됨' } }
} }
const text = (id: string): ChatMessage => ({ id, chatId: 'x', senderId: 'peer', kind: 'text', text: 'Good evening' } as unknown as ChatMessage)

test('the menu row is the same for a chat and an inquiry room, and goes under the room\'s key', async () => {
  const { translationMenuEntry } = await import('../../src/renderer/src/app/translations')
  const chat = await translationMenuEntry('acc', 'chat1', text('a'), 'direct', 'device', false)
  const inquiry = await translationMenuEntry('acc', 'sub_inq_Q1', text('b'), 'inquiry', 'device', false)
  assert.deepEqual([(chat as { label: string }).label, (inquiry as { label: string }).label], ['번역', '번역'])
  assert.deepEqual(calls.filter(call => call[0] === 'gate').map(call => call[2]), ['chat1', 'sub_inq_Q1'], 'the device gate asks under the room key')
  ;(inquiry as { onSelect(): void }).onSelect()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(calls.filter(call => call[0] === 'translate').map(call => call[2]), ['sub_inq_Q1'])
  assert.equal(await translationMenuEntry('acc', 'chat2', text('c'), 'secret', 'device', false), null, 'not in a secret chat')
  assert.equal(await translationMenuEntry('acc', 'chat2', text('c'), 'direct', 'none', false), null, 'not where nothing translates')
  // On the server's route main's gate answers yes (index.ts translation-gate) and the server judges the language.
  assert.ok(await translationMenuEntry('acc', 'sub_inq_Q1', text('d'), 'inquiry', 'server', false))
})

test('one path: both menus call translationMenuEntry, main reads the open inquiry with the one rule, «전체번역» stays off there', () => {
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  const panel = readFileSync('src/renderer/src/channels/channel-inquiry-panel.tsx', 'utf8')
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(widget, /translationMenuEntry\(accountUid, chatId, message, owner\?\.kind,/)
  assert.match(panel, /translationMenuEntry\(accountUid, inquiryQueueChatId\(inquiryId\), inquiryChatMessage\(item, inquiryId\), 'inquiry',/)
  assert.doesNotMatch(widget + panel, /tr\('원문 보기'\)/, 'the row is built in one place (translations.ts)')
  assert.match(panel, /autoTranslate=\{false\} translationRoom=\{inquiryQueueChatId\(inquiryId\)\}/)
  const source = session.slice(session.indexOf('  translationSource(chatId: string, messageId: string): string {'))
  assert.match(source.slice(0, source.indexOf('\n  }\n')), /channelInquiries\.openMessage\(room\.roomId, messageId\)[\s\S]*menuTranslatable\(item, 'inquiry'\)/)
})
