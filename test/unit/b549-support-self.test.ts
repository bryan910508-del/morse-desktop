import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { supportTarget } from '../../src/main/accounts/support-account'
import { directChatId } from '../../src/main/messaging/direct-chat-id'

// B549 (review 11-05 20:4x): when the server names this very account as support, «채팅으로 문의하기» opens nothing and
// says chat support is not available now — as iOS does, and with the same meaning as supportTarget's «unavailable».
test('B549: support is this account → «채팅으로 문의하기» is refused before any chat is found or made', () => {
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  const open = session.slice(session.indexOf('  async openSupportChat('), session.indexOf('  async appConfig('))
  const guard = "if (!uid || uid === this.profile.uid) throw new Error(tr('지금은 채팅 문의를 쓸 수 없어요.'))"
  assert.ok(open.includes(guard), 'no support named, or it is me: not now')
  assert.ok(open.indexOf(guard) < open.indexOf('findDirect') && open.indexOf(guard) < open.indexOf('openDirect'), 'checked before any chat is looked up or opened')
  const me = 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1w'
  assert.equal(supportTarget({ chatId: directChatId(me, me), uid: me, supportUid: me }, directChatId), 'unavailable', 'the report box reads it the same way')
})
