import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cancelPlan } from '../../src/main/messaging/outbox'

// B54 (Telegram history.cpp:694-696 cancelLocalItem; Android SendMessagesHelper cancelSendingMessage, 52592b0): a
// message still on its way can always be cancelled — the device's row goes, an upload of it stops, and a send already
// on its way is not recalled (a copy the server kept comes back as the server's message).
test('cancelling always removes the row, never recalls a send, and stops only this message\'s upload', () => {
  assert.deepEqual(cancelPlan({ uploading: false }), { removeRow: true, abortUpload: false, recallSend: false })
  assert.deepEqual(cancelPlan({ uploading: true }), { removeRow: true, abortUpload: true, recallSend: false })
})
