import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { idleTimeout, maxReceivedMediaBytes, mediaIdleMs } from '../../src/shared/media-limits'
import { maxMediaEntryBytes, maxMediaCacheBytes } from '../../src/main/storage/media-cache-table'

// B308, first release (contracts/B308-video-limit-storage.md; plan §8 A): Desktop takes in up to 200 MiB before any app
// sends that much, and a download stops when it stops moving rather than after two minutes.
test('received media: 200 MiB, and the cache keeps one that large', () => {
  assert.equal(maxReceivedMediaBytes, 209_715_200)
  assert.equal(maxMediaEntryBytes, maxReceivedMediaBytes)
  assert.ok(maxMediaCacheBytes >= 5 * maxMediaEntryBytes, 'several of them fit the account cache')
})

test('a download is given up only after nothing has come for the idle time', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const idle = idleTimeout(mediaIdleMs, () => new Error('idle'))
    // Bytes keep coming every 20 s for ten minutes: never given up, however long the whole file takes.
    for (let second = 0; second < 600; second += 20) { mock.timers.tick(20_000); idle.touch() }
    assert.equal(idle.signal.aborted, false)
    mock.timers.tick(mediaIdleMs - 1)
    assert.equal(idle.signal.aborted, false)
    mock.timers.tick(1)
    assert.equal(idle.signal.aborted, true)
    assert.equal((idle.signal.reason as Error).message, 'idle')
  } finally { mock.timers.reset() }
})

test('a finished download lets its timer go', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const idle = idleTimeout(mediaIdleMs, () => new Error('idle'))
    idle.stop(); mock.timers.tick(mediaIdleMs * 2)
    assert.equal(idle.signal.aborted, false)
  } finally { mock.timers.reset() }
})
