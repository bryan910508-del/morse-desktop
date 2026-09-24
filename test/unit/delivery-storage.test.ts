import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import { DeliveryCommandFailure, DeliveryRepository, setLocalDataKey, uncertainDeliveryCodes } from '../../src/main/storage/delivery-client'
import type { DeliveryCommand } from '../../src/main/storage/delivery-protocol'

// The account's delivery storage. One command that does not come back used to end the whole store for
// the rest of the session — the worker was terminated — and the person was told only «앱을 다시 열어 주세요».
// Telegram's cache answers each operation with its own error (Storage::Cache::Error) and keeps the
// database, and reopens one it cannot read (Settings::clearOnWrongKey) instead of giving up.
setLocalDataKey(() => 'a'.repeat(64))
const draft: DeliveryCommand = { kind: 'draft', chatId: 'c1' } as DeliveryCommand

// A worker that answers every command with `ok`, except the kinds it was told to swallow or die on.
const script = `
const { parentPort, workerData } = require('node:worker_threads')
parentPort.on('message', ({ id, command }) => {
  if (workerData.swallow === command.kind) return
  if (workerData.die === command.kind) { process.exit(3); return }
  parentPort.postMessage({ id, ok: true, value: command.kind })
})
`
function repository(options: { swallow?: string; die?: string } = {}) {
  const started: number[] = []
  const store = new DeliveryRepository('dir', 'uid', 'scope', data => {
    started.push(started.length)
    assert.equal(data.key, 'a'.repeat(64), 'the worker is opened with the local data key')
    return new Worker(script, { eval: true, workerData: { ...options, ...data } })
  })
  return { store, workers: () => started.length }
}
const failure = async (task: Promise<unknown>): Promise<DeliveryCommandFailure> => {
  const error = await task.then(() => null, reason => reason)
  assert.ok(error instanceof DeliveryCommandFailure, `expected a command failure, got ${String(error)}`)
  return error
}

test('a command that never comes back fails on its own, and the storage stays open', async t => {
  const { store } = repository({ swallow: 'draft' })
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const waiting = store.call(draft)
    t.mock.timers.tick(15_000)
    const error = await failure(waiting)
    assert.equal(error.code, 'timeout')
    assert.ok(uncertainDeliveryCodes.has(error.code), 'a command that timed out may still have been written')
    t.mock.timers.reset()
    assert.equal(store.usable, true, 'the store is not finished because one command was not answered')
    assert.equal(await store.call({ kind: 'direct-list' } as DeliveryCommand), 'direct-list', 'the next command is answered')
  } finally { await store.close(false).catch(() => {}) }
})

test('a worker that dies is opened again, and its commands are refused as uncertain', async () => {
  const { store, workers } = repository({ die: 'prune' })
  try {
    assert.equal(workers(), 1)
    const error = await failure(store.call({ kind: 'prune' } as DeliveryCommand))
    assert.equal(error.code, 'restarted')
    assert.ok(uncertainDeliveryCodes.has(error.code))
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(workers(), 2, 'a new worker took over')
    assert.equal(store.usable, true)
    assert.equal(await store.call(draft), 'draft', 'the account writes again without being restarted')
  } finally { await store.close(false).catch(() => {}) }
})

test('a worker that keeps dying is given up on, and says so once', async () => {
  const { store, workers } = repository({ die: 'prune' })
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await failure(store.call({ kind: 'prune' } as DeliveryCommand))
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(workers(), 4, 'three tries, and no more')
    const last = await store.call({ kind: 'prune' } as DeliveryCommand).then(() => null, reason => reason)
    assert.ok(last instanceof Error)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(store.usable, false, 'the storage says it is finished instead of trying for ever')
    assert.equal(workers(), 4)
  } finally { await store.close(false).catch(() => {}) }
})

test('a refusal from the worker keeps its own code', async () => {
  for (const code of ['capacity', 'conflict', 'storage'] as const) {
    const failing = `
      const { parentPort } = require('node:worker_threads')
      parentPort.on('message', ({ id }) => parentPort.postMessage({ id, ok: false, code: '${code}' }))
    `
    const store = new DeliveryRepository('dir', 'uid', 'scope', () => new Worker(failing, { eval: true }))
    try {
      const error = await failure(store.call(draft))
      assert.equal(error.code, code)
      assert.equal(store.usable, true, 'a refused command is not a broken store')
    } finally { await store.close(false).catch(() => {}) }
  }
  assert.deepEqual([...uncertainDeliveryCodes].sort(), ['restarted', 'storage', 'timeout'])
})
