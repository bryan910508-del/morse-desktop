import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { isPlainDatabase, openEncryptedDatabase, rawKey } from '../../src/main/storage/encrypted-database'
import { localKeyIterations, passcodeKey, unwrapLocalKey, wrapLocalKey } from '../../src/main/platform/local-data-key'

// tdesktop Storage::Domain: one local key seals the local data; a local passcode only wraps that key.

test('the local key is wrapped with the passcode and opens only with the same passcode', async () => {
  assert.equal(localKeyIterations, 100_000, 'kStrongIterationsCount')
  const key = randomBytes(32)
  const record = await wrapLocalKey(key, '1234')
  assert.equal(record.mode, 'passcode')
  assert.equal(Buffer.from(record.salt, 'base64').length, 32, 'LocalEncryptSaltSize')
  assert.ok(!JSON.stringify(record).includes(key.toString('base64')) && !JSON.stringify(record).includes(key.toString('hex')))
  assert.deepEqual(await unwrapLocalKey(record, '1234'), key)
  assert.equal(await unwrapLocalKey(record, '1235'), null)
  assert.equal(await unwrapLocalKey({ ...record, data: Buffer.from(randomBytes(32)).toString('base64') }, '1234'), null, 'a changed record fails its tag')
  const again = await wrapLocalKey(key, '1234')
  assert.notEqual(again.salt, record.salt, 'every wrap takes a new salt')
})

test('the passcode key follows CreateLocalKey: SHA-512 of salt, passcode and salt, then salted PBKDF2', async () => {
  const salt = Buffer.alloc(32, 7)
  const first = await passcodeKey('비밀', salt), second = await passcodeKey('비밀', salt), other = await passcodeKey('비밀', Buffer.alloc(32, 8))
  assert.equal(first.length, 32)
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, other)
})

async function directory(): Promise<{ path: string; done(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'morse-local-data-'))
  return { path, done: () => rm(path, { recursive: true, force: true }) }
}

test('a database written by an earlier version is encrypted in place, WAL content included', async () => {
  const dir = await directory()
  try {
    const file = join(dir.path, 'delivery.sqlite'), key = randomBytes(32).toString('hex')
    const plain = new Database(file)
    plain.pragma('journal_mode = WAL'); plain.pragma('wal_autocheckpoint = 0')
    plain.exec("CREATE TABLE local_drafts (chat_id TEXT PRIMARY KEY, text TEXT); INSERT INTO local_drafts VALUES ('chat1', '보내지 않은 초안')")
    // Leave the row in the WAL, as a crash before a checkpoint would.
    const reader = new Database(file); reader.prepare('SELECT count(*) FROM local_drafts').get()
    plain.close(); reader.close()
    assert.ok(isPlainDatabase(file))
    const db = openEncryptedDatabase(file, key)
    db.pragma('journal_mode = WAL')
    assert.deepEqual(db.prepare('SELECT text FROM local_drafts').get(), { text: '보내지 않은 초안' })
    db.exec("INSERT INTO local_drafts VALUES ('chat2', '새 초안')")
    db.close()
    assert.equal(isPlainDatabase(file), false)
    for (const part of [file, `${file}-wal`]) if (existsSync(part)) assert.ok(!(await readFile(part)).includes(Buffer.from('초안')), `${part} holds no plain text`)
    const reopened = openEncryptedDatabase(file, key)
    assert.equal((reopened.prepare('SELECT count(*) AS count FROM local_drafts').get() as { count: number }).count, 2)
    reopened.close()
    assert.throws(() => openEncryptedDatabase(file, randomBytes(32).toString('hex')), (error: { code?: string }) => error.code === 'SQLITE_NOTADB')
    const bare = new Database(file)
    assert.throws(() => bare.prepare('SELECT count(*) FROM local_drafts').get(), 'without the key nothing can be read')
    bare.close()
  } finally { await dir.done() }
})

test('a new database starts encrypted, and an attached archive takes the same key', async () => {
  const dir = await directory()
  try {
    const file = join(dir.path, 'delivery.sqlite'), archive = join(dir.path, 'archive.sqlite'), key = randomBytes(32).toString('hex')
    const db = openEncryptedDatabase(file, key)
    db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('hello')")
    db.prepare('ATTACH DATABASE ? AS retired KEY ?').run(archive, rawKey(key))
    db.exec('CREATE TABLE retired.t AS SELECT * FROM main.t')
    db.exec('DETACH DATABASE retired')
    db.close()
    assert.equal(isPlainDatabase(file), false)
    assert.equal(isPlainDatabase(archive), false)
    const opened = openEncryptedDatabase(archive, key)
    assert.deepEqual(opened.prepare('SELECT x FROM t').get(), { x: 'hello' })
    opened.close()
    assert.throws(() => rawKey('not-a-key'))
  } finally { await dir.done() }
})
