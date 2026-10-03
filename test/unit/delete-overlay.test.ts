import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '../../src/shared/model'

// B101 (§34, user rule «텔레그램 구조»): «delete for everyone» hides the bubble at once, before the server answers
// (message-overlay.ts mutate), and keeps it hidden whatever else moves on the server copy meanwhile (a reaction, an
// edit, a read mark) until the delete lands or fails, as tdesktop destroys the item when the request goes and restores
// it only on failure (data_histories.cpp:942, 1019-1030).
const pending: (() => void)[] = []
;(globalThis as unknown as { window: unknown }).window = { morse: { mutateMessage: () => new Promise<void>(resolve => { pending.push(resolve) }) } }

const message = (version: string): ChatMessage => ({ id: 'm1', chatId: 'chat1', senderId: 'me', text: 's43e2', version } as unknown as ChatMessage)

test('B101: a deleted bubble is hidden at once, before the server answers', async () => {
  const { deleteMessage, overlayMessage } = await import('../../src/renderer/src/history/message-overlay')
  void deleteMessage('me', message('v1'))
  assert.equal(overlayMessage(message('v1')), null, 'hidden while the delete is on its way')
  pending.splice(0).forEach(resolve => resolve())
})

test('B101: a version that moves before the delete lands keeps the bubble gone; the copy going ends the hiding', async () => {
  const { deleteMessage, overlayMessage, reconcileMessages } = await import('../../src/renderer/src/history/message-overlay')
  void deleteMessage('me', message('v1'))
  assert.equal(overlayMessage(message('v1')), null)
  // Someone reacts (or the message is read) before the server has the delete: the room's copy moves to v2.
  reconcileMessages('chat1', [message('v2')])
  assert.equal(overlayMessage(message('v2')), null, 'still gone, as in Telegram')
  // The delete lands: the copy leaves the history, and the hiding with it.
  reconcileMessages('chat1', [])
  assert.notEqual(overlayMessage(message('v3')), null, 'nothing hidden any more for this id')
  pending.splice(0).forEach(resolve => resolve())
})

test('B101: a delete the device could not hand over puts the bubble back', async () => {
  ;(globalThis as unknown as { window: { morse: object } }).window.morse = { mutateMessage: async () => { throw new Error('refused') } }
  const { deleteMessage, overlayMessage } = await import('../../src/renderer/src/history/message-overlay')
  const ui = await import('../../src/renderer/src/app/ui')
  const toast = ui.controller.toast; ui.controller.toast = () => {}
  await deleteMessage('me', { ...message('v1'), id: 'm2' } as ChatMessage)
  assert.notEqual(overlayMessage({ ...message('v1'), id: 'm2' } as ChatMessage), null)
  ui.controller.toast = toast
})
