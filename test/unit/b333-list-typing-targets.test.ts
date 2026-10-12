import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DialogTyping, type TypingReader } from '../../src/main/accounts/chat-typing'
import { documents, ReadFailure, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { WatchEvents } from '../../src/main/network/firestore-rpc'
import type { DialogSummary } from '../../src/shared/model'

// B333: the chat list's «typing…» listens to each room as its own target on one stream (B277 ②). A room the server
// refuses ends alone; a new order of the list listens to nothing again; a room that leaves the list stops at once.
const dialog = (id: string, kind: DialogSummary['kind'], uids: string[]): DialogSummary => ({ id, kind, participantUids: uids } as DialogSummary)
const watcher = (chatId: string, uid: string, atMs: number): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/watchers/${uid}`,
  fields: { typing: { booleanValue: true }, typingAt: { timestampValue: { seconds: String(Math.floor(atMs / 1000)), nanos: 0 } } }
} as unknown as FirestoreDocument)

function harness() {
  const log: string[] = []
  const live = new Map<string, { wire: WireObject; events: WatchEvents; max: number }>()
  let opened = 0
  const listen = {
    add: (wire: WireObject, events: WatchEvents, max: number) => {
      const room = JSON.stringify(wire).match(/chats\/([^/"]+)/)![1]!
      const entry = { wire, events, max }
      log.push(`add ${room}`); live.set(room, entry)
      return () => { log.push(`remove ${room}`); if (live.get(room) === entry) live.delete(room) }
    },
    close: () => { log.push('close'); live.clear() }
  }
  const reader: TypingReader = { listenTargets: () => { opened++; return listen } }
  let changes = 0, refused = 0
  const typing = new DialogTyping('me', new AbortController().signal, () => { changes++ }, () => { refused++ })
  return { typing, reader, log, live, opened: () => opened, changes: () => changes, refused: () => refused }
}

test('every room is its own target: a 1:1 room its other person, a group its watchers', () => {
  const { typing, reader, log, live, opened } = harness()
  typing.bind([dialog('c1', 'direct', ['me', 'a']), dialog('g1', 'group', ['me', 'a', 'b'])], reader)
  assert.equal(opened(), 1, 'one stream for every room')
  assert.deepEqual(log, ['add c1', 'add g1'])
  assert.deepEqual(live.get('c1')!.wire, { documents: { documents: [`${documents}/chats/c1/watchers/a`] } })
  assert.equal(live.get('c1')!.max, 1)
  assert.equal((live.get('g1')!.wire.query as { parent: string }).parent, `${documents}/chats/g1`)
  assert.equal(live.get('g1')!.max, 500)
})

test('a new order of the same rooms listens to nothing again', () => {
  const { typing, reader, log } = harness()
  typing.bind([dialog('c1', 'direct', ['me', 'a']), dialog('c2', 'direct', ['me', 'b'])], reader)
  log.length = 0
  typing.bind([dialog('c2', 'direct', ['me', 'b']), dialog('c1', 'direct', ['me', 'a'])], reader)
  assert.deepEqual(log, [])
})

test('a room that leaves the list stops at once and takes its «typing…» with it', () => {
  const { typing, reader, log, live, changes } = harness()
  const now = Date.now()
  typing.bind([dialog('c1', 'direct', ['me', 'a']), dialog('c2', 'direct', ['me', 'b'])], reader)
  live.get('c1')!.events.snapshot(new Map([[watcher('c1', 'a', now).name, watcher('c1', 'a', now)]]))
  assert.deepEqual(Object.keys(typing.snapshot(now)), ['c1'])
  log.length = 0
  const before = changes()
  typing.bind([dialog('c2', 'direct', ['me', 'b'])], reader)
  assert.deepEqual(log, ['remove c1'])
  assert.deepEqual(typing.snapshot(now), {})
  assert.equal(changes(), before + 1)
})

test('a room the server refuses ends alone, and the same list does not ask for it again', () => {
  const { typing, reader, log, live, refused } = harness()
  const now = Date.now()
  const list = [dialog('c1', 'direct', ['me', 'a']), dialog('c2', 'direct', ['me', 'b'])]
  typing.bind(list, reader)
  const c2 = live.get('c2')!
  c2.events.snapshot(new Map([[watcher('c2', 'b', now).name, watcher('c2', 'b', now)]]))
  live.get('c1')!.events.state('error', new ReadFailure('permission'))
  assert.equal(refused(), 1)
  assert.deepEqual(Object.keys(typing.snapshot(now)), ['c2'], 'the other room goes on')
  assert.equal(typing.size, 1)
  log.length = 0
  typing.bind(list, reader)
  typing.bind([...list].reverse(), reader)
  assert.deepEqual(log, [])
})

test('a refused room is listened again once its members change, or once it leaves the list and comes back', () => {
  const { typing, reader, log, live } = harness()
  typing.bind([dialog('g1', 'group', ['me', 'a', 'b'])], reader)
  live.get('g1')!.events.state('error', new ReadFailure('permission'))
  log.length = 0
  typing.bind([dialog('g1', 'group', ['me', 'a', 'c'])], reader)
  assert.deepEqual(log, ['add g1'])
  live.get('g1')!.events.state('error', new ReadFailure('permission'))
  log.length = 0
  typing.bind([], reader)
  typing.bind([dialog('g1', 'group', ['me', 'a', 'c'])], reader)
  assert.deepEqual(log, ['add g1'])
})

test('secret chats, the memo, rooms without me, large groups and rooms past the first thirty are not listened', () => {
  const { typing, reader, live } = harness()
  const big = dialog('big', 'group', ['me', ...Array.from({ length: 101 }, (_, index) => `u${index}`)])
  const many = Array.from({ length: 40 }, (_, index) => dialog(`c${index}`, 'direct', ['me', `p${index}`]))
  typing.bind([dialog('memo_me', 'direct', ['me']), dialog('s1', 'secret', ['me', 'a']), dialog('x1', 'direct', ['a', 'b']), big, ...many], reader)
  assert.equal(live.size, 30)
  for (const id of ['memo_me', 's1', 'x1', 'big', 'c30']) assert.ok(!live.has(id), id)
})

test('a lock, a sign-out or a new reader stops every room and forgets which ended', () => {
  const { typing, reader, log, live } = harness()
  const list = [dialog('c1', 'direct', ['me', 'a']), dialog('c2', 'direct', ['me', 'b'])]
  typing.bind(list, reader)
  live.get('c1')!.events.state('error', new ReadFailure('permission'))
  log.length = 0
  typing.bind([], null)
  assert.deepEqual(log, ['remove c2', 'close'])
  log.length = 0
  typing.bind(list, reader)
  assert.deepEqual(log, ['add c1', 'add c2'])
  log.length = 0
  typing.clear()
  assert.deepEqual(log, ['remove c1', 'remove c2', 'close'])
  assert.equal(typing.size, 0)
})
