import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { sendWithFallback, socketWaitMs, type CallablePath, type SocketPath } from '../../src/main/messaging/send-fallback'
import { SystemNetwork } from '../../src/main/network/reachability'
import type { SendAcknowledgement, TextSendWire } from '../../src/shared/model'

// Three apps, one rule (review 10-12 21:5x): the socket's five seconds count from the later of the socket losing its way
// and the network coming back; while there is no network nothing counts and nothing goes by the callable.
const wire: TextSendWire = { id: 'm1', chatId: 'chat1', senderId: 'me', type: 'text', text: '1', isSilent: false, isEncrypted: false, protocolVersion: 3 }
const ack: SendAcknowledgement = { id: 'm1', chatId: 'chat1', senderId: 'me', createdAt: 1700000000000, alreadyExisted: false }
const accepted = { ok: true, persistedByServer: true, serverOwnedMessage: true, id: 'm1', chatId: 'chat1', senderId: 'me', createdAt: 1700000000000, alreadyExisted: false }

function socket(downSince: number) {
  let sendable = false
  const waiters = new Set<() => void>()
  const path: SocketPath = {
    whenSendable: (ms, signal) => sendable ? Promise.resolve(true) : new Promise(resolve => {
      const done = (value: boolean) => { clearTimeout(timer); waiters.delete(wake); resolve(value) }
      const wake = () => { if (sendable) done(true) }
      const timer = setTimeout(() => done(sendable), ms)
      waiters.add(wake); signal.addEventListener('abort', () => done(false), { once: true })
    }),
    notSendableSince: () => sendable ? null : downSince,
    send: async () => ack,
    markRead: async () => { throw new Error('unused') }
  }
  return { path, connect: () => { sendable = true; for (const wake of [...waiters]) wake() } }
}
const flush = async () => { for (let n = 0; n < 5; n++) await Promise.resolve() }

test('with no network the five seconds do not run, and the callable is not asked however long it lasts', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  try {
    const network = new SystemNetwork(() => Date.now())
    network.set(false)
    const calls: string[] = []
    const callable: CallablePath = async name => { calls.push(name); return accepted }
    const s = socket(Date.now())
    let settled = false
    const sending = sendWithFallback(wire, new AbortController().signal, s.path, callable, undefined, network).then(answer => { settled = true; return answer })
    mock.timers.tick(60_000); await flush()
    assert.equal(settled, false); assert.deepEqual(calls, [], 'a minute with no network: nothing by the callable')
    // The network comes back; the socket connects three seconds later: the message goes over the socket.
    network.set(true); await flush()
    mock.timers.tick(3_000); await flush()
    s.connect(); await flush()
    assert.deepEqual(await sending, ack)
    assert.deepEqual(calls, [])
  } finally { mock.timers.reset() }
})

test('the network back and no socket for five seconds: the same message goes through the callable', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 })
  try {
    const network = new SystemNetwork(() => Date.now())
    network.set(false)
    const calls: string[] = []
    const callable: CallablePath = async name => { calls.push(name); return accepted }
    const s = socket(Date.now() - 600_000)
    const sending = sendWithFallback(wire, new AbortController().signal, s.path, callable, undefined, network)
    mock.timers.tick(30_000); await flush()
    network.set(true); await flush()
    mock.timers.tick(socketWaitMs - 1); await flush()
    assert.deepEqual(calls, [], 'not before five seconds from the network\'s return, however long the socket was down')
    mock.timers.tick(1); await flush()
    assert.deepEqual((await sending).id, 'm1')
    assert.deepEqual(calls, ['sendMorseMessage'])
  } finally { mock.timers.reset() }
})

test('a network that carries all but the socket, down for longer than five seconds already, goes by the callable at once', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 3_000_000 })
  try {
    const network = new SystemNetwork(() => Date.now())
    mock.timers.tick(60_000)
    const calls: string[] = []
    const callable: CallablePath = async name => { calls.push(name); return accepted }
    const s = socket(Date.now() - 20_000)
    const sending = sendWithFallback(wire, new AbortController().signal, s.path, callable, undefined, network)
    mock.timers.tick(0); await flush()
    await sending
    assert.deepEqual(calls, ['sendMorseMessage'], 'the five seconds had passed while the network was there')
  } finally { mock.timers.reset() }
})
