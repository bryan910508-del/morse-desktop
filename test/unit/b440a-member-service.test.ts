import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeDialog, decodeMessage, documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { memberServiceText } from '../../src/shared/member-service'
import { setLanguage } from '../../src/shared/i18n'

// B440a (reports/server/2026-10-16-b440a-member-service-messages.md): a group's member service lines carry people —
// systemActorUid, systemTargetUids and the names copied when they were written (systemNames) — and are drawn in the
// window's language, as tdesktop draws lng_action_add_user / kick_user / user_left (history_item.cpp:6148-6310). The row
// reads the chat's copy (lastMessageType + lastSystemEvent); the lines count as unread.
const s = (stringValue: string) => ({ stringValue })
const uids = (...values: string[]) => ({ arrayValue: { values: values.map(s) } })
const names = (entries: Record<string, string>) => ({ mapValue: { fields: Object.fromEntries(Object.entries(entries).map(([uid, name]) => [uid, s(name)])) } })

test('the words, by kind — one target, several, and joining by oneself; names: now, then the copy, then unknown', () => {
  setLanguage('ko')
  const now = (uid: string) => ({ me: '나', ann: '안나' } as Record<string, string>)[uid] ?? ''
  const copy = { bob: '보브', cid: '시드' }
  assert.equal(memberServiceText({ kind: 'memberAdded', actorUid: 'ann', targetUids: ['bob'], names: copy }, now), '안나님이 보브님을 초대했어요')
  assert.equal(memberServiceText({ kind: 'memberAdded', actorUid: 'ann', targetUids: ['bob', 'cid'], names: copy }, now), '안나님이 보브, 시드님을 초대했어요')
  assert.equal(memberServiceText({ kind: 'memberAdded', actorUid: 'bob', targetUids: ['bob'], names: copy }, now), '보브님이 들어왔어요')
  assert.equal(memberServiceText({ kind: 'memberRemoved', actorUid: 'ann', targetUids: ['bob'], names: copy }, now), '안나님이 보브님을 내보냈어요')
  assert.equal(memberServiceText({ kind: 'memberLeft', actorUid: 'bob', targetUids: ['bob'], names: copy }, now), '보브님이 나갔어요')
  assert.equal(memberServiceText({ kind: 'groupOwnerChanged', actorUid: 'bob', targetUids: ['ann'], names: copy }, now), '안나님이 이제 그룹 주인이에요')
  assert.equal(memberServiceText({ kind: 'memberRemoved', actorUid: 'ann', targetUids: ['zed'], names: {} }, now), '안나님이 알 수 없는 사용자님을 내보냈어요')
  assert.equal(memberServiceText({ kind: 'memberRemoved', actorUid: 'ann', targetUids: ['bob'], names: copy }, uid => uid === 'bob' ? '연락처 보브' : now(uid)), '안나님이 연락처 보브님을 내보냈어요',
    'the name known now comes before the copy')
  setLanguage('en')
  assert.equal(memberServiceText({ kind: 'memberRemoved', actorUid: 'ann', targetUids: ['bob'], names: { ann: 'Anna', bob: 'Bob' } }, () => ''), 'Anna removed Bob')
  setLanguage('ru')
  assert.doesNotMatch(memberServiceText({ kind: 'memberLeft', actorUid: 'bob', targetUids: ['bob'], names: { bob: 'Боб' } }, () => ''), /[가-힣]/)
  setLanguage('ko')
})

const group: ReadDialog = {
  summary: { id: 'g1', version: '1:0', kind: 'group', title: '그룹', participantUids: ['me', 'ann'], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { me: '나', ann: '안나' }, accountUid: 'me'
} as unknown as ReadDialog
const line = (fields: Record<string, unknown>): FirestoreDocument => ({
  name: `${documents}/chats/g1/messages/sys1`, updateTime: { seconds: '1', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: '1750000000', nanos: 0 } }, senderId: s('ann'), type: s('text'), isSystem: { booleanValue: true },
    text: s('Anna removed Bob'), ...fields }
} as unknown as FirestoreDocument)

test('a member line in the room reads in this window\'s words, counts as unread, and says its kind; another system line is as before', () => {
  setLanguage('ko')
  const removed = decodeMessage(line({ systemKind: s('memberRemoved'), systemActorUid: s('ann'), systemTargetUids: uids('bob'), systemNames: names({ ann: 'Anna', bob: '보브' }) }), group)!
  assert.equal(removed.text, '안나님이 보브님을 내보냈어요', 'ann is in the room now; bob only in the copy')
  assert.equal(removed.system, true)
  assert.equal(removed.readEligible, true)
  assert.equal(removed.memberService, 'memberRemoved')
  const owner = decodeMessage(line({ systemKind: s('groupOwnerChanged'), systemActorUid: s('bob'), systemTargetUids: uids('ann'), systemNames: names({ bob: '보브', ann: 'Anna' }) }), group)!
  assert.equal(owner.text, '안나님이 이제 그룹 주인이에요')
  const unknown = decodeMessage(line({ systemKind: s('somethingNew') }), group)!
  assert.equal(unknown.text, 'Anna removed Bob', 'an unknown kind keeps the server\'s own sentence, as before')
  assert.equal(unknown.readEligible, false)
  assert.equal(unknown.memberService, undefined)
  const broken = decodeMessage(line({ systemKind: s('memberRemoved'), systemActorUid: s('ann') }), group)!
  assert.equal(broken.text, 'Anna removed Bob', 'no targets: not a member line — the server\'s sentence')
})

const room = (fields: Record<string, unknown>): FirestoreDocument => ({ name: `${documents}/chats/g1`, updateTime: { seconds: '5', nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
  fields: { type: s('group'), title: s('그룹'), participantUids: uids('me', 'ann'),
    participantInfo: { mapValue: { fields: { me: { mapValue: { fields: { displayName: s('나') } } }, ann: { mapValue: { fields: { displayName: s('안나') } } } } } },
    lastMessageAt: { timestampValue: { seconds: '1790000000', nanos: 0 } }, ...fields } } as unknown as FirestoreDocument)

test('the row reads the chat\'s copy of its newest member line; without the matching kind it reads as before', () => {
  setLanguage('ko')
  const event = (kind: string) => ({ mapValue: { fields: { kind: s(kind), actorUid: s('ann'), targetUids: uids('bob'), names: names({ bob: '보브' }) } } })
  const read = decodeDialog(room({ lastMessage: s('Anna removed Bob'), lastMessageType: s('memberRemoved'), lastSystemEvent: event('memberRemoved') }), 'me')
  assert.equal(read.summary.preview, '안나님이 보브님을 내보냈어요')
  assert.equal(read.memberEvent?.kind, 'memberRemoved')
  const mismatched = decodeDialog(room({ lastMessage: s('안녕'), lastMessageType: s('text'), lastSystemEvent: event('memberRemoved') }), 'me')
  assert.equal(mismatched.summary.preview, '안녕')
  assert.equal(mismatched.memberEvent, undefined)
})
