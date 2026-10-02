import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { Reachability, watchSystemOnline } from '../../src/main/network/reachability'
import { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents, ReadFailure } from '../../src/main/network/firestore-values'
import { restoreRetryDelay } from '../../src/main/auth/restore-retry'

// Telegram restarts every connection the moment the network is back and forgets the wait it was in
// (mtp_instance.cpp availableChanges → restart, SessionPrivate::restartNow). Morse's «back» is the system saying so, a
// socket registering, or a request answered after requests had failed to leave.
test('the network is back when something answers after requests failed to leave, or when the system or a socket says so', () => {
  const reachability = new Reachability(), seen: string[] = []
  const stop = reachability.subscribe(reason => seen.push(reason))
  reachability.reached('firestore')
  assert.deepEqual(seen, [], 'an answer while nothing was failing says nothing')
  reachability.lost(); reachability.lost()
  assert.equal(reachability.down, true)
  reachability.reached('https'); reachability.reached('firestore')
  assert.deepEqual(seen, ['https'], 'the first answer after the failures, once')
  reachability.returned('socket')
  assert.deepEqual(seen, ['https', 'socket'], 'a socket registering always counts')
  stop(); reachability.returned('system')
  assert.deepEqual(seen, ['https', 'socket'])
})

test('one listener that fails does not keep the others from trying', () => {
  const reachability = new Reachability(), seen: string[] = []
  reachability.subscribe(() => { throw new Error('broken') })
  reachability.subscribe(reason => seen.push(reason))
  reachability.returned('system')
  assert.deepEqual(seen, ['system'])
})

// A saved account keeps trying to reconnect: it no longer stops after four tries (Telegram's connection never does).
test('a saved account keeps waiting at the last wait instead of giving up', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10, 100].map(restoreRetryDelay), [5000, 15000, 45000, 120000, 120000, 120000, 120000])
})

// @grpc/grpc-js keeps a channel that could not connect in TRANSIENT_FAILURE for its own backoff (up to 120 s) and fails
// every call at once meanwhile; it cannot be told to try now. When the network is back the reader makes the channel
// anew, and a watch waiting out its wait listens again at once. A proxy port nothing listens on stands for the
// network being gone, so nothing here leaves the machine.
test('a Firestore channel stuck in its reconnect wait is made anew when the network is back, and a waiting watch goes at once', async () => {
  const port = await new Promise<number>(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)) }) })
  const previous = process.env.grpc_proxy
  process.env.grpc_proxy = `http://127.0.0.1:${port}`
  const reader = new FirestoreReader({ signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) })
  try {
    await assert.rejects(reader.getDocument(`${documents}/users/nobody`, new AbortController().signal),
      error => error instanceof ReadFailure && error.code === 'network' && error.reason === 'UNAVAILABLE/no-connection')
    const listening = new AbortController()
    reader.watch({ documents: { documents: [`${documents}/users/nobody`] } }, listening.signal, { snapshot: () => {}, state: () => {} }, 10)
    await new Promise(resolve => setTimeout(resolve, 300))
    const done = reader.reconnectNow()
    assert.deepEqual(done, { made: 1, woken: 1 }, 'the stuck channel was replaced and the watch listened again')
    assert.deepEqual(reader.reconnectNow().made, 0, 'a new channel that has not failed yet is left alone')
    listening.abort()
  } finally {
    reader.close()
    if (previous === undefined) delete process.env.grpc_proxy; else process.env.grpc_proxy = previous
  }
})

// The system saying it is online again is a return; staying online, or going offline, is not.
test('the system coming back online counts as the network returning, once per return', async () => {
  let online = false, returns = 0
  const stop = watchSystemOnline(() => online, () => { returns += 1 }, 5)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(returns, 0, 'offline says nothing')
  online = true
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(returns, 1, 'offline turning online is one return')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(returns, 1, 'staying online is not another')
  online = false; await new Promise(resolve => setTimeout(resolve, 20)); online = true
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(returns, 2)
  stop()
})
