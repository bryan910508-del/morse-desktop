import assert from 'node:assert/strict'
import { test } from 'node:test'
import { videoSendPreset } from '../../src/shared/photo-quality'
import { schemeLinkTarget } from '../../src/shared/text-links'
import { advancedChannelPosts } from '../../src/main/accounts/channel-post-notices'
import { listTypingDocumentNames, listTypingState } from '../../src/main/accounts/chat-typing'
import { AccountNotifications, channelPostNotice, type NotificationContent } from '../../src/main/messaging/notifications'
import { defaultPreferences, type DialogSummary, type MessagePosition, type Preferences } from '../../src/shared/model'
import type { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// iOS MorseMediaPolicy.videoSendQualityDefault(fallback: .q480) and VideoSendQuality.exportPreset.
test('a picked video is compressed with the preset iOS uses for its send quality', () => {
  assert.equal(videoSendPreset('auto', false), '960x540')
  assert.equal(videoSendPreset('original', false), '1280x720')
  assert.equal(videoSendPreset('compressed', false), 'medium')
  assert.equal(videoSendPreset('original', true), 'medium', 'power saving compresses uploads')
})

// Telegram Desktop's tg:// links; iOS MorseDeepLinkParsing reads talky://channel/{id}.
test('morse:// and talky:// links become the web addresses the app already opens', () => {
  assert.equal(schemeLinkTarget('morse://channel/abc123'), 'https://talky-a38c3.web.app/channel/abc123')
  assert.equal(schemeLinkTarget('talky://channel/abc123'), 'https://talky-a38c3.web.app/channel/abc123')
  assert.equal(schemeLinkTarget('morse://channel/abc123/post/p_1'), 'https://talky-a38c3.web.app/channel/abc123/post/p_1')
  assert.equal(schemeLinkTarget('morse://i/abcdefgh12345678'), 'https://talky-a38c3.web.app/i/abcdefgh12345678')
  for (const bad of ['morse://channel/post', 'morse://channel/a b', 'morse://i/short', 'https://talky-a38c3.web.app/channel/x', 'morse://channel/x?y=1', 'morse://settings'])
    assert.equal(schemeLinkTarget(bad), null, bad)
})

const at = (seconds: number): MessagePosition => ({ seconds, nanoseconds: 0, id: `m${seconds}` })

// functions onChannelPostCreated moves the discussion chat's last message to the post card (lastSenderType channel_post).
test('a discussion chat whose last message moves forward to a channel post announces it once', () => {
  const known = new Map<string, MessagePosition | null>()
  assert.deepEqual(advancedChannelPosts(known, false, [{ chatId: 'd1', top: at(1), channelPost: true }]), [], 'the first look only remembers')
  assert.deepEqual(advancedChannelPosts(known, true, [{ chatId: 'd1', top: at(1), channelPost: true }]), [], 'nothing moved')
  assert.equal(advancedChannelPosts(known, true, [{ chatId: 'd1', top: at(2), channelPost: true }]).length, 1)
  assert.deepEqual(advancedChannelPosts(known, true, [{ chatId: 'd1', top: at(3), channelPost: false }]), [], 'a member message is not a post')
  assert.deepEqual(advancedChannelPosts(known, true, [{ chatId: 'd1', top: at(3), channelPost: true }, { chatId: 'd2', top: at(9), channelPost: true }]), [], 'a chat seen for the first time is remembered only')
  assert.equal(advancedChannelPosts(known, true, [{ chatId: 'd2', top: at(10), channelPost: true }]).length, 1)
  assert.equal(known.has('d1'), false, 'a chat that left the list is forgotten')
})

const card = (fields: Record<string, string>): FirestoreDocument => ({ name: `${documents}/chats/d1/messages/chpost_p1`, updateTime: { seconds: '2', nanos: 0 },
  fields: Object.fromEntries([['createdAt', { timestampValue: { seconds: '1750000000', nanos: 0 } }], ['senderId', { stringValue: 'owner' }], ['type', { stringValue: 'channelPost' }],
    ['isSystem', { booleanValue: true }], ['status', { stringValue: 'sent' }], ...Object.entries(fields).map(([key, value]) => [key, { stringValue: value }])]) } as unknown as FirestoreDocument)

test('a post notice shows the channel name over the post, or the server words for a photo or video post', () => {
  assert.deepEqual(channelPostNotice(card({ text: '오늘 공지입니다', channelName: '공지 채널' }), '토론방'), { title: '공지 채널', body: '오늘 공지입니다' })
  assert.deepEqual(channelPostNotice(card({ text: '새 사진 게시물', mediaType: 'image' }), '토론방'), { title: '토론방', body: '📷 새 사진 게시물' })
  assert.deepEqual(channelPostNotice(card({ text: '새 게시물' }), '토론방'), { title: '토론방', body: '새 게시물이 올라왔어요' })
})

const discussion = { summary: { id: 'd1', version: '1:0', kind: 'group', title: '토론방', participantUids: ['me', 'owner'], discussion: true,
  preview: '', unreadCount: 1, markedUnread: false, readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { me: '나', owner: '운영자' }, accountUid: 'me' } as unknown as ReadDialog

async function postShown(preferences: Partial<Preferences>): Promise<NotificationContent[]> {
  const doc = card({ text: '새 글', channelName: '공지 채널' }), result: NotificationContent[] = []
  const reader = { query: async () => [doc], watch: () => () => {} } as unknown as FirestoreReader
  const notifications = new AccountNotifications('me', new AbortController().signal, () => ({ ready: true, reader, dialogs: new Map([['d1', discussion]]) }), {
    preferences: () => ({ ...defaultPreferences, showNotificationPreview: true, ...preferences }), locked: () => false, foreground: () => false, appActive: () => false,
    show: content => { result.push(content); return () => {} }, open: () => {}, report: () => {}
  }, async () => true)
  notifications.receive({ chatId: 'd1', id: 'chpost_p1' } as never)
  await new Promise(resolve => setTimeout(resolve, 600))
  await notifications.close()
  return result
}

// iOS NotificationSettingsView «채널» (pushChannelEnabled), apart from group chats.
test('the channel choice alone decides whether a post card notifies', async () => {
  const shown = await postShown({})
  assert.equal(shown.length, 1)
  assert.equal(shown[0]?.title, '공지 채널')
  assert.equal(shown[0]?.body, '새 글')
  assert.equal((await postShown({ notifyChannel: false })).length, 0)
  assert.equal((await postShown({ notifyGroup: false })).length, 1)
})

const dialog = (id: string, kind: DialogSummary['kind'], uids: string[]): DialogSummary => ({ id, kind, participantUids: uids } as DialogSummary)
const watcher = (chatId: string, uid: string, typing: boolean, atMs: number): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/watchers/${uid}`,
  fields: { typing: { booleanValue: typing }, typingAt: { timestampValue: { seconds: String(Math.floor(atMs / 1000)), nanos: (atMs % 1000) * 1e6 } } }
} as unknown as FirestoreDocument)

// Telegram's dialog row send actions, read from the same watcher documents the chat header reads.
test('the chat list follows the other people of its first chats and shows who types', () => {
  const names = listTypingDocumentNames([dialog('memo_me', 'direct', ['me']), dialog('s1', 'secret', ['me', 'a']), dialog('c1', 'direct', ['me', 'a']), dialog('g1', 'group', ['me', 'a', 'b'])], 'me')
  assert.deepEqual(names, [`${documents}/chats/c1/watchers/a`, `${documents}/chats/g1/watchers/a`, `${documents}/chats/g1/watchers/b`])
  const many = Array.from({ length: 40 }, (_, index) => dialog(`c${index}`, 'direct', ['me', 'p']))
  assert.equal(listTypingDocumentNames(many, 'me').length, 30)
  const now = 1_750_000_000_000
  const state = listTypingState([watcher('g1', 'a', true, now - 1000), watcher('g1', 'b', true, now - 9000), watcher('c1', 'a', false, now), watcher('c1', 'me', true, now)], 'me', now)
  assert.deepEqual(state, { g1: { until: now - 1000 + 8000, uids: ['a'] } })
})
