import type { ChatMessage, HistorySnapshot, MessagePosition } from '../../shared/model'
import { comparePosition, positionAt } from '../../shared/model'
import { FirestoreReader } from '../network/firestore-rpc'
import { decodeMessage, documents, expiry, historyReadable, historyLimit, messagesQuery, pageSize, positionValue, rawPosition, ReadFailure, type FirestoreDocument, type ReadDialog, roomMediaNames } from '../network/firestore-values'
import type { MediaRequest } from '../../shared/media'
import { mediaResources } from '../media/media-document'
import { originalPreview, replyOriginal, ReplyContext } from './reply-context'
import { ExpiredMessages } from './expired-messages'
import { recordHistoryStep } from '../platform/history-diagnostics'
import { ReactionUpdates } from './reaction-updates'
import { tr } from '../../shared/i18n'

export class HistoryReader {
  private readonly abort = new AbortController()
  private rows = new Map<string, FirestoreDocument>()
  private top: FirestoreDocument[] = []
  private stops: (() => void)[] = []
  private stopTail: (() => void) | null = null
  private groupGeneration = 0
  private groupNames = ''
  private closed = false
  private following = true
  private paging: Promise<HistorySnapshot> | null = null
  private pageAbort: AbortController | null = null
  private epoch = 0
  private failed = false
  private expiryTimer?: ReturnType<typeof setTimeout>
  private readonly replies: ReplyContext
  private readonly reactionUpdates = new ReactionUpdates()
  // checkTTLs(): what this room has seen expire leaves the server too, since no one else takes it away.
  private readonly expired: ExpiredMessages
  private value: HistorySnapshot = { messages: [], before: null, hasMore: false, revision: 0, status: 'loading', message: '', newerAvailable: false }

  constructor(readonly dialog: ReadDialog, private readonly reader: FirestoreReader, private readonly changed: (snapshot: HistorySnapshot) => void,
    private readonly nextRevision: () => number, private readonly hidden: (messageId: string) => boolean = () => false,
    // Nothing is taken from the server while the screen is locked or the account has moved on.
    private readonly writable: () => boolean = () => true) {
    this.replies = new ReplyContext(dialog, reader, this.abort.signal, () => this.publish())
    this.expired = new ExpiredMessages(
      entry => reader.deleteMessage(entry.doc, dialog.summary.id, entry.id, dialog.accountUid, this.abort.signal),
      // A group takes away only this account's own messages, as iOS does; a 1:1 or the memo space takes any.
      entry => !this.closed && !this.failed && this.writable() && historyReadable(dialog) && dialog.summary.kind !== 'secret' &&
        (dialog.summary.kind !== 'group' || entry.senderId === dialog.accountUid))
  }
  get snapshot(): HistorySnapshot { return { ...this.value, messages: [...this.value.messages] } }
  mediaResource(request: MediaRequest) {
    const message = this.actionMessage(request.messageId, request.version)
    // A channel post card is the one system message that carries a picture of its own, and
    // decodeMessage already keeps it readable (readEligible: `!system || kind === 'channelPost'`).
    // Refusing every system message here left the card's bubble in the discussion room with nothing
    // inside it, which is what iOS draws from the same mirrored message (MorseChatUIKitNativeChannelPostRow).
    if (!message || message.encrypted || (message.system && message.kind !== 'channelPost') || !message.readEligible) return null
    const doc = this.rows.get(`${documents}/chats/${this.dialog.summary.id}/messages/${request.messageId}`)!
    return mediaResources(doc, roomMediaNames(doc, this.dialog), message.kind, false)[request.index] ?? null
  }
  actionMessage(messageId: string, version: string) {
    if (this.closed || this.failed || this.paging || this.value.status !== 'ready') return null
    const doc = this.rows.get(`${documents}/chats/${this.dialog.summary.id}/messages/${messageId}`)
    const message = doc ? decodeMessage(doc, this.dialog) : null
    return message?.version === version && this.value.messages.some(value => value.id === messageId) ? message : null
  }
  replyTarget(messageId: string, version: string): MessagePosition | null {
    const source = this.actionMessage(messageId, version)
    if (!source?.replyToId || source.replyToId === source.id || source.encrypted) return null
    const original = this.rows.get(`${documents}/chats/${this.dialog.summary.id}/messages/${source.replyToId}`)
    return original ? replyOriginal(original, this.dialog)?.position ?? null : this.replies.target(source.replyToId)
  }
  visibleReadTarget(revision: number, messageId: string, uid: string): MessagePosition | null {
    if (this.closed || this.failed || this.paging || this.value.status !== 'ready' || this.value.revision !== revision) return null
    const doc = this.rows.get(`${documents}/chats/${this.dialog.summary.id}/messages/${messageId}`)
    // Decode again so an expiry between the last publish and this IPC cannot
    // authorize a target whose visible body is no longer current.
    const message = doc ? decodeMessage(doc, this.dialog) : null
    return message?.readEligible && message.serverConfirmed && message.senderId !== uid &&
      this.value.messages.some(value => value.id === messageId) ? message.position : null
  }
  updateNames(names: Record<string, string>): void {
    if (JSON.stringify(names) === JSON.stringify(this.dialog.participantNames)) return
    this.dialog.participantNames = names; this.publish()
  }
  start(): void {
    if (!historyReadable(this.dialog)) {
      this.value.status = this.dialog.summary.historyAccess === 'loading' ? 'loading' : 'error'; this.value.message = this.dialog.summary.historyMessage || tr('토론방 기록 공개 범위를 확인해 주세요.'); this.publish(); return
    }
    if (this.dialog.summary.kind === 'secret') {
      this.value.status = 'unsupported'; this.value.message = tr('이 기기에서는 아직 비밀 대화를 열 수 없습니다.'); this.publish(); return
    }
    this.stopTail = this.reader.watch({ query: { parent: `${documents}/chats/${this.dialog.summary.id}`, structuredQuery: messagesQuery(this.dialog) } },
      this.abort.signal, {
        snapshot: entries => {
          if (this.closed || this.failed) return
          this.top = this.sorted(entries.values())
          if (this.following) {
            // Query-window removal does not delete older history. A following
            // view displays the current latest page; older views use doc targets.
            this.rows = new Map(this.top.slice(0, pageSize).map(doc => [doc.name, doc]))
            this.value.before = this.top[Math.min(pageSize, this.top.length) - 1] ? rawPosition(this.top[Math.min(pageSize, this.top.length) - 1]!, this.dialog.summary.id) : null
            this.value.hasMore = this.top.length > pageSize
            this.value.newerAvailable = false
          } else {
            // During older browsing only exact document targets own the rows.
            // Two independent streams must not race to overwrite the same row.
            this.value.newerAvailable = true
          }
          this.value.status = 'ready'; this.value.message = ''; this.observeRows(); this.publish()
        },
        // HistoryWidget keeps its messages while the stream reconnects; the next snapshot replaces the page.
        reconnecting: () => { if (!this.closed && !this.failed) this.cancelPage() },
        state: (state, error) => {
          if (this.closed || this.failed) return
          if (state === 'error') this.fail(error!)
          else if (state === 'loading') {
            this.cancelPage()
            // Reconnect discards rows whose server authorization is not current.
            this.rows.clear(); this.top = []; this.groupNames = ''; this.stopGroups()
            this.value.status = 'loading'; this.value.message = error?.message ?? ''; this.value.before = null; this.value.hasMore = false; this.value.newerAvailable = false; this.value.focusMessageId = undefined; this.following = true; this.publish()
          }
        },
      }, pageSize + 1)
  }
  private sorted(rows: Iterable<FirestoreDocument>): FirestoreDocument[] {
    return [...rows].sort((a, b) => comparePosition(rawPosition(b, this.dialog.summary.id), rawPosition(a, this.dialog.summary.id)))
  }
  private stopGroups(): void { this.groupGeneration++; for (const stop of this.stops) stop(); this.stops = [] }
  private observeRows(): void {
    if (this.following) { this.stopGroups(); this.groupNames = ''; return }
    const names = [...this.rows.keys()].sort()
    const signature = names.join('\n')
    if (signature === this.groupNames) return
    this.stopGroups(); this.groupNames = signature
    const generation = this.groupGeneration
    // Small document targets keep loaded older rows live without an unbounded
    // history query. Their absence at CURRENT is authority for this exact set.
    for (let offset = 0; offset < names.length; offset += pageSize) {
      const group = names.slice(offset, offset + pageSize)
      let current = false
      this.stops.push(this.reader.watch({ documents: { documents: group } }, this.abort.signal, {
        snapshot: entries => {
          if (this.closed || this.failed || generation !== this.groupGeneration) return
          current = true
          for (const name of group) {
            if (entries.has(name)) this.rows.set(name, entries.get(name)!)
            else this.rows.delete(name)
          }
          this.publish()
        },
        // A stream renewal or network retry re-reads the same documents; the rows stay until then.
        reconnecting: () => { if (!this.closed && !this.failed && generation === this.groupGeneration) recordHistoryStep('rows-reconnecting') },
        state: (state, error) => {
          if (!this.closed && !this.failed && generation === this.groupGeneration &&
              (state === 'error' || error || (state === 'loading' && current))) { recordHistoryStep('rows-failed', `${state}:${error?.code ?? ''}`); this.fail(error ?? new ReadFailure('network')) }
        },
      }, group.length))
    }
  }
  private fail(error: ReadFailure): void {
    if (this.closed || this.failed) return
    recordHistoryStep('history-failed', error.code)
    this.failed = true; this.cancelPage(); this.stopTail?.(); this.stopGroups(); this.replies.clear()
    this.value.status = 'error'; this.value.message = error.message
    this.rows.clear(); this.top = []; this.value.before = null; this.value.hasMore = false; this.value.newerAvailable = false
    this.publish()
  }
  private publish(): void {
    if (this.closed) return
    clearTimeout(this.expiryTimer)
    try {
      const raw = this.sorted(this.rows.values())
      if (raw.reduce((total, doc) => total + JSON.stringify(doc).length, 0) > 32 * 1024 * 1024) throw new ReadFailure('data')
      const messages = raw.map(doc => {
        const message = decodeMessage(doc, this.dialog)
        const updated = message && !message.encrypted ? this.reactionUpdates.reactions(message.id, doc, this.dialog.accountUid, this.dialog.participantNames) : null
        return message && updated ? { ...message, reactions: updated } : message
      }).filter((message): message is ChatMessage => message !== null && !this.hidden(message.id)).reverse()
      const name = (id: string): string => `${documents}/chats/${this.dialog.summary.id}/messages/${id}`
      // Loaded rows retain their existing authoritative owner. Only off-window
      // originals need separate, bounded document targets; never recurse replies.
      this.replies.setTargets(this.value.status === 'ready' ? messages.flatMap(message =>
        message.replyToId && message.replyToId !== message.id && !this.rows.has(name(message.replyToId)) ? [message.replyToId] : []) : [])
      this.value.messages = messages.map(message => {
        if (!message.replyToId) return message
        const original = this.rows.get(name(message.replyToId))
        const reply = message.replyToId === message.id ? { state: 'unavailable' as const } : original
          ? originalPreview(replyOriginal(original, this.dialog), this.dialog) : this.replies.preview(message.replyToId)
        return { ...message, reply }
      })
      const nextExpiry = [...raw.map(expiry), this.replies.nextExpiry()].filter((time): time is number => time !== null && time > Date.now()).sort((a, b) => a - b)[0]
      if (nextExpiry) this.expiryTimer = setTimeout(() => this.publish(), Math.min(2147483647, Math.max(1, nextExpiry - Date.now() + 1)))
      // What has already expired is taken from the server as well, so it is gone for the other side too.
      if (this.value.status === 'ready') this.expired.sweep(raw)
    } catch {
      this.fail(new ReadFailure('data')); return
    }
    this.value.revision = this.nextRevision(); this.changed(this.snapshot)
  }
  // reactionUpdated for a message of this history: shown at once, until its document says as much.
  reactionUpdated(messageId: string, map: Record<string, unknown>, version: number): void {
    if (this.closed || this.failed) return
    const doc = this.rows.get(`${documents}/chats/${this.dialog.summary.id}/messages/${messageId}`)
    if (!doc) return
    if (this.reactionUpdates.remember(messageId, map, version, doc) && this.value.status === 'ready') this.publish()
  }
  // A message deleted for this person only leaves the history at once.
  hiddenChanged(): void {
    if (!this.closed && !this.failed && this.value.status === 'ready') this.publish()
  }
  latest(): HistorySnapshot {
    if (this.value.status !== 'ready') return this.snapshot
    this.cancelPage()
    // A fresh CURRENT boundary avoids restoring a cached tail older than a
    // loaded document's edit/deletion snapshot on another stream.
    this.stopTail?.(); this.stopGroups(); this.groupNames = ''
    this.following = true; this.start(); return this.snapshot
  }
  // Telegram's jump to date (resolveJumpToDate: the first message at or after the day's start), found with an
  // ascending query from that moment; null when nothing that can be shown comes after it.
  async dateTarget(at: number): Promise<MessagePosition | null> {
    if (this.closed || this.failed || this.paging || this.value.status !== 'ready' || !Number.isSafeInteger(at) || at < 0) throw new Error(tr('기록을 불러온 뒤 다시 선택해 주세요.'))
    const start = positionAt(at, '')
    const from = this.dialog.cutoff && comparePosition(this.dialog.cutoff, start) > 0 ? this.dialog.cutoff : start
    const query = { from: [{ collectionId: 'messages' }], where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: positionValue(from) } },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 20 } }
    const rows = await this.reader.query(`${documents}/chats/${this.dialog.summary.id}`, query, this.abort.signal)
    for (const doc of this.sorted(rows).reverse()) {
      const message = decodeMessage(doc, this.dialog)
      if (message && !this.hidden(message.id)) return message.position
    }
    return null
  }
  async jump(target: MessagePosition): Promise<HistorySnapshot> {
    if (this.closed || this.failed || this.paging || this.value.status !== 'ready') throw new Error(tr('기록을 불러온 뒤 다시 선택해 주세요.'))
    this.cancelPage()
    const epoch = this.epoch, pageAbort = new AbortController()
    this.pageAbort = pageAbort; this.following = false
    this.stopTail?.(); this.stopTail = null; this.stopGroups(); this.groupNames = ''
    this.rows.clear(); this.top = []
    this.value = { ...this.value, status: 'loading', message: '', before: null, hasMore: false, newerAvailable: true, focusMessageId: undefined }
    this.publish()
    const task = (async (): Promise<HistorySnapshot> => {
      try {
        // Include the selected message and its preceding context. Newer history
        // is reached explicitly through the existing latest-message command.
        const query = messagesQuery(this.dialog)
        query.startAt = { before: true, values: [positionValue(target), { referenceValue: `${documents}/chats/${this.dialog.summary.id}/messages/${target.id}` }] }
        const rows = await this.reader.query(`${documents}/chats/${this.dialog.summary.id}`, query, AbortSignal.any([this.abort.signal, pageAbort.signal]))
        if (this.closed || this.failed || epoch !== this.epoch) return this.snapshot
        const sorted = this.sorted(rows)
        const selected = sorted.find(doc => rawPosition(doc, this.dialog.summary.id).id === target.id)
        const reason = sorted.some(doc => comparePosition(rawPosition(doc, this.dialog.summary.id), target) > 0) ? 'newer-row' : !selected ? 'target-missing' : !decodeMessage(selected, this.dialog) ? 'target-hidden' : ''
        if (reason) { recordHistoryStep('jump-check', `${reason} rows=${sorted.length}`); throw new ReadFailure('data') }
        const page = sorted.slice(0, pageSize)
        this.rows = new Map(page.map(doc => [doc.name, doc]))
        this.value.before = page.length ? rawPosition(page.at(-1)!, this.dialog.summary.id) : null
        this.value.hasMore = sorted.length > pageSize; this.value.newerAvailable = true
        this.value.status = 'ready'; this.value.focusMessageId = target.id
        this.observeRows(); this.publish()
      } catch (error) {
        if (this.closed || this.failed || epoch !== this.epoch) return this.snapshot
        // Telegram shows a notice when it cannot reach a message; the chat itself stays. Return to the latest page.
        recordHistoryStep('jump-failed', error instanceof ReadFailure ? error.code : error instanceof Error ? error.name : 'unknown')
        this.cancelPage(); this.stopGroups(); this.groupNames = ''; this.following = true
        this.value = { ...this.value, status: 'loading', message: '', focusMessageId: undefined, newerAvailable: false }
        this.publish(); this.start()
        throw new Error(tr('메시지로 이동하지 못했습니다. 최신 메시지를 다시 불러왔어요.'))
      }
      return this.snapshot
    })()
    this.paging = task
    try { return await task } finally { if (this.paging === task) this.paging = null; if (this.pageAbort === pageAbort) this.pageAbort = null }
  }
  async older(before: MessagePosition): Promise<HistorySnapshot> {
    if (this.paging) return this.paging
    if (this.closed || this.value.status !== 'ready' || !this.value.hasMore || !this.value.before || comparePosition(before, this.value.before) !== 0) return this.snapshot
    this.value.focusMessageId = undefined
    const epoch = this.epoch, pageAbort = new AbortController()
    this.pageAbort = pageAbort
    // Freeze the raw page boundary while the older server query is in flight.
    this.following = false
    this.observeRows()
    const task = (async (): Promise<HistorySnapshot> => {
      try {
        const rows = await this.reader.query(`${documents}/chats/${this.dialog.summary.id}`, messagesQuery(this.dialog, before), AbortSignal.any([this.abort.signal, pageAbort.signal]))
        if (this.closed || this.failed || epoch !== this.epoch) return this.snapshot
        // Validate every raw cursor before deriving page progress, including rows
        // hidden by expiry/deletion markers. UI-visible rows are not the cursor.
        const sorted = this.sorted(rows)
        if (sorted.some(doc => comparePosition(rawPosition(doc, this.dialog.summary.id), before) >= 0)) throw new ReadFailure('data')
        this.following = false
        for (const doc of sorted.slice(0, pageSize)) this.rows.set(doc.name, doc)
        const all = this.sorted(this.rows.values())
        if (all.length > historyLimit) this.value.newerAvailable = true
        this.rows = new Map(all.slice(-historyLimit).map(doc => [doc.name, doc]))
        const oldest = sorted[Math.min(pageSize, sorted.length) - 1]
        this.value.before = oldest ? rawPosition(oldest, this.dialog.summary.id) : before
        this.value.hasMore = sorted.length > pageSize
        this.observeRows(); this.publish()
      } catch (error) {
        if (!this.closed && !this.failed && epoch === this.epoch) recordHistoryStep('older-failed', error instanceof ReadFailure ? error.code : 'unknown')
        if (!this.closed && !this.failed && epoch === this.epoch) this.fail(error instanceof ReadFailure ? error : new ReadFailure('network'))
      }
      return this.snapshot
    })()
    this.paging = task
    try { return await task } finally { if (this.paging === task) this.paging = null; if (this.pageAbort === pageAbort) this.pageAbort = null }
  }
  private cancelPage(): void { this.epoch++; this.pageAbort?.abort(); this.pageAbort = null; this.paging = null }
  close(): void {
    if (this.closed) return
    this.closed = true; this.cancelPage(); this.abort.abort(); this.stopTail?.(); this.stopGroups(); this.replies.clear(); this.expired.close(); clearTimeout(this.expiryTimer)
    this.rows.clear(); this.top = []
  }
}
