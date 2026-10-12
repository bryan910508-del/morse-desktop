import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { SocketMessageTransport, tokenExpiry } from '../../src/main/network/socket-transport'

// The registration is renewed five minutes before the moment the server's authTimer would end it: the `exp` of the
// ID token it was made with, read as verifyIdToken reads it.
test('the expiry of an ID token is read from its payload, and an unreadable one gives none', () => {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  assert.equal(tokenExpiry(`${part({ alg: 'RS256' })}.${part({ exp: 1_790_000_000 })}.signature`), 1_790_000_000_000)
  assert.equal(tokenExpiry('not-a-token'), 0)
  assert.equal(tokenExpiry(`${part({})}.${part({ exp: 'soon' })}.s`), 0)
  assert.equal(tokenExpiry(`${part({})}.!!!.s`), 0)
})

// Telegram gives a connection one to eight seconds and tries again (kMinConnectedTimeout 1000,
// kMaxConnectedTimeout 8000). B314: the websocket is the only transport, however many tries fail and whether or not one
// ever connected — a long poll needs every request to reach the same server, which several servers do not give. Where
// the socket never carries, sends and reads go through the callable (A15, send-fallback.ts).
test('the socket asks only for a websocket, also after many failed tries with nothing ever connected', async () => {
  class FakeSocket extends EventEmitter {
    connected = false
    io = { engine: { transport: { name: 'websocket' }, once: () => {} } }
    connect(): this { return this }
    disconnect(): this { return this }
  }
  const opened: { transports?: string[] }[] = [], sockets: FakeSocket[] = [], steps: string[] = []
  const open = ((_url: string, options: { transports?: string[] }) => { opened.push(options); const socket = new FakeSocket(); sockets.push(socket); return socket }) as unknown as ConstructorParameters<typeof SocketMessageTransport>[2]
  const transport = new SocketMessageTransport('test', { state: () => {}, message: () => {}, needsReconciliation: () => {}, step: step => steps.push(step) }, open)
  transport.connect({ uid: 'u1', sessionId: 's1', idToken: async () => 'a.b.c' })
  for (let n = 0; n < 20; n++) sockets.at(-1)!.emit('connect_error', new Error('websocket error'))
  await new Promise(resolve => setTimeout(resolve, 20))
  transport.stop()
  assert.equal(opened.length, 1, 'failed tries are Socket.IO reconnecting the same socket, not a new kind of connection')
  assert.deepEqual(opened[0]!.transports, ['websocket'])
  assert.equal(steps.filter(step => step === 'connect-error').length, 20)
  assert.ok(!steps.includes('transport-fallback'))
})
