import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPressedItem, pressedItem, stillPressed, withPressed, type PressedSend } from '../../src/renderer/src/history/pressed-sends'
import { historyEntries } from '../../src/renderer/src/history/history-entries'
import type { LocalOutgoing } from '../../src/shared/delivery'
import type { ChatMessage } from '../../src/shared/model'

// B306 (tdesktop sendTextWithTags, history_widget.cpp:6004-6020): a text is drawn the moment the composer empties.
const send = (id: string, at = 1000): PressedSend => ({ id, chatId: 'chat1', text: `text ${id}`, createdAt: at })
const queued = (id: string, sequence: number): LocalOutgoing => ({ id, chatId: 'chat1', sequence, text: `text ${id}`, createdAt: 900 + sequence, state: 'queued', reason: '', busy: false, retryable: false })
const message = (id: string): ChatMessage => ({ id, chatId: 'chat1', senderId: 'me', position: { seconds: 1, nanoseconds: 0, id } } as unknown as ChatMessage)
const shown = (messages: ChatMessage[], items: readonly LocalOutgoing[]) =>
  historyEntries(messages, items, raw => ({ kind: 'message', key: raw.id, message: raw, own: true, time: 1 })).map(entry => `${entry.kind}:${entry.key}`)

test('pressed: drawn at once as a message on its way, after what the queue already holds', () => {
  const items = withPressed([queued('a', 1)], [send('b'), send('c', 1001)])
  assert.deepEqual(shown([], items), ['local:a', 'local:b', 'local:c'])
  const item = pressedItem(send('b'))
  assert.equal(item.state, 'queued'); assert.equal(item.text, 'text b'); assert.equal(isPressedItem(item), true); assert.equal(isPressedItem(queued('a', 1)), false)
})
test('the queue\'s item for the same id takes its place: one message, one item', () => {
  const pressed = [send('b')]
  const items = withPressed([queued('a', 1), queued('b', 2)], pressed)
  assert.deepEqual(shown([], items), ['local:a', 'local:b'])
  assert.equal(items.find(item => item.id === 'b')!.sequence, 2, 'the queue\'s own item, not the pressed one')
  assert.deepEqual(stillPressed(pressed, items, new Set()), [], 'handed over to the queue')
  assert.deepEqual(stillPressed(pressed, [], new Set(['b'])), [], 'or to the history')
  assert.equal(stillPressed(pressed, [queued('a', 1)], new Set()), pressed, 'the same list while it waits')
})
test('a refused send leaves: the window draws nothing more for it', () => {
  // Compose puts the text back in the field and asks for it to be dropped (onPressSettled(id, false)).
  assert.deepEqual(shown([], withPressed([], [])), [])
})
test('B303 kept: once the history showed it and it was deleted, the pressed text does not come back', () => {
  let pressed: readonly PressedSend[] = [send('b')]
  pressed = stillPressed(pressed, [], new Set(['b']))
  assert.deepEqual(shown([message('b')], withPressed([], pressed)), ['message:b'])
  assert.deepEqual(shown([], withPressed([], pressed)), [], 'deleted for everyone or hidden: nothing in its place')
})
