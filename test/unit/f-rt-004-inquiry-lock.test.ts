import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { EventReminders } from '../../src/main/accounts/event-reminders'
import { InquiryNotifications, type InquiryNotice } from '../../src/main/accounts/inquiry-notifications'
import { InquiryRows } from '../../src/main/accounts/inquiry-rows'
import type { ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import type { NotificationContent } from '../../src/main/messaging/notifications'
import { defaultPreferences, type Preferences } from '../../src/shared/model'

// F-RT-004 (tdesktop Manager::getNotificationOptions, window/notifications_manager.cpp:1084-1088), for inquiry rooms as for
// chats: a banner is dropped only while the app closes or the computer sleeps, shows without its words under the app's own
// lock, and a locked screen or a person away from the computer no longer loses it. Before, every lock dropped it and the
// rooms were not even listened to.
const room = (value: Partial<InquiryNotice> = {}): InquiryNotice =>
  ({ inquiryId: 'ch1_sub1', channelId: 'ch1', title: '민지', preview: '안녕하세요', at: 1_000, unread: 1, fromMe: false, ...value })
function host(state: { locked?: boolean; dropped?: boolean; hidden?: boolean }) {
  const shown: NotificationContent[] = [], closed: string[] = []
  return { shown, closed, state, host: {
    preferences: (): Preferences => ({ ...defaultPreferences, showNotificationPreview: true }),
    locked: () => state.locked === true, dropped: () => state.dropped === true, hidden: () => state.hidden === true,
    appActive: () => false, foreground: () => false,
    show: (content: NotificationContent) => { shown.push(content); return () => closed.push(content.chatId) },
    open: () => {}
  } }
}
const arrive = (notifications: InquiryNotifications, at: number) => notifications.observe([room({ at })])

test('F-RT-004: under the app lock an inquiry message still makes a banner, without its words', () => {
  const { shown, host: target } = host({ locked: true, hidden: true })
  const notifications = new InquiryNotifications(target, () => 1_000)
  arrive(notifications, 1_000); arrive(notifications, 2_000)
  assert.deepEqual(shown.map(item => [item.title, item.body]), [['Morse', '새 메시지가 도착했습니다.']])
})

test('F-RT-004: a locked screen or a person away still sees the banner as it is; asleep or closing, none', () => {
  const away = host({ locked: true })
  const shown = new InquiryNotifications(away.host, () => 1_000)
  arrive(shown, 1_000); arrive(shown, 2_000)
  assert.deepEqual(away.shown.map(item => item.title), ['민지'])
  const asleep = host({ locked: true, dropped: true })
  const none = new InquiryNotifications(asleep.host, () => 1_000)
  arrive(none, 1_000); arrive(none, 2_000)
  assert.equal(asleep.shown.length, 0)
})

test('F-RT-004: the app locking takes away a banner that showed its words, and only that one', () => {
  const target = host({})
  const notifications = new InquiryNotifications(target.host, () => 1_000)
  notifications.observe([room({ inquiryId: 'a', at: 1_000 }), room({ inquiryId: 'b', at: 1_000 })])
  notifications.observe([room({ inquiryId: 'a', at: 2_000 }), room({ inquiryId: 'b', at: 1_000 })])
  target.state.hidden = true
  notifications.observe([room({ inquiryId: 'a', at: 2_000 }), room({ inquiryId: 'b', at: 3_000 })])
  notifications.lockChanged()
  assert.deepEqual(target.closed, ['a'], 'the detailed one goes; the hidden one made under the lock stays')
  notifications.lockChanged()
  assert.deepEqual(target.closed, ['a'])
})

test('F-RT-004: the rooms are listened to under a lock, and none is shown until the unlock', () => {
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'c', expiresAt: Date.now() + 3600000 }) } as ReadCredentials
  const watches: { events: WatchEvents; stopped: boolean }[] = []
  const list = new InquiryRows('me', auth, () => {}, () => {})
  const fake = { close: () => {}, watch: (_t: unknown, _s: unknown, events: WatchEvents) => { const watch = { events, stopped: false }; watches.push(watch); return () => { watch.stopped = true } } }
  const give = () => { (list as unknown as { reader: unknown }).reader = fake }
  give(); list.resume()
  assert.equal(watches.length, 2)
  list.setLocked(true)
  assert.deepEqual(watches.map(watch => watch.stopped), [false, false], 'still listening')
  assert.deepEqual(list.snapshot(), [], 'nothing on screen')
  list.pause(); give(); list.resume()
  assert.equal(watches.filter(watch => !watch.stopped).length, 2, 'a list that starts again under the lock listens too')
  list.setLocked(false)
  assert.equal(watches.filter(watch => !watch.stopped).length, 2, 'unlocking does not start it twice')
  list.close()
})

test('F-RT-004: a room that changes under a lock still reaches the banner (Phase1 11-05: notices() was empty while locked)', () => {
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'c', expiresAt: Date.now() + 3600000 }) } as ReadCredentials
  const watches: WatchEvents[] = [], noticed: InquiryNotice[][] = []
  const list = new InquiryRows('me', auth, () => {}, () => {}, rooms => noticed.push(rooms))
  ;(list as unknown as { reader: unknown }).reader = { close: () => {}, watch: (_t: unknown, _s: unknown, events: WatchEvents) => { watches.push(events); return () => {} } }
  list.resume()
  list.setLocked(true)
  const name = 'projects/talky-a38c3/databases/(default)/documents/channelInquiries/ch1_me'
  const doc = { name, fields: { channelId: { stringValue: 'ch1' }, subscriberId: { stringValue: 'me' }, channelOwnerId: { stringValue: 'owner' },
    channelName: { stringValue: '채널' }, lastMessage: { stringValue: 'b521 1' }, lastSenderId: { stringValue: 'owner' },
    lastMessageAt: { timestampValue: '2026-11-05T00:00:00Z' }, unreadForSubscriber: { integerValue: '1' } } }
  watches[0]!.snapshot!(new Map([[name, doc as never]]))
  assert.deepEqual(noticed.at(-1)?.map(room => [room.inquiryId, room.unread, room.fromMe]), [['ch1_me', 1, false]], 'the locked list tells the banner')
  assert.deepEqual(list.snapshot(), [], 'and still shows nothing')
  list.close()
})

// Event reminders («일정 알림», EventReminders) follow the same rule: held back only asleep or closing, shown without the
// event's words under the app's lock, shown as they are on a locked screen.
async function fire(state: { locked?: boolean; dropped?: boolean; hidden?: boolean }) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  try {
    const shown: NotificationContent[] = []
    const reminders = new EventReminders((async () => []) as never, { locked: () => state.locked === true, dropped: () => state.dropped === true,
      hidden: () => state.hidden === true, show: content => { shown.push(content); return () => {} }, open: () => {} })
    await reminders.add({ id: 'r1', chatId: 'c1', title: '회의', eventStart: 1_100_000, fireAt: 1_010_000 })
    mock.timers.tick(10_000)
    reminders.close()
    return shown
  } finally { mock.timers.reset() }
}
test('F-RT-004: an event reminder under the app lock shows without the event, and as it is on a locked screen', async () => {
  assert.deepEqual((await fire({ locked: true, hidden: true })).map(item => [item.title, item.body]), [['Morse', '일정 알림']])
  const screen = await fire({ locked: true })
  assert.equal(screen.length, 1); assert.equal(screen[0]!.title, '일정 알림'); assert.match(screen[0]!.body, /회의/)
  assert.equal((await fire({ locked: true, dropped: true })).length, 0, 'asleep: held back, looked at again shortly')
})
