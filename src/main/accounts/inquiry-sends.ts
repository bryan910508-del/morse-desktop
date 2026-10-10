import { createHash } from 'node:crypto'
import type { InquiryMessageKind, InquirySendItem } from '../../shared/channel-inquiries'
import type { ReadCredentials } from '../network/firestore-rpc'
import { callMorseFunction, MorseCallableFailure, transientAnswers } from '../network/morse-callable'
import { uploadInquiryAttachment } from '../network/inquiry-photo-upload-api'
import { UploadRefused } from '../network/upload-refused'
import { DeliveryCommandFailure } from '../storage/delivery-client'
import type { InquirySendCommand, InquirySendMedia, StoredInquirySend } from '../storage/inquiry-send-table'
import { tr } from '../../shared/i18n'
import { stickerReferenceRefusals } from '../messaging/text-identity'
import { stickerSidePx } from '../../shared/stickers'
import { recordRetry } from '../platform/connection-diagnostics'

// The device's queue of messages sent into inquiry rooms (user decision 2026-09-29: it survives a restart, as
// Telegram's outgoing messages do and Android's and iOS's inquiry queues do). A message is handed over once and then
// goes by itself: its file up to Storage (the object is named by the message id, so an upload that broke is resumed,
// not doubled), then sendMorseInquiryMessage under its client message id, which the server accepts once and answers
// again with the same acknowledgement (morse-release-authority.js acceptedMessages). So whatever became of an attempt
// — never left, or no answer — it goes again under the same id, after a wait that grows to a minute while the
// connection is up and at once when the connection comes back. Only the server's refusal stops it; the person can
// then send it again or take it away. A room's messages go in the order they were written.
export function inquiryRetryDelay(attempt: number): number { return Math.min(60000, 1000 * 2 ** Math.max(0, attempt - 1)) }
// How long a message that went is still drawn from here, until the room's own history shows it.
const sentVisibleMs = 60000

export interface InquirySendRequest { id: string; inquiryId: string; message: Record<string, unknown>; preview: { kind: InquiryMessageKind; text: string }
  media?: { bytes: Uint8Array; extension: InquirySendMedia['extension']; noun: string; urlInText: boolean } }

export class InquirySends {
  private closed = false
  private failed = false
  private loaded = false
  private generation = new AbortController()
  private task: Promise<void> | null = null
  private rerun = false
  private busy: string | null = null
  private rows: StoredInquirySend[] = []
  private retries = new Map<string, { attempt: number; at: number }>()
  private recent = new Map<string, { item: InquirySendItem; until: number }>()
  private wake: ReturnType<typeof setTimeout> | null = null
  private expiry: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly storage: <T>(command: InquirySendCommand) => Promise<T>, private readonly changed: () => void,
    // Sending, over the network; a test gives its own.
    private readonly network: {
      send: (payload: Record<string, unknown>, signal: AbortSignal, validate: () => void) => Promise<unknown>
      upload: (upload: { inquiryId: string; messageId: string; bytes: Uint8Array; extension: InquirySendMedia['extension']; noun: string; sha256: string; md5: string }, signal: AbortSignal, validate: () => void) => Promise<string>
    } = {
      send: (payload, signal, validate) => callMorseFunction(auth, 'sendMorseInquiryMessage', payload, signal, { validate }),
      upload: (upload, signal, validate) => uploadInquiryAttachment(auth, uid, upload, AbortSignal.any([signal, AbortSignal.timeout(600000)]), () => {}, validate)
    }) {}

  items(): InquirySendItem[] {
    const now = Date.now()
    for (const [id, entry] of this.recent) if (entry.until <= now || this.rows.some(row => row.id === id)) this.recent.delete(id)
    return [...this.rows.map(row => ({ id: row.id, inquiryId: row.inquiryId, kind: row.preview.kind, text: row.preview.text, at: row.createdAt,
      state: row.state === 'failed' ? 'failed' as const : 'sending' as const, reason: row.reason, busy: row.id === this.busy })), ...[...this.recent.values()].map(entry => entry.item)]
  }
  private publish(): void { if (!this.closed) this.changed() }
  private async store<T = void>(command: InquirySendCommand): Promise<T> {
    if (this.closed || this.failed) throw new Error(tr('메시지 대기열을 사용할 수 없습니다. 앱을 다시 열어 주세요.'))
    try { return await this.storage<T>(command) }
    catch (error) {
      if (!(error instanceof DeliveryCommandFailure) || error.code === 'storage') { this.failed = true; this.pause() }
      throw error
    }
  }
  private async reload(): Promise<void> { this.rows = await this.store<StoredInquirySend[]>({ kind: 'inquiry-send-list' }) }
  async load(): Promise<void> {
    await this.reload()
    this.loaded = true
    this.publish(); this.kick()
  }
  // Handed over: kept on the device first, then sent. The file goes with it, so nothing more is needed from the room.
  async enqueue(request: InquirySendRequest): Promise<void> {
    if (!this.loaded) await this.load()
    const media = request.media ? { extension: request.media.extension, noun: request.media.noun, urlInText: request.media.urlInText, size: request.media.bytes.byteLength,
      sha256: createHash('sha256').update(request.media.bytes).digest('hex'), md5: createHash('md5').update(request.media.bytes).digest('base64') } : null
    try {
      await this.store({ kind: 'inquiry-send-enqueue', id: request.id, inquiryId: request.inquiryId, payload: { message: request.message, preview: request.preview, media },
        ...(request.media ? { bytes: request.media.bytes } : {}), createdAt: Date.now() })
    } catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code === 'capacity') throw new Error(tr('보내는 중인 메시지가 너무 많습니다. 앞의 메시지가 간 뒤 다시 보내 주세요.'))
      throw error
    }
    await this.reload()
    this.publish(); this.kick()
  }
  // The person sends a refused message again, under the same id.
  async retry(id: string): Promise<void> {
    const row = this.rows.find(entry => entry.id === id)
    if (!row || row.state !== 'failed') return
    await this.store({ kind: 'inquiry-send-state', id, state: 'queued', reason: '' })
    this.retries.delete(id)
    await this.reload(); this.publish(); this.kick()
  }
  async discard(id: string): Promise<void> {
    if (this.busy === id) throw new Error(tr('메시지를 보내는 중입니다. 잠시 후 다시 시도해 주세요.'))
    await this.store({ kind: 'inquiry-send-remove', id })
    this.retries.delete(id)
    await this.reload(); this.publish()
  }
  // A room that was deleted takes what was still going into it.
  async forgetRoom(inquiryId: string): Promise<void> {
    if (!this.rows.some(row => row.inquiryId === inquiryId)) return
    await this.store({ kind: 'inquiry-send-forget-room', inquiryId })
    await this.reload(); this.publish()
  }
  // The connection went: what is in flight stops and waits as it is.
  pause(): void {
    this.generation.abort(); this.generation = new AbortController()
    this.retries.clear(); this.unschedule(); this.publish()
  }
  // The connection is back: everything waiting goes at once.
  resume(): void { this.kick() }
  // The network is back (reachability.ts): a message waiting out its wait goes now, and its waits start over.
  retryNow(): void { this.retries.clear(); this.unschedule(); this.kick() }
  async close(): Promise<void> {
    this.closed = true; this.pause()
    if (this.expiry) clearTimeout(this.expiry)
    await this.task?.catch(() => {})
  }
  private unschedule(): void { if (this.wake) { clearTimeout(this.wake); this.wake = null } }
  private connected(): boolean { try { this.allowed(); return true } catch { return false } }
  private active(signal: AbortSignal): boolean { return !this.closed && !this.failed && !signal.aborted && !this.auth.signal.aborted && this.connected() }
  private kick(): void {
    if (!this.loaded || !this.active(this.generation.signal)) return
    if (this.task) { this.rerun = true; return }
    const task = this.drain(this.generation.signal)
    this.task = task
    void task.catch(() => {}).finally(() => {
      if (this.task !== task) return
      this.task = null; this.busy = null; this.publish()
      if (this.rerun) { this.rerun = false; this.kick() }
    })
  }
  // The next message that may go: the first waiting one of each room, unless it is still waiting out a retry.
  private next(now: number): StoredInquirySend | null {
    const held = new Set<string>()
    for (const row of this.rows) {
      if (row.state !== 'queued' || held.has(row.inquiryId)) continue
      if ((this.retries.get(row.id)?.at ?? 0) > now) { held.add(row.inquiryId); continue }
      return row
    }
    return null
  }
  private schedule(now: number): void {
    const due = this.rows.filter(row => row.state === 'queued').map(row => this.retries.get(row.id)?.at ?? 0).filter(at => at > now)
    this.unschedule()
    if (due.length) this.wake = setTimeout(() => { this.wake = null; this.kick() }, Math.max(50, Math.min(...due) - now))
  }
  private async drain(signal: AbortSignal): Promise<void> {
    while (this.active(signal)) {
      const row = this.next(Date.now())
      if (!row) { this.schedule(Date.now()); return }
      this.busy = row.id; this.publish()
      await this.attempt(row, signal)
      this.busy = null
      await this.reload()
      this.publish()
    }
  }
  // B246 (contracts/B195-B210-stickers.md «다시 보내는 id·문의방»): the same refused reference, by the bytes the account
  // finds for it (the set's file, else the server's copy), stays where it is and goes again; with none to be had it
  // stays refused, saying so for a sticker.
  stickerBytes: ((ref: { id: string; kind: 'png' | 'gif' | 'mp4'; setId?: string }) => Promise<Uint8Array | null>) | null = null
  stickerReferenceOff: (() => void) | null = null
  private async stickerToBytes(row: StoredInquirySend, reason: string): Promise<void> {
    if (reason === 'STICKER_REFERENCE_OFF') this.stickerReferenceOff?.()
    const message = row.message, id = String(message.stickerId), kind = message.stickerKind
    const ref = (kind === 'png' || kind === 'gif' || kind === 'mp4') ? { id, kind, ...(typeof message.stickerSetId === 'string' ? { setId: message.stickerSetId } : {}) } as const : null
    const bytes = ref ? await this.stickerBytes?.(ref).catch(() => null) ?? null : null
    if (!ref || !bytes || createHash('sha256').update(bytes).digest('hex') !== ref.id) {
      await this.store({ kind: 'inquiry-send-state', id: row.id, state: 'failed', reason: tr('이 스티커를 보내지 못했습니다. 스티커를 다시 골라 보내 주세요.') })
      return
    }
    const { stickerId: _id, stickerKind: _kind, stickerSetId: _set, ...rest } = message
    const payload = { message: { ...rest, mediaWidthPx: stickerSidePx, mediaHeightPx: stickerSidePx }, preview: row.preview,
      media: { extension: ref.kind, noun: tr('스티커'), urlInText: false, size: bytes.byteLength, sha256: ref.id, md5: createHash('md5').update(bytes).digest('base64') } }
    await this.store({ kind: 'inquiry-send-sticker-bytes', id: row.id, payload, bytes })
  }
  private async attempt(row: StoredInquirySend, signal: AbortSignal): Promise<void> {
    const validate = (): void => { signal.throwIfAborted(); this.allowed() }
    let stage = 'upload'
    try {
      let url = row.mediaUrl
      if (row.media && !url) {
        const bytes = await this.store<Uint8Array | null>({ kind: 'inquiry-send-media', id: row.id })
        if (!bytes || bytes.byteLength !== row.media.size) throw new UploadRefused(tr('보낼 파일을 찾지 못했습니다. 삭제한 뒤 다시 보내 주세요.'))
        try { url = await this.network.upload({ inquiryId: row.inquiryId, messageId: row.id, bytes, extension: row.media.extension, noun: row.media.noun, sha256: row.media.sha256, md5: row.media.md5 }, signal, validate) }
        finally { bytes.fill(0) }
        await this.store({ kind: 'inquiry-send-uploaded', id: row.id, url })
      }
      const payload = { ...row.message, inquiryId: row.inquiryId, clientMessageId: row.id, senderId: this.uid,
        ...(url ? { mediaUrl: url, ...(row.media?.urlInText ? { text: url } : {}) } : {}) }
      stage = 'send'
      await this.network.send(payload, signal, validate)
      await this.store({ kind: 'inquiry-send-remove', id: row.id })
      this.retries.delete(row.id)
      this.recent.set(row.id, { item: { id: row.id, inquiryId: row.inquiryId, kind: row.preview.kind, text: row.preview.text, at: row.createdAt, state: 'sent', reason: '', busy: false }, until: Date.now() + sentVisibleMs })
      if (this.expiry) clearTimeout(this.expiry)
      this.expiry = setTimeout(() => { this.expiry = null; this.publish() }, sentVisibleMs + 50)
    } catch (error) {
      // The connection went while it was on its way: it waits as it is and goes when the connection is back.
      if (!this.active(signal)) return
      // Only a refusal for good fails the message; a busy or contended server, or a proof that had just expired, is
      // tried again like a lost connection (morse-callable.ts transientAnswers).
      const refused = (error instanceof MorseCallableFailure && error.delivery === 'answered' && !transientAnswers.has(error.status)) || error instanceof UploadRefused
      // B246: a sticker reference refused for its copy or the switch goes again by its bytes under the same id.
      if (refused && error instanceof MorseCallableFailure && stickerReferenceRefusals.has(error.reason) && typeof row.message.stickerId === 'string') {
        this.retries.delete(row.id)
        await this.stickerToBytes(row, error.reason)
        return
      }
      if (refused) {
        this.retries.delete(row.id)
        await this.store({ kind: 'inquiry-send-state', id: row.id, state: 'failed',
          reason: error instanceof UploadRefused ? error.message : tr('문의방이 이 메시지를 받지 않았습니다. 채널 구독 상태를 확인해 주세요.') })
        return
      }
      const attempt = (this.retries.get(row.id)?.attempt ?? 0) + 1
      recordRetry('inquiry', stage, error, inquiryRetryDelay(attempt))
      this.retries.set(row.id, { attempt, at: Date.now() + inquiryRetryDelay(attempt) })
    }
  }
}
