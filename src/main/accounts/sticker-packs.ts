import { createHash, randomInt } from 'node:crypto'
import type { StickerPack, StickerPackItem, StickerPackSnapshot } from '../../shared/sticker-packs'
import { maxStickerBytes, stickerContentType, stickerKind } from '../../shared/stickers'
import { maxStickerPackItems, maxStickerPackTitle } from '../../shared/sticker-packs'
import { uploadStorageObject } from '../network/storage-object'
import { ownedStickerPacksQuery, stickerIndexCreateWrite, stickerPackAddWrite, stickerPackCreateWrite } from '../network/sticker-pack-write'
import { documents } from '../network/firestore-values'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { installedStickerPackIds, readStickerPack, resolveStickerPack, stickerPackFromDocument } from '../network/sticker-pack-read'
import { downloadStickerPackItem } from '../network/sticker-pack-media'
import { rangeResponse } from '../media/range-response'
import { tr } from '../../shared/i18n'

// Telegram StickerPackScreen for this account, as iOS MorseStickerPackSheet / MorseStickerSetStore: the set a
// tapped sticker belongs to (found by the SHA-256 of its bytes), the sets this account installed, and their
// stickers served to the window from a hash-verified cache.
export class StickerPacks {
  private value: StickerPackSnapshot | null = null
  private opening: AbortController | null = null
  private installed: StickerPack[] | null = null
  private installedLoad: Promise<void> | null = null
  private readonly cache = new Map<string, { bytes: Buffer; item: StickerPackItem }>()
  private cacheBytes = 0
  private closed = false

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly reader: () => FirestoreReader | null,
    private readonly changed: () => void, private readonly stickerBytes: (chatId: string, messageId: string, version: string, signal: AbortSignal) => Promise<Buffer>) {}

  private validate(): void { if (this.closed || this.auth.signal.aborted) throw new Error('Sticker pack account changed') }
  private currentReader(): FirestoreReader {
    const reader = this.reader()
    if (!reader) throw new Error(tr('계정 연결을 확인해 주세요.'))
    return reader
  }

  snapshot(): StickerPackSnapshot | null { return this.value ? { ...this.value, pack: this.value.pack, installed: this.isInstalled(this.value.pack?.id) } : null }
  isInstalled(setId: string | undefined): boolean { return Boolean(setId && this.installed?.some(pack => pack.id === setId)) }

  // users/{uid}/stickerSets → the sets themselves, once per session and after each install change.
  installedPacks(): StickerPack[] | null {
    if (this.closed) return null
    if (!this.installed && !this.installedLoad) {
      const signal = this.auth.signal
      this.installedLoad = (async () => {
        const reader = this.currentReader()
        const ids = await installedStickerPackIds(reader, this.uid, signal)
        const packs: StickerPack[] = []
        for (const id of ids) {
          const pack = await readStickerPack(reader, id, signal, () => this.validate()).catch(() => null)
          if (pack) packs.push(pack)
        }
        this.validate()
        this.installed = packs
      })().catch(() => {}).finally(() => { this.installedLoad = null; if (!this.closed) this.changed() })
    }
    return this.installed
  }

  packNamed(setId: string): StickerPack | null {
    if (this.value?.pack?.id === setId) return this.value.pack
    return this.installed?.find(pack => pack.id === setId) ?? null
  }

  // A sticker bubble was tapped: hash its bytes and show its set, or say it has none.
  async open(chatId: string, messageId: string, version: string): Promise<void> {
    this.opening?.abort(); const abort = new AbortController(); this.opening = abort
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(60000)])
    this.value = { status: 'loading', chatId, pack: null, highlighted: null, installed: false, busy: false, message: '' }
    this.changed()
    try {
      const bytes = await this.stickerBytes(chatId, messageId, version, signal)
      const hash = createHash('sha256').update(bytes).digest('hex')
      const resolved = await resolveStickerPack(this.currentReader(), hash, signal, () => { this.validate(); signal.throwIfAborted() })
      if (this.opening !== abort) return
      if (resolved) this.remember(resolved.item, bytes)
      this.value = resolved
        ? { status: 'ready', chatId, pack: resolved.pack, highlighted: resolved.item.id, installed: this.isInstalled(resolved.pack.id), busy: false, message: '' }
        : { status: 'none', chatId, pack: null, highlighted: null, installed: false, busy: false, message: tr('이 스티커는 스티커팩에 속해 있지 않아요.') }
    } catch {
      if (this.opening !== abort || this.closed) return
      this.value = { status: 'error', chatId, pack: null, highlighted: null, installed: false, busy: false, message: tr('스티커팩을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.') }
    } finally { if (this.opening === abort) this.opening = null; if (!this.closed) this.changed() }
  }
  closeSheet(): void { this.opening?.abort(); this.opening = null; this.value = null; if (!this.closed) this.changed() }

  private async change(setId: string, action: (reader: FirestoreReader, pack: StickerPack) => Promise<void>): Promise<void> {
    const pack = this.packNamed(setId)
    if (!pack) throw new Error(tr('스티커팩을 다시 열어 주세요.'))
    if (this.value?.busy) throw new Error(tr('스티커팩을 변경하는 중입니다.'))
    if (this.value) { this.value = { ...this.value, busy: true, message: '' }; this.changed() }
    try {
      await action(this.currentReader(), pack)
      this.installed = null
      this.installedPacks()
    } finally { if (this.value) { this.value = { ...this.value, busy: false }; this.changed() } }
  }
  install(setId: string): Promise<void> {
    return this.change(setId, async (reader, pack) => {
      await reader.installStickerPack(this.uid, pack, this.auth.signal, () => this.validate())
      this.installed = [pack, ...(this.installed ?? []).filter(known => known.id !== pack.id)]
    })
  }
  uninstall(setId: string): Promise<void> {
    return this.change(setId, async reader => {
      await reader.uninstallStickerPack(this.uid, setId, this.auth.signal, () => this.validate())
      this.installed = (this.installed ?? []).filter(known => known.id !== setId)
    })
  }

  // The sets this account made (MorseStickerSetStore.mine), for the sticker editor's «내 팩에 추가».
  async ownedPacks(): Promise<StickerPack[]> {
    const reader = this.currentReader()
    const rows = await reader.query(`${documents}`, ownedStickerPacksQuery(this.uid, 50), this.auth.signal)
    this.validate()
    return rows.flatMap(doc => { try { const pack = stickerPackFromDocument(doc); return pack && pack.ownerUid === this.uid ? [pack] : [] } catch { return [] } })
  }
  // createSet: a new empty set this account owns, installed at once as Telegram installs a set it just created.
  async createPack(rawTitle: string, ownerName: string): Promise<StickerPack> {
    const title = rawTitle.trim().slice(0, maxStickerPackTitle)
    if (!title) throw new Error(tr('스티커팩 이름을 입력해 주세요.'))
    const reader = this.currentReader()
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const setId = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join('')
    const pack: StickerPack = { id: setId, ownerUid: this.uid, ownerName: ownerName.trim().slice(0, 50), title, items: [] }
    await reader.commitStickerPackWrites([stickerPackCreateWrite(setId, this.uid, pack.ownerName, title)], this.auth.signal)
    this.validate()
    await reader.installStickerPack(this.uid, pack, this.auth.signal, () => this.validate()).catch(() => {})
    this.installed = [pack, ...(this.installed ?? []).filter(known => known.id !== setId)]
    this.changed()
    return pack
  }
  // addSticker: the file under sticker_sets/{setId}/{sha256}.{kind} with ownerUid/setId metadata, then the set's list
  // and count, then the hash index a receiver resolves the set from. Bytes the set already holds change nothing.
  async addToPack(setId: string, raw: Uint8Array): Promise<StickerPack> {
    const kind = stickerKind(raw)
    if (!kind) throw new Error(tr('PNG, GIF 또는 MP4 스티커만 추가할 수 있습니다.'))
    if (raw.byteLength > maxStickerBytes) throw new Error(tr('10MB 이하 파일을 선택해 주세요.'))
    const reader = this.currentReader()
    const pack = await readStickerPack(reader, setId, this.auth.signal, () => this.validate())
    if (!pack || pack.ownerUid !== this.uid) throw new Error(tr('내가 만든 스티커팩에만 추가할 수 있습니다.'))
    const hash = createHash('sha256').update(raw).digest('hex')
    if (pack.items.some(item => item.id === hash)) return pack
    if (pack.items.length >= maxStickerPackItems) throw new Error(tr('스티커팩에는 스티커를 {0}개까지 넣을 수 있습니다.', [maxStickerPackItems]))
    const item: StickerPackItem = { id: hash, kind, path: `sticker_sets/${pack.id}/${hash}.${kind}`, emoji: '', bytes: raw.byteLength }
    await uploadStorageObject(this.auth, item.path, raw, stickerContentType[kind], { ownerUid: this.uid, setId: pack.id }, AbortSignal.any([this.auth.signal, AbortSignal.timeout(300000)]))
    this.validate()
    await reader.commitStickerPackWrites([stickerPackAddWrite(pack.id, item)], this.auth.signal)
    await reader.commitStickerPackWrites([stickerIndexCreateWrite(hash, pack.id, this.uid)], this.auth.signal).catch(() => {})
    this.remember(item, Buffer.from(raw))
    const next = { ...pack, items: [...pack.items, item] }
    if (this.installed?.some(known => known.id === pack.id)) this.installed = this.installed.map(known => known.id === pack.id ? next : known)
    this.changed()
    return next
  }

  private remember(item: StickerPackItem, bytes: Buffer): void {
    if (this.cache.has(item.id)) return
    while (this.cacheBytes + bytes.length > 64 * 1024 * 1024 && this.cache.size) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cacheBytes -= this.cache.get(oldest)!.bytes.length; this.cache.delete(oldest)
    }
    this.cache.set(item.id, { bytes: Buffer.from(bytes), item }); this.cacheBytes += bytes.length
  }
  // The bytes of one sticker of a known set, downloaded once and verified against their id.
  async itemBytes(setId: string, itemId: string): Promise<Buffer> {
    const hit = this.cache.get(itemId)
    if (hit) return hit.bytes
    const item = this.packNamed(setId)?.items.find(candidate => candidate.id === itemId)
    if (!item) throw new Error(tr('스티커를 다시 선택해 주세요.'))
    const bytes = await downloadStickerPackItem(this.auth, item, AbortSignal.any([this.auth.signal, AbortSignal.timeout(60000)]), () => this.validate())
    this.remember(item, bytes)
    return bytes
  }
  async response(setId: string, itemId: string, request: Request): Promise<Response> {
    if (this.closed || !['GET', 'HEAD'].includes(request.method) || !/^[a-f0-9]{64}$/.test(itemId)) return new Response(null, { status: 403 })
    try {
      const bytes = await this.itemBytes(setId, itemId)
      const item = this.cache.get(itemId)?.item
      return item ? rangeResponse(bytes, stickerContentType[item.kind], request) : new Response(null, { status: 404 })
    } catch { return new Response(null, { status: 404 }) }
  }

  close(): void {
    this.closed = true; this.opening?.abort(); this.opening = null; this.value = null; this.installed = null
    for (const entry of this.cache.values()) entry.bytes.fill(0)
    this.cache.clear(); this.cacheBytes = 0
  }
}
