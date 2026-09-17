import { contactStoryAudienceRequest, type ContactStoryAudienceRequest, type ContactStoryAudienceSnapshot } from '../../shared/contact-story-audience'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
interface Selection { request: ContactStoryAudienceRequest; uid: string; abort: AbortController; reader: FirestoreReader; deadline: number; started: number }
export class ContactStoryAudience {
  private closed = false
  private selected: Selection | null = null
  private value: ContactStoryAudienceSnapshot | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private job: Promise<void> | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly source: (request: ContactStoryAudienceRequest) => string, private readonly changed: () => void) {}
  private publish(): void { if (!this.closed) this.changed() }
  private validate(selected: Selection): void {
    this.auth.signal.throwIfAborted(); selected.abort.signal.throwIfAborted()
    if (this.closed || this.selected !== selected || performance.now() >= selected.deadline || this.source(selected.request) !== selected.uid) throw new Error(tr('현재 연락처의 청중 확인이 변경되었습니다.'))
  }
  get snapshot(): ContactStoryAudienceSnapshot | null {
    try { if (!this.selected || !this.value) return null; this.validate(this.selected); return { ...this.value } }
    catch { return null }
  }
  storySource(id: string, profileRequestId: string, privacy: 'contacts' | 'closeFriends'): { uid: string; expiresAt: number } {
    const current = this.snapshot
    if (!current || current.id !== id || current.profileRequestId !== profileRequestId || current.status !== 'ready' || current[privacy] !== true || current.expiresAt <= Date.now()) throw new Error(tr('이 스토리 청중에 포함된 현재 관계를 다시 확인해 주세요.'))
    return { uid: current.ownerId, expiresAt: current.expiresAt }
  }
  extendForMedia(id: string, profileRequestId: string, privacy: 'contacts' | 'closeFriends'): void {
    this.storySource(id, profileRequestId, privacy)
    const selected = this.selected!
    selected.deadline = selected.started + 10 * 60000
    const remaining = selected.deadline - performance.now()
    if (remaining <= 0) throw new Error(tr('청중 확인을 새로 시작해 주세요.'))
    if (this.timer) clearTimeout(this.timer)
    this.value = { ...this.value!, expiresAt: Date.now() + remaining }
    this.timer = setTimeout(() => { if (this.selected === selected) { this.pause(); this.publish() } }, remaining)
    this.publish()
  }
  pause(): void { const selected = this.selected; this.selected = null; this.value = null; if (this.timer) clearTimeout(this.timer); this.timer = null; selected?.abort.abort(); selected?.reader.close() }
  prune(): void { try { if (this.selected) this.validate(this.selected) } catch { this.pause() } }
  dismiss(id: string): void { if (this.selected?.request.id === id) { this.pause(); this.publish() } }
  open(input: ContactStoryAudienceRequest): Promise<void> {
    const request = contactStoryAudienceRequest(input)
    if (this.closed || this.job) throw new Error(tr('진행 중인 청중 확인을 마친 뒤 다시 선택해 주세요.'))
    this.auth.signal.throwIfAborted(); const uid = this.source(request)
    if (uid === this.uid) throw new Error(tr('본인의 청중은 내 스토리에서 확인해 주세요.'))
    this.pause()
    const selected: Selection = { request, uid, abort: new AbortController(), reader: new FirestoreReader(this.auth), deadline: performance.now() + 30000, started: performance.now() }
    this.selected = selected; this.value = { ...request, ownerId: uid, status: 'loading', contacts: null, closeFriends: null, observedAt: null, expiresAt: Date.now() + 30000, message: tr('현재 연락처가 나를 포함한 스토리 청중 관계를 확인하고 있습니다.') }
    this.timer = setTimeout(() => { if (this.selected === selected) { this.pause(); this.publish() } }, 30000)
    const task = this.observe(selected).catch(() => {
      if (this.selected !== selected) return
      this.pause()
      // A failed observation has no retained membership authority.
      this.value = null
    }).finally(() => { if (this.job === task) this.job = null; this.publish() })
    this.job = task; this.publish(); return task
  }
  private observe(selected: Selection): Promise<void> {
    const contact = `${documents}/users/${selected.uid}/contacts/${this.uid}`, closeFriend = `${documents}/users/${selected.uid}/closeFriends/${this.uid}`
    const signal = AbortSignal.any([this.auth.signal, selected.abort.signal])
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve()
      }
      const cancel = (): void => finish(new Error('Audience observation cancelled'))
      const fail = (): void => { if (this.selected === selected) { this.pause(); this.publish() }; finish(new Error('Audience observation unavailable')) }
      signal.addEventListener('abort', cancel, { once: true })
      selected.reader.watch({ documents: { documents: [contact, closeFriend] } }, selected.abort.signal, {
        snapshot: rows => {
          if (this.selected !== selected) return
          try {
            this.validate(selected)
            if (rows.size > 2 || [...rows.entries()].some(([path, doc]) => (path !== contact && path !== closeFriend) || doc.name !== path)) throw new Error('Unexpected audience documents')
            this.value = { ...this.value!, status: 'ready', contacts: rows.has(contact), closeFriends: rows.has(closeFriend), observedAt: Date.now(), message: tr('현재 관측한 청중 관계입니다. 이 표시만으로 개별 스토리의 숨김·만료나 미디어 접근을 보장하지 않습니다.') }
            finish(); this.publish()
          } catch { fail() }
        },
        state: state => {
          if (this.selected !== selected || state === 'ready') return
          if (state === 'error') { fail(); return }
          this.value = { ...this.value!, status: 'loading', contacts: null, closeFriends: null, observedAt: null, message: tr('연결 상태가 바뀌어 청중 관계를 다시 확인하고 있습니다.') }; this.publish()
        }
      }, 2, 2 * 1024 * 1024)
      if (signal.aborted) cancel()
    })
  }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job?.catch(() => {}) }
}
