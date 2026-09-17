import { safeStorage } from 'electron'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppCheckProof } from './contracts'

// The last App Check proof, encrypted with the OS keychain, so a restart within its lifetime
// (the project's App Check TTL, at most about one hour) does not need another reCAPTCHA
// assessment. The token proves the app client only; it carries no account or session data.
export class ProofTokenStore {
  private readonly file: string
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory: string) { this.file = join(directory, 'app-check-proof.bin') }

  async read(): Promise<string | null> {
    let raw: Buffer
    try { raw = await readFile(this.file) } catch { return null }
    try {
      if (raw.byteLength > 65536 || !['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) return null
      const value = JSON.parse((await safeStorage.decryptStringAsync(raw)).result) as { token?: unknown }
      return typeof value.token === 'string' && value.token.length <= 16384 ? value.token : null
    } catch { return null }
    finally { raw.fill(0) }
  }
  save(proof: AppCheckProof): Promise<void> {
    const task = this.tail.then(async () => {
      if (!['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) return
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ token: proof.token }))
      try {
        const pending = `${this.file}.pending`, handle = await open(pending, 'w', 0o600)
        try { await handle.writeFile(encrypted); await handle.sync() } finally { await handle.close() }
        await rename(pending, this.file)
      } finally { encrypted.fill(0) }
    }).catch(() => {})
    this.tail = task
    return task
  }
}
