import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Local diagnostics for list photos that stay as initials. Each line has the surface, a per-run
// alias for the person or chat (never the uid), the step and a short technical detail. No photo
// address, file name, token or account data is written. Repeated identical lines are skipped.
export type AvatarLogSurface = 'dialogs' | 'contacts'
const aliases = new Map<string, string>(), seen = new Set<string>()
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordAvatarStep(surface: AvatarLogSurface, subject: string, step: string, detail = ''): void {
  if (written >= 400) return
  let alias = ''
  if (subject) {
    alias = aliases.get(subject) ?? `p${aliases.size + 1}`
    aliases.set(subject, alias)
  }
  const short = detail.slice(0, 120), key = `${surface}|${alias}|${step}|${short}`
  if (seen.has(key)) return
  seen.add(key); written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), surface, subject: alias, step, detail: short })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'avatar-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 256 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}

// The shape of a photo address: host, bucket and path layout only, never the path itself.
export function photoAddressShape(raw: string, owner: string): string {
  try {
    let bucket = '', parts: string[] = [], host = 'gs'
    if (raw.startsWith('gs://')) { const rest = raw.slice(5); bucket = rest.split('/')[0] ?? ''; parts = rest.split('/').slice(1) }
    else {
      const url = new URL(raw), match = /^\/v0\/b\/([^/]+)\/o\/(.*)$/.exec(url.pathname)
      host = url.hostname
      if (!match) return `host=${host} layout=not-storage`
      bucket = match[1] ?? ''; parts = decodeURIComponent(match[2] ?? '').split('/')
    }
    return `host=${host} bucket=${bucket} root=${parts[0] ?? ''} parts=${parts.length} owner=${parts[1] === owner ? 'same' : 'other'}`
  } catch { return 'invalid-address' }
}
