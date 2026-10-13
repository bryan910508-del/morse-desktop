import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import { PinnedMessages } from '../../src/main/accounts/pinned-messages'
import { ReplyDraft } from '../../src/main/accounts/reply-draft'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { vanishedFromHistory } from '../../src/shared/message-deletion'
import type { ReplyDraftCommand } from '../../src/main/storage/reply-draft-table'
import type { HistorySnapshot } from '../../src/shared/model'

// B354 (reports/desktop/2026-10-13-b354-plan.md, review 10-13 23:3x): a message deleted for me is a deleted message
// here — tdesktop removeDependencyMessage → HistoryMessageReply::clearData (data_session.cpp:3407-3437,
// history_item_components.cpp:659-703) draws «Deleted message» (history_view_reply.cpp:715-725); the pinned index drops
// it (history_item.cpp:3231-3243); a reply or edit of it ends (history_widget.cpp:8358-8366). v7.3.1 6fed91ff.
const chatId = 'chat1', me = 'me', peer = 'peer'
const dialog = {
  summary: { id: chatId, version: '1:0', kind: 'direct', title: 'peer', participantUids: [me, peer], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null, pinnedForAll: ['p2'] },
  cutoff: null, participantNames: { [me]: 'me', [peer]: 'peer' }, accountUid: me
} as unknown as ReadDialog
const doc = (id: string, index: number, extra: Record<string, unknown> = {}): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/${id}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(1_750_000_000 + index * 60), nanos: 0 } }, senderId: { stringValue: peer }, text: { stringValue: id }, type: { stringValue: 'text' }, status: { stringValue: 'sent' }, ...extra }
} as unknown as FirestoreDocument)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function reader(rows: FirestoreDocument[]) {
  const watches: WatchEvents[] = []
  return { watches, reader: { watch: (_t: unknown, _s: AbortSignal, events: WatchEvents) => { watches.push(events); queueMicrotask(() => { events.snapshot(new Map(rows.map(row => [row.name, row]))); events.state('ready') }); return () => {} },
    query: async () => rows } as unknown as FirestoreReader }
}

test('a reply to a message deleted for me quotes a deleted message and goes nowhere; another device\'s hide changes it at once', async () => {
  const gone = new Set<string>()
  const rows = [doc('o1', 1), doc('r1', 2, { replyToId: { stringValue: 'o1' } })]
  const { reader: fake } = reader(rows)
  let last: HistorySnapshot | null = null, revision = 0
  const history = new HistoryReader(dialog, fake, snapshot => { last = snapshot }, () => ++revision, id => gone.has(id))
  history.start(); await tick(); await tick()
  const reply = () => last!.messages.find(message => message.id === 'r1')!
  assert.equal(reply().reply?.state, 'ready')
  assert.ok(history.replyTarget('r1', reply().version!))
  gone.add('o1'); history.hiddenChanged()
  assert.deepEqual([last!.messages.map(message => message.id), reply().reply], [['r1'], { state: 'unavailable' }], 'drawn «삭제된 메시지»')
  assert.equal(history.replyTarget('r1', reply().version!), null)
})

test('a pin deleted for me leaves the bar, which shows the next one', async () => {
  const gone = new Set<string>()
  const { reader: fake } = reader([doc('p1', 1), doc('p2', 2)])
  const pins = new PinnedMessages(new AbortController().signal, (async (command: { kind: string }) => command.kind === 'bookmarks-read' ? ['p1'] : null) as never, () => {}, (_chat, id) => gone.has(id))
  pins.bind(dialog, fake); await tick(); await tick()
  assert.deepEqual(pins.snapshot(chatId, 10)!.items.map(item => [item.id, item.status]), [['p1', 'ready'], ['p2', 'ready']])
  gone.add('p1')
  assert.deepEqual(pins.snapshot(chatId, 10)!.items.map(item => item.id), ['p2'])
  assert.equal(pins.count(chatId), 1)
  gone.add('p2')
  assert.equal(pins.count(chatId), 0, 'no bar')
})

test('the reply being written goes when its original is deleted for me, or deleted', async () => {
  const commands: ReplyDraftCommand[] = []
  let selection: { selectionId: string; messageId: string } | null = { selectionId: 's1', messageId: 'o1' }
  const store = (async (command: ReplyDraftCommand) => { commands.push(command); if (command.kind === 'reply-clear') selection = null; return command.kind === 'reply-draft' ? selection : null }) as never
  const gone = new Set<string>()
  let events!: WatchEvents
  const fake = { watch: (_t: unknown, _s: AbortSignal, e: WatchEvents) => { events = e; queueMicrotask(() => { e.snapshot(new Map([[doc('o1', 1).name, doc('o1', 1)]])); e.state('ready') }); return () => {} }, query: async () => [] } as unknown as FirestoreReader
  const draft = new ReplyDraft(new AbortController().signal, store, () => {}, (_chat, id) => gone.has(id))
  draft.bind(dialog, fake); await tick(); await tick()
  assert.equal(draft.snapshot(chatId).status, 'ready')
  gone.add('o1'); draft.hiddenChanged(); await tick(); await tick()
  assert.ok(commands.some(command => command.kind === 'reply-clear'), 'cancelled (HistoryWidget::itemRemoved → cancelReply)')
  assert.equal(draft.snapshot(chatId).selection, null)
  // Deleted for everyone while answered: the original's document goes.
  selection = { selectionId: 's2', messageId: 'o1' }; gone.clear(); commands.length = 0
  await draft.refresh(chatId); await tick(); await tick()
  assert.equal(draft.snapshot(chatId).status, 'ready')
  events.snapshot(new Map()); await tick(); await tick()
  assert.ok(commands.some(command => command.kind === 'reply-clear'))
})

test('an edit ends when its message leaves the history it is still covered by; a message only scrolled away has not left', () => {
  const at = (seconds: number) => ({ seconds, nanoseconds: 0, id: `m${seconds}` })
  const window = (ids: number[], newerAvailable = false) => ({ messages: ids.map(n => ({ id: `m${n}`, position: at(n) })), newerAvailable })
  assert.equal(vanishedFromHistory({ id: 'm2', position: at(2) }, window([1, 3])), true, 'gone from between')
  assert.equal(vanishedFromHistory({ id: 'm4', position: at(4) }, window([1, 3])), true, 'the newest, gone')
  assert.equal(vanishedFromHistory({ id: 'm4', position: at(4) }, window([1, 3], true)), false, 'past a window with newer pages')
  assert.equal(vanishedFromHistory({ id: 'm0', position: at(0) }, window([1, 3])), false, 'scrolled out above')
  assert.equal(vanishedFromHistory({ id: 'm2', position: at(2) }, window([1, 2, 3])), false)
  assert.equal(vanishedFromHistory({ id: 'm2', position: at(2) }, window([])), false)
})
