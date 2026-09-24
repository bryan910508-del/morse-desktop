import type { ChatMessage } from '../../shared/model'
import type { MessageActionRequest, MessageActionsSnapshot } from '../../shared/message-actions'
import { DeliveryCommandFailure } from '../storage/delivery-client'
import type { MessageActionCommand, MessageActionStore, StoredMessageAction } from '../storage/message-action-protocol'
import { boolField, decodeMessage, historyReadable, documentVersion, documents, mapField, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import type { FirestoreReader } from '../network/firestore-rpc'
import { MessageMutationFailure, NotEmitted } from '../network/contracts'
import { selectionDigest, setMessageReaction } from '../network/message-reaction-api'
import { setMessagePollVote } from '../network/attachment-api'
import type { AccountAuthorization } from './outbox'
import { tr } from '../../shared/i18n'

interface Context { ready: boolean; reader: FirestoreReader | null; dialogs: Map<string, ReadDialog> }
export function canApplyAction(request: Pick<MessageActionRequest, 'kind'>, message: ChatMessage, dialog: ReadDialog): boolean {
  if (!message.version || message.encrypted || message.system || !message.serverConfirmed || (!historyReadable(dialog) || dialog.summary.kind === 'secret')) return false
  if (request.kind === 'edit') return message.kind === 'text' && message.senderId === dialog.accountUid
  // A vote goes into a poll that is still open. Telegram lets anyone in the room vote, the sender too
  // (TelegramMediaPoll: only `isClosed` closes it), and the server draws the same line.
  if (request.kind === 'poll-vote') return message.kind === 'poll' && Boolean(message.poll) && !message.poll!.closed
  // Saved Messages holds one copy, on the server, so deleting a note there deletes it — firestore.rules
  // says so for this room by name («1:1/메모 채팅 참여자라면 모든 메시지 삭제 가능»:
  // `isOneOnOneChatParticipant(chatId)` is true of a room whose only participant is me). Refusing it
  // here left the window with nothing but a local hide, so a note a person had deleted was still on
  // their phone, and came back to this window on the next install.
  if (request.kind === 'delete') return true
  return true
}

// A reaction may be sent again under its own clientRevision: the server applies one revision once and answers the
// repeat with alreadyApplied (firebase/functions/morse-release-authority.js:296). So a reaction whose outcome the
// connection swallowed is worth sending again rather than dropping on the account, which is what iOS
// (MorsePendingReactionSync, 1s doubling) and Android do. An edit or a delete is a conditional write on one version
// and is never sent again on its own.
// The count is per connected stretch — pause() clears it — because an account that loses its connection stops the
// queue altogether and resumes it on reconnect. Failing this many times while connected is a fault worth telling
// the account about, so the attempt after the last one is reported the way it was before.
export const reactionRetryLimit = 8
export function reactionRetryDelay(attempt: number): number { return Math.min(30000, 1000 * 2 ** (attempt - 1)) }

export class MessageActions {
  private closed = false
  private failed = false
  private generation = new AbortController()
  private task: Promise<void> | null = null
  private writes = new Set<Promise<unknown>>()
  private rerun = false
  private checked = new Set<string>()
  private retries = new Map<string, { attempt: number; at: number }>()
  private waking: ReturnType<typeof setTimeout> | null = null
  private views = new Set<string>()
  private busy: string | null = null
  private revision = 0

  constructor(private readonly uid: string, private readonly auth: AccountAuthorization, private readonly storage: MessageActionStore,
    private readonly context: () => Context, private readonly changed: (chatId: string, snapshot: MessageActionsSnapshot) => void) {}
  private active(signal: AbortSignal): boolean {
    return !this.closed && !this.failed && !signal.aborted && !this.auth.signal.aborted && this.auth.sender.ready && this.context().ready
  }
  private async store<T = void>(command: MessageActionCommand): Promise<T> {
    if (this.closed || this.failed) throw new Error(tr('메시지 작업 저장소를 사용할 수 없습니다.'))
    const task = this.storage<T>(command); this.writes.add(task)
    try { return await task }
    catch (error) {
      if (!(error instanceof DeliveryCommandFailure) || error.code === 'storage') { this.failed = true; this.pause() }
      throw error
    } finally { this.writes.delete(task) }
  }
  private frame(chatId: string, rows: StoredMessageAction[], revision: number): MessageActionsSnapshot {
    const dialog = this.context().dialogs.get(chatId)
    const visible = !this.closed && !this.auth.signal.aborted && this.context().ready && Boolean(dialog && historyReadable(dialog) && dialog.summary.kind !== 'secret')
    return { revision, ready: visible && this.active(this.generation.signal),
      message: this.failed ? tr('메시지 작업을 저장하지 못했습니다. 앱을 다시 열어 주세요.') : '',
      items: visible ? rows.filter(row => row.chatId === chatId).map(row => ({ id: row.id, messageId: row.messageId,
        kind: row.kind, preview: row.preview, state: row.state, reason: row.reason, busy: row.id === this.busy })) : [] }
  }
  async snapshot(chatId: string): Promise<MessageActionsSnapshot> {
    this.views.add(chatId)
    const revision = ++this.revision
    try { return this.frame(chatId, await this.store<StoredMessageAction[]>({ kind: 'action-list' }), revision) }
    catch { return this.frame(chatId, [], revision) }
  }
  forget(chatId: string): void { this.views.delete(chatId) }
  private async publish(): Promise<void> {
    if (this.closed || !this.views.size) return
    const revision = ++this.revision
    let rows: StoredMessageAction[] = []
    if (!this.failed) try { rows = await this.store<StoredMessageAction[]>({ kind: 'action-list' }) } catch { /* frame reports storage errors */ }
    if (!this.closed) for (const id of this.views) this.changed(id, this.frame(id, rows, revision))
  }
  async enqueue(chatId: string, request: MessageActionRequest, message: ChatMessage): Promise<void> {
    const dialog = this.context().dialogs.get(chatId)
    if (!this.active(this.generation.signal) || !dialog || !canApplyAction(request, message, dialog) || message.version !== request.version) throw new Error(tr('최신 메시지를 다시 선택해 주세요.'))
    try { await this.store({ kind: 'action-enqueue', action: { ...request, chatId, preview: message.text.slice(0, 160), state: 'queued', reason: '' } }) }
    catch (error) {
      if (error instanceof DeliveryCommandFailure && error.code !== 'storage') throw new Error(tr('이 메시지에 진행 중인 작업이 있거나 대기 목록이 가득 찼습니다. 먼저 결과를 확인해 주세요.'))
      throw error
    }
    void this.publish(); this.kick()
  }
  pause(): void {
    this.generation.abort(); this.generation = new AbortController(); this.checked.clear()
    this.retries.clear(); this.unschedule(); void this.publish()
  }
  private unschedule(): void { if (this.waking) { clearTimeout(this.waking); this.waking = null } }
  // Wake the drain when the earliest waiting reaction is due, so the loop never spins on a row it must not try yet.
  private schedule(rows: StoredMessageAction[], now: number): void {
    const due = rows.map(row => this.retries.get(row.id)?.at ?? 0).filter(at => at > now)
    if (!due.length) return
    this.unschedule()
    this.waking = setTimeout(() => { this.waking = null; this.kick() }, Math.max(50, Math.min(...due) - now))
  }
  resume(): void { void this.publish(); this.kick() }
  private kick(): void {
    if (!this.active(this.generation.signal)) return
    if (this.task) { this.rerun = true; return }
    const task = this.drain(this.generation.signal)
    this.task = task
    void task.catch(() => {}).finally(() => {
      if (this.task !== task) return
      this.task = null; this.busy = null; void this.publish()
      if (this.rerun) { this.rerun = false; this.kick() }
    })
  }
  private async exact(action: StoredMessageAction, signal: AbortSignal, collection = 'messages'): Promise<FirestoreDocument | null> {
    const context = this.context(), reader = context.reader
    if (!reader || !this.active(signal) || !context.dialogs.get(action.chatId) || !historyReadable(context.dialogs.get(action.chatId)!)) throw new Error(tr('계정 연결이 변경되었습니다.'))
    const name = `${documents}/chats/${action.chatId}/${collection}/${action.messageId}`
    const rows = await reader.query(`${documents}/chats/${action.chatId}`, { from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: name } } }, limit: { value: 1 } }, signal)
    if (!this.active(signal) || !this.context().dialogs.get(action.chatId) || !historyReadable(this.context().dialogs.get(action.chatId)!)) throw new Error(tr('계정 연결이 변경되었습니다.'))
    if (rows.length > 1 || (rows[0] && rows[0].name !== name)) throw new Error(tr('메시지 식별자가 다릅니다.'))
    return rows[0] ?? null
  }
  // This account's own vote, read one document at a time: firestore.rules allows the reader to `get`
  // their own pollVotes/{uid} and refuses `list` outright, so the query `exact` uses cannot be used here.
  private async voteReceipt(action: StoredMessageAction, signal: AbortSignal): Promise<FirestoreDocument | null> {
    const context = this.context(), reader = context.reader, dialog = context.dialogs.get(action.chatId)
    if (!reader || !this.active(signal) || !dialog || !historyReadable(dialog)) throw new Error(tr('계정 연결이 변경되었습니다.'))
    const path = `${documents}/chats/${action.chatId}/messages/${action.messageId}/pollVotes/${this.uid}`
    const doc = await reader.getDocument(path, signal, () => {
      const current = this.context().dialogs.get(action.chatId)
      if (!this.active(signal) || !current || !historyReadable(current)) throw new Error(tr('계정 연결이 변경되었습니다.'))
    })
    if (doc && doc.name !== path) throw new Error(tr('메시지 식별자가 다릅니다.'))
    return doc
  }
  private async resolve(action: StoredMessageAction, signal: AbortSignal): Promise<'done' | 'same' | 'unknown'> {
    const doc = await this.exact(action, signal)
    if (!doc) { await this.store({ kind: 'action-finish', id: action.id }); return 'done' }
    if (action.kind === 'reaction') {
      const receipt = mapField(mapField(doc.fields, 'reactionRequestByUid'), this.uid)
      if (stringField(receipt, 'clientRevision', 160) === action.id && stringField(receipt, 'selectionDigest', 64) === selectionDigest(action.reactions!)) {
        await this.store({ kind: 'action-finish', id: action.id }); return 'done'
      }
      // A different device may have overwritten the last revision. There is no
      // permanent per-operation receipt proving this request cannot arrive later.
      return 'unknown'
    }
    if (action.kind === 'poll-vote') {
      // pollVotes/{uid} holds the selection and the revision that wrote it, and a vote taken back
      // leaves no document at all (morse-release-authority.js: the receipt is only set when something
      // was chosen). Either is proof; anything else may still arrive, as a reaction may.
      const vote = await this.voteReceipt(action, signal)
      if (vote ? stringField(vote.fields, 'clientRevision', 160) === action.id : !action.options!.length) {
        await this.store({ kind: 'action-finish', id: action.id }); return 'done'
      }
      return 'unknown'
    }
    if (documentVersion(doc) !== action.version) {
      if (action.kind === 'edit' && stringField(doc.fields, 'text', 100000) === action.text && boolField(doc.fields, 'isEdited')) {
        await this.store({ kind: 'action-finish', id: action.id })
      } else await this.store({ kind: 'action-state', id: action.id, state: 'failed', reason: tr('메시지가 변경되었습니다. 최신 메시지에서 다시 선택해 주세요.') })
      return 'done'
    }
    return 'same'
  }
  private async drain(signal: AbortSignal): Promise<void> {
    await this.store({ kind: 'action-prune', allowed: [...this.context().dialogs.values()].filter(dialog => dialog.summary.kind !== 'secret').map(dialog => dialog.summary.id) })
    while (this.active(signal)) {
      const rows = await this.store<StoredMessageAction[]>({ kind: 'action-list' })
      if (!this.active(signal)) return
      // Retain the lookup guard for unresolved actions, not every completed ID.
      // This is the full pending list in the serialized drain, not a view snapshot.
      const uncertain = new Set(rows.filter(row => row.state === 'uncertain').map(row => row.id))
      for (const id of this.checked) if (!uncertain.has(id)) this.checked.delete(id)
      const now = Date.now()
      const action = rows.find(row => { const dialog = this.context().dialogs.get(row.chatId)
        return dialog && historyReadable(dialog) && (row.state === 'queued' || (row.state === 'uncertain' && !this.checked.has(row.id)))
          && (this.retries.get(row.id)?.at ?? 0) <= now })
      if (!action) { this.schedule(rows, now); return }
      this.busy = action.id; this.checked.add(action.id); void this.publish()
      if (!this.context().dialogs.has(action.chatId)) { await this.store({ kind: 'action-finish', id: action.id }); continue }
      if (action.state === 'uncertain') {
        try { await this.resolve(action, signal) } catch { /* keep the durable uncertainty */ }
        continue
      }
      let attempted = false
      try {
        const doc = await this.exact(action, signal), dialog = this.context().dialogs.get(action.chatId)
        const message = doc && dialog ? decodeMessage(doc, dialog) : null
        if (!doc || !message) { await this.store({ kind: 'action-finish', id: action.id }); continue }
        if (!dialog || documentVersion(doc) !== action.version || !canApplyAction(action, message, dialog)) throw new MessageMutationFailure(tr('메시지가 변경되었습니다. 최신 메시지에서 다시 선택해 주세요.'), true)
        if (action.kind === 'delete' && await this.exact(action, signal, 'revokedForAll')) throw new MessageMutationFailure(tr('이미 삭제 기록이 있는 메시지입니다. 대화를 새로 불러와 주세요.'), true)
        if (!this.active(signal)) return
        if (!await this.store<boolean>({ kind: 'action-claim', id: action.id })) continue
        if (!this.active(signal)) return
        const reader = this.context().reader!
        attempted = true
        if (action.kind === 'edit') await reader.editText(doc, action.text!, signal)
        else if (action.kind === 'delete') await reader.deleteMessage(doc, action.chatId, action.messageId, this.uid, signal)
        else if (action.kind === 'poll-vote') await setMessagePollVote(this.auth, this.uid, action.chatId, action.messageId, action.options!, action.id, signal)
        else await setMessageReaction(this.auth, this.uid, action, signal)
        if (!this.active(signal)) return
        this.retries.delete(action.id)
        await this.store({ kind: 'action-finish', id: action.id })
      } catch (error) {
        if (!this.active(signal)) return
        if ((action.kind === 'reaction' || action.kind === 'poll-vote') && !(error instanceof MessageMutationFailure && error.definitive) && await this.retried(action, attempted, signal)) continue
        if (!attempted || error instanceof NotEmitted || (error instanceof MessageMutationFailure && error.definitive)) {
          await this.store({ kind: 'action-state', id: action.id, state: 'failed', reason: error instanceof MessageMutationFailure ? error.message : tr('요청을 보내지 못했습니다. 연결과 최신 메시지를 확인해 주세요.') })
        } else {
          await this.store({ kind: 'action-state', id: action.id, state: 'uncertain', reason: tr('결과를 확인하지 못했습니다. 기록을 확인해 주세요.') })
          try { await this.resolve(action, signal) } catch { /* canonical reads may also be unavailable */ }
        }
      }
      this.busy = null; void this.publish()
    }
  }
  // A reaction the connection could not settle goes back in the queue instead of onto the account: the same
  // selection under the same revision, after a growing wait. True when this attempt is dealt with here — the row is
  // waiting for its next try, or the receipt proved it had applied after all.
  private async retried(action: StoredMessageAction, attempted: boolean, signal: AbortSignal): Promise<boolean> {
    // It may have applied after all. The receipt says so for certain, and then there is nothing left to send.
    if (attempted) {
      try { if (await this.resolve(action, signal) === 'done') { this.retries.delete(action.id); return true } }
      catch { /* the canonical read may be unavailable too; treat it as one more unsettled attempt */ }
      if (!this.active(signal)) return false
    }
    const attempt = (this.retries.get(action.id)?.attempt ?? 0) + 1
    if (attempt > reactionRetryLimit) { this.retries.delete(action.id); return false }
    this.retries.set(action.id, { attempt, at: Date.now() + reactionRetryDelay(attempt) })
    // 'queued' and no reason: the account is told nothing while the app is still trying, as on iOS and Android.
    await this.store({ kind: 'action-state', id: action.id, state: 'queued', reason: '' })
    this.busy = null; void this.publish()
    return true
  }
  async inspect(chatId: string, id: string): Promise<void> {
    if (this.task || !this.active(this.generation.signal)) throw new Error(tr('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.'))
    const signal = this.generation.signal
    const task = (async () => {
      this.busy = id; void this.publish()
      const action = (await this.store<StoredMessageAction[]>({ kind: 'action-list' })).find(row => row.id === id && row.chatId === chatId)
      if (!action || action.state !== 'uncertain') return
      const result = await this.resolve(action, signal)
      // Only a user-requested retry of the identical conditional write is safe.
      if (result === 'same' && action.kind !== 'reaction' && this.active(signal)) await this.store({ kind: 'action-state', id, state: 'queued', reason: '' })
      // A reaction leaves no permanent receipt, so a check that comes back 'unknown' will come back 'unknown' for
      // ever. Say so once and let the row go, instead of keeping a journal entry the account can neither resolve
      // nor dismiss. Reacting again is the way to set the selection, and that no longer waits on this row.
      else if (result === 'unknown' && this.active(signal)) await this.store({ kind: 'action-state', id, state: 'failed',
        reason: tr('반응이 적용되었는지 확인하지 못했습니다. 메시지의 반응을 보고 필요하면 다시 선택해 주세요.') })
    })()
    this.task = task
    try { await task } finally { this.task = null; this.busy = null; this.rerun = false; void this.publish(); this.kick() }
  }
  async dismiss(chatId: string, id: string): Promise<void> {
    if (this.task || !this.active(this.generation.signal)) throw new Error(tr('진행 중인 작업이 끝난 뒤 정리해 주세요.'))
    const task = (async () => {
      const action = (await this.store<StoredMessageAction[]>({ kind: 'action-list' })).find(row => row.id === id && row.chatId === chatId)
      if (action?.state === 'uncertain') throw new Error(tr('결과가 불명확한 작업은 먼저 기록을 확인해 주세요.'))
      if (action) await this.store({ kind: 'action-dismiss', id })
    })()
    this.task = task
    try { await task } finally { this.task = null; this.rerun = false; void this.publish(); this.kick() }
  }
  async close(): Promise<void> {
    this.closed = true; this.pause(); this.unschedule()
    await this.task?.catch(() => {}); await Promise.allSettled([...this.writes])
    this.views.clear()
  }
}
