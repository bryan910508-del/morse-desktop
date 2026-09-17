import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeDialog, type FirestoreDocument } from '../../src/main/network/firestore-values'

const chat = (unseen: Record<string, unknown>): FirestoreDocument => ({
  name: 'projects/talky-a38c3/databases/(default)/documents/chats/c1', updateTime: { seconds: '1', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
  fields: { type: { stringValue: 'direct' }, participantUids: { arrayValue: { values: [{ stringValue: 'me' }, { stringValue: 'peer' }] } },
    unseenReactionByUid: { mapValue: { fields: { me: { mapValue: { fields: unseen } } } } } }
} as unknown as FirestoreDocument)

// AppState.resolveMyUnseenReaction.
test('another person\'s reaction to my message is read for me, never my own or a versionless one', () => {
  const good = { messageId: { stringValue: 'm1' }, emoji: { stringValue: '❤️' }, actorUid: { stringValue: 'peer' }, reactionVersion: { integerValue: '3' } }
  assert.deepEqual(decodeDialog(chat(good), 'me').summary.unseenReaction, { messageId: 'm1', emoji: '❤️', reactionVersion: 3 })
  assert.equal(decodeDialog(chat({ ...good, actorUid: { stringValue: 'me' } }), 'me').summary.unseenReaction, undefined)
  assert.equal(decodeDialog(chat({ ...good, reactionVersion: { integerValue: '0' } }), 'me').summary.unseenReaction, undefined)
  assert.equal(decodeDialog(chat(good), 'peer').summary.unseenReaction, undefined, 'the other person has no entry')
})
