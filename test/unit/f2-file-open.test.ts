import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MediaCacheStore, type MediaCacheCommand } from '../../src/main/storage/media-cache-table'
import { MediaCache, registerMediaCache } from '../../src/main/accounts/media-cache'
import { OpenedFiles, type OpenedFileSystem } from '../../src/main/media/opened-files'
import { fileWarning } from '../../src/main/media/file-types'
import { mediaResources, type MediaResource } from '../../src/main/media/media-document'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import type { FileState, MediaRequest } from '../../src/shared/media'

// F2 (tdesktop HistoryView::Document + Data::ResolveDocument): a file bubble fetches its file into the account's cache,
// stops it, and once it is here hands it to the system — asking first about a kind tdesktop warns of, showing the
// folder for one with no extension or no program — from a copy in the account's own folder that sign-out and «캐시
// 지우기» take away. A one-time file never reaches the disk.
const settle = async (): Promise<void> => { for (let step = 0; step < 50; step++) await new Promise(resolve => setImmediate(resolve)) }
const request: MediaRequest = { requestId: 'r1', messageId: 'm1', version: '1:0', index: 0 }
const file = (name: string, path = 'chat_files/c1/f1', blind = false): MediaResource =>
  ({ path, summary: { index: 0, kind: 'file', name, available: true, blind } })

async function harness(resource: MediaResource | null, cached: Buffer | null) {
  const root = await mkdtemp(join(tmpdir(), 'morse-opened-files-'))
  const store = new MediaCacheStore(join(root, 'media.sqlite'), randomBytes(32).toString('hex'))
  const cache = new MediaCache(async command => store.execute(command as MediaCacheCommand) as never)
  if (cached && resource?.path) { cache.write(resource.path, cached); await settle() }
  const credentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('no network in this test') } } as unknown as ReadCredentials
  registerMediaCache(credentials, cache)
  const calls: string[] = [], states: FileState[] = []
  let answer = true, failure = ''
  const system: OpenedFileSystem = {
    open: async path => { calls.push(`open:${path}`); return failure },
    show: path => { calls.push(`show:${path}`) },
    confirm: async (warning, extension) => { calls.push(`confirm:${warning}:${extension}`); return answer },
  }
  const directory = join(root, 'account', 'opened-files')
  const files = new OpenedFiles(credentials, () => resource, directory, (_chat, _message, _index, state) => { states.push(state) }, system)
  return { root, directory, files, calls, states, store, setAnswer: (value: boolean) => { answer = value }, setFailure: (value: string) => { failure = value },
    done: async () => { store.close(); await rm(root, { recursive: true, force: true }) } }
}

test('a file not here is remote; one in the cache is ready; fetching it tells the bubble loading then ready', async () => {
  const absent = await harness(file('a.pdf'), null)
  try { assert.deepEqual(await absent.files.state('c1', request), { state: 'remote' }) } finally { await absent.done() }
  const kept = await harness(file('a.pdf'), Buffer.from('%PDF-1.4 test'))
  try {
    assert.deepEqual(await kept.files.state('c1', request), { state: 'ready' })
    kept.files.fetch('c1', request)
    await settle()
    assert.equal(kept.states[0]?.state, 'loading')
    assert.deepEqual(kept.states.at(-1), { state: 'ready' })
  } finally { await kept.done() }
})

test('opening writes the file once, as itself, readable by this user only, and hands it to the system', async () => {
  const h = await harness(file('report.pdf'), Buffer.from('%PDF-1.4 body'))
  try {
    assert.equal(await h.files.open('c1', request), 'opened')
    const opened = h.calls[0]!.slice('open:'.length)
    assert.ok(opened.startsWith(h.directory) && opened.endsWith('/report.pdf'))
    assert.equal((await readFile(opened)).toString(), '%PDF-1.4 body')
    assert.equal((await stat(opened)).mode & 0o777, 0o600)
    assert.equal(await h.files.open('c1', request), 'opened')
    assert.equal(h.calls.length, 2, 'no question for a document')
    assert.deepEqual(await h.files.state('c1', request), { state: 'ready' })
  } finally { await h.done() }
})

test('a kind tdesktop warns of is asked about first, and a no stops it', async () => {
  const h = await harness(file('tool.command'), Buffer.from('echo hi'))
  try {
    h.setAnswer(false)
    assert.equal(await h.files.open('c1', request), 'cancelled')
    assert.deepEqual(h.calls, [`confirm:${fileWarning('command')}:command`])
    h.setAnswer(true)
    assert.equal(await h.files.open('c1', request), 'opened')
  } finally { await h.done() }
})

test('a file with no extension, or one the system has no program for, is shown in its folder', async () => {
  const bare = await harness(file('README'), Buffer.from('text'))
  try { assert.equal(await bare.files.open('c1', request), 'shown'); assert.match(bare.calls[0]!, /^show:.*README$/) } finally { await bare.done() }
  const orphan = await harness(file('notes.txt'), Buffer.from('text'))
  try {
    orphan.setFailure('No application knows how to open it')
    assert.equal(await orphan.files.open('c1', request), 'shown')
    assert.deepEqual(orphan.calls.map(call => call.split(':')[0]), ['open', 'show'])
  } finally { await orphan.done() }
})

test('a one-time file is never written, and «캐시 지우기» and sign-out take the folder away', async () => {
  const blind = await harness(file('secret.pdf', 'chat_files/c1/f2', true), Buffer.from('x'))
  try { await assert.rejects(blind.files.open('c1', request)); await assert.rejects(stat(blind.directory)) } finally { await blind.done() }
  const h = await harness(file('a.pdf'), Buffer.from('%PDF'))
  try {
    await h.files.open('c1', request)
    await h.files.clear()
    await assert.rejects(stat(h.directory))
    await h.files.open('c1', request)
    await h.files.close(true)
    await assert.rejects(stat(h.directory))
  } finally { await h.done() }
})

test('the kinds tdesktop asks about (Core::DetectNameType, IsIpRevealingPath), per system', () => {
  assert.equal(fileWarning('exe', 'win32'), 'program')
  assert.equal(fileWarning('EXE', 'win32'), 'program')
  assert.equal(fileWarning('app', 'darwin'), 'program')
  assert.equal(fileWarning('exe', 'darwin'), 'unknown')
  assert.equal(fileWarning('sh', 'linux'), 'program')
  assert.equal(fileWarning('html', 'darwin'), 'address')
  assert.equal(fileWarning('docx', 'darwin'), 'address')
  assert.equal(fileWarning('docx', 'win32'), null)
  assert.equal(fileWarning('pdf', 'darwin'), null)
  assert.equal(fileWarning('zip', 'win32'), null)
  assert.equal(fileWarning('tdesktop-theme', 'darwin'), 'unknown')
  assert.equal(fileWarning('whatever', 'darwin'), 'unknown')
})

test('F4: a file carries the size its sender recorded (fileSize), and nothing when it is missing or wrong', () => {
  const doc = (fields: Record<string, unknown>): FirestoreDocument => ({ name: 'm', fields: { mediaUrl: { stringValue: 'gs://talky-a38c3.firebasestorage.app/chat_files/c1/f1' }, fileName: { stringValue: 'a.pdf' }, ...fields } } as unknown as FirestoreDocument)
  assert.equal(mediaResources(doc({ fileSize: { integerValue: '1536' } }), 'c1', 'file', false)[0]?.summary.size, 1536)
  assert.equal(mediaResources(doc({ fileSize: { doubleValue: 2048 } }), 'c1', 'file', false)[0]?.summary.size, 2048)
  assert.equal(mediaResources(doc({}), 'c1', 'file', false)[0]?.summary.size, undefined)
  assert.equal(mediaResources(doc({ fileSize: { integerValue: '-3' } }), 'c1', 'file', false)[0]?.summary.size, undefined)
  // B360: a single photo's size is read too (automatic download weighs it before asking); see b360-auto-download-before.
  assert.equal(mediaResources(doc({ fileSize: { integerValue: '1536' } }), 'c1', 'image', false)[0]?.summary.size, 1536)
})

test('the cache answers whether it holds an object without reading it, and a month-old one is gone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'morse-cache-has-'))
  let now = 1_000_000_000_000
  const store = new MediaCacheStore(join(root, 'media.sqlite'), randomBytes(32).toString('hex'), () => now)
  try {
    const key = MediaCache.key('chat_files/c1/f1')
    assert.equal(store.execute({ kind: 'media-cache-has', key }), false)
    store.execute({ kind: 'media-cache-write', key, data: new Uint8Array([1, 2, 3]) })
    assert.equal(store.execute({ kind: 'media-cache-has', key }), true)
    now += 32 * 24 * 60 * 60 * 1000
    assert.equal(store.execute({ kind: 'media-cache-has', key }), false)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})
