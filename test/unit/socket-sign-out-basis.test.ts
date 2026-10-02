import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { after, test } from 'node:test'
import { SocketMessageTransport, type TransportEvents } from '../../src/main/network/socket-transport'
import type { ConnectionState } from '../../src/shared/model'

// A5 contract §3-1 (user decision 2026-09-30, Desktop too): what the socket says about the sign-in is a reason to ask
// the server, never a sign-out. For every refusal: is startMorseDeviceSession asked, and does the connection end as
// rejected (the account then signs out and clears what it kept)? Only the server's «session-revoked» ends it.
class FakeSocket extends EventEmitter {
  connected = false
  registers: unknown[] = []
  io = { engine: { transport: { name: 'websocket', writable: true }, once: () => {} } }
  connect(): this { this.connected = true; setImmediate(() => super.emit('connect')); return this }
  disconnect(): this { this.connected = false; return this }
  override emit(event: string, ...args: unknown[]): boolean {
    if (event === 'register') { this.registers.push(args[0]); return true }
    return super.emit(event, ...args)
  }
}
const transports: SocketMessageTransport[] = []
after(() => { for (const transport of transports) transport.stop() })
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
// Waits for what the transport does next rather than a fixed moment: on a busy Mac a registration can take longer than
// a few milliseconds (2026-09-30, while another app was building).
async function until(done: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!done() && Date.now() < end) await tick(10)
}

async function refused(reason: string, answer: 'revoked' | 'confirmed' | 'unknown') {
  const sockets: FakeSocket[] = [], states: ConnectionState[] = [], rejected: string[] = [], tokens: boolean[] = []
  let asked = 0
  const events: TransportEvents = { state: state => states.push(state), message: () => {}, needsReconciliation: () => {},
    rejected: why => rejected.push(why), confirm: async () => { asked++; return answer } }
  const open = (() => { const socket = new FakeSocket(); sockets.push(socket); return socket }) as unknown as ConstructorParameters<typeof SocketMessageTransport>[2]
  const transport = new SocketMessageTransport('test', events, open)
  transports.push(transport)
  transport.connect({ uid: 'u1', sessionId: 's1', idToken: async force => { tokens.push(force); return 'a.b.c' } })
  await until(() => sockets[0]?.registers.length === 1)
  assert.equal(sockets[0]!.registers.length, 1, 'it registered')
  sockets[0]!.emit('registrationFailed', { error: 'UNAUTHORIZED', reason })
  await until(() => asked > 0 || states.length > 0 && tokens.length > 0)
  await tick()
  return { asked, rejected, states, sockets, tokens, transport }
}

for (const reason of ['session-revoked', 'credential-revoked', 'account-unavailable', 'session-unconfirmed']) {
  test(`«${reason}» from the socket asks the server; only its «session-revoked» ends the connection`, async () => {
    const revoked = await refused(reason, 'revoked')
    assert.equal(revoked.asked, 1, 'the server was asked once')
    assert.deepEqual(revoked.rejected, [reason])
    assert.equal(revoked.states.at(-1), 'rejected')
    for (const answer of ['confirmed', 'unknown'] as const) {
      const kept = await refused(reason, answer)
      assert.equal(kept.asked, 1)
      assert.deepEqual(kept.rejected, [], `${answer}: not signed out`)
      assert.notEqual(kept.states.at(-1), 'rejected')
      kept.transport.stop()
    }
    revoked.transport.stop()
  })
}

test('«token-account-mismatch» fetches a fresh token and registers again, without asking or signing out', async () => {
  const run = await refused('token-account-mismatch', 'revoked')
  assert.equal(run.asked, 0)
  assert.deepEqual(run.rejected, [])
  await until(() => run.sockets[1]?.registers.length === 1, 4000)
  assert.equal(run.sockets.length, 2, 'a new connection')
  assert.equal(run.tokens.at(-1), true, 'with a token fetched again')
  assert.equal(run.sockets[1]!.registers.length, 1, 'and registered again')
  run.transport.stop()
})

test('a session the server confirms registers again on a new connection with a fresh token', async () => {
  const run = await refused('session-unconfirmed', 'confirmed')
  await until(() => run.sockets[1]?.registers.length === 1, 4000)
  assert.equal(run.sockets.length, 2)
  assert.equal(run.tokens.at(-1), true)
  assert.equal(run.sockets[1]!.registers.length, 1)
  run.transport.stop()
})
