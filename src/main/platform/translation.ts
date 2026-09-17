import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { maxTranslationText, translationTarget, type TranslationResult } from '../../shared/translation'

interface Waiting { resolve(value: Record<string, unknown>): void; timer: ReturnType<typeof setTimeout> }
const cacheLimit = 500

// Runs the on-device translation helper (native/morse-translate) and keeps recent results in
// memory, like Telegram's per-message translation cache. Nothing is written to disk or logs.
export class ChatTranslator {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private readonly waiting = new Map<string, Waiting>()
  private readonly results = new Map<string, TranslationResult>()
  private readonly gates = new Map<string, boolean>()
  private quickExits = 0
  private unavailable = process.platform !== 'darwin'
  private closed = false

  private get path(): string {
    return app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/resources/native/morse-translate') : join(app.getAppPath(), 'resources/native/morse-translate')
  }
  private process(): ChildProcessWithoutNullStreams | null {
    if (this.child) return this.child
    if (this.closed || this.unavailable || !existsSync(this.path)) { this.unavailable = true; return null }
    const started = Date.now()
    const child = spawn(this.path, [], { stdio: 'pipe' })
    this.child = child; this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > 4 * 1024 * 1024) { child.kill(); return }
      let index: number
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1)
        try {
          const value = JSON.parse(line) as Record<string, unknown>
          const waiting = typeof value.id === 'string' ? this.waiting.get(value.id) : undefined
          if (waiting) { this.waiting.delete(value.id as string); clearTimeout(waiting.timer); waiting.resolve(value) }
        } catch { /* A malformed line answers nothing; its request times out. */ }
      }
    })
    child.stderr.resume()
    const ended = (): void => {
      if (this.child !== child) return
      this.child = null
      // A helper that cannot start on this macOS exits at once; stop trying after a few.
      if (Date.now() - started < 3000 && ++this.quickExits >= 3) this.unavailable = true
      for (const [id, waiting] of this.waiting) { clearTimeout(waiting.timer); waiting.resolve({ id, status: 'unavailable' }) }
      this.waiting.clear()
    }
    child.on('error', ended); child.on('exit', ended)
    child.stdin.on('error', () => {})
    return child
  }
  private call(op: 'gate' | 'translate', text: string, timeout: number): Promise<Record<string, unknown>> {
    const child = this.process()
    if (!child) return Promise.resolve({ status: 'unavailable' })
    const id = randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ status: 'failed' }) }, timeout)
      this.waiting.set(id, { resolve, timer })
      child.stdin.write(`${JSON.stringify({ id, op, text, target: translationTarget() })}\n`)
    })
  }
  private key(text: string): string { return createHash('sha256').update(translationTarget()).update('\0').update(text).digest('hex') }
  private remember<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key); map.set(key, value)
    if (map.size > cacheLimit) map.delete(map.keys().next().value!)
  }
  // MorseChatTranslateLanguageGate: offer translation only for text in another language.
  async differs(text: string): Promise<boolean> {
    if (!text.trim() || text.length > maxTranslationText) return false
    const key = this.key(text), known = this.gates.get(key)
    if (known !== undefined) return known
    const reply = await this.call('gate', text, 5000)
    if (typeof reply.differs !== 'boolean') return false
    this.remember(this.gates, key, reply.differs)
    return reply.differs
  }
  async translate(text: string): Promise<TranslationResult> {
    if (!text.trim()) return { status: 'same-language' }
    if (text.length > maxTranslationText) return { status: 'failed' }
    const key = this.key(text), known = this.results.get(key)
    if (known) return known
    const reply = await this.call('translate', text, 60000)
    const result: TranslationResult = reply.status === 'translated' && typeof reply.text === 'string' && reply.text.length <= maxTranslationText * 4
      ? { status: 'translated', text: reply.text }
      : { status: ['same-language', 'unsupported', 'not-installed', 'unavailable'].includes(String(reply.status)) ? reply.status as 'same-language' : 'failed' }
    // Missing languages and failures are asked again; the user may download a language meanwhile.
    if (result.status === 'translated' || result.status === 'same-language' || result.status === 'unsupported') this.remember(this.results, key, result)
    return result
  }
  close(): void {
    this.closed = true
    const child = this.child; this.child = null
    for (const [id, waiting] of this.waiting) { clearTimeout(waiting.timer); waiting.resolve({ id, status: 'unavailable' }) }
    this.waiting.clear(); this.results.clear(); this.gates.clear()
    child?.kill()
  }
}
