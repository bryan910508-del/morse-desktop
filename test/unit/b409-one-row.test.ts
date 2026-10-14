import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import './b384-dom-stub'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageView, type MessageLayout } from '../../src/renderer/src/history/message'
import { localChatMessage, localMediaVersion } from '../../src/renderer/src/history/local-media'
import { remainingAt } from '../../src/renderer/src/history/item-reveal'
import { historyEntries, type Entry } from '../../src/renderer/src/history/history-entries'
import { positionAt, type ChatMessage, type ReplyPreview } from '../../src/shared/model'
import type { LocalOutgoing } from '../../src/shared/delivery'

// B409 (user 10-14 21:0x «데스크탑 메시지 보내면 말풍선들이 깜빡거린다», review 22:3x): a message on its way and its server
// copy were two views (LocalMessageView, MessageView), so the answer took the bubble away and drew a new one — measured
// on Phase1 as the row's element leaving and another coming ~0.6 s after a send. tdesktop keeps the one item and changes
// its id (HistoryItem::setRealId, history_item.cpp:3309-3341). Here one view draws both, from the same ChatMessage.
const layout: MessageLayout = { date: false, unread: false, top: false, bottom: false, name: false, photo: false, gutter: false, roomOnly: false }
const none = (): void => {}
const at = 1790121600000
const going = (extra: Partial<LocalOutgoing>): LocalOutgoing => ({ id: 'm1', chatId: 'c1', sequence: 1, text: 'hello', createdAt: at, state: 'queued', reason: '', busy: true, retryable: false, ...extra })
const props = (message: ChatMessage, item?: LocalOutgoing) => ({ accountUid: 'me', chatId: 'c1', message, own: true, layout, read: 'sent' as const, selecting: false, selected: false,
  highlighted: false, autoTranslate: false, onMenu: none, onReply: none, onJumpReply: none, onOpenMedia: none, onToggle: none, onReaction: none, ...(item ? { outgoing: { item, onMenu: none } } : {}) })
const drawLocal = (item: LocalOutgoing, reply?: ReplyPreview) => renderToStaticMarkup(createElement(MessageView, props(localChatMessage(item, 'me', reply), item)))
// The server's copy of the same message: confirmed, a server version, its own time a little after the device's.
const confirmed = (item: LocalOutgoing, reply?: ReplyPreview): ChatMessage => ({ ...localChatMessage(item, 'me', reply), serverConfirmed: true, version: '1790121600:1', position: positionAt(at + 800, item.id), readEligible: true })
const drawServer = (item: LocalOutgoing, reply?: ReplyPreview) => renderToStaticMarkup(createElement(MessageView, props(confirmed(item, reply))))
// The tree's shape: elements in order, with no attributes, text or icon drawing (a status icon changes its picture only).
const shape = (html: string): string => html.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').replace(/<(\/?)([a-z0-9-]+)[^>]*?(\/?)>/g, '<$1$2$3>').replace(/>[^<]+</g, '><')

test('B409: a message on its way and its server copy are the same tree — text, emoji, a link, a reply, a photo', () => {
  const reply: ReplyPreview = { state: 'ready', senderName: 'Peer', kind: 'text', text: 'before' }
  const photo = { kind: 'image' as const, parts: [{ index: 0, name: 'a.jpg', size: 1000 }], caption: '', metadata: { width: 800, height: 600 } as never }
  const cases: [string, LocalOutgoing, ReplyPreview?][] = [['text', going({})], ['emoji', going({ text: '😀' })], ['link', going({ text: 'see https://example.com' })],
    ['reply', going({ replyToId: 'r1' }), reply], ['photo', going({ text: '', media: photo })], ['captioned photo', going({ text: '', media: { ...photo, caption: 'look' } })]]
  for (const [name, item, quote] of cases) {
    const sent = { ...item, state: 'sent' as const }
    assert.equal(shape(drawLocal(sent, quote)), shape(drawServer(sent, quote)), name)
  }
  // A quote still loading on the device, ready in the server's copy: the same element, only its words change.
  const quoted = going({ replyToId: 'r1', state: 'sent' })
  assert.equal(shape(drawLocal(quoted, { state: 'loading' })), shape(drawServer(quoted, reply)))
})

test('B409: the row on its way carries its state — sending, sent, failed with its reason — and no message id for read marks', () => {
  const sending = drawLocal(going({}))
  assert.match(sending, /aria-label="보내는 중"/); assert.match(sending, /data-local-id="m1"/); assert.doesNotMatch(sending, /data-message-id/)
  assert.match(drawLocal(going({ state: 'sent' })), /aria-label="보냄"/)
  const failed = drawLocal(going({ state: 'failed', reason: '네트워크', retryable: true, busy: false }))
  assert.match(failed, /class="history-message own failed"/); assert.match(failed, /class="history-failed"/); assert.match(failed, /history-failed-reason">네트워크</)
  const server = drawServer(going({}))
  assert.match(server, /data-message-id="m1"/); assert.doesNotMatch(server, /data-local-id/)
  assert.doesNotMatch(drawLocal(going({ text: '', voicePreview: { duration: 3 } as never })), /bubble-text/, 'a voice message on its way is its player, no «첨부» line')
  const message = localChatMessage(going({ text: '안녕' }), 'me')
  assert.deepEqual([message.kind, message.text, message.senderId, message.version, message.serverConfirmed], ['text', '안녕', 'me', localMediaVersion, false])
})

test('B409: the history and the inquiry room draw both rows with MessageView, in one keyed list', () => {
  const message = readFileSync('src/renderer/src/history/message.tsx', 'utf8')
  assert.doesNotMatch(message, /LocalMessageView/)
  const history = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  assert.doesNotMatch(history, /LocalMessageView/)
  assert.match(history, /: <MessageView accountUid=\{accountUid\} chatId=\{chatId\} message=\{localChatMessage\(entry\.item, accountUid/)
  assert.match(history, /outgoing=\{\{ item: entry\.item, onMenu: openLocalMenu \}\}/)
  const inquiry = readFileSync('src/renderer/src/channels/channel-inquiry-panel.tsx', 'utf8')
  assert.doesNotMatch(inquiry, /LocalMessageView/)
  // One order for both, the chat's (B409-4: a failed one keeps its place, those on their way are last).
  assert.match(inquiry, /const ordered = historyEntries\(rows\.map\(row => row\.message\), waiting\.map\(entry => inquiryLocal\(entry, inquiryId\)\)/)
  assert.match(inquiry, /\{ordered\.map\(entry => \{ if \(entry\.kind === 'message'\)/)
  // The waiting row keeps the confirmed row's children in place: an empty date slot, then the view.
  assert.match(inquiry, /className="history-row inquiry-thread-row">\n\s+\{false\}\n\s+<MessageView/)
})

test('B409-3: the rise hides exactly the row\'s measured height and ends at nothing', () => {
  assert.equal(remainingAt(43.9, 0, 0), 43.9)
  assert.equal(remainingAt(37.5, 100, 100), 37.5)
  assert.equal(remainingAt(43.9, 0, 150), 0)
  assert.ok(remainingAt(43.9, 0, 75) > 0 && remainingAt(43.9, 0, 75) < 43.9)
})

// B409-4 (Phase1 10-14 23:21: with a failed message on screen, the next message's answer moved the failed row below it —
// a local row was always last). tdesktop keeps a failed item where it was written; what comes after lands below it.
test('B409-4: a failed message keeps its place among the history; what is still on its way stays at the bottom', () => {
  const at = (id: string, time: number, senderId = 'me'): Entry => ({ kind: 'message', key: id, message: { id, senderId } as ChatMessage, own: senderId === 'me', time })
  const history = [at('a', 1000), at('b', 2000), at('p', 2500, 'peer')]
  const local = (id: string, sequence: number, createdAt: number, state: LocalOutgoing['state']): LocalOutgoing => going({ id, sequence, createdAt, state })
  const keys = (items: LocalOutgoing[]) => historyEntries(history.map(entry => (entry as { message: ChatMessage }).message), items, raw => history.find(entry => entry.key === raw.id)!).map(entry => entry.key)
  assert.deepEqual(keys([local('f', 1, 1500, 'failed')]), ['a', 'f', 'b', 'p'], 'the later own message and the reply come below it')
  assert.deepEqual(keys([local('f', 1, 1500, 'upload-failed'), local('g', 2, 1600, 'failed')]), ['a', 'f', 'g', 'b', 'p'])
  assert.deepEqual(keys([local('f', 1, 1500, 'failed'), local('s', 2, 3000, 'queued')]), ['a', 'f', 'b', 'p', 's'], 'one on its way is the newest')
  assert.deepEqual(keys([local('f', 1, 5000, 'failed')]), ['a', 'b', 'p', 'f'], 'the newest failed one is still last')
})
