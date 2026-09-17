import { safeStorage } from 'electron'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { autoLockChoices, type AppLockSnapshot, type PasscodeResult } from '../../shared/app-lock'
import { tr } from '../../shared/i18n'

interface Stored { version: 1; salt: string; hash: string; autoLock: number; systemUnlock: boolean }
// core_settings.h: _autoLock = 3600.
const defaultAutoLock = 3600

function derive(passcode: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(passcode, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)))
}

// Core::Application local passcode for this installation. Only a scrypt hash is kept, in
// OS-encrypted storage. The lock hides the window and blocks its data requests; unlike
// Telegram Desktop it does not re-encrypt the other local app files with the passcode.
export class AppLock {
  private stored: Stored | null = null
  private unreadable = false
  private lockedNow = false
  private enteredThisRun = false
  private badTries = 0
  private lastTry = 0
  private tail: Promise<unknown> = Promise.resolve()
  private readonly file: string
  constructor(private readonly directory: string) { this.file = join(directory, 'app-lock.bin') }

  get enabled(): boolean { return Boolean(this.stored) || this.unreadable }
  get locked(): boolean { return this.lockedNow }
  get autoLockSeconds(): number { return this.stored?.autoLock ?? defaultAutoLock }
  // PasscodeLockWidget: system unlock is offered only after the passcode was entered once this run.
  get systemUnlockAllowed(): boolean { return this.enteredThisRun && Boolean(this.stored?.systemUnlock) }
  snapshot(touchId: boolean): AppLockSnapshot {
    return { enabled: this.enabled, locked: this.lockedNow, autoLock: this.autoLockSeconds, systemUnlock: touchId ? 'touch-id' : 'none',
      systemUnlockEnabled: Boolean(this.stored?.systemUnlock), systemUnlockAllowed: this.enteredThisRun }
  }

  // Application::startDomain: a set passcode is required at every start. A record that cannot be
  // read stays locked; signing out from the lock screen is the way back, as in Telegram Desktop.
  async load(): Promise<void> {
    let raw: Buffer
    try { raw = await readFile(this.file) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.unreadable = true; this.lockedNow = true; return
    }
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Encryption unavailable')
      const value = JSON.parse((await safeStorage.decryptStringAsync(raw)).result) as Partial<Stored>
      if (value.version !== 1 || typeof value.salt !== 'string' || typeof value.hash !== 'string' || typeof value.systemUnlock !== 'boolean' ||
        Buffer.from(value.salt, 'base64').length !== 16 || Buffer.from(value.hash, 'base64').length !== 32) throw new Error('Invalid app lock')
      this.stored = { version: 1, salt: value.salt, hash: value.hash, systemUnlock: value.systemUnlock,
        autoLock: (autoLockChoices as readonly number[]).includes(value.autoLock as number) ? value.autoLock as number : defaultAutoLock }
    } catch { this.unreadable = true }
    finally { raw.fill(0) }
    this.lockedNow = true
  }

  // settings.h passcodeCanTry: three free tries, then 5 to 30 seconds after the last wrong one.
  private canTry(): boolean {
    if (this.badTries < 3) return true
    return Date.now() - this.lastTry >= (this.badTries >= 8 ? 30000 : (this.badTries - 2) * 5000)
  }
  private async matches(passcode: string): Promise<boolean> {
    if (!this.stored) return false
    const key = await derive(passcode, Buffer.from(this.stored.salt, 'base64'))
    try { return timingSafeEqual(key, Buffer.from(this.stored.hash, 'base64')) } finally { key.fill(0) }
  }
  // window_lock_widgets.cpp TryPasscode
  async check(passcode: string): Promise<PasscodeResult> {
    if (!passcode) return 'empty'
    if (!this.canTry()) return 'flood'
    if (!await this.matches(passcode)) { this.badTries++; this.lastTry = Date.now(); return 'wrong' }
    this.badTries = 0
    return 'correct'
  }
  async unlock(passcode: string): Promise<PasscodeResult> {
    const result = await this.check(passcode)
    if (result === 'correct') { this.lockedNow = false; this.enteredThisRun = true }
    return result
  }
  unlockBySystem(): void { this.badTries = 0; this.lockedNow = false }
  lock(): boolean {
    if (!this.enabled) return false
    this.lockedNow = true
    return true
  }
  async create(passcode: string, systemUnlock: boolean): Promise<void> {
    if (this.enabled) throw new Error(tr('로컬 암호가 이미 설정되어 있습니다.'))
    await this.save(passcode, defaultAutoLock, systemUnlock)
    this.enteredThisRun = true
  }
  async change(passcode: string): Promise<'saved' | 'same'> {
    const current = this.requireStored()
    if (await this.matches(passcode)) return 'same'
    await this.save(passcode, current.autoLock, current.systemUnlock)
    return 'saved'
  }
  setAutoLock(seconds: number): Promise<void> { return this.write({ ...this.requireStored(), autoLock: seconds }) }
  setSystemUnlock(enabled: boolean): Promise<void> { return this.write({ ...this.requireStored(), systemUnlock: enabled }) }
  remove(): Promise<void> {
    return this.serial(async () => {
      await rm(this.file, { force: true })
      this.stored = null; this.unreadable = false; this.lockedNow = false; this.badTries = 0
    })
  }
  private requireStored(): Stored {
    if (!this.stored) throw new Error(tr('로컬 암호를 먼저 설정해 주세요.'))
    return this.stored
  }
  private async save(passcode: string, autoLock: number, systemUnlock: boolean): Promise<void> {
    const salt = randomBytes(16), key = await derive(passcode, salt)
    try { await this.write({ version: 1, salt: salt.toString('base64'), hash: key.toString('base64'), autoLock, systemUnlock }) }
    finally { key.fill(0) }
  }
  private write(next: Stored): Promise<void> {
    return this.serial(async () => {
      if (!['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) throw new Error(tr('이 기기에서는 로컬 암호를 안전하게 저장할 수 없습니다.'))
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(next))
      try {
        const pending = `${this.file}.pending`, handle = await open(pending, 'w', 0o600)
        try { await handle.writeFile(encrypted); await handle.sync() } finally { await handle.close() }
        await rename(pending, this.file)
      } finally { encrypted.fill(0) }
      this.stored = next; this.unreadable = false
    })
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const job = this.tail.then(work)
    this.tail = job.catch(() => {})
    return job
  }
}
