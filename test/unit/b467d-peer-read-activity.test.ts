import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PeerReadActivity } from '../../src/main/accounts/peer-read-activity'
import { presenceAfterMessage } from '../../src/shared/presence'
import type { DialogSummary } from '../../src/shared/model'
import type { ReadCursor } from '../../src/shared/read-receipts'

// B467d (review 10-30 10:4x, the three apps on TI's rule): in a 1:1, the other person's read that a live snapshot brings
// is their activity at the moment it arrives — TI .ReadOutbox (AccountStateManagementUtils.swift:4740-4744), tdesktop
// updateReadHistoryOutbox → madeAction(now) (api_updates.cpp:1378-1389). Not the cursor's time (the read message's).
const me = 'me', peer = 'peer', now = Date.UTC(2026, 9, 30, 11, 0, 0)
const cursor = (at: number, id = `m${at}`): ReadCursor => ({ at, id })
function dialog(id: string, kind: DialogSummary['kind'], read: ReadCursor | null, extra: Partial<DialogSummary> = {}): DialogSummary {
  const participantUids = kind === 'group' ? [me, peer, 'third'] : [me, peer]
  return { id, kind, participantUids, readPositions: read ? { [peer]: read } : {}, ...extra } as unknown as DialogSummary
}
function watch(): { activity: PeerReadActivity; seen: { peer: string; at: number }[] } {
  const seen: { peer: string; at: number }[] = []
  return { activity: new PeerReadActivity(me, (uid, at) => seen.push({ peer: uid, at }), () => now), seen }
}

test('a 1:1 read that moves forward in a live snapshot is the other person\'s activity now, not at the cursor\'s time', () => {
  const { activity, seen } = watch()
  activity.observe([dialog('c1', 'direct', cursor(1000))], true)
  activity.observe([dialog('c1', 'direct', cursor(2000))], false)
  assert.deepEqual(seen, [{ peer, at: now }])
  activity.observe([dialog('c1', 'direct', null)], false)
  activity.observe([dialog('c1', 'direct', cursor(3000))], false)
  assert.equal(seen.length, 2, 'a first read in a chat already listed counts too')
})

test('the first snapshot of a listen or of a listen started again only sets where each one is', () => {
  const { activity, seen } = watch()
  activity.observe([dialog('c1', 'direct', cursor(1000))], true)
  activity.observe([dialog('c1', 'direct', cursor(5000))], true)
  assert.deepEqual(seen, [], 'read while this list was not listening')
  activity.observe([dialog('c1', 'direct', cursor(6000))], false)
  assert.equal(seen.length, 1, 'after it, a live move counts')
})

test('the same place, a place further back, and a chat that only now came into the list say nothing', () => {
  const { activity, seen } = watch()
  activity.observe([dialog('c1', 'direct', cursor(2000))], true)
  activity.observe([dialog('c1', 'direct', cursor(2000))], false)
  activity.observe([dialog('c1', 'direct', cursor(1000))], false)
  activity.observe([dialog('c1', 'direct', cursor(1000)), dialog('c2', 'direct', cursor(9000))], false)
  assert.deepEqual(seen, [])
  activity.observe([dialog('c1', 'direct', cursor(1000))], false)
  activity.observe([dialog('c1', 'direct', cursor(1000)), dialog('c2', 'direct', cursor(9500))], false)
  assert.deepEqual(seen, [], 'a chat that left the list starts again from where it comes back')
})

test('groups, secret chats and the service chat are left out', () => {
  const { activity, seen } = watch()
  const rooms = (at: number): DialogSummary[] => [dialog('g', 'group', cursor(at)), dialog('s', 'secret', cursor(at)), dialog('n', 'direct', cursor(at), { service: true })]
  activity.observe(rooms(1000), true)
  activity.observe(rooms(2000), false)
  assert.deepEqual(seen, [])
})

test('the moment raises only a last seen shown as an older moment; online, hidden and the rough ones stay', () => {
  const seconds = Math.floor(now / 1000)
  assert.deepEqual(presenceAfterMessage({ s: 'present', t: seconds - 3600 }, now), { s: 'present', t: seconds })
  assert.equal(presenceAfterMessage({ s: 'present', t: seconds + 1 }, now), null)
  for (const s of ['online', 'hidden', 'lastWeek', 'lastMonth', 'longTimeAgo', 'none'] as const) assert.equal(presenceAfterMessage({ s }, now), null, s)
})

test('the session tells it each chats snapshot after the list is rebuilt, the first one of a listen marked, on the server\'s clock', () => {
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /new PeerReadActivity\(profile\.uid, \(peer, at\) => this\.presence\.messageSeen\(peer, at\), serverNow\)/)
  assert.match(session, /const first = kind === 'chats' && !this\.chatsCurrent\s*\n\s*if \(kind === 'chats'\) \{ this\.chatRows = rows; this\.chatsCurrent = true/)
  assert.match(session, /try \{ this\.rebuild\(\) \} catch \(error\) \{ failed\([^)]*\)\); return \}\s*\n\s*if \(kind === 'chats' && this\.pinsCurrent\) this\.peerReads\.observe\(\[\.\.\.this\.index\.values\(\)\]\.map\(value => value\.summary\), first\)/)
  assert.equal((session.match(/peerReads\.observe\(/g) ?? []).length, 1, 'only a chats snapshot, never a rebuild for names or pins')
  // A listen started again goes through reconnecting or loading before its first snapshot, and both leave chatsCurrent false.
  assert.match(session, /reconnecting: \(\) => \{\s*if \(!active\(\)\) return\s*if \(kind === 'chats'\) this\.chatsCurrent = false/)
  const rpc = readFileSync('src/main/network/firestore-rpc.ts', 'utf8')
  assert.match(rpc, /try \{\s*relisten\(\)\s*const authorization = await this\.auth\.authorize/, 'each listen cycle says so before it starts')
})
