import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'

// B280 ③: once «보내기» is pressed, the selection is that send's — a chat changed (clearHistory → discardAttachment) or a
// connection paused meanwhile does not let it go; tdesktop binds a confirmed send to its history
// (Api::SendAction(_history), history_widget.cpp:5748-5750).
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const staged = () => {
  const staging = new AttachmentStaging()
  const draft = staging.receive('chatA', [{ name: 'a.png', bytes: png }], () => true)
  return { staging, draft }
}

test('not pressed: changing the chat lets the selection go, as before', () => {
  const { staging, draft } = staged()
  staging.clear()
  assert.throws(() => staging.prepare('me', 'chatA', draft.id, '', [draft.items[0]!.id]), /첨부 선택이 해제/)
})

test('pressed: changing the chat or a pause keeps it, and it is still sent to the chat it was pressed in', () => {
  const { staging, draft } = staged()
  const release = staging.pressed(draft.id)
  assert.equal(staging.pressedChat(), 'chatA')
  staging.clear()
  const { wire } = staging.prepare('me', 'chatA', draft.id, '', [draft.items[0]!.id])
  assert.equal(wire.chatId, 'chatA')
  release()
  assert.equal(staging.pressedChat(), null)
})

test('the send itself, the box closing, or the account locking lets it go', () => {
  for (const end of [(s: AttachmentStaging, id: string) => s.clear(id), (s: AttachmentStaging) => s.clear(undefined, true)]) {
    const { staging, draft } = staged()
    staging.pressed(draft.id)
    end(staging, draft.id)
    assert.throws(() => staging.prepare('me', 'chatA', draft.id, '', [draft.items[0]!.id]), /첨부 선택이 해제/)
    assert.equal(staging.pressedChat(), null)
  }
})

test('a press refused before it is queued: the selection stays for «보내기» again until the box lets it go', () => {
  const { staging, draft } = staged()
  const release = staging.pressed(draft.id)
  release()
  // The box is still open with it; only the box closing (clear by id) or the next chat change lets it go.
  assert.doesNotThrow(() => staging.prepare('me', 'chatA', draft.id, '', [draft.items[0]!.id]))
})
