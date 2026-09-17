import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TranscriptResult } from '../../shared/transcript'

interface Waiting { resolve(value: Record<string, unknown>): void; timer: ReturnType<typeof setTimeout> }
export type CutoutResult = { status: 'ok'; png: Uint8Array } | { status: 'no-subject' | 'failed' | 'unavailable' }
export type VideoExport = { status: 'ok'; width: number; height: number; duration: number } | { status: 'too-long' | 'failed' | 'unavailable' }
const maxInput = 20 * 1024 * 1024

// Runs native/morse-media (Vision background removal, Speech recognition) the way ChatTranslator runs the
// translation helper: one child, JSON lines, a timeout per request, and nothing kept once answered.
export class MediaHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private readonly waiting = new Map<string, Waiting>()
  private quickExits = 0
  private unavailable = process.platform !== 'darwin'
  private closed = false

  private get path(): string {
    return app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/resources/native/morse-media') : join(app.getAppPath(), 'resources/native/morse-media')
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
      if (this.buffer.length > 64 * 1024 * 1024) { child.kill(); return }
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
      if (Date.now() - started < 3000 && ++this.quickExits >= 3) this.unavailable = true
      for (const [id, waiting] of this.waiting) { clearTimeout(waiting.timer); waiting.resolve({ id, status: 'unavailable' }) }
      this.waiting.clear()
    }
    child.on('error', ended); child.on('exit', ended)
    child.stdin.on('error', () => {})
    return child
  }
  private call(op: 'cutout' | 'transcribe' | 'crop-gif' | 'crop-mp4', data: Uint8Array, extra: Record<string, string | number>, timeout: number): Promise<Record<string, unknown>> {
    if (!data.byteLength || data.byteLength > maxInput) return Promise.resolve({ status: 'failed' })
    return this.request({ op, data: Buffer.from(data).toString('base64'), ...extra }, timeout)
  }
  private request(payload: Record<string, string | number>, timeout: number): Promise<Record<string, unknown>> {
    const child = this.process()
    if (!child) return Promise.resolve({ status: 'unavailable' })
    const id = randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ status: 'failed' }) }, timeout)
      this.waiting.set(id, { resolve, timer })
      child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`)
    })
  }
  async cutout(data: Uint8Array): Promise<CutoutResult> {
    const reply = await this.call('cutout', data, {}, 60000)
    if (reply.status === 'ok' && typeof reply.data === 'string') {
      const png = new Uint8Array(Buffer.from(reply.data, 'base64'))
      if (png.length > 8 && png[0] === 0x89 && png[1] === 0x50) return { status: 'ok', png }
      return { status: 'failed' }
    }
    return { status: reply.status === 'no-subject' || reply.status === 'unavailable' ? reply.status : 'failed' }
  }
  async transcribe(data: Uint8Array, locale: string): Promise<TranscriptResult> {
    const reply = await this.call('transcribe', data, { locale }, 120000)
    if (reply.status === 'ok' && typeof reply.text === 'string' && reply.text.trim()) return { status: 'ok', text: reply.text.slice(0, 20000) }
    return { status: reply.status === 'denied' || reply.status === 'unavailable' ? reply.status : 'failed' }
  }
  // VideoRecorderView.exportMP4: the file at `input` is exported with the send quality's preset into `output`.
  // `overlay`: a PNG laid over every frame of the exported part (MorseVideoMarkupExporter).
  async compressVideo(input: string, output: string, preset: string, maxSeconds: number, range?: { start: number; end: number }, overlay?: string): Promise<VideoExport> {
    const reply = await this.request({ op: 'compress-video', input, output, preset, maxSeconds, ...(range ? { start: range.start, end: range.end } : {}), ...(overlay ? { overlay } : {}) }, 15 * 60 * 1000)
    if (reply.status === 'ok' && [reply.width, reply.height, reply.duration].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return { status: 'ok', width: reply.width as number, height: reply.height as number, duration: reply.duration as number }
    }
    return { status: reply.status === 'too-long' || reply.status === 'unavailable' ? reply.status : 'failed' }
  }
  // «스티커 만들기» for a GIF or an MP4: the square at (x, y) with side `size`, drawn at `side` pixels.
  async cropAnimated(data: Uint8Array, kind: 'gif' | 'mp4', square: { x: number; y: number; size: number }, side: number): Promise<Uint8Array | null> {
    const reply = await this.call(kind === 'gif' ? 'crop-gif' : 'crop-mp4', data, { x: square.x, y: square.y, size: square.size, side }, 120000)
    return reply.status === 'ok' && typeof reply.data === 'string' ? new Uint8Array(Buffer.from(reply.data, 'base64')) : null
  }
  close(): void {
    this.closed = true
    const child = this.child; this.child = null
    for (const [id, waiting] of this.waiting) { clearTimeout(waiting.timer); waiting.resolve({ id, status: 'unavailable' }) }
    this.waiting.clear()
    child?.kill()
  }
}
