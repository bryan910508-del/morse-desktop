import { randomUUID } from 'node:crypto'
import { maxDialogAvatars } from '../../shared/dialog-avatars'
import type { GroupPhotoImage } from '../../shared/group-photo'
import type { ReadCredentials } from '../network/firestore-rpc'
import { documentVersion, type FirestoreDocument } from '../network/firestore-values'
import { GroupPhoto, groupPhotoFields } from './group-photo'
import { avatarDisplayLimits } from './profile-photo'
import { DirectAvatar, type DirectAvatarSource } from './direct-avatar'
import { recordAvatarStep } from '../platform/avatar-diagnostics'
import { userpicURL } from './userpic-cache'
import { holdsImage } from './userpic-images'

interface Entry { raw: string; photo: GroupPhoto; started: boolean }
const retainedAvatars = 48
// Account-owned, visible-only cache. List and header share the same group entry.
export class DialogAvatars {
  private wanted: string[] = []
  private retained: string[] = []
  private entries = new Map<string, Entry>()
  private direct = new Map<string, DirectAvatar>()
  private jobs = new Set<Promise<void>>()
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (chatId: string) => FirestoreDocument, private readonly changed: () => void,
    private readonly directSource: (chatId: string) => DirectAvatarSource,
    private readonly localResponse: (url: string, request: Request) => Promise<Response>) {}
  snapshot(chatId: string): GroupPhotoImage | null {
    try {
      if (!groupPhotoFields(this.source(chatId)).hasPhoto) return null
      return this.entries.get(chatId)?.photo.snapshot ?? { status: 'idle', url: null, message: '' }
    } catch {
      try { this.directSource(chatId); return this.direct.get(chatId)?.snapshot ?? { status: 'idle', url: null, message: '' } }
      catch { return null }
    }
  }
  peerName(chatId: string): string { return this.direct.get(chatId)?.profileName ?? '' }
  setVisible(ids: string[]): void {
    if (this.closed) return
    this.wanted = [...new Set(ids)].slice(0, maxDialogAvatars)
    // Like Telegram's userpic cache, photos of rows that scrolled away stay ready for a while;
    // only rows on screen start new downloads.
    this.retained = [...this.wanted, ...this.retained.filter(id => !this.wanted.includes(id))].slice(0, retainedAvatars)
    this.prune(); this.changed()
  }
  prune(): void {
    if (this.closed) return
    const sources = new Map<string, string>()
    const peers = new Map<string, DirectAvatarSource>()
    // A group picture already in memory keeps its entry after its row scrolls away, as Dialogs::Row keeps the view it
    // holds; only memory bounds that. A person's row is watched while it is near the screen, and its picture is put
    // back from memory the moment the row returns.
    for (const id of new Set([...this.retained, ...this.entries.keys()])) {
      try {
        const { raw } = groupPhotoFields(this.source(id))
        if (raw && (this.retained.includes(id) || holdsImage(raw))) sources.set(id, raw)
      }
      catch {
        if (!this.retained.includes(id)) continue
        try { peers.set(id, this.directSource(id)) } catch (error) { recordAvatarStep('dialogs', id, 'source-unavailable', error instanceof Error ? error.message : '') }
      }
    }
    for (const [id, entry] of this.entries) {
      if (sources.get(id) !== entry.raw) { this.entries.delete(id); void entry.photo.close() }
    }
    for (const [id, raw] of sources) {
      if (this.entries.has(id)) continue
      const photo = new GroupPhoto(this.uid, this.auth, () => this.source(id), this.changed,
        avatarDisplayLimits)
      const started = photo.attach({ requestId: randomUUID(), chatId: id, version: '' })
      this.entries.set(id, { raw, photo, started })
    }
    for (const [id, peer] of this.direct) {
      const next = peers.get(id)
      if (!next || !peer.matches(next)) { this.direct.delete(id); peer.close() }
      else peer.refresh()
    }
    for (const [id, binding] of peers) {
      if (!this.direct.has(id)) this.direct.set(id, new DirectAvatar(binding, this.auth, () => this.directSource(id), this.localResponse,
        () => { if (!this.closed) { this.pump(); this.changed() } }))
    }
    this.pump()
  }
  private pump(): void {
    if (this.closed) return
    for (const id of this.wanted) {
      if (this.jobs.size >= 2) break
      const entry = this.entries.get(id)
      let load: (() => Promise<void>) | null = null
      if (entry && !entry.started) {
        entry.started = true
        load = async () => {
          if (this.closed || this.entries.get(id) !== entry) return
          const doc = this.source(id)
          await entry.photo.load({ requestId: randomUUID(), chatId: id, version: documentVersion(doc) })
        }
      } else load = this.direct.get(id)?.takeLoad() ?? null
      if (!load) continue
      const task = Promise.resolve().then(load).catch(() => {}).finally(() => {
        this.jobs.delete(task)
        if (!this.closed) { this.pump(); this.changed() }
      })
      this.jobs.add(task)
    }
  }
  async response(token: string, request: Request): Promise<Response> {
    const url = userpicURL(token)
    for (const entry of this.entries.values()) {
      if (entry.photo.snapshot.url === url) return entry.photo.response(token, request)
    }
    for (const peer of this.direct.values()) {
      if (peer.snapshot.url === url) return peer.response(token, request)
    }
    return new Response(null, { status: 403 })
  }
  clear(): void {
    this.wanted = []; this.retained = []
    for (const entry of this.entries.values()) void entry.photo.close()
    this.entries.clear()
    for (const peer of this.direct.values()) peer.close()
    this.direct.clear()
  }
  async close(): Promise<void> { this.closed = true; this.clear(); await Promise.allSettled(this.jobs) }
}
