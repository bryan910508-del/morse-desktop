import type { StickerItem, StickerKind } from '../../shared/stickers'
import { stickerContentType } from '../../shared/stickers'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { MorseCallableFailure } from '../network/morse-callable'
import { downloadStickerFile, readStickerFile, registerStickerBytes, StickerRegistrationRefused, stickerPrefsName, stickerPrefsOf,
  type StickerFile, type StickerPrefs, type StickerRef } from '../network/sticker-files'
import { rangeResponse } from '../media/range-response'
import { documents } from '../network/firestore-values'
import { featureAccessPath, featureOn } from '../api/feature-switch'
import { tr } from '../../shared/i18n'

// B210 (contracts/B195-B210-stickers.md «검토 설계» B): this account's favourite and recent stickers are the server's
// lists, users/{uid}/stickerPrefs/main — Telegram's messages.getFavedStickers / getRecentStickers (tdesktop
// apiwrap.cpp:2981-2988), read and listened to here; only the server writes them. A favourite goes in or out through
// faveSticker (tdesktop Api::ToggleFavedSticker → MTPmessages_FaveSticker, api_toggling_media.cpp:63-76) and a recent
// one out through saveRecentSticker (ToggleRecentSticker, :81-99); the server keeps the limits (5, 10 for premium; 30).
// The stickers themselves are the server's copies (sticker_files), drawn on morse://app/__sticker/{sha}.
export interface LegacyStickers {
  list(): Promise<{ id: string; kind: StickerKind }[]>
  read(id: string): Promise<{ kind: StickerKind; data: Uint8Array } | null>
  clear(): Promise<void>
}
type Call = (name: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>

export class StickerLibrary {
  private prefs: StickerPrefs | null = null
  private reader: FirestoreReader | null = null
  private generation = 0
  private retry?: ReturnType<typeof setTimeout>
  private connected = false
  private closed = false
  private readonly files = new Map<string, StickerFile>()
  private readonly cache = new Map<string, Buffer>()
  private cacheBytes = 0
  private loading = new Map<string, Promise<Buffer>>()
  private migrating: Promise<void> | null = null
  private switchRead: { on: boolean; at: number } | null = null
  private migrated = false
  private migrateAfter = 0

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly call: Call,
    private readonly changed: () => void, private readonly premium: () => boolean | null, private readonly legacy: LegacyStickers) {}

  private validate(): void { if (this.closed || this.auth.signal.aborted) throw new Error(tr('계정이 변경되었습니다.')) }
  private items(list: StickerRef[] | undefined): StickerItem[] | null {
    return list ? list.map(ref => ({ id: ref.id, kind: ref.kind, size: this.files.get(ref.id)?.bytes ?? 0, url: `morse://app/__sticker/${ref.id}` })) : null
  }
  faved(): StickerItem[] | null {
    // The move waits for the list and the profile (premium decides five or ten); asked again with each snapshot.
    if (this.prefs && !this.migrated) void this.migrate()
    return this.items(this.prefs?.faved)
  }
  recent(): StickerItem[] | null { return this.items(this.prefs?.recent) }
  kindOf(id: string): StickerKind | null {
    return this.prefs?.faved.find(ref => ref.id === id)?.kind ?? this.prefs?.recent.find(ref => ref.id === id)?.kind ?? this.files.get(id)?.kind ?? null
  }
  isFaved(id: string): boolean { return Boolean(this.prefs?.faved.some(ref => ref.id === id)) }

  connection(connected: boolean): void {
    this.connected = connected
    if (connected && !this.reader && !this.closed) this.start()
  }
  private start(): void {
    clearTimeout(this.retry)
    const generation = ++this.generation, current = (): boolean => !this.closed && generation === this.generation
    let reader: FirestoreReader
    try { reader = new FirestoreReader(this.auth); this.reader = reader } catch { this.later(); return }
    const name = stickerPrefsName(this.uid)
    reader.watch({ documents: { documents: [name] } }, this.auth.signal, {
      snapshot: rows => {
        if (!current()) return
        this.prefs = stickerPrefsOf(rows.get(name))
        this.changed()
        void this.migrate()
      },
      // The rows already shown stay while the listen comes back (Telegram keeps its sets through a reconnect).
      reconnecting: () => {},
      state: state => { if (current() && state === 'error') { this.reader?.close(); this.reader = null; this.later() } }
    }, 1)
  }
  private later(): void {
    clearTimeout(this.retry)
    if (!this.closed) this.retry = setTimeout(() => { if (this.connected && !this.reader) this.start() }, 15000)
  }

  // sticker_reference_send (B195): read as two_step is — app_config and this account's featureAccess together — and kept a
  // minute; a read that fails counts as off (the bytes go, as before the reference).
  async referenceSendOn(): Promise<boolean> {
    if (this.switchRead && Date.now() - this.switchRead.at < 60000) return this.switchRead.on
    const reader = new FirestoreReader(this.auth), signal = AbortSignal.any([this.auth.signal, AbortSignal.timeout(15000)])
    try {
      const [config, access] = await Promise.all([
        reader.getDocument(`${documents}/app_config/sticker_reference_send`, signal).catch(() => null),
        reader.getDocument(`${documents}/${featureAccessPath(this.uid)}`, signal).catch(() => null)])
      const on = featureOn('sticker_reference_send', config, access)
      this.switchRead = { on, at: Date.now() }
      return on
    } catch { return false } finally { reader.close() }
  }
  // The server said the switch is off (STICKER_REFERENCE_OFF): believed until the next read.
  referenceSendRefused(): void { this.switchRead = { on: false, at: Date.now() } }
  // How a sticker goes: by reference only with the switch on and a copy registered, else by its bytes.
  async route(id: string): Promise<'reference' | 'bytes'> {
    return stickerSendRoute(await this.referenceSendOn().catch(() => false), Boolean(await this.file(id).catch(() => null)))
  }
  // The registry entry of a sticker: whether the server holds a copy to send by reference (B195) and its address.
  async file(id: string): Promise<StickerFile | null> {
    const known = this.files.get(id)
    if (known) return known
    const reader = this.reader ?? new FirestoreReader(this.auth)
    try {
      const file = await readStickerFile(reader, id, this.auth.signal, () => this.validate())
      if (file) this.files.set(id, file)
      return file
    } finally { if (reader !== this.reader) reader.close() }
  }
  async bytes(ref: StickerRef): Promise<Buffer> {
    const hit = this.cache.get(ref.id)
    if (hit) return hit
    const pending = this.loading.get(ref.id)
    if (pending) return pending
    const task = downloadStickerFile(this.auth, ref, AbortSignal.any([this.auth.signal, AbortSignal.timeout(60000)]), () => this.validate())
      .then(bytes => { this.remember(ref.id, bytes); return bytes }).finally(() => this.loading.delete(ref.id))
    this.loading.set(ref.id, task)
    return task
  }
  private remember(id: string, bytes: Buffer): void {
    if (this.cache.has(id)) return
    while (this.cacheBytes + bytes.length > 48 * 1024 * 1024 && this.cache.size) {
      const oldest = this.cache.keys().next().value!
      this.cacheBytes -= this.cache.get(oldest)!.length; this.cache.delete(oldest)
    }
    this.cache.set(id, bytes); this.cacheBytes += bytes.length
  }
  async response(id: string, request: Request): Promise<Response> {
    const kind = this.kindOf(id)
    if (this.closed || !kind || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 })
    try { return rangeResponse(await this.bytes({ id, kind }), stickerContentType[kind], request) }
    catch { return new Response(null, { status: 404 }) }
  }

  // faveSticker: in (to the front; the oldest leaves past the limit) or out. A sticker the server holds no copy of is
  // registered from its bytes first (registerStickerFile), as Telegram uploads a document before it can be faved.
  async fave(ref: StickerRef, unfave = false, bytes?: () => Promise<Uint8Array>): Promise<void> {
    this.validate()
    try { await this.call('faveSticker', { stickerId: ref.id, stickerKind: ref.kind, ...(unfave ? { unfave: true } : {}) }) }
    catch (error) {
      if (unfave || !bytes || !(error instanceof MorseCallableFailure && error.reason === 'STICKER_NOT_FOUND')) throw failure(error)
      const registered = await this.register(await bytes())
      await this.call('faveSticker', { stickerId: registered.id, stickerKind: registered.kind }).catch(reason => { throw failure(reason) })
    }
  }
  async faveBytes(raw: Uint8Array): Promise<StickerRef> {
    const ref = await this.register(raw)
    await this.call('faveSticker', { stickerId: ref.id, stickerKind: ref.kind }).catch(reason => { throw failure(reason) })
    return ref
  }
  async unrecent(ref: StickerRef): Promise<void> {
    this.validate()
    await this.call('saveRecentSticker', { stickerId: ref.id, stickerKind: ref.kind, unsave: true }).catch(reason => { throw failure(reason) })
  }
  async register(raw: Uint8Array): Promise<StickerRef> {
    this.validate()
    try {
      const ref = await registerStickerBytes(this.auth, this.uid, raw, this.call, this.auth.signal)
      // Known at once, before the list's snapshot names it: «저장 후 전송» sends it by reference right away.
      if (!this.files.has(ref.id)) this.files.set(ref.id, { ...ref, mediaUrl: '', bytes: raw.byteLength })
      this.remember(ref.id, Buffer.from(raw))
      return ref
    } catch (error) { throw failure(error) }
  }

  // B210 §4 (user decision 10-09): the favourites this device kept go to the server once — the newest five (ten for a
  // premium account), the oldest of them first so the server's order ends newest first — and the device's list is
  // emptied once every one has an answer. A sticker the server refuses (not 512, not a sticker) is left out; a network
  // failure keeps the list for the next start.
  private migrate(): Promise<void> {
    if (this.migrating || this.closed || this.migrated || Date.now() < this.migrateAfter) return this.migrating ?? Promise.resolve()
    const premium = this.premium()
    if (premium === null) return Promise.resolve()
    this.migrating = (async () => {
      const rows = await this.legacy.list()
      if (!rows.length) { this.migrated = true; return }
      for (const row of plannedMigration(rows, premium)) {
        this.validate()
        const stored = await this.legacy.read(row.id)
        if (!stored) continue
        try { await this.faveBytes(stored.data) }
        catch (error) { if (!(error instanceof StickerRefused)) throw error }
      }
      await this.legacy.clear()
      this.migrated = true
    })().catch(() => { this.migrateAfter = Date.now() + 60000 }).finally(() => { this.migrating = null; if (this.migrated) this.changed() })
    return this.migrating
  }

  close(): void {
    this.closed = true; this.generation++; clearTimeout(this.retry)
    this.reader?.close(); this.reader = null
    for (const bytes of this.cache.values()) bytes.fill(0)
    this.cache.clear(); this.cacheBytes = 0; this.files.clear(); this.prefs = null
  }
}

export function stickerSendRoute(switchOn: boolean, registered: boolean): 'reference' | 'bytes' { return switchOn && registered ? 'reference' : 'bytes' }

// The rows of the device's list (newest first, sticker-table.ts) that move: the newest `limit`, oldest of them first.
export function plannedMigration<T>(newestFirst: readonly T[], premium: boolean): T[] {
  return newestFirst.slice(0, premium ? 10 : 5).reverse()
}

export class StickerRefused extends Error {}
function failure(error: unknown): Error {
  if (error instanceof StickerRegistrationRefused) {
    return new StickerRefused(error.reason === 'not-512' ? tr('512×512 스티커만 즐겨찾기에 넣을 수 있어요.')
      : error.reason === 'too-large' ? tr('10MB 이하 파일을 선택해 주세요.') : tr('스티커로 저장할 수 없는 파일이에요. PNG, GIF 또는 MP4를 사용해 주세요.'))
  }
  if (error instanceof MorseCallableFailure && error.delivery === 'answered') {
    return new StickerRefused(error.status === 'RESOURCE_EXHAUSTED' ? tr('잠시 후 다시 시도해 주세요.') : tr('처리하지 못했습니다. 다시 시도해 주세요.'))
  }
  return error instanceof Error ? error : new Error(String(error))
}
