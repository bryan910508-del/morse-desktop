import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerAfterPublish } from '../../src/main/platform/chat-opening'

// B109 (user rule «텔레그램 구조»): opening a 1:1 that is not a row of the list (search, a contact's «메시지», a group
// member, «채팅으로 문의하기») answered with the chat id before the batch carrying that chat went to the window, and the
// renderer drew «대화를 찾을 수 없습니다.» for a frame. The answer now follows the batch, as tdesktop's showPeerHistory
// shows a History the session data already holds.

test('B109: the chat id is answered only after the batch carrying the chat has gone out', async () => {
  const sent: string[] = []
  const opened = answerAfterPublish(async () => { await Promise.resolve(); sent.push('batch') })
  await opened('chat-1').then(id => { sent.push(`answer ${id}`) })
  assert.deepEqual(sent, ['batch', 'answer chat-1'])
})

test('B109: a chat found asynchronously (the pair document, a new chat) is published after it is found', async () => {
  const sent: string[] = []
  let found = false
  const opened = answerAfterPublish(async () => { sent.push(found ? 'batch with chat' : 'batch without chat') })
  const id = await opened(new Promise<string>(resolve => setTimeout(() => { found = true; resolve('chat-2') }, 5)))
  assert.equal(id, 'chat-2')
  assert.deepEqual(sent, ['batch with chat'])
})

test('B109: an open that fails publishes nothing and answers with its error', async () => {
  let published = 0
  const opened = answerAfterPublish(async () => { published++ })
  await assert.rejects(opened(Promise.reject(new Error('대화를 다시 선택해 주세요.'))), /대화를 다시 선택해 주세요/)
  assert.equal(published, 0)
})

test('B109: a group this account made is opened only once the list holds it and its batch has gone out', async () => {
  const { answerWhenListed } = await import('../../src/main/platform/chat-opening')
  const sent: string[] = []
  const created = answerWhenListed(async () => { sent.push('batch') })
  assert.equal(await created(Promise.resolve('done'), async () => { sent.push('listed'); return true }), 'listed')
  assert.deepEqual(sent, ['listed', 'batch'])
})

test('B109: a group made but not listed in time, or not known to be made, is not opened and publishes nothing', async () => {
  const { answerWhenListed } = await import('../../src/main/platform/chat-opening')
  let published = 0, asked = 0
  const created = answerWhenListed(async () => { published++ })
  assert.equal(await created(Promise.resolve('done'), async () => { asked++; return false }), 'done')
  assert.equal(await created(Promise.resolve('unconfirmed'), async () => { asked++; return true }), 'unconfirmed')
  assert.equal(published, 0)
  assert.equal(asked, 1, 'an unconfirmed creation does not wait for the list')
})
