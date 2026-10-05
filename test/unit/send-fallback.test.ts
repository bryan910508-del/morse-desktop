import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotEmitted, ProtocolFailure, ServerRejection } from '../../src/main/network/contracts'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { SocketMessageTransport } from '../../src/main/network/socket-transport'
import { markReadWithFallback, sendWithFallback, socketWaitMs, type CallablePath, type SocketPath } from '../../src/main/messaging/send-fallback'
import type { MessagePosition, SendAcknowledgement, TextSendWire } from '../../src/shared/model'

// A15 (contracts/A15-send-fallback.md §3.2-3.3, inbox B95 — in Russia the message server's socket does not carry): a
// message goes over the socket when it can, and otherwise under the same id through `sendMorseMessage`, whose answer is
// the socket's acknowledgement and is read the same way. Reads take `markMorseRead` by the same rule.
const wire: TextSendWire = { id: 'm1', chatId: 'chat1', senderId: 'me', type: 'text', text: '1', isSilent: false, isEncrypted: false, protocolVersion: 3 }
const accepted = (alreadyExisted = false) => ({ ok: true, persistedByServer: true, serverOwnedMessage: true, id: 'm1', chatId: 'chat1', senderId: 'me', createdAt: 1700000000000, alreadyExisted })
const ack: SendAcknowledgement = { id: 'm1', chatId: 'chat1', senderId: 'me', createdAt: 1700000000000, alreadyExisted: false }

function paths(socket: Partial<SocketPath> & { sendable?: boolean }, answer: (name: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const calls: { name: string; data: Record<string, unknown> }[] = [], waits: number[] = []
  const path: SocketPath = {
    whenSendable: async ms => { waits.push(ms); return socket.sendable ?? false },
    send: socket.send ?? (async () => { throw new Error('socket used') }),
    markRead: socket.markRead ?? (async () => { throw new Error('socket used') })
  }
  const callable: CallablePath = async (name, data) => { calls.push({ name, data }); return answer(name, data) }
  return { path, callable, calls, waits }
}
const signal = () => new AbortController().signal

test('a socket that can send carries the message and the callable is not asked', async () => {
  const { path, callable, calls } = paths({ sendable: true, send: async () => ack }, async () => { throw new Error('callable used') })
  assert.deepEqual(await sendWithFallback(wire, signal(), path, callable), ack)
  assert.equal(calls.length, 0)
})

test('a socket that cannot send within five seconds: the same message goes through sendMorseMessage', async () => {
  const { path, callable, calls, waits } = paths({ sendable: false }, async () => accepted())
  assert.equal(socketWaitMs, 5000)
  assert.deepEqual(await sendWithFallback(wire, signal(), path, callable), ack)
  assert.deepEqual(waits, [5000])
  assert.deepEqual(calls, [{ name: 'sendMorseMessage', data: { ...wire } }], 'the socket\'s own body, the same id')
})

test('a socket send with no answer in fifteen seconds goes again by the callable under the same id, which takes it once', async () => {
  const { path, callable, calls } = paths({ sendable: true, send: async () => { throw new Error('operation has timed out') } }, async () => accepted(true))
  const answer = await sendWithFallback(wire, signal(), path, callable)
  assert.equal(answer.id, 'm1'); assert.equal(answer.alreadyExisted, true, 'the socket\'s copy had arrived: shown once')
  assert.equal(calls[0]!.data.id, 'm1')
  const unsent = paths({ sendable: true, send: async () => { throw new NotEmitted('not writable') } }, async () => accepted())
  assert.deepEqual(await sendWithFallback(wire, signal(), unsent.path, unsent.callable), ack, 'one the socket could not emit')
})

test('a refusal is the same refusal by either path, with the pair\'s room (B88)', async () => {
  const refused = paths({ sendable: true, send: async () => { throw new ServerRejection('BLOCKED') } }, async () => { throw new Error('callable used') })
  await assert.rejects(sendWithFallback(wire, signal(), refused.path, refused.callable), (error: unknown) => error instanceof ServerRejection && error.reason === 'BLOCKED')
  assert.equal(refused.calls.length, 0, 'a socket refusal is not asked again')
  const byCallable = paths({ sendable: false }, async () => ({ ok: false, error: 'DIRECT_CHAT_EXISTS', existingChatId: 'legacy-uuid-room' }))
  await assert.rejects(sendWithFallback(wire, signal(), byCallable.path, byCallable.callable),
    (error: unknown) => error instanceof ServerRejection && error.reason === 'DIRECT_CHAT_EXISTS' && error.existingChatId === 'legacy-uuid-room')
})

test('a callable that never left goes again as unsent; any other failure is «sending, check and try again»', async () => {
  const failing = (failure: MorseCallableFailure) => paths({ sendable: false }, async () => { throw failure })
  const unsent = failing(new MorseCallableFailure('not-sent', 'UNAVAILABLE'))
  await assert.rejects(sendWithFallback(wire, signal(), unsent.path, unsent.callable), NotEmitted)
  for (const failure of [new MorseCallableFailure('unknown', 'DEADLINE_EXCEEDED'), new MorseCallableFailure('answered', 'UNAUTHENTICATED'), new MorseCallableFailure('answered', 'NOT_FOUND')]) {
    const failed = failing(failure)
    await assert.rejects(sendWithFallback(wire, signal(), failed.path, failed.callable), ProtocolFailure, failure.status)
  }
})

test('a read the socket cannot carry goes through markMorseRead and is read as the socket\'s', async () => {
  const target: MessagePosition = { seconds: 1700000000, nanoseconds: 0, id: 'm9' }
  const { path, callable, calls } = paths({ sendable: false }, async () =>
    ({ ok: true, persistedByServer: true, chatId: 'chat1', readerId: 'me', alreadyExisted: false, lastReadAt: 1700000000000, unreadCount: 0, messageId: 'm9' }))
  const answer = await markReadWithFallback('chat1', 'me', target, signal(), path, callable)
  assert.deepEqual(calls, [{ name: 'markMorseRead', data: { chatId: 'chat1', messageId: 'm9' } }])
  assert.deepEqual(answer.cursor, { at: 1700000000000, id: 'm9' })
  const bySocket = paths({ sendable: true, markRead: async () => answer }, async () => { throw new Error('callable used') })
  assert.equal(await markReadWithFallback('chat1', 'me', target, signal(), bySocket.path, bySocket.callable), answer)
})

test('a socket that never connected says it cannot send when the time is up, or when the account goes', async () => {
  const transport = new SocketMessageTransport('0.0.0', { state: () => {}, message: () => {}, needsReconciliation: () => {} })
  assert.equal(transport.sendable, false)
  assert.equal(await transport.whenSendable(20, signal()), false)
  const gone = new AbortController()
  const waiting = transport.whenSendable(60000, gone.signal)
  gone.abort()
  assert.equal(await waiting, false)
})

// Railway shows only what the socket carried; whether a run used the callable at all, and why, is noted once per run
// (connection-check.log «send-fallback»), never with an id or a word of the message.
test('the path past the socket is noted with why — not ready, or tried and failed — and nothing when the socket carried it', async () => {
  const notes: string[] = []
  const note = (detail: string) => { notes.push(detail) }
  const over = paths({ sendable: true, send: async () => ack }, async () => { throw new Error('callable used') })
  await sendWithFallback(wire, signal(), over.path, over.callable, note)
  assert.deepEqual(notes, [], 'the socket carried it')
  const down = paths({ sendable: false }, async () => accepted())
  await sendWithFallback(wire, signal(), down.path, down.callable, note)
  const dropped = paths({ sendable: true, send: async () => { throw new ProtocolFailure('no answer') } }, async () => accepted(true))
  await sendWithFallback(wire, signal(), dropped.path, dropped.callable, note)
  const refused = paths({ sendable: true, send: async () => { throw new ServerRejection('BLOCKED') } }, async () => accepted())
  await assert.rejects(sendWithFallback(wire, signal(), refused.path, refused.callable, note))
  assert.deepEqual(notes, ['send socket-not-ready', 'send socket-failed'], 'a refusal is the server\'s answer, not a path taken')
  assert.ok(notes.every(detail => !detail.includes('m1') && !detail.includes('chat1')))
})
