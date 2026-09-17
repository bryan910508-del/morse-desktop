import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccountNotifications, type NotificationContent } from '../../src/main/messaging/notifications'
import { defaultPreferences, type Preferences } from '../../src/shared/model'
import type { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

const summary = (id: string, kind: 'direct' | 'group') => ({ summary: { id, version: '1:0', kind, title: kind === 'group' ? '그룹' : '친구', participantUids: ['me', 'peer'],
  preview: '', unreadCount: 1, markedUnread: false, readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { me: '나', peer: '친구' }, accountUid: 'me' }) as unknown as ReadDialog
const message = (chatId: string, id: string): FirestoreDocument => ({ name: `${documents}/chats/${chatId}/messages/${id}`, updateTime: { seconds: '2', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: '1750000000', nanos: 0 } }, senderId: { stringValue: 'peer' }, type: { stringValue: 'text' }, text: { stringValue: '안녕' }, status: { stringValue: 'sent' } } } as unknown as FirestoreDocument)

async function shown(preferences: Partial<Preferences>, kind: 'direct' | 'group', appActive = false): Promise<NotificationContent[]> {
  const chatId = `${kind}1`, doc = message(chatId, 'm1'), result: NotificationContent[] = []
  const reader = { query: async () => [doc], watch: () => () => {} } as unknown as FirestoreReader
  const notifications = new AccountNotifications('me', new AbortController().signal, () => ({ ready: true, reader, dialogs: new Map([[chatId, summary(chatId, kind)]]) }), {
    preferences: () => ({ ...defaultPreferences, ...preferences }), locked: () => false, foreground: () => false, appActive: () => appActive,
    show: content => { result.push(content); return () => {} }, open: () => {}, report: () => {}
  }, async () => true)
  notifications.receive({ chatId, id: 'm1' } as never)
  await new Promise(resolve => setTimeout(resolve, 600))
  await notifications.close()
  return result
}

// iOS NotificationSettingsView: 1:1 and group apart, sound, and nothing while in use when that is off.
test('1:1, group, sound and in-app choices decide whether and how a message notifies', async () => {
  assert.equal((await shown({}, 'direct')).length, 1)
  assert.equal((await shown({ notifyPersonal: false }, 'direct')).length, 0)
  assert.equal((await shown({ notifyPersonal: false }, 'group')).length, 1)
  assert.equal((await shown({ notifyGroup: false }, 'group')).length, 0)
  assert.equal((await shown({ notificationSound: false }, 'direct'))[0]?.silent, true)
  assert.equal((await shown({ inAppNotifications: false }, 'direct', true)).length, 0)
  assert.equal((await shown({ inAppNotifications: false }, 'direct', false)).length, 1)
})
