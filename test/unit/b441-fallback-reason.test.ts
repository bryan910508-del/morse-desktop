import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { SocketMessageTransport } from '../../src/main/network/socket-transport'
import { NotEmitted, ProtocolFailure, SocketUnanswered } from '../../src/main/network/contracts'
import { fallbackReason, markReadWithFallback, sendWithFallback, type CallablePath, type SocketPath } from '../../src/main/messaging/send-fallback'
import type { SendAcknowledgement, SendWire, TextSendWire } from '../../src/shared/model'

// B441 (reports/server/2026-10-16-b441-fallback-reason.md §2): the callable that carries a send or a read in the socket's
// place says why — `not-registered`, `ack-timeout`, `disconnected` or `other` (server morse-send-fallback.js
// FALLBACK_REASONS) — so the server's reading can tell the three apart. The socket's own body does not carry it.
const wire: TextSendWire = { id: 'm1', chatId: 'chat1', senderId: 'me', type: 'text', text: '1', isSilent: false, isEncrypted: false, protocolVersion: 3 }
const accepted = { ok: true, persistedByServer: true, serverOwnedMessage: true, id: 'm1', chatId: 'chat1', senderId: 'me', createdAt: 1700000000000, alreadyExisted: true }
const read = { ok: true, persistedByServer: true, chatId: 'chat1', readerId: 'me', alreadyExisted: false, lastReadAt: 1700000000000, unreadCount: 0, messageId: 'm9' }
const signal = () => new AbortController().signal
function paths(sendable: boolean, failure: unknown) {
  const calls: { name: string; data: Record<string, unknown> }[] = []
  const path: SocketPath = {
    whenSendable: async () => sendable,
    send: async () => { throw failure },
    markRead: async () => { throw failure }
  }
  const callable: CallablePath = async (name, data) => { calls.push({ name, data }); return (name === 'sendMorseMessage' ? accepted : read) as Record<string, unknown> }
  return { path, callable, calls }
}

test('each socket failure is named as the server names it', () => {
  assert.equal(fallbackReason(new NotEmitted('x')), 'not-registered')
  assert.equal(fallbackReason(new SocketUnanswered('x', 'ack-timeout')), 'ack-timeout')
  assert.equal(fallbackReason(new SocketUnanswered('x', 'disconnected')), 'disconnected')
  assert.equal(fallbackReason(new ProtocolFailure('x')), 'other')
  assert.equal(fallbackReason(new Error('x')), 'other')
})

test('the callable carries the reason: not registered, ACK lost to a closed socket, ACK timed out', async () => {
  let net = paths(false, new Error('unused'))
  await sendWithFallback(wire, signal(), net.path, net.callable)
  assert.deepEqual(net.calls, [{ name: 'sendMorseMessage', data: { ...wire, fallbackReason: 'not-registered' } }], 'the same body and id, and why')
  net = paths(true, new SocketUnanswered('x', 'disconnected'))
  await sendWithFallback(wire, signal(), net.path, net.callable)
  assert.equal(net.calls[0]!.data.fallbackReason, 'disconnected')
  net = paths(true, new SocketUnanswered('x', 'ack-timeout'))
  await markReadWithFallback('chat1', 'me', { seconds: 1700000000, nanoseconds: 0, id: 'm9' }, signal(), net.path, net.callable)
  assert.deepEqual(net.calls[0], { name: 'markMorseRead', data: { chatId: 'chat1', messageId: 'm9', fallbackReason: 'ack-timeout' } })
})

class FakeSocket extends EventEmitter {
  connected = false
  sendBuffer: unknown[] = []
  asked: [string, unknown][] = []
  failure: Error | null = null
  io = { engine: { transport: { name: 'websocket', writable: true }, once: () => {}, _hasPingExpired: () => false } }
  connect(): this { return this }
  disconnect(): this { return this }
  get volatile(): this { return this }
  timeout(): { emitWithAck: (event: string, payload: unknown) => Promise<unknown> } {
    return { emitWithAck: async (event, payload) => { this.asked.push([event, payload]); if (this.failure) throw this.failure; return null } }
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'register') return true
    return super.emit(event, ...args)
  }
}
async function registered() {
  const sockets: FakeSocket[] = []
  const open = (() => { const socket = new FakeSocket(); sockets.push(socket); return socket }) as unknown as ConstructorParameters<typeof SocketMessageTransport>[2]
  const transport = new SocketMessageTransport('test', { state: () => {}, message: () => {}, needsReconciliation: () => {} }, open)
  transport.connect({ uid: 'me', sessionId: 's1', idToken: async () => 'a.b.c' })
  const socket = sockets.at(-1)!
  socket.connected = true; socket.emit('connect')
  await new Promise(resolve => setTimeout(resolve, 5))
  socket.emit('registered', { ok: true, uid: 'me', clientProtocolVersion: 2, capabilities: ['durable-message-ack', 'session-bound-registration'] })
  return { transport, socket }
}

test('Socket.IO\'s two unanswered errors become ack-timeout and disconnected; the socket body has no reason', async () => {
  const { transport, socket } = await registered()
  for (const [text, reason] of [['operation has timed out', 'ack-timeout'], ['socket has been disconnected', 'disconnected'], ['something else', 'other']] as const) {
    socket.failure = new Error(text)
    await assert.rejects(transport.send(wire as SendWire, signal()), (error: unknown) => error instanceof SocketUnanswered && error.reason === reason)
  }
  assert.equal((socket.asked.find(([event]) => event === 'sendMessage')![1] as Record<string, unknown>).fallbackReason, undefined)
  transport.stop()
  // The installed socket.io-client still words them so (4.8 socket.js); a version that does not fails here.
  const library = readFileSync('node_modules/socket.io-client/build/cjs/socket.js', 'utf8')
  assert.match(library, /new Error\("operation has timed out"\)/)
  assert.match(library, /new Error\("socket has been disconnected"\)/)
})
