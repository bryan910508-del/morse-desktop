import { safeStorage } from 'electron'
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { identifier, object } from '../../shared/validation'
import { AuthenticationFailure, type SavedCredential } from './contracts'

function decodeCredential(value: unknown): SavedCredential {
  const record = object(value)
  const profile = object(record.profile)
  if (record.version !== 1 || typeof record.refreshToken !== 'string' || !record.refreshToken || record.refreshToken.length > 16384 ||
      !Number.isSafeInteger(record.authTime) || Number(record.authTime) <= 0 ||
      typeof profile.userId !== 'string' || typeof profile.displayName !== 'string' || profile.displayName.length > 512 || profile.userId.length > 160) {
    throw new AuthenticationFailure('storage')
  }
  return { version: 1, profile: { uid: identifier(profile.uid), userId: profile.userId, displayName: profile.displayName },
    sessionId: identifier(record.sessionId), refreshToken: record.refreshToken, authTime: Number(record.authTime),
    ...(record.provider === 'apple.com' ? { provider: 'apple.com' as const } : {}) }
}
interface AccountIndex { version: 1; order: string[]; active: string | null }
const uidPattern = /^[A-Za-z0-9_-]{1,160}$/

// Main::Domain keeps each account's own credential: one encrypted file per account. The
// index holds only the account order and the account shown last. The single file of earlier
// versions becomes the first account the first time the vault is used.
export class CredentialVault {
  private tail: Promise<unknown> = Promise.resolve()
  private migrated = false
  private readonly legacy: string
  private readonly accounts: string
  private readonly indexFile: string
  private readonly codes: string
  constructor(private readonly directory: string) {
    this.legacy = join(directory, 'desktop-credential.bin'); this.accounts = join(directory, 'accounts'); this.indexFile = join(directory, 'accounts.json')
    this.codes = join(directory, 'backup-codes')
  }

  private async requireEncryption(): Promise<void> {
    if (!['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) {
      throw new AuthenticationFailure('storage')
    }
  }
  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation)
    this.tail = task.catch(() => {})
    return task
  }
  get location(): string { return this.directory }
  async ready(): Promise<void> { await this.requireEncryption() }
  private file(uid: string): string { return join(this.accounts, `${identifier(uid)}.bin`) }
  private async readIndex(): Promise<AccountIndex> {
    try {
      const raw = object(JSON.parse(await readFile(this.indexFile, 'utf8')))
      const order = Array.isArray(raw.order) ? [...new Set(raw.order.filter((value): value is string => typeof value === 'string' && uidPattern.test(value)))] : []
      return { version: 1, order, active: typeof raw.active === 'string' && order.includes(raw.active) ? raw.active : null }
    } catch { return { version: 1, order: [], active: null } }
  }
  private async writeIndex(index: AccountIndex): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const pending = `${this.indexFile}.pending`, file = await open(pending, 'w', 0o600)
      try { await file.writeFile(JSON.stringify(index)); await file.sync() } finally { await file.close() }
      await rename(pending, this.indexFile)
    } catch { /* The order is a convenience; credentials stay authoritative. */ }
  }
  private async decrypt(path: string): Promise<SavedCredential | null> {
    let encrypted: Buffer
    try { encrypted = await readFile(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new AuthenticationFailure('storage')
    }
    try {
      await this.requireEncryption()
      if (encrypted.byteLength > 131072) throw new AuthenticationFailure('storage')
      const decoded = await safeStorage.decryptStringAsync(encrypted)
      const credential = decodeCredential(JSON.parse(decoded.result))
      if (decoded.shouldReEncrypt) await this.writeNow(credential)
      return credential
    } catch { throw new AuthenticationFailure('storage') }
    finally { encrypted.fill(0) }
  }
  private async migrate(): Promise<void> {
    if (this.migrated) return
    this.migrated = true
    const legacy = await this.decrypt(this.legacy).catch(() => null)
    if (!legacy) return
    await this.writeNow(legacy)
    const index = await this.readIndex()
    if (!index.order.includes(legacy.profile.uid)) index.order.unshift(legacy.profile.uid)
    index.active ??= legacy.profile.uid
    await this.writeIndex(index)
    for (const file of [this.legacy, `${this.legacy}.pending`]) await unlink(file).catch(() => {})
  }
  private async present(): Promise<string[]> {
    const index = await this.readIndex()
    const files = (await readdir(this.accounts).catch(() => [] as string[])).filter(name => name.endsWith('.bin')).map(name => name.slice(0, -4)).filter(uid => uidPattern.test(uid))
    return [...index.order.filter(uid => files.includes(uid)), ...files.filter(uid => !index.order.includes(uid))]
  }
  list(): Promise<string[]> { return this.ordered(async () => { await this.migrate(); return this.present() }) }
  active(): Promise<string | null> { return this.ordered(async () => { await this.migrate(); return (await this.readIndex()).active }) }
  setActive(uid: string): Promise<void> {
    return this.ordered(async () => {
      const index = await this.readIndex()
      if (!index.order.includes(uid)) index.order.push(identifier(uid))
      index.active = uid
      await this.writeIndex(index)
    }).catch(() => {})
  }
  read(uid: string): Promise<SavedCredential | null> {
    return this.ordered(async () => {
      await this.migrate()
      const credential = await this.decrypt(this.file(uid))
      if (credential && credential.profile.uid !== uid) throw new AuthenticationFailure('storage')
      return credential
    })
  }
  save(credential: SavedCredential): Promise<void> {
    return this.ordered(async () => {
      await this.migrate()
      const value = decodeCredential(credential)
      await this.writeNow(value)
      const index = await this.readIndex()
      if (!index.order.includes(value.profile.uid)) { index.order.push(value.profile.uid); await this.writeIndex(index) }
    })
  }
  private async writeNow(credential: SavedCredential): Promise<void> {
    try {
      await this.requireEncryption()
      await mkdir(this.accounts, { recursive: true, mode: 0o700 })
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(credential))
      try {
        const target = this.file(credential.profile.uid), pending = `${target}.pending`
        const file = await open(pending, 'w', 0o600)
        try { await file.writeFile(encrypted); await file.sync() }
        finally { await file.close() }
        await rename(pending, target)
      } finally { encrypted.fill(0) }
    } catch { throw new AuthenticationFailure('storage') }
  }
  // iOS SavedAccount.backupCode: the recovery code made on this device for an Apple sign-up, which is never
  // shown then, stays with the account's login so a new code can be made from settings.
  saveBackupCode(uid: string, code: string): Promise<void> {
    return this.ordered(async () => {
      if (!/^[A-Z0-9-]{1,64}$/.test(code)) throw new AuthenticationFailure('storage')
      try {
        await this.requireEncryption()
        await mkdir(this.codes, { recursive: true, mode: 0o700 })
        const encrypted = await safeStorage.encryptStringAsync(code)
        try {
          const target = join(this.codes, `${identifier(uid)}.bin`), pending = `${target}.pending`
          const file = await open(pending, 'w', 0o600)
          try { await file.writeFile(encrypted); await file.sync() }
          finally { await file.close() }
          await rename(pending, target)
        } finally { encrypted.fill(0) }
      } catch { throw new AuthenticationFailure('storage') }
    })
  }
  backupCode(uid: string): Promise<string | null> {
    return this.ordered(async () => {
      let encrypted: Buffer
      try { encrypted = await readFile(join(this.codes, `${identifier(uid)}.bin`)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new AuthenticationFailure('storage') }
      try {
        await this.requireEncryption()
        const code = (await safeStorage.decryptStringAsync(encrypted)).result
        return /^[A-Z0-9-]{1,64}$/.test(code) ? code : null
      } catch { throw new AuthenticationFailure('storage') }
      finally { encrypted.fill(0) }
    })
  }
  remove(uid: string): Promise<void> {
    return this.ordered(async () => {
      // Delete both encrypted records and a kept recovery code; a leftover pending file is never restored.
      const target = this.file(uid), code = join(this.codes, `${identifier(uid)}.bin`)
      for (const file of [target, `${target}.pending`, code, `${code}.pending`]) {
        try { await unlink(file) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AuthenticationFailure('storage') }
      }
      const index = await this.readIndex()
      index.order = index.order.filter(value => value !== uid)
      if (index.active === uid) index.active = index.order[0] ?? null
      await this.writeIndex(index)
    })
  }
  async flush(): Promise<void> { await this.tail }
}
