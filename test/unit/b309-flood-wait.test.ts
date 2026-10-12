import assert from 'node:assert/strict'
import { test } from 'node:test'
import { floodWaitDelay, NotEmitted, ProtocolFailure, ServerRejection } from '../../src/main/network/contracts'
import { SocketMessageTransport } from '../../src/main/network/socket-transport'

// B309 (contracts/B309-flood-wait.md; tdesktop mtp_instance.cpp:1585-1640): talky's FLOOD_WAIT is never a failure — the
// same request goes again after the wait it names, plus 10 ms, and the caller only sees the answer that follows.
test('how long a FLOOD_WAIT answer says to wait', () => {
  assert.equal(floodWaitDelay({ ok: false, error: 'FLOOD_WAIT', reason: 'FLOOD_WAIT', retryAfterMs: 1500 }), 1510)
  assert.equal(floodWaitDelay({ ok: false, reason: 'FLOOD_WAIT', retryAfterMs: 0 }), 1010, 'no usable wait: a second')
  assert.equal(floodWaitDelay({ ok: false, error: 'FLOOD_WAIT', retryAfterMs: 'soon' }), 1010)
  assert.equal(floodWaitDelay({ ok: false, error: 'FLOOD_WAIT', retryAfterMs: 1e12 }), 86_400_010, 'never past a day')
  assert.equal(floodWaitDelay({ ok: false, error: 'BLOCKED' }), null)
  assert.equal(floodWaitDelay({ ok: true }), null)
  assert.equal(floodWaitDelay(null), null)
})

function rig(answers: unknown[]) {
  const transport = new SocketMessageTransport('1.0.0', {} as never)
  const sent: { event: string; payload: unknown }[] = []
  const socket = { connected: true, io: { engine: { transport: { writable: true } } },
    volatile: { timeout: () => ({ emitWithAck: async (event: string, payload: unknown) => { sent.push({ event, payload }); return answers.shift() } }) } }
  Object.assign(transport as unknown as Record<string, unknown>, { socket, currentState: 'ready', credentials: { uid: 'me' } })
  return { transport, sent, socket }
}
const wire = { id: 'm1', chatId: 'c1', senderId: 'me', type: 'text', text: 'hi', isSilent: false, isEncrypted: false, protocolVersion: 3 } as never
const ack = { ok: true, persistedByServer: true, serverOwnedMessage: true, id: 'm1', chatId: 'c1', senderId: 'me', createdAt: 1, alreadyExisted: false }
const flood = { ok: false, error: 'FLOOD_WAIT', reason: 'FLOOD_WAIT', retryAfterMs: 20 }

test('a send told to wait goes again, the same message, and is answered — not failed', async () => {
  const { transport, sent } = rig([flood, flood, ack])
  const answer = await transport.send(wire, new AbortController().signal)
  assert.equal(answer.id, 'm1')
  assert.deepEqual(sent.map(item => item.event), ['sendMessage', 'sendMessage', 'sendMessage'])
  assert.ok(sent.every(item => item.payload === wire), 'the same payload, the same id')
})

test('a read and a reaction told to wait go again too', async () => {
  const read = rig([flood, { ok: true, persistedByServer: true, chatId: 'c1', readerId: 'me', alreadyExisted: false, lastReadAt: 5, unreadCount: 0, messageId: 'm5' }])
  const cursor = await read.transport.markRead('c1', 'me', { seconds: 0, nanoseconds: 5_000_000, id: 'm5' }, new AbortController().signal)
  assert.equal(cursor.cursor.id, 'm5'); assert.equal(read.sent.length, 2)
  const reaction = rig([flood, { ok: true }])
  Object.assign(reaction.transport as unknown as Record<string, unknown>, { capabilities: ['message-reactions'] })
  assert.deepEqual(await reaction.transport.setReaction({ chatId: 'c1' }, new AbortController().signal), { ok: true })
  assert.equal(reaction.sent.length, 2)
})

test('any other refusal is the caller\'s as before; giving up or losing the connection while waiting ends it', async () => {
  await assert.rejects(rig([{ ok: false, error: 'BLOCKED' }]).transport.send(wire, new AbortController().signal), ServerRejection)
  const stop = new AbortController(), aborted = rig([{ ...flood, retryAfterMs: 5000 }])
  const pending = aborted.transport.send(wire, stop.signal)
  setTimeout(() => stop.abort(), 10)
  await assert.rejects(pending, ProtocolFailure)
  const lost = rig([flood, ack])
  const waiting = lost.transport.send(wire, new AbortController().signal)
  setTimeout(() => { lost.socket.connected = false }, 5)
  await assert.rejects(waiting, NotEmitted, 'a FLOOD_WAIT applied nothing: the queue sends it again as one that never went')
  assert.equal(lost.sent.length, 1)
})
