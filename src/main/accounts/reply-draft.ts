import { historyReadable } from '../network/firestore-values'
import { randomUUID } from 'node:crypto'
import type { ReplyBinding, ReplyDraftSnapshot } from '../../shared/reply-draft'
import type { ReplyDraftCommand } from '../storage/reply-draft-table'
import type { FirestoreReader } from '../network/firestore-rpc'
import { documents, type ReadDialog } from '../network/firestore-values'
import { originalPreview, replyOriginal } from './reply-context'
import { tr } from '../../shared/i18n'

interface Owner {
  dialog: ReadDialog; reader: FirestoreReader; load: number; loaded: boolean
  selection: ReplyBinding | null; state: 'loading' | 'ready' | 'error'
  original: ReturnType<typeof replyOriginal>; stop(): void; timer?: ReturnType<typeof setTimeout>
}
export class ReplyDraft {
  private owner: Owner | null = null
  private revision = 0
  constructor(private readonly signal: AbortSignal, private readonly store: <T>(command: ReplyDraftCommand) => Promise<T>,
    private readonly changed: (chatId: string, value: ReplyDraftSnapshot) => void) {}
  private frame(owner: Owner): ReplyDraftSnapshot {
    const selection = owner.selection ? { ...owner.selection } : null
    const preview = owner.state === 'ready' ? originalPreview(owner.original, owner.dialog) : null
    const status = !owner.loaded ? owner.state === 'error' ? 'error' : 'loading' : !selection ? 'none' :
      owner.state !== 'ready' ? owner.state : preview?.state === 'ready' ? 'ready' : 'unavailable'
    return { revision: this.revision, selection, status, preview: selection ? preview : null }
  }
  snapshot(chatId: string): ReplyDraftSnapshot {
    return this.owner?.dialog.summary.id === chatId ? this.frame(this.owner) : { revision: this.revision, selection: null, status: 'loading', preview: null }
  }
  private current(owner: Owner): boolean { return this.owner === owner && !this.signal.aborted }
  private publish(owner: Owner): void { if (this.current(owner)) { this.revision++; this.changed(owner.dialog.summary.id, this.frame(owner)) } }
  private stopWatch(owner: Owner): void { owner.stop(); owner.stop = () => {}; clearTimeout(owner.timer); owner.original = null }
  clear(): void {
    const old = this.owner; this.owner = null
    if (old) {
      this.stopWatch(old)
      this.changed(old.dialog.summary.id, { revision: ++this.revision, selection: null, status: 'loading', preview: null })
    }
  }
  bind(dialog: ReadDialog, reader: FirestoreReader): void {
    this.clear()
    if (!historyReadable(dialog) || dialog.summary.kind === 'secret' || this.signal.aborted) return
    const owner: Owner = { dialog, reader, load: 0, loaded: false, selection: null, state: 'loading', original: null, stop: () => {} }
    this.owner = owner; this.publish(owner); void this.reload(owner)
  }
  updateDialog(dialog: ReadDialog): void { if (this.owner?.dialog.summary.id === dialog.summary.id) { this.owner.dialog = dialog; this.publish(this.owner) } }
  private async reload(owner: Owner): Promise<void> {
    const load = ++owner.load
    this.stopWatch(owner); owner.loaded = false; owner.state = 'loading'; this.publish(owner)
    try {
      const selection = await this.store<ReplyBinding | null>({ kind: 'reply-draft', chatId: owner.dialog.summary.id })
      if (!this.current(owner) || load !== owner.load) return
      owner.selection = selection; owner.loaded = true
      if (selection) this.watch(owner, selection)
      this.publish(owner)
    } catch { if (this.current(owner) && load === owner.load) { owner.state = 'error'; this.publish(owner) } }
  }
  private watch(owner: Owner, selection: ReplyBinding): void {
    const name = `${documents}/chats/${owner.dialog.summary.id}/messages/${selection.messageId}`
    const load = owner.load, current = (): boolean => this.current(owner) && owner.load === load && owner.selection === selection
    owner.stop = owner.reader.watch({ documents: { documents: [name] } }, this.signal, {
      snapshot: rows => {
        if (!current()) return
        clearTimeout(owner.timer)
        try {
          if ([...rows.keys()].some(key => key !== name)) throw new Error('Reply scope mismatch')
          const doc = rows.get(name), original = doc ? replyOriginal(doc, owner.dialog) : null
          owner.original = original && !original.system && original.kind !== 'unsupported' ? original : null; owner.state = 'ready'
          const at = owner.original?.expiresAt
          if (at && at > Date.now()) {
            const expire = (): void => {
              if (!current()) return
              if (at > Date.now()) owner.timer = setTimeout(expire, Math.min(2147483647, Math.max(1, at - Date.now())))
              else this.publish(owner)
            }
            expire()
          }
        } catch { owner.original = null; owner.state = 'error' }
        this.publish(owner)
      },
      state: (state, error) => {
        if (!current() || state === 'ready') return
        clearTimeout(owner.timer); owner.original = null; owner.state = state === 'error' || error ? 'error' : 'loading'; this.publish(owner)
      }
    }, 1, 2 * 1024 * 1024)
  }
  async select(chatId: string, messageId: string): Promise<void> {
    const owner = this.owner
    if (!owner || owner.dialog.summary.id !== chatId || !this.current(owner)) throw new Error(tr('대화를 다시 선택해 주세요.'))
    owner.load++; this.stopWatch(owner); owner.loaded = false; owner.state = 'loading'; this.publish(owner)
    try {
      await this.store({ kind: 'reply-select', chatId, selection: { selectionId: randomUUID(), messageId } })
      if (this.current(owner)) await this.reload(owner)
    } catch { if (this.current(owner)) { owner.state = 'error'; this.publish(owner) }; throw new Error(tr('답장 대상을 저장하지 못했습니다.')) }
  }
  async cancel(chatId: string, selectionId: string): Promise<void> {
    const owner = this.owner
    if (!owner || owner.dialog.summary.id !== chatId || !this.current(owner)) throw new Error(tr('대화를 다시 선택해 주세요.'))
    await this.store({ kind: 'reply-clear', chatId, selectionId })
    if (this.current(owner)) await this.reload(owner)
  }
  validate(chatId: string, binding: ReplyBinding): void {
    const frame = this.snapshot(chatId)
    if (frame.status !== 'ready' || frame.selection?.selectionId !== binding.selectionId || frame.selection.messageId !== binding.messageId) throw new Error(tr('답장 원본을 확인하거나 답장을 해제한 뒤 전송해 주세요.'))
  }
  refresh(chatId: string): Promise<void> { return this.owner?.dialog.summary.id === chatId ? this.reload(this.owner) : Promise.resolve() }
}
