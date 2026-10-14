import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ServerClock, tokenIssuedAt } from '../../src/main/network/server-clock'
import { setStorageClock, storageNow } from '../../src/main/storage/storage-clock'

// B409-2 (review 10-15): tdesktop keeps the server's time (base::unixtime, mtproto/session_private.cpp:2172·2179) and
// dates what it sends with it (history_item_helpers.cpp:599-605). Phase1 10-14 23:20: with the clock 30 s or 3 min off, the
// time on a message changed when the server confirmed it.
const clockAt = (start: number) => { let now = start; const clock = new ServerClock(() => now); return { clock, set: (value: number) => { now = value } } }

test('B409-2: no word yet is no difference; a fresh token\'s issue time gives one at sign-in, before any send', () => {
  const { clock } = clockAt(1_000_000)
  assert.equal(clock.offset(), 0); assert.equal(clock.now(), 1_000_000)
  // The computer is ten minutes behind: the server issued the token at 1_600_000 ms while this clock read 1_000_000.
  clock.issued(1600, 1_000_000)
  assert.equal(clock.offset(), 600_500); assert.equal(clock.now(), 1_600_500)
  clock.issued('soon', 1_000_000); clock.issued(-1, 1_000_000)
  assert.equal(clock.offset(), 600_500, 'a token with no issue time changes nothing')
})

test('B409-2: answered sends give the difference to the millisecond, by their middle value, over the token\'s', () => {
  const { clock } = clockAt(0)
  clock.issued(200, 0)
  // Sent at 1000, answered at 1200: the middle is 1100; the server dated it 181_100 → +180 000.
  clock.answered(1000, 1200, 181_100)
  assert.equal(clock.offset(), 180_000)
  clock.answered(2000, 2100, 182_060); clock.answered(3000, 3300, 183_140)
  assert.equal(clock.offset(), 180_000, 'the middle of 180 000, 180 010, 179 990')
  clock.answered(4000, 3900, 999_999); clock.answered(5000, 16_000, 999_999); clock.answered(5000, 5100, Number.NaN)
  assert.equal(clock.offset(), 180_000, 'an answer before its request, one slower than ten seconds, or no date is not a word on the time')
})

test('B409-2: a clock that moved starts again from the first answer after it; a token issue time far off drops the old answers', () => {
  const { clock } = clockAt(0), base = 1_000_000
  for (const n of [1, 2, 3]) clock.answered(base + n * 1000, base + n * 1000 + 100, base + n * 1000 + 50 + 60_000)
  assert.equal(clock.offset(), 60_000)
  clock.answered(base + 10_000, base + 10_100, base + 10_050 - 20_000)
  assert.equal(clock.offset(), -20_000, 'the computer\'s clock was set forward by 80 s: the next answer counts alone')
  const calls: number[] = []
  clock.subscribe(offset => calls.push(offset))
  clock.issued(1_100, 1_200_000)
  assert.equal(clock.offset(), -99_500, 'a fresh token ninety seconds off: the sends\' answers were from before a move')
  assert.deepEqual(calls, [-99_500])
  clock.issued(1_100, 1_200_000)
  assert.deepEqual(calls, [-99_500], 'told only when it changes')
})

test('B409-2: the issue time of a token is read from its payload', () => {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  assert.equal(tokenIssuedAt(`${part({})}.${part({ iat: 1_790_000_000 })}.s`), 1_790_000_000)
  assert.equal(tokenIssuedAt('x'), null); assert.equal(tokenIssuedAt(`${part({})}.${part({ iat: '1' })}.s`), null)
})

test('B409-2: the storage worker dates with the difference main hands it, and ignores nonsense', () => {
  setStorageClock(180_000)
  assert.ok(Math.abs(storageNow() - (Date.now() + 180_000)) < 50)
  setStorageClock(Number.NaN); setStorageClock(30 * 86400000); setStorageClock('1')
  assert.ok(Math.abs(storageNow() - (Date.now() + 180_000)) < 50)
  setStorageClock(0)
})

test('B409-2: what the server dates is compared with the server\'s time, and a message on its way is dated with it', () => {
  const read = (path: string) => readFileSync(path, 'utf8')
  const uses: [string, RegExp[]][] = [
    ['src/main/auth/controller.ts', [/owner\.tokens\.expiresAt > serverNow\(\) \+ 60000\) return/, /owner\.tokens\.expiresAt > serverNow\(\) \+ 60000 \? owner\.tokens\.idToken/]],
    ['src/main/auth/firebase-rest.ts', [/proof\.expiresAt <= serverNow\(\) \+ 60000/, /serverClock\.issued\(claims\.iat, Date\.now\(\)\)/, /Number\(claims\.exp\) \* 1000 <= serverNow\(\)/, /Math\.min\(serverNow\(\) \+ lifetime \* 1000/]],
    ['src/main/auth/web-app-proof.ts', [/if \(fresh\) serverClock\.issued\(claims\.iat, Date\.now\(\)\)/, /expiresAt <= serverNow\(\) \+ 120000 \|\| expiresAt > serverNow\(\) \+ 3900000/, /expiresAt > serverNow\(\) \+ usableUntilBefore/, /proofFromToken\(token, this\.appId, false\)/]],
    ['src/main/network/socket-transport.ts', [/at - serverNow\(\)\)\)/, /serverClock\.answered\(sentAt, Date\.now\(\), ack\.createdAt\)/]],
    ['src/main/messaging/send-fallback.ts', [/serverClock\.answered\(sentAt, Date\.now\(\), ack\.createdAt\)/]],
    ['src/main/network/firestore-rpc.ts', [/authorization\.expiresAt - serverNow\(\) - 30000/, /expiresAt <= serverNow\(\)\) throw new Error\('Story expired before commit'\)/]],
    ['src/main/storage/delivery-client.ts', [/postMessage\(\{ id, command, clock: serverClock\.offset\(\) \}\)/]],
    ['src/main/storage/delivery-worker.ts', [/setStorageClock\(request\.clock\)/]],
    ['src/renderer/src/history/compose.tsx', [/createdAt: Date\.now\(\) \+ \(desktop\.value\?\.serverClockOffset \?\? 0\)/]]
  ]
  for (const [path, patterns] of uses) for (const pattern of patterns) assert.match(read(path), pattern, path)
  assert.equal((read('src/main/network/firestore-rpc.ts').match(/authorization\.expiresAt - Date\.now\(\)/g) ?? []).length, 0)
  // Every message put on the queue is dated by the worker's server clock.
  for (const path of ['delivery-worker', 'forward-table', 'forward-media-table', 'forward-batch-table', 'forward-text-batch-table', 'sticker-reference-table', 'story-reply-send-table', 'upload-table']) {
    const source = read(`src/main/storage/${path}.ts`)
    assert.ok(/storageNow\(\)/.test(source), path)
    for (const insert of source.match(/INSERT INTO intents[^\n]*\n?[^\n]*/g) ?? []) assert.doesNotMatch(insert, /Date\.now\(\)/, path)
  }
})
