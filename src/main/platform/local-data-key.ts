import { safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, createHash, pbkdf2, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tr } from '../../shared/i18n'

// Storage::Domain (tdesktop storage_domain.cpp): one random local key encrypts this installation's local data, and
// only that key is ever re-wrapped. With a local passcode it is wrapped the way CreateLocalKey derives the passcode
// key — PBKDF2-HMAC-SHA512 over SHA512(salt + passcode + salt), salted, kStrongIterationsCount 100,000, a 32-byte
// salt (LocalEncryptSaltSize) — so the data cannot be opened until the passcode is entered. Without a passcode
// Telegram wraps it with an empty passcode and one iteration; here it stays in the system keychain (safeStorage),
// as the account credentials do. Either record is itself kept in safeStorage.
export const localKeyIterations = 100_000
const saltSize = 32
interface KeychainRecord { version: 1; mode: 'keychain'; key: string }
interface PasscodeRecord { version: 1; mode: 'passcode'; salt: string; iv: string; tag: string; data: string }
type KeyRecord = KeychainRecord | PasscodeRecord

export function passcodeKey(passcode: string, salt: Buffer): Promise<Buffer> {
  const hash = createHash('sha512').update(salt).update(Buffer.from(passcode, 'utf8')).update(salt).digest()
  return new Promise((resolve, reject) => pbkdf2(hash, salt, localKeyIterations, 32, 'sha512', (error, key) => { hash.fill(0); if (error) reject(error); else resolve(key) }))
}
export async function wrapLocalKey(key: Buffer, passcode: string): Promise<PasscodeRecord> {
  const salt = randomBytes(saltSize), iv = randomBytes(12), wrapping = await passcodeKey(passcode, salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', wrapping, iv)
    const data = Buffer.concat([cipher.update(key), cipher.final()])
    return { version: 1, mode: 'passcode', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  } finally { wrapping.fill(0) }
}
// A wrong passcode fails the GCM tag, as a wrong one fails DecryptLocal in Domain::startModern.
export async function unwrapLocalKey(record: PasscodeRecord, passcode: string): Promise<Buffer | null> {
  const salt = Buffer.from(record.salt, 'base64'), wrapping = await passcodeKey(passcode, salt)
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrapping, Buffer.from(record.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
    const key = Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()])
    return key.length === 32 ? key : null
  } catch { return null }
  finally { wrapping.fill(0) }
}
function readRecord(raw: unknown): KeyRecord {
  const value = (raw && typeof raw === 'object' ? raw : {}) as { [field: string]: unknown }
  const bytes = (text: unknown, size: number): text is string => typeof text === 'string' && Buffer.from(text, 'base64').length === size
  if (value.version === 1 && value.mode === 'keychain' && bytes(value.key, 32)) return { version: 1, mode: 'keychain', key: value.key }
  if (value.version === 1 && value.mode === 'passcode' && bytes(value.salt, saltSize) && bytes(value.iv, 12) && bytes(value.tag, 16) && bytes(value.data, 32))
    return { version: 1, mode: 'passcode', salt: value.salt, iv: value.iv, tag: value.tag, data: value.data }
  throw new Error('Invalid local key record')
}

export type LocalKeyState = 'ready' | 'passcode' | 'unreadable'
export class LocalDataKey {
  private key: Buffer | null = null
  private record: KeyRecord | null = null
  private unreadable = false
  private tail: Promise<unknown> = Promise.resolve()
  private readonly file: string
  constructor(private readonly directory: string) { this.file = join(directory, 'local-key.bin') }

  get ready(): boolean { return Boolean(this.key) }
  get protectedByPasscode(): boolean { return this.record?.mode === 'passcode' }
  // The key as SQLite3 Multiple Ciphers takes a raw key: PRAGMA key = "x'…'".
  hex(): string {
    if (!this.key) throw new Error(tr('로컬 암호를 입력해 주세요.'))
    return this.key.toString('hex')
  }

  // Domain::start: no record yet means a new key (generateLocalKey); a keychain record is ready at once; a passcode
  // record waits for the passcode. A record that cannot be read is reported, never silently replaced.
  async load(): Promise<LocalKeyState> {
    let raw: Buffer
    try { raw = await readFile(this.file) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.unreadable = true; return 'unreadable' }
      const key = randomBytes(32)
      await this.write({ version: 1, mode: 'keychain', key: key.toString('base64') })
      this.key = key
      return 'ready'
    }
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Encryption unavailable')
      const record = readRecord(JSON.parse((await safeStorage.decryptStringAsync(raw)).result))
      this.record = record
      if (record.mode === 'keychain') { this.key = Buffer.from(record.key, 'base64'); return 'ready' }
      return 'passcode'
    } catch { this.unreadable = true; return 'unreadable' }
    finally { raw.fill(0) }
  }
  async unlock(passcode: string): Promise<boolean> {
    if (this.key) return true
    if (this.record?.mode !== 'passcode') return false
    const key = await unwrapLocalKey(this.record, passcode)
    if (!key) return false
    this.key = key
    return true
  }
  // Domain::setPasscode: only the key is wrapped again; an empty passcode puts it back in the keychain.
  protect(passcode: string | null): Promise<void> {
    return this.serial(async () => {
      if (!this.key) throw new Error(tr('로컬 암호를 입력해 주세요.'))
      await this.write(passcode ? await wrapLocalKey(this.key, passcode) : { version: 1, mode: 'keychain', key: this.key.toString('base64') })
    })
  }
  // PasscodeLockWidget log out with a forgotten passcode: the data sealed by the old key can no longer be opened,
  // so a new key starts a new, empty local store.
  reset(): Promise<void> {
    return this.serial(async () => {
      this.key?.fill(0)
      const key = randomBytes(32)
      await this.write({ version: 1, mode: 'keychain', key: key.toString('base64') })
      this.key = key; this.unreadable = false
    })
  }
  get failed(): boolean { return this.unreadable }

  private async write(next: KeyRecord): Promise<void> {
    if (!['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) throw new Error(tr('이 기기에서는 로컬 데이터를 안전하게 보관할 수 없습니다.'))
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(next))
    try {
      const pending = `${this.file}.pending`, handle = await open(pending, 'w', 0o600)
      try { await handle.writeFile(encrypted); await handle.sync() } finally { await handle.close() }
      await rename(pending, this.file)
    } finally { encrypted.fill(0) }
    this.record = next
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const job = this.tail.then(work)
    this.tail = job.catch(() => {})
    return job
  }
}
