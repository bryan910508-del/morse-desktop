import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { defaultReactionSettings, ReactionNotices, ReactionNotifications, reactionNoticesEnabled, reactionSettingsOf, type ReactionHint, type ReactionSettings } from '../../src/main/messaging/reaction-notifications'
import type { NotificationContent, NotificationHost } from '../../src/main/messaging/notifications'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { defaultPreferences, type Preferences } from '../../src/shared/model'

// B545 (contracts/B545-reaction-push.md §9, reports/desktop/2026-11-04-b545-desktop.md §6): a reaction to my message is
// announced from the room's unseen reaction, filtered as the server's push is (§3), worded as its text (§2), with its
// sound (A2), once an hour for the same person and message (tdesktop kReactionNotificationEach), and taken back when it
// is seen elsewhere, its message goes, or a new read covers it — never by looking at a stored read position again (§6).
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)) }
const unseen = (version = 1, actorUid = 'peer') => ({ messageId: 'm1', emoji: '👍', reactionVersion: version, actorUid })
const room = (patch: Record<string, unknown> = {}, read = { at: 1750000300_000, id: 'zz' }) => ({ summary: { id: 'c1', version: '1:0', kind: 'direct', title: '친구 방',
  participantUids: ['me', 'peer'], preview: '', unreadCount: 0, markedUnread: false, readPositions: { me: read }, readSync: { status: 'ready' },
  pinned: false, pinVersion: '', muted: false, archived: false, top: null, unseenReaction: unseen(), ...patch }, cutoff: null, participantNames: { me: '나', peer: '친구' }, accountUid: 'me' }) as unknown as ReadDialog
const name = `${documents}/chats/c1/messages/m1`
const message = (patch: Record<string, unknown> = {}, reactors = ['peer']): FirestoreDocument => ({ name, updateTime: { seconds: '2', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: '1750000200', nanos: 0 } }, senderId: { stringValue: 'me' }, type: { stringValue: 'text' }, text: { stringValue: '안녕' },
    reactions: { mapValue: { fields: { '👍': { arrayValue: { values: reactors.map(uid => ({ stringValue: uid })) } } } } }, ...patch } } as unknown as FirestoreDocument)
const hint = (version = 1, actorUid = 'peer'): ReactionHint => ({ chatId: 'c1', messageId: 'm1', actorUid, emoji: '👍', version })

function world(options: { doc?: FirestoreDocument | null; blocked?: boolean; contact?: boolean; settings?: Partial<ReactionSettings>; prefs?: Partial<Preferences>; dialog?: ReadDialog; foreground?: boolean } = {}) {
  const shown: NotificationContent[] = [], withdrawn: string[] = [], opened: [string, string | undefined][] = [], clicks: (() => void)[] = []
  const watches: WatchEvents[] = []
  let now = 1_800_000_000_000
  const dialogs = new Map([['c1', options.dialog ?? room()]])
  const reader = {
    query: async () => options.doc === null ? [] : [options.doc ?? message()],
    getDocument: async (path: string) => path.includes('/blocked/') ? (options.blocked ? message() : null) : path.includes('/contacts/') ? (options.contact === false ? null : message()) : null,
    watch: (_target: unknown, _signal: unknown, events: WatchEvents) => { watches.push(events); return () => {} }
  } as unknown as FirestoreReader
  const host: NotificationHost = {
    preferences: () => ({ ...defaultPreferences, showNotificationPreview: true, ...options.prefs }), locked: () => false, foreground: () => options.foreground === true, appActive: () => false,
    show: (content, click) => { shown.push(content); clicks.push(click); return () => {} }, open: (chatId, messageId) => { opened.push([chatId, messageId]) }, report: () => {},
    withdrawn: reason => { withdrawn.push(reason) }
  }
  const claimed = new Set<string>()
  const reactions = new ReactionNotifications('me', new AbortController().signal,
    () => ({ ready: true, reader, dialogs, reactions: { ...defaultReactionSettings, ...options.settings } }), host,
    async command => { if (claimed.has(command.messageId)) return false; claimed.add(command.messageId); return true }, () => now)
  return { reactions, dialogs, shown, withdrawn, opened, clicks, watches, later: (ms: number) => { now += ms } }
}

test('B545 ①: the first look at the list only remembers; a reaction that changes afterwards is announced once', () => {
  const heard: ReactionHint[] = []
  const notices = new ReactionNotices(item => heard.push(item))
  const index = new Map([['c1', room()], ['s1', room({ id: 's1', kind: 'secret' })], ['n1', room({ id: 'n1', unseenReaction: { messageId: 'm2', emoji: '👍', reactionVersion: 1 } })]])
  notices.observe(index)
  assert.equal(heard.length, 0, 'what the account already had')
  notices.observe(index)
  assert.equal(heard.length, 0, 'nothing changed')
  index.set('c1', room({ unseenReaction: unseen(2) }))
  index.set('s1', room({ id: 's1', kind: 'secret', unseenReaction: unseen(5) }))
  notices.observe(index)
  assert.deepEqual(heard, [hint(2)], 'not a secret chat, not one without who reacted')
})

test('B545 ②: filtered as the server\'s push is — each reason alone keeps it from showing', async () => {
  const cases: [string, Parameters<typeof world>[0], ReactionHint?][] = [
    ['own reaction', {}, hint(1, 'me')],
    ['left the room', { dialog: room({ participantUids: ['peer', 'x'] }) }],
    ['not my message', { doc: message({ senderId: { stringValue: 'peer' } }) }],
    ['message gone', { doc: null }],
    ['blocked', { blocked: true }],
    ['nobody', { settings: { messages: 'nobody' } }],
    ['contacts, not a contact', { contact: false }],
    ['muted room', { dialog: room({ muted: true }) }],
    ['secret chat', { dialog: room({ kind: 'secret' }) }],
    ['reaction taken back', { doc: message({}, ['x']) }],
    ['seen here (no unseen reaction left)', { dialog: room({ unseenReaction: undefined }) }],
    ['room on screen', { foreground: true }],
  ]
  for (const [label, options, item] of cases) {
    const { reactions, shown } = world(options)
    reactions.receive(item ?? hint()); await tick()
    assert.equal(shown.length, 0, label)
    reactions.close()
  }
  const everyone = world({ contact: false, settings: { messages: 'everyone' } })
  everyone.reactions.receive(hint()); await tick()
  assert.equal(everyone.shown.length, 1, 'everyone: a stranger\'s reaction shows')
  everyone.reactions.close()
})

test('B545 ③: the same person on the same message shows once an hour; a new hour shows it again', async () => {
  const { reactions, shown, dialogs, later } = world()
  reactions.receive(hint(1)); await tick()
  dialogs.set('c1', room({ unseenReaction: unseen(2) }))
  reactions.receive(hint(2)); await tick()
  assert.equal(shown.length, 1)
  later(60 * 60 * 1000)
  dialogs.set('c1', room({ unseenReaction: unseen(3) }))
  reactions.receive(hint(3)); await tick()
  assert.equal(shown.length, 2)
  reactions.close()
})

test('B545 ④: the words are the server\'s — who, with what, on which message — or only «새 반응»', async () => {
  const shownWith = async (options: Parameters<typeof world>[0]) => { const w = world(options); w.reactions.receive(hint()); await tick(); w.reactions.close(); return w.shown[0] }
  assert.deepEqual(await shownWith({}), { chatId: 'c1', title: '친구 방', body: '친구님이 👍 반응: “안녕”', silent: false })
  const hidden = { chatId: 'c1', title: 'Morse', body: '새 반응', silent: false }
  assert.deepEqual(await shownWith({ prefs: { showNotificationPreview: false } }), hidden, 'previews off')
  assert.deepEqual(await shownWith({ settings: { showSender: false } }), hidden, 'the sender not to be shown')
  const nameless = room(); (nameless as { participantNames: Record<string, string> }).participantNames = { me: '나' }
  assert.deepEqual(await shownWith({ dialog: nameless }), hidden, 'no name for who reacted')
  assert.deepEqual(await shownWith({ doc: message({ text: { stringValue: '' }, type: { stringValue: 'image' } }) }), { chatId: 'c1', title: '친구 방', body: '친구님이 👍 반응: “사진”', silent: false }, 'a picture by its kind')
})

test('B545 ⑤: the sound is the reaction setting\'s, or the notifications\' when none is written', async () => {
  const silentWith = async (options: Parameters<typeof world>[0]) => { const w = world(options); w.reactions.receive(hint()); await tick(); w.reactions.close(); return w.shown[0]?.silent }
  assert.equal(await silentWith({ settings: { sound: 'none' } }), true)
  assert.equal(await silentWith({ settings: { sound: 'default' }, prefs: { notificationSound: false } }), false)
  assert.equal(await silentWith({ prefs: { notificationSound: false } }), true)
  assert.equal(await silentWith({}), false)
})

test('B545 ⑥: seen on another device, the message gone or the room gone, it is taken back', async () => {
  const seen = world()
  seen.reactions.receive(hint()); await tick()
  seen.dialogs.set('c1', room({ unseenReaction: undefined }))
  seen.reactions.resume('list')
  assert.deepEqual(seen.withdrawn, ['reaction:resume:list:reaction-seen'])
  const gone = world()
  gone.reactions.receive(hint()); await tick()
  gone.watches[0]!.snapshot(new Map())
  assert.deepEqual(gone.withdrawn, ['reaction:watch:gone'])
  const back = world()
  back.reactions.receive(hint()); await tick()
  back.watches[0]!.snapshot(new Map([[name, message({}, ['x'])]]))
  assert.deepEqual(back.withdrawn, ['reaction:watch:taken-back'])
  const left = world()
  left.reactions.receive(hint()); await tick()
  left.dialogs.delete('c1'); left.reactions.resume('list')
  assert.deepEqual(left.withdrawn, ['reaction:resume:list:no-dialog'])
  for (const w of [seen, gone, back, left]) w.reactions.close()
})

test('B545 ⑦: only a new read takes it back — looking at the stored read position again does not', async () => {
  const { reactions, dialogs, withdrawn } = world()
  reactions.receive(hint()); await tick()
  reactions.resume('focus'); reactions.resume('preferences'); reactions.resume('list')
  assert.deepEqual(withdrawn, [], 'the room was read past my old message long ago')
  dialogs.set('c1', room({}, { at: 1750000400_000, id: 'zz' }))
  reactions.resume('list')
  assert.deepEqual(withdrawn, ['reaction:resume:list:read'], 'read further on another device')
  reactions.close()
  const here = world()
  here.reactions.receive(hint()); await tick()
  here.reactions.observed('c1', { seconds: 1750000250, nanoseconds: 0, id: 'm9' })
  assert.deepEqual(here.withdrawn, ['reaction:read-here'])
  here.reactions.close()
})

test('B545 ⑧: a click opens the room at that message', async () => {
  const { reactions, clicks, opened, withdrawn } = world()
  reactions.receive(hint()); await tick()
  clicks[0]!()
  assert.deepEqual(opened, [['c1', 'm1']])
  assert.deepEqual(withdrawn, ['clicked'])
  reactions.close()
})

test('B545 ⑨: the settings read as written, and as contacts · shown · the chat\'s sound when nothing is', () => {
  assert.deepEqual(reactionSettingsOf(undefined), { messages: 'contacts', stories: 'contacts', showSender: true, sound: null })
  const doc = { name: 'x', fields: { reactions: { mapValue: { fields: { messages: { stringValue: 'everyone' }, showSender: { booleanValue: false }, sound: { stringValue: 'none' } } } } } } as unknown as FirestoreDocument
  assert.deepEqual(reactionSettingsOf(doc), { messages: 'everyone', stories: 'contacts', showSender: false, sound: 'none' })
  const odd = { name: 'x', fields: { reactions: { mapValue: { fields: { messages: { stringValue: 'all' }, sound: { stringValue: 'loud' } } } } } } as unknown as FirestoreDocument
  assert.deepEqual(reactionSettingsOf(odd), { messages: 'contacts', stories: 'contacts', showSender: true, sound: null })
})

test('B545 ⑩: on in this build — the session makes reaction notices and watches the settings only through the switch', () => {
  assert.equal(reactionNoticesEnabled, true)
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /const reactions = reactionNoticesEnabled \? new ReactionNotifications\(/)
  assert.match(session, /if \(this\.reactionNotices\) \{ this\.watchReactionSettings\(\); this\.reactionNotices\.observe\(index\) \}/)
})
