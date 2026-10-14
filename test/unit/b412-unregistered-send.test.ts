import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { pingExpired, SocketMessageTransport } from '../../src/main/network/socket-transport'
import { NotEmitted } from '../../src/main/network/contracts'
import type { SendWire } from '../../src/shared/model'

// B412 (Phase1 10-15 00:10–00:12, three of three before the fix): with the clock jumped past the heartbeat, a send was
// kept back by Socket.IO (engine _hasPingExpired), the connection closed («ping timeout»), and on the new connection the
// kept-back sendMessage reached the server before `register` — UNAUTHORIZED, «로그인 상태를 다시 확인해 주세요.».
class FakeSocket extends EventEmitter {
  connected = false
  expired = false
  sendBuffer: unknown[] = []
  asked: [string, unknown][] = []
  answer: unknown = null
  io = { engine: { transport: { name: 'websocket', writable: true }, once: () => {}, _hasPingExpired: () => this.expired } }
  connect(): this { return this }
  disconnect(): this { return this }
  get volatile(): this { return this }
  timeout(): { emitWithAck: (event: string, payload: unknown) => Promise<unknown> } {
    return { emitWithAck: async (event, payload) => { this.asked.push([event, payload]); return this.answer } }
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'register') { this.asked.push(['register', args[0]]); return true }
    return super.emit(event, ...args)
  }
}
const wire = { id: 'm1', chatId: 'c1', senderId: 'u1', type: 'text', text: 'hi' } as unknown as SendWire
async function registered() {
  const sockets: FakeSocket[] = [], steps: string[] = []
  const open = (() => { const socket = new FakeSocket(); sockets.push(socket); return socket }) as unknown as ConstructorParameters<typeof SocketMessageTransport>[2]
  const transport = new SocketMessageTransport('test', { state: () => {}, message: () => {}, needsReconciliation: () => {}, step: step => steps.push(step) }, open)
  transport.connect({ uid: 'u1', sessionId: 's1', idToken: async () => 'a.b.c' })
  const socket = sockets.at(-1)!
  socket.connected = true; socket.emit('connect')
  await new Promise(resolve => setTimeout(resolve, 5))
  socket.emit('registered', { ok: true, uid: 'u1', clientProtocolVersion: 2, capabilities: ['durable-message-ack', 'session-bound-registration'] })
  return { transport, socket, sockets, steps }
}

test('B412: Engine.IO\'s run-out heartbeat is read where it exists, and nothing is assumed where it does not', () => {
  assert.equal(pingExpired({ io: { engine: { _hasPingExpired: () => true } } } as never), true)
  assert.equal(pingExpired({ io: { engine: { _hasPingExpired: () => false } } } as never), false)
  assert.equal(pingExpired({ io: { engine: {} } } as never), false)
  assert.equal(pingExpired({ io: {} } as never), false)
  // The installed engine.io-client still has it (6.x); a version without it fails here rather than silently.
  const engine = readFileSync('node_modules/engine.io-client/build/cjs/socket.js', 'utf8')
  assert.match(engine, /_hasPingExpired\(\) \{/)
})

test('B412: a send with the heartbeat run out does not leave — it is one that never left, for the callable', async () => {
  const { transport, socket } = await registered()
  socket.expired = true
  await assert.rejects(transport.send(wire, new AbortController().signal), (error: unknown) => error instanceof NotEmitted)
  assert.deepEqual(socket.asked.filter(([event]) => event === 'sendMessage'), [], 'nothing was handed to Socket.IO to keep back')
  transport.stop()
})

test('B412: UNAUTHORIZED is an unregistered connection — it registers again with a fresh token, and the send never left', async () => {
  const { transport, socket, sockets, steps } = await registered()
  socket.answer = { ok: false, error: 'UNAUTHORIZED' }
  await assert.rejects(transport.send(wire, new AbortController().signal), (error: unknown) => error instanceof NotEmitted, 'not a refusal the message keeps')
  assert.ok(steps.includes('unregistered-answer'))
  assert.equal(sockets.length, 2, 'a new connection is made, which registers before anything is sent on it')
  transport.stop()
})

test('B412: what Socket.IO kept back is dropped when the connection ends, so the next one cannot carry it before register', async () => {
  const { transport, socket } = await registered()
  socket.sendBuffer.push({ type: 2, data: ['sendMessage', wire] })
  socket.emit('disconnect', 'ping timeout')
  assert.deepEqual(socket.sendBuffer, [])
  transport.stop()
})

// Review 10-15 00:5x: a request whose packet was dropped with the kept-back buffer never gets an answer; it ends unanswered
// and the same message goes again under the same id (send-fallback.ts) — the server takes an id once, so a copy that had
// arrived after all is answered alreadyExisted and the message is shown once.
test('B412: a send whose answer never comes goes again under the same id, and an id the server already has is one message', async () => {
  const { sendWithFallback } = await import('../../src/main/messaging/send-fallback')
  const { transport, socket } = await registered()
  socket.timeout = () => ({ emitWithAck: async (event: string, payload: unknown) => { socket.asked.push([event, payload]); socket.sendBuffer.push(payload); socket.emit('disconnect', 'ping timeout'); throw new Error('operation has timed out') } })
  const calls: { name: string; data: Record<string, unknown> }[] = []
  const answer = await sendWithFallback(wire, new AbortController().signal, transport, async (name, data) => {
    calls.push({ name, data })
    return { ok: true, persistedByServer: true, serverOwnedMessage: true, id: 'm1', chatId: 'c1', senderId: 'u1', createdAt: 1790000000000, alreadyExisted: true }
  })
  assert.deepEqual(socket.sendBuffer, [], 'the kept-back packet was dropped')
  assert.deepEqual(calls.map(call => [call.name, call.data.id]), [['sendMorseMessage', 'm1']], 'the same id again')
  assert.equal(answer.alreadyExisted, true, 'one message, not two')
  transport.stop()
})
