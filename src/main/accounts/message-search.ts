import type { ChatMessage, MessagePosition } from '../../shared/model'
import { comparePosition } from '../../shared/model'
import { searchFold, searchText, type SearchHit, type SearchSnapshot, type SharedMediaFilter } from '../../shared/search'
import { findTextLinks, linkTarget } from '../../shared/text-links'
import type { MediaRequest } from '../../shared/media'
import { mediaResources } from '../media/media-document'
import type { FirestoreReader } from '../network/firestore-rpc'
import { decodeMessage, documents, expiry, messagesQuery, pageSize, rawPosition, ReadFailure, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

const resultLimit = 160, byteLimit = 8 * 1024 * 1024

// A search owns bounded server reads independently of the displayed history.
// It never emits messages, creates notification candidates or acknowledges reads.
export class MessageSearch {
  private readonly abort = new AbortController()
  private readonly rows = new Map<string, FirestoreDocument>()
  private stops: (() => void)[] = []
  private watchGeneration = 0
  private currentGroups = new Set<number>()
  private groupCount = 0
  private cursor: MessagePosition | undefined
  private task: Promise<SearchSnapshot> | null = null
  private closed = false
  private failed = false
  private scanning = false
  private timer?: ReturnType<typeof setTimeout>
  private value: SearchSnapshot
  constructor(readonly id: string, readonly dialog: ReadDialog, query: string, private readonly reader: FirestoreReader,
    private readonly changed: (snapshot: SearchSnapshot) => void, private readonly nextRevision: () => number, private readonly filter: SharedMediaFilter | null = null) {
    this.value = { id, query, revision: 0, status: 'loading', hits: [], scanned: 0, hasMore: true, limited: false, message: '' }
  }
  get snapshot(): SearchSnapshot { return { ...this.value, hits: [...this.value.hits] } }
  private match(doc: FirestoreDocument): { message: ChatMessage; hit: SearchHit } | null {
    const message = decodeMessage(doc, this.dialog)
    if (!message || message.encrypted || message.system || !message.readEligible || !message.version || message.kind === 'unsupported') return null
    if (this.filter) return this.matchShared(message)
    const fields = [message.text, message.caption ?? '', ...(message.attachments ?? []).filter(item => item.kind === 'file' && !item.blind).map(item => item.name)]
    const field = fields.map(searchText).find(text => searchFold(text).includes(searchFold(this.value.query)))
    if (!field) return null
    const at = searchFold(field).indexOf(searchFold(this.value.query)), start = Math.max(0, at - 60)
    const end = Math.min(field.length, at + this.value.query.length + 120)
    return { message, hit: { id: message.id, position: message.position, kind: message.kind,
      sender: this.dialog.participantNames[message.senderId] || tr('참여자'),
      snippet: `${start ? '…' : ''}${field.slice(start, end)}${end < field.length ? '…' : ''}` } }
  }
  // The shared media tabs keep whole messages, so their pictures can be drawn and opened from the panel.
  private matchShared(message: ChatMessage): { message: ChatMessage; hit: SearchHit } | null {
    const parts = (message.attachments ?? []).filter(part => !part.blind)
    const hit = (snippet: string): { message: ChatMessage; hit: SearchHit } => ({ message, hit: { id: message.id, position: message.position, kind: message.kind,
      sender: this.dialog.participantNames[message.senderId] || tr('참여자'), snippet, message } })
    if (this.filter === 'media') return (message.kind === 'image' || message.kind === 'video') && !message.circular && parts.length ? hit(message.caption ?? '') : null
    if (this.filter === 'files') return message.kind === 'file' && parts.length ? hit(parts.map(part => part.name).join(', ')) : null
    const text = message.kind === 'text' ? message.text : message.caption ?? ''
    const link = findTextLinks(text).find(item => item.kind === 'url')
    return link ? hit(linkTarget(link)) : null
  }
  mediaResource(request: MediaRequest) {
    if (this.closed || this.failed || !this.filter) return null
    const doc = this.rows.get(`${documents}/chats/${this.dialog.summary.id}/messages/${request.messageId}`)
    const matched = doc ? this.match(doc) : null
    if (!doc || !matched || matched.message.version !== request.version) return null
    return mediaResources(doc, this.dialog.summary.id, matched.message.kind, false)[request.index] ?? null
  }
  target(messageId: string): MessagePosition | null {
    if (this.closed || this.failed || this.value.status !== 'ready') return null
    const doc = this.rows.get(`${documents}/chats/${this.dialog.summary.id}/messages/${messageId}`)
    return doc ? this.match(doc)?.message.position ?? null : null
  }
  updateNames(names: Record<string, string>): void { this.dialog.participantNames = names; this.publish() }
  private stopWatches(): void {
    this.watchGeneration++; for (const stop of this.stops) stop()
    this.stops = []; this.currentGroups.clear(); this.groupCount = 0
  }
  private watch(): void {
    this.stopWatches()
    const generation = this.watchGeneration, names = [...this.rows.keys()]
    this.groupCount = Math.ceil(names.length / pageSize)
    for (let offset = 0; offset < names.length; offset += pageSize) {
      const group = names.slice(offset, offset + pageSize)
      let current = false
      const stop = this.reader.watch({ documents: { documents: group } }, this.abort.signal, {
        snapshot: entries => {
          if (this.closed || this.failed || generation !== this.watchGeneration) return
          current = true; this.currentGroups.add(offset)
          for (const name of group) {
            const doc = entries.get(name)
            if (doc) this.rows.set(name, doc); else this.rows.delete(name)
          }
          this.publish()
        }, state: (state, error) => {
          if (!this.closed && !this.failed && generation === this.watchGeneration &&
              (state === 'error' || error || (state === 'loading' && current))) this.fail(error ?? new ReadFailure('network'))
        }
      }, group.length)
      if (this.closed || this.failed || generation !== this.watchGeneration) { stop(); return }
      this.stops.push(stop)
    }
  }
  private publish(): void {
    if (this.closed || this.failed) return
    clearTimeout(this.timer)
    try {
      const docs = [...this.rows.values()]
      if (docs.reduce((sum, doc) => sum + JSON.stringify(doc).length, 0) > byteLimit) throw new ReadFailure('data')
      this.value.hits = docs.flatMap(doc => { const match = this.match(doc); return match ? [match.hit] : [] })
        .sort((a, b) => comparePosition(b.position, a.position))
      this.value.status = this.scanning || this.currentGroups.size < this.groupCount ? 'loading' : 'ready'
      const nextExpiry = docs.map(expiry).filter((time): time is number => time !== null && time > Date.now()).sort((a, b) => a - b)[0]
      if (nextExpiry) this.timer = setTimeout(() => this.publish(), Math.min(2147483647, Math.max(1, nextExpiry - Date.now() + 1)))
      this.value.revision = this.nextRevision(); this.changed(this.snapshot)
    } catch { this.fail(new ReadFailure('data')) }
  }
  private fail(error: ReadFailure): void {
    if (this.closed || this.failed) return
    this.failed = true; this.abort.abort(); this.stopWatches(); clearTimeout(this.timer); this.rows.clear()
    this.value = { ...this.value, revision: this.nextRevision(), hits: [], hasMore: false, status: 'error', message: error.message }
    this.changed(this.snapshot)
  }
  more(): Promise<SearchSnapshot> {
    if (this.task) return this.task
    if (this.closed || this.failed || !this.value.hasMore || this.value.limited) return Promise.resolve(this.snapshot)
    this.scanning = true; this.publish()
    const task = this.scan(); this.task = task
    void task.finally(() => { if (this.task === task) this.task = null })
    return task
  }
  private async scan(): Promise<SearchSnapshot> {
    try {
      for (let page = 0; page < 5 && this.value.hasMore && !this.value.limited; page++) {
        const rows = await this.reader.query(`${documents}/chats/${this.dialog.summary.id}`, messagesQuery(this.dialog, this.cursor), this.abort.signal)
        if (this.closed || this.failed) return this.snapshot
        const sorted = rows.sort((a, b) => comparePosition(rawPosition(b, this.dialog.summary.id), rawPosition(a, this.dialog.summary.id)))
        if (this.cursor && sorted.some(doc => comparePosition(rawPosition(doc, this.dialog.summary.id), this.cursor!) >= 0)) throw new ReadFailure('data')
        const pageRows = sorted.slice(0, pageSize)
        let bytes = [...this.rows.values()].reduce((sum, doc) => sum + JSON.stringify(doc).length, 0)
        for (const doc of pageRows) if (this.match(doc)) {
          const size = JSON.stringify(doc).length
          if (this.rows.size >= resultLimit || bytes + size > byteLimit) { this.value.limited = true; break }
          this.rows.set(doc.name, doc); bytes += size
        }
        const last = pageRows.at(-1)
        if (last) this.cursor = rawPosition(last, this.dialog.summary.id)
        this.value.scanned += pageRows.length; this.value.hasMore = sorted.length > pageSize
        if (this.rows.size >= resultLimit && this.value.hasMore) this.value.limited = true
        // Existing matches remain under their current document subscriptions.
        // Newly matched documents acquire subscriptions after this bounded scan.
      }
      if (!this.closed && !this.failed) { this.scanning = false; this.watch(); this.publish() }
    } catch (error) {
      if (!this.closed && !this.failed) this.fail(error instanceof ReadFailure ? error : new ReadFailure('network'))
    }
    return this.snapshot
  }
  close(): void {
    if (this.closed) return
    this.closed = true; this.abort.abort(); this.stopWatches(); clearTimeout(this.timer); this.rows.clear()
    this.value = { ...this.value, revision: this.nextRevision(), status: 'closed', hits: [], hasMore: false, message: tr('검색이 종료되었습니다. 다시 검색해 주세요.') }
    this.changed(this.snapshot)
  }
}
