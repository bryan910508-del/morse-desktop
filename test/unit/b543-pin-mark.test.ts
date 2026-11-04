import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import './b384-dom-stub'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageView, type MessageLayout } from '../../src/renderer/src/history/message'
import { localChatMessage } from '../../src/renderer/src/history/local-media'
import { positionAt, type ChatMessage } from '../../src/shared/model'
import { pinnedMessageIds, shownPins, type PinnedMessageItem, type PinnedMessagesSnapshot } from '../../src/shared/pinned-messages'
import type { LocalOutgoing } from '../../src/shared/delivery'

// B543 (user 11-03 «말풍선에 고정 표시가 없고 고정을 누르면 깜빡임 표시도 없다»): tdesktop draws a pin in a pinned
// message's date line (BottomInfo Flag::Pinned, history_view_bottom_info.cpp:328-337, :677-678) and highlights the message
// on every jump from the pinned bar, standing still when animations are off (history_widget.cpp:8455-8466,
// history_view_highlight_manager.cpp:226-235). iOS and Android draw the pin first in the time line.
const item = (id: string, patch: Partial<PinnedMessageItem> = {}): PinnedMessageItem => ({ id, forMe: true, forAll: false, status: 'ready', preview: 'p', position: null, ...patch })
const snapshot = (chatId: string, items: PinnedMessageItem[]): PinnedMessagesSnapshot => ({ chatId, items, limit: 3 })

test('the pins shown: both kinds in their order, none that cannot be read, none of another chat', () => {
  const pins = snapshot('c1', [item('a'), item('b', { forMe: false, forAll: true }), item('x', { status: 'unavailable' }), item('l', { status: 'loading' })])
  assert.deepEqual(shownPins(pins, 'c1').map(pin => pin.id), ['a', 'b', 'l'])
  assert.deepEqual([...pinnedMessageIds(pins, 'c1')], ['a', 'b', 'l'])
  assert.deepEqual([...pinnedMessageIds(pins, 'c2')], [])
  assert.deepEqual([...pinnedMessageIds(null, 'c1')], [])
})

const layout: MessageLayout = { date: false, unread: false, top: false, bottom: false, name: false, photo: false, gutter: false, roomOnly: false }
const none = (): void => {}
const at = 1790121600000
const sent = (extra: Partial<LocalOutgoing> = {}): LocalOutgoing => ({ id: 'm1', chatId: 'c1', sequence: 1, text: 'hello', createdAt: at, state: 'sent', reason: '', busy: false, retryable: false, ...extra })
const server = (extra: Partial<LocalOutgoing> = {}, patch: Partial<ChatMessage> = {}): ChatMessage =>
  ({ ...localChatMessage(sent(extra), 'me'), serverConfirmed: true, version: '1790121600:1', position: positionAt(at + 800, 'm1'), ...patch })
const draw = (message: ChatMessage, pinned: boolean, own = true) => renderToStaticMarkup(createElement(MessageView, { accountUid: 'me', chatId: 'c1', message, own, layout,
  read: 'sent', selecting: false, selected: false, highlighted: false, pinned, autoTranslate: false, onMenu: none, onReply: none, onJumpReply: none, onOpenMedia: none, onToggle: none, onReaction: none }))

test('a pinned message has the pin first in its time line, and its text leaves room for it', () => {
  const pinned = draw(server(), true), plain = draw(server(), false)
  assert.match(pinned, /class="bubble-meta"><svg[^>]*class="lucide lucide-pin bubble-pin"[^>]*aria-label="고정됨"/)
  assert.match(pinned, /class="bubble-meta-space own pinned"/)
  assert.doesNotMatch(plain, /bubble-pin/)
  assert.doesNotMatch(plain, /bubble-meta-space[^"]*pinned/)
  const edited = draw(server({}, { edited: true }), true, false)
  assert.match(edited, /bubble-pin[\s\S]*?수정됨/, 'before «수정됨», as iOS and Android')
  assert.match(edited, /class="bubble-meta-space edited pinned"/)
  const photo = draw(server({ text: '', media: { kind: 'image', parts: [{ index: 0, name: 'a.jpg', size: 1000 }], caption: '', metadata: { width: 800, height: 600 } as never } }), true)
  assert.match(photo, /bubble-pin/, 'a picture\'s time over it carries the pin too')
})

test('the highlight comes again on every jump and stands still when animations are reduced', () => {
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  assert.match(widget, /useState<\{ id: string; serial: number \} \| null>/)
  assert.match(widget, /highlightMessage\(next\.focusMessageId\)/)
  assert.match(widget, /<PinnedBar accountUid=\{accountUid\} chatId=\{chatId\} onJumped=\{jumpedToPin\} \/>/)
  assert.match(widget, /pinned=\{pinnedIds\.has\(entry\.message\.id\)\}/)
  assert.match(widget, /pinnedIdsRef\.current\.has\(message\.id\)/, 'the menu\'s «고정 해제» by the same pins')
  assert.match(readFileSync('src/renderer/src/history/pinned-bar.tsx', 'utf8'), /\.then\(\(\) => onJumped\?\.\(current\.id\)/)
  const css = readFileSync('src/renderer/src/styles/history.css', 'utf8')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.history-message\.highlight \.bubble \{ animation: none !important; box-shadow: 0 0 0 3px var\(--accent-border\) \} \}/)
  assert.match(css, /\.reduce-motion \.history-message\.highlight \.bubble \{ animation: none !important; box-shadow: 0 0 0 3px var\(--accent-border\) \}/)
  assert.match(css, /\.bubble-meta-space\.pinned \{ margin-left: 15px \}/)
})
