import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { identifier } from '../../shared/validation'
import { AuthenticationFailure } from './contracts'

// The server limits new accounts per device with an iOS vendor UUID. Desktop has
// none, so each installation keeps its own random UUID in encrypted storage.
// Removing the app data starts a new installation identity.
export class DeviceIdentity {
  private cached: string | null = null
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory: string) {}

  private async requireEncryption(): Promise<void> {
    if (!['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) throw new AuthenticationFailure('storage')
  }
  private async write(file: string, value: string): Promise<void> {
    await this.requireEncryption()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const encrypted = await safeStorage.encryptStringAsync(value)
    try {
      const pending = `${file}.pending`, handle = await open(pending, 'w', 0o600)
      try { await handle.writeFile(encrypted); await handle.sync() }
      finally { await handle.close() }
      await rename(pending, file)
    } finally { encrypted.fill(0) }
  }
  vendorId(): Promise<string> {
    const task = this.tail.then(async (): Promise<string> => {
      if (this.cached) return this.cached
      const file = join(this.directory, 'desktop-device.bin')
      let stored: Buffer | null = null
      try { stored = await readFile(file) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AuthenticationFailure('storage') }
      if (stored) {
        try {
          await this.requireEncryption()
          const value = (await safeStorage.decryptStringAsync(stored)).result
          if (!/^[0-9a-f-]{36}$/.test(value)) throw new Error('Invalid device identity')
          this.cached = value
          return value
        } catch { throw new AuthenticationFailure('storage') }
        finally { stored.fill(0) }
      }
      const value = randomUUID()
      try { await this.write(file, value) } catch { throw new AuthenticationFailure('storage') }
      this.cached = value
      return value
    })
    this.tail = task.catch(() => {})
    return task
  }
  // This installation's session ID for one account (A6 §4 Desktop): kept apart from the saved credential, which signing
  // out removes, so signing in again to the same account on this Mac reuses the same session and the account's list
  // shows it once — as iOS keeps one per installation and account (MorseSignInSessionService). `current` is the ID a
  // credential saved by an earlier build already uses: it is kept, and written down for later sign-ins. A file that
  // cannot be read starts a new ID; one that cannot be written is only this run's (the next sign-in makes another).
  sessionId(uid: string, current?: string): Promise<string> {
    const task = this.tail.then(async (): Promise<string> => {
      await this.requireEncryption()
      const file = join(this.directory, `desktop-session-${identifier(uid)}.bin`)
      let stored: Buffer | null = null, kept = ''
      try { stored = await readFile(file) } catch { /* none yet */ }
      if (stored) {
        try { kept = (await safeStorage.decryptStringAsync(stored)).result } catch { /* unreadable: a new one below */ }
        finally { stored.fill(0) }
      }
      const valid = (value: string | undefined): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
      if (valid(current)) { if (current !== kept) await this.write(file, current).catch(() => {}); return current }
      if (valid(kept)) return kept
      const value = randomUUID()
      await this.write(file, value).catch(() => {})
      return value
    })
    this.tail = task.catch(() => {})
    return task
  }
  // The end-to-end key pair created with a new account stays on this device only.
  async saveKeypair(uid: string, pair: { publicKey: string; privateKey: string }): Promise<void> {
    try { await this.write(join(this.directory, `desktop-keypair-${identifier(uid)}.bin`), JSON.stringify(pair)) }
    catch { throw new AuthenticationFailure('storage') }
  }
}
