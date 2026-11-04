import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Metadata, status } from '@grpc/grpc-js'
import { CloudDrafts, cloudDraftTarget, cloudDraftValue, type CloudDraftHost, type CloudDraftSource } from '../../src/main/accounts/cloud-drafts'
import { ComposerDraftWriteFailure, writeComposerDraft } from '../../src/main/network/composer-draft-write'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'

// B530 (contract B530-cloud-drafts §4·§5·§11): a chat's unsent text goes to users/{uid}/composerDrafts/{chatId} and comes
// back from the account's other devices through one listener on that collection.
const uid = 'u1'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const settle = async () => { for (let i = 0; i < 5; i++) await sleep(0) }
const seconds = (at: number) => BigInt(at) * 1_000_000_000n
const doc = (chatId: string, text: string, at = 1): FirestoreDocument =>
  ({ name: `${documents}/users/${uid}/composerDrafts/${chatId}`, fields: { text: { stringValue: text } }, updateTime: { seconds: String(at), nanos: 0 } })

interface Write { chatId: string; text: string; resolve(at: bigint): void; reject(error: unknown): void }
// What this device keeps in local_drafts (text, synced, edited_at): shared by two harnesses, it is the app quit and
// started again.
interface Saved { locals: Map<string, string>; synced: Map<string, string>; edited: Map<string, number> }
const onDisk = (from: { locals?: Record<string, string>; synced?: Record<string, string>; edited?: Record<string, number> } = {}): Saved =>
  ({ locals: new Map(Object.entries(from.locals ?? {})), synced: new Map(Object.entries(from.synced ?? {})), edited: new Map(Object.entries(from.edited ?? {})) })
function harness(options: { auto?: boolean; delay?: number; secret?: string[]; open?: string[]; locals?: Record<string, string>; synced?: Record<string, string>; edited?: Record<string, number>; allowed?: () => void; store?: Saved } = {}) {
  const writes: Write[] = [], shown: [string, string, string | null][] = [], saved: [string, string][] = []
  const { locals, synced, edited } = options.store ?? onDisk({ locals: options.locals, synced: options.synced, edited: options.edited })
  let snapshot: ((rows: Iterable<FirestoreDocument>) => void) | null = null, watching = 0, opened = 0, closed = 0, clock = 100
  const targets: WireObject[] = []
  const source = (): CloudDraftSource => {
    opened++
    return {
      watch: (target, next) => { targets.push(target); watching++; snapshot = next; return () => { watching--; snapshot = null } },
      write: (chatId, text) => new Promise<bigint>((resolve, reject) => {
        const write = { chatId, text, resolve, reject }
        writes.push(write)
        if (options.auto !== false) resolve(seconds(++clock))
      }),
      close: () => { closed++ }
    }
  }
  const host: CloudDraftHost = {
    state: async chatId => ({ text: locals.get(chatId) ?? '', synced: synced.get(chatId) ?? null, editedAt: edited.get(chatId) ?? null }),
    adopt: async (chatId, text) => { saved.push([chatId, text]); locals.set(chatId, text); synced.set(chatId, text) },
    markSynced: async (chatId, text) => { synced.set(chatId, text) },
    unsynced: async () => [...locals].filter(([, text]) => text !== '').map(([chatId, text]) => ({ chatId, text, synced: synced.get(chatId) ?? null })),
    open: chatId => options.open?.includes(chatId) ?? false,
    // An open room's field takes a copy only while empty, and saves it as this device's draft (compose.tsx).
    show: (chatId, text, previous) => { shown.push([chatId, text, previous]); if (text && !locals.get(chatId)) locals.set(chatId, text) },
    eligible: chatId => !(options.secret ?? []).includes(chatId)
  }
  const drafts = new CloudDrafts(uid, source, options.allowed ?? (() => {}), host, () => Date.now(), options.delay ?? 30)
  return {
    drafts, writes, shown, saved, locals, synced, edited, targets,
    rows: (...docs: FirestoreDocument[]) => snapshot?.(docs),
    get watching() { return watching }, get opened() { return opened }, get closed() { return closed },
    texts: () => writes.map(write => `${write.chatId}:${write.text}`)
  }
}

test('a change goes up a second after the last keystroke; a blank one deletes the document', async () => {
  const h = harness(); h.drafts.resume(); h.rows()
  h.drafts.changed('c1', 'a'); h.drafts.changed('c1', 'ab')
  await sleep(10); assert.deepEqual(h.texts(), [])
  await sleep(40); assert.deepEqual(h.texts(), ['c1:ab'])
  h.drafts.changed('c1', ' \n '); await sleep(50)
  assert.deepEqual(h.texts(), ['c1:ab', 'c1:'])
  // The same text as the server holds is not written again.
  h.drafts.changed('c1', ''); await sleep(50)
  assert.equal(h.writes.length, 2)
  h.drafts.close()
})

test('leaving the room or quitting sends the waiting change at once', async () => {
  const h = harness({ delay: 10000 }); h.drafts.resume(); h.rows()
  // The field's text is this device's draft (outbox saveDraft) before the copy follows it.
  h.locals.set('c1', 'left'); h.drafts.changed('c1', 'left'); h.drafts.push('c1'); await settle()
  assert.deepEqual(h.texts(), ['c1:left'])
  h.drafts.changed('c2', 'quit'); h.drafts.changed('c3', 'too')
  await h.drafts.flush()
  assert.deepEqual(h.texts(), ['c1:left', 'c2:quit', 'c3:too'])
  // A room with nothing waiting sends nothing when left.
  h.drafts.push('c1'); await settle(); assert.equal(h.writes.length, 3)
  const main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(main, /handle\('push-draft', \(uid, chatId\) => accounts\.requireActive\(identifier\(uid\)\)\.pushDraft\(identifier\(chatId\)\), true\)/)
  assert.match(main, /await Promise\.race\(\[Promise\.all\(accounts\.all\.map\(session => session\.flushCloudDrafts\(\)\.catch\(\(\) => \{\}\)\)\), new Promise\(resolve => setTimeout\(resolve, 3000\)\)\]\)\n\s*try \{ await windowState\?\.save\(\)/)
  const compose = readFileSync('src/renderer/src/history/compose.tsx', 'utf8')
  assert.match(compose, /draftFlushers\.delete\(flush\); void flush\(\)\.catch\(\(\) => \{\}\)\.finally\(\(\) => \{ void window\.morse\.pushDraft\(accountUid, chatId\)/)
  assert.match(compose, /if \(document\.visibilityState === 'hidden'\) void flush\(\)/)
  h.drafts.close()
})

test('a send deletes the copy, even when an upload was still on its way', async () => {
  const h = harness({ auto: false, delay: 10000 }); h.drafts.resume(); h.rows()
  h.drafts.changed('c1', 'hello', true); await settle()
  assert.deepEqual(h.texts(), ['c1:hello'])
  h.drafts.sent('c1'); await settle()
  assert.equal(h.writes.length, 1, 'one write per room at a time')
  h.writes[0]!.resolve(seconds(5)); await settle()
  assert.deepEqual(h.texts(), ['c1:hello', 'c1:'])
  h.writes[1]!.resolve(seconds(6)); await settle()
  // Nothing on the server and nothing on its way: a send writes nothing.
  h.drafts.sent('c1'); await settle(); assert.equal(h.writes.length, 2)
  // A debounced change not yet sent is dropped and the copy deleted all the same.
  h.drafts.changed('c1', 'typed'); h.drafts.sent('c1'); await sleep(20)
  assert.equal(h.writes.length, 2, 'the server holds nothing, so the waiting change is just dropped')
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /\}, silent\)\n\s*this\.cloudDrafts\.sent\(chatId\)/)
  h.drafts.close()
})

test('a write that fails offline is kept and goes when the network is back; a refused one is dropped', async () => {
  const h = harness({ auto: false }); h.drafts.resume(); h.rows()
  h.drafts.changed('c1', 'offline', true); await settle()
  h.writes[0]!.reject(new ComposerDraftWriteFailure(true)); await settle()
  h.drafts.retryNow(); await settle()
  assert.deepEqual(h.texts(), ['c1:offline', 'c1:offline'])
  h.writes[1]!.resolve(seconds(3)); await settle()
  h.drafts.changed('c2', 'refused', true); await settle()
  h.writes[2]!.reject(new ComposerDraftWriteFailure(false)); await settle()
  h.drafts.retryNow(); await settle()
  assert.equal(h.writes.length, 3)
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /this\.postCreation\.resume\(\); this\.commentCreation\.resume\(\); this\.cloudDrafts\.retryNow\(\)/)
  h.drafts.close()
})

test('one write per room at a time; a change made meanwhile is written after it', async () => {
  const h = harness({ auto: false }); h.drafts.resume(); h.rows()
  h.drafts.changed('c1', 'a', true); await settle()
  h.drafts.changed('c1', 'ab', true); h.drafts.changed('c1', 'abc', true); await settle()
  assert.deepEqual(h.texts(), ['c1:a'])
  h.writes[0]!.resolve(seconds(2)); await settle()
  assert.deepEqual(h.texts(), ['c1:a', 'c1:abc'])
  h.writes[1]!.resolve(seconds(3)); await settle()
  h.drafts.close()
})

test('the cloud copy keeps the first 8000 characters; secret chats have none', async () => {
  assert.equal(cloudDraftValue('x'.repeat(9000)).length, 8000)
  assert.equal(cloudDraftValue('  \t'), '')
  const h = harness({ secret: ['s1'] }); h.drafts.resume(); h.rows()
  h.drafts.changed('s1', 'secret', true); h.drafts.sent('s1'); await settle()
  h.rows(doc('s1', 'from elsewhere')); await settle()
  assert.deepEqual([h.texts(), h.saved, h.shown], [[], [], []])
  h.drafts.close()
})

test('the listener starts with the account and stops when it is locked, paused or signed out', () => {
  const h = harness()
  h.drafts.resume(); assert.equal(h.watching, 1)
  assert.deepEqual(h.targets[0], cloudDraftTarget(uid))
  assert.deepEqual(cloudDraftTarget(uid), { query: { parent: `${documents}/users/${uid}`, structuredQuery: { from: [{ collectionId: 'composerDrafts' }] } } })
  h.drafts.resume(); assert.equal(h.watching, 1, 'one listener')
  h.drafts.setLocked(true); assert.deepEqual([h.watching, h.closed], [0, 1])
  h.drafts.resume(); assert.equal(h.watching, 0, 'not while locked')
  h.drafts.setLocked(false); assert.equal(h.watching, 1)
  h.drafts.pause(); assert.equal(h.watching, 0)
  h.drafts.resume(); assert.equal(h.watching, 1)
  h.drafts.close(); assert.equal(h.watching, 0)
  h.drafts.resume(); assert.equal(h.watching, 0, 'not after signing out')
  const refused = harness({ allowed: () => { throw new Error('not connected') } })
  refused.drafts.resume(); assert.equal(refused.watching, 0)
  // The session turns it on and off where it does the dialog preferences.
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  for (const line of [/this\.dialogPreferences\.setLocked\(locked\)\n\s*this\.cloudDrafts\.setLocked\(locked\)/, /this\.dialogPreferences\.pause\(\)\n\s*this\.cloudDrafts\.pause\(\)/,
    /this\.dialogPreferences\.resume\(\)\n\s*this\.cloudDrafts\.resume\(\)/, /this\.dialogPreferences\.close\(\); this\.cloudDrafts\.close\(\);/]) assert.match(session, line)
})

test('a draft from another device shows on the list line without the room ever being opened', async () => {
  const h = harness(); h.drafts.resume()
  h.rows(doc('c1', 'from the phone')); await settle()
  assert.deepEqual(h.saved, [['c1', 'from the phone']])
  assert.deepEqual(h.writes, [], 'taking it writes nothing back')
  h.drafts.close()
})

test('an open room takes it only while its input is empty and untouched', async () => {
  const h = harness({ open: ['c1'] }); h.drafts.resume()
  h.rows(doc('c1', 'first')); await settle()
  h.rows(doc('c1', 'second', 2)); await settle()
  assert.deepEqual(h.shown, [['c1', 'first', null], ['c1', 'second', 'first']])
  assert.deepEqual(h.saved, [], 'the field decides, not the stored draft')
  const compose = readFileSync('src/renderer/src/history/compose.tsx', 'utf8')
  assert.match(compose, /if \(editing \|\| sending\.current \|\| dirty\.current \|\| !available\.current\) return/)
  assert.match(compose, /if \(event\.text \? current\.trim\(\) !== '' : event\.previous === null \|\| current !== event\.previous \|\| current === ''\) return/)
  h.drafts.close()
})

test('a room typed in here keeps its own text over a copy that arrives', async () => {
  // Typed here after the copy was written (edited 5 s, the copy at 1 s), with nothing known of the last match: it stays
  // and goes up again.
  const h = harness({ locals: { c1: 'mine' }, edited: { c1: 5000 } }); h.drafts.resume()
  h.rows(doc('c1', 'theirs')); await settle()
  assert.deepEqual(h.saved, [])
  assert.deepEqual(h.texts(), ['c1:mine'])
  // A draft still as it was last synced follows the next copy; once typed in here, it does not.
  h.rows(doc('c2', 'v1')); await settle()
  h.rows(doc('c2', 'v2', 2)); await settle()
  assert.deepEqual(h.saved, [['c2', 'v1'], ['c2', 'v2']])
  h.locals.set('c2', 'v2 and more'); h.edited.set('c2', 9000)
  h.rows(doc('c2', 'v3', 3)); await settle()
  assert.deepEqual(h.saved.length, 2)
  assert.deepEqual(h.texts(), ['c1:mine', 'c2:v2 and more'])
  h.drafts.close()
})

// §11 ⑦ (Phase1 ↔ iOS 11-02 ⑦b): the open room kept «b530 d8» while the other device's «5308» came; left without typing,
// the field's text goes up over it — the copy and this device's draft end the same.
test('leaving a room whose field kept its own text over a copy sends that text up', async () => {
  const h = harness({ open: ['c1'], locals: { c1: 'b530 d8' }, synced: { c1: 'b530 d8' } }); h.drafts.resume()
  h.rows(doc('c1', 'b530 d8')); await settle()
  assert.deepEqual(h.texts(), [], 'already the same')
  h.rows(doc('c1', '5308', 2)); await settle()
  assert.equal(h.locals.get('c1'), 'b530 d8', 'the field keeps its own text')
  assert.equal(h.synced.get('c1'), '5308')
  h.drafts.push('c1'); await settle()
  assert.deepEqual(h.texts(), ['c1:b530 d8'])
  // Left again with nothing new, nothing more goes.
  h.drafts.push('c1'); await settle()
  assert.deepEqual(h.texts(), ['c1:b530 d8'])
  // A field that took the copy (empty, so the copy came in) leaves it as it is.
  h.rows(doc('c2', 'theirs', 3)); await settle()
  h.drafts.push('c2'); await settle()
  assert.deepEqual(h.texts(), ['c1:b530 d8'])
  h.drafts.close()
})

test('this device\'s own write coming back is not applied again (in flight, then by update time)', async () => {
  const h = harness({ auto: false }); h.drafts.resume(); h.rows()
  h.drafts.changed('c1', 'mine', true); await settle()
  h.rows(doc('c1', 'while writing', 5)); await settle()
  assert.deepEqual(h.saved, [])
  h.writes[0]!.resolve(seconds(10)); await settle()
  h.rows(doc('c1', 'older', 9)); await settle()
  h.rows(doc('c1', 'mine', 10)); await settle()
  assert.deepEqual(h.saved, [])
  h.rows(doc('c1', 'newer elsewhere', 11)); await settle()
  assert.deepEqual(h.saved, [['c1', 'newer elsewhere']])
  // A deletion carries no time: right after this device's write it is taken for an older one.
  h.drafts.changed('c2', 'kept', true); await settle()
  h.writes[1]!.resolve(seconds(12)); await settle()
  h.rows(doc('c1', 'newer elsewhere', 11), doc('c2', 'kept', 12)); await settle()
  h.rows(doc('c1', 'newer elsewhere', 11)); await settle()
  assert.equal(h.saved.length, 1)
  h.drafts.close()
})

test('a deletion clears the list line and a synced draft, never text typed here', async () => {
  const h = harness({ locals: { c2: 'mine' }, edited: { c2: 9000 }, open: ['c3'] }); h.drafts.resume()
  h.rows(doc('c1', 'a'), doc('c2', 'b'), doc('c3', 'c')); await settle()
  assert.deepEqual(h.saved, [['c1', 'a']])
  assert.deepEqual(h.texts(), ['c2:mine'])
  h.rows(); await settle()
  assert.deepEqual(h.saved, [['c1', 'a'], ['c1', '']])
  assert.equal(h.locals.get('c2'), 'mine')
  assert.deepEqual(h.shown.at(-1), ['c3', '', 'c'])
  h.drafts.close()
})

test('the commit is one write with updatedAt from the server, and no transaction', async () => {
  const sent: WireObject[] = []
  const client = (answer: { code?: number; commitTime?: unknown }) => ({
    commit: (request: WireObject, _metadata: Metadata, _options: { deadline: Date }, callback: (error: never, response: WireObject) => void) => {
      sent.push(request)
      setImmediate(() => callback((answer.code === undefined ? null : Object.assign(new Error('x'), { code: answer.code })) as never, { commitTime: answer.commitTime }))
      return { cancel() {} } as never
    }
  })
  const ok = client({ commitTime: { seconds: '7', nanos: 5 } }), signal = new AbortController().signal
  assert.equal(await writeComposerDraft(ok, new Metadata(), uid, 'c1', 'hi', signal, () => {}), 7_000_000_005n)
  assert.deepEqual((sent[0] as { writes: unknown[] }).writes, [{ update: { name: `${documents}/users/${uid}/composerDrafts/c1`, fields: { text: { stringValue: 'hi' } } },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }])
  assert.equal('transaction' in (sent[0] as object), false)
  await writeComposerDraft(ok, new Metadata(), uid, 'c1', '', signal, () => {})
  assert.deepEqual((sent[1] as { writes: unknown[] }).writes, [{ delete: `${documents}/users/${uid}/composerDrafts/c1` }])
  assert.throws(() => writeComposerDraft(ok, new Metadata(), uid, 'c1', 'x'.repeat(8001), signal, () => {}), ComposerDraftWriteFailure)
  const failure = async (code: number) => { try { await writeComposerDraft(client({ code }), new Metadata(), uid, 'c1', 'hi', signal, () => {}); return null } catch (error) { return (error as ComposerDraftWriteFailure).retry } }
  assert.deepEqual([await failure(status.UNAVAILABLE), await failure(status.UNAUTHENTICATED), await failure(status.PERMISSION_DENIED), await failure(status.INVALID_ARGUMENT)], [true, true, false, false])
  const outbox = readFileSync('src/main/messaging/outbox.ts', 'utf8')
  assert.match(outbox, /the account's cloud copy follows it \(B530, session\.saveDraft →\n\s*\/\/ cloud-drafts\.ts\), and it never sends a message\./)
})

test('a listener started again: a draft as last synced takes the copy; one typed offline, or later than the copy, stays and goes up', async () => {
  const h = harness({
    locals: { c1: 'old', c2: 'typed offline', c3: 'later here', c4: 'earlier here', c5: 'sent elsewhere', c6: 'new offline', c7: 'from before B530' },
    synced: { c1: 'old', c2: 'old2', c5: 'sent elsewhere', c6: '' },
    edited: { c2: 2000, c3: 2000, c4: 500 }
  })
  h.drafts.resume()
  const c4 = doc('c4', 'copy of c4', 1)
  c4.fields.updatedAt = { timestampValue: { seconds: '3', nanos: 0 } }
  h.rows(doc('c1', 'new'), doc('c2', 'old2'), doc('c3', 'copy of c3', 1), c4); await settle(); await settle()
  // c1 as last synced takes the copy; c4 typed before the copy's updatedAt (3 s) takes it; c5, as synced and gone from
  // the server, is cleared.
  assert.deepEqual(h.saved.sort(), [['c1', 'new'], ['c4', 'copy of c4'], ['c5', '']])
  // c2 typed since its last match, c3 typed after the copy, c6 typed offline with no copy, c7 from before: they go up.
  assert.deepEqual(h.texts().sort(), ['c2:typed offline', 'c3:later here', 'c6:new offline', 'c7:from before B530'])
  assert.equal(h.synced.get('c2'), 'typed offline', 'what went up is what it last matched now')
  const worker = readFileSync('src/main/storage/delivery-worker.ts', 'utf8')
  assert.match(worker, /if \(!localDraftColumns\.has\('synced'\)\) db\.exec\('ALTER TABLE local_drafts ADD COLUMN synced TEXT'\)/)
  assert.match(worker, /edited_at=CASE WHEN local_drafts\.text=excluded\.text THEN local_drafts\.edited_at ELSE excluded\.edited_at END/)
  assert.match(worker, /case 'adopt-draft':\n\s*db\.prepare\('INSERT INTO local_drafts\(chat_id,text,synced\) VALUES\(\?,\?,\?\) ON CONFLICT\(chat_id\) DO UPDATE SET text=excluded\.text,synced=excluded\.synced'\)/)
  h.drafts.close()
})

test('changed on another device while this one was off: started again, it shows the server\'s copy', async () => {
  const store = onDisk()
  const before = harness({ store }); before.drafts.resume()
  before.rows(doc('c1', 'v1', 1)); await settle()
  assert.deepEqual(before.saved, [['c1', 'v1']])
  before.drafts.close()
  // Off meanwhile: the phone changed the draft. What this device last matched is kept on disk, not in memory.
  const after = harness({ store }); after.drafts.resume()
  after.rows(doc('c1', 'v2 from the phone', 2)); await settle(); await settle()
  assert.deepEqual(after.saved, [['c1', 'v2 from the phone']])
  assert.equal(store.locals.get('c1'), 'v2 from the phone')
  assert.deepEqual(after.writes, [], 'nothing goes back up')
  after.drafts.close()
})

test('typed offline and quit: started again, this device\'s draft stays and goes up', async () => {
  const store = onDisk()
  const before = harness({ store, auto: false }); before.drafts.resume()
  before.rows(doc('c1', 'v1', 1)); await settle()
  // Offline: the edit is kept here, its upload fails, and the app quits.
  store.locals.set('c1', 'v1, typed offline'); store.edited.set('c1', 9000)
  store.locals.set('c2', 'a new draft, offline'); store.edited.set('c2', 9000)
  before.drafts.changed('c1', 'v1, typed offline', true); before.drafts.changed('c2', 'a new draft, offline', true); await settle()
  for (const write of before.writes) write.reject(new ComposerDraftWriteFailure(true))
  await settle(); before.drafts.close()
  const after = harness({ store }); after.drafts.resume()
  after.rows(doc('c1', 'v1', 1)); await settle(); await settle()
  assert.deepEqual(after.saved, [], 'the old copy does not replace it')
  assert.deepEqual(after.texts().sort(), ['c1:v1, typed offline', 'c2:a new draft, offline'])
  assert.equal(store.locals.get('c1'), 'v1, typed offline')
  after.drafts.close()
})

test('typed offline and quit, then changed later on another device: started again, the later one — the server\'s — wins', async () => {
  // Typed here at 5 s while offline; the phone changed the draft at 9 s. Whichever was edited later wins (§11 ⑥).
  const store = onDisk({ locals: { c1: 'typed offline' }, synced: { c1: 'v1' }, edited: { c1: 5000 } })
  const after = harness({ store }); after.drafts.resume()
  after.rows(doc('c1', 'later on the phone', 9)); await settle(); await settle()
  assert.deepEqual(after.saved, [['c1', 'later on the phone']])
  assert.deepEqual(after.writes, [])
  after.drafts.close()
})
