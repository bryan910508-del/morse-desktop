import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outgoingOrder } from '../../src/main/messaging/outbox'
import { historyEntries, type Entry } from '../../src/renderer/src/history/history-entries'
import type { StoredIntent } from '../../src/main/storage/delivery-protocol'
import type { LocalOutgoing } from '../../src/shared/delivery'
import type { ChatMessage } from '../../src/shared/model'

// B90 (Telegram adds a local message once at the bottom and keeps its place through the server's answer and a
// failure — History::addNewLocalMessage, history.cpp:884-930; HistoryItem::setRealId, history_item.cpp:3165-3195;
// sendFailed, :4384-4393): ten messages written fast in a 1:1 stay in the order they were written at every step.
const chatId = 'chat1', me = 'me'
const intent = (n: number): StoredIntent => ({ id: `m${n}`, chatId, sequence: n, createdAt: 1000 + n, text: String(n), state: 'queued', reason: '',
  wire: {} as StoredIntent['wire'] } as unknown as StoredIntent)
const message = (id: string, at: number, sender = me): ChatMessage => ({ id, senderId: sender, position: { seconds: at, nanoseconds: 0, id } } as unknown as ChatMessage)

// The device as the window sees it: what waits, what the server took (kept until the history shows it), the history.
class Chat {
  waiting = new Map<number, StoredIntent>()
  taken = new Map<number, StoredIntent>()
  history: ChatMessage[] = []
  constructor(count: number) { for (let n = 1; n <= count; n++) this.waiting.set(n, intent(n)) }
  answer(n: number): void { this.taken.set(n, this.waiting.get(n)!); this.waiting.delete(n) }
  shows(n: number): void { this.history.push(message(`m${n}`, 2000 + n)); this.taken.delete(n) }
  peer(id: string, at: number): void { this.history.push(message(id, at, 'peer')) }
  keys(): string[] {
    const items = outgoingOrder(chatId, [...this.waiting.values()], [...this.taken.values()])
      .map(({ row, sent }) => ({ id: row.id, chatId, sequence: row.sequence, createdAt: row.createdAt, state: sent ? 'sent' : 'queued' }) as unknown as LocalOutgoing)
    const sorted = [...this.history].sort((a, b) => a.position.seconds - b.position.seconds)
    const entries = historyEntries(sorted, items, raw => ({ kind: 'message', key: raw.id, message: raw, own: raw.senderId === me, time: raw.position.seconds }) as Entry)
    return entries.map(entry => entry.key)
  }
  mine(): string[] { return this.keys().filter(key => key.startsWith('m')) }
}
const inOrder = Array.from({ length: 10 }, (_, n) => `m${n + 1}`)

test('answered one by one, each then shown by the history, the ten keep their order', () => {
  const chat = new Chat(10)
  assert.deepEqual(chat.mine(), inOrder)
  for (let n = 1; n <= 10; n++) {
    chat.answer(n); assert.deepEqual(chat.mine(), inOrder, `after answer ${n}`)
    chat.shows(n); assert.deepEqual(chat.mine(), inOrder, `after history ${n}`)
  }
})

test('the history showing a message before its answer arrives moves nothing either', () => {
  const chat = new Chat(10)
  for (let n = 1; n <= 10; n++) {
    chat.history.push(message(`m${n}`, 2000 + n)); assert.deepEqual(chat.mine(), inOrder, `history first ${n}`)
    chat.answer(n); chat.taken.delete(n); assert.deepEqual(chat.mine(), inOrder, `then answer ${n}`)
  }
})

test('several answered before the history catches up, and a reply from the other side in between', () => {
  const chat = new Chat(10)
  for (const n of [1, 2, 3]) { chat.answer(n); assert.deepEqual(chat.mine(), inOrder) }
  chat.shows(1)
  chat.peer('p1', 2001.5)
  assert.deepEqual(chat.mine(), inOrder)
  assert.deepEqual(chat.keys().slice(0, 3), ['m1', 'p1', 'm2'], 'the reply sits where the server put it')
  for (const n of [2, 3]) { chat.shows(n); assert.deepEqual(chat.mine(), inOrder) }
  for (let n = 4; n <= 10; n++) { chat.answer(n); chat.shows(n); assert.deepEqual(chat.mine(), inOrder) }
})

test('before, the waiting came first and the answered after them — the jump this replaces', () => {
  const waiting = [intent(2), intent(3)], taken = [intent(1)]
  assert.deepEqual(outgoingOrder(chatId, waiting, taken).map(item => item.row.id), ['m1', 'm2', 'm3'])
  assert.deepEqual(outgoingOrder(chatId, waiting, taken).map(item => item.sent), [true, false, false])
  assert.deepEqual(outgoingOrder('other', waiting, taken), [], 'another chat\'s rows are not this chat\'s')
  assert.deepEqual(outgoingOrder(chatId, [intent(1)], [intent(1)]).length, 1, 'a row both waiting and taken counts once, as waiting')
})
