import type { ContactSearchSnapshot } from '../../shared/contacts'
import { ContactWriteFailure, FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { lookupContact, type PublicContact } from '../network/contact-lookup'
import { tr } from '../../shared/i18n'

interface Search { id: string; publicId: string; abort: AbortController; result: PublicContact | null }
export class ContactDiscovery {
  private owner: Search | null = null
  private closed = false
  private job: Promise<void> | null = null
  private value: ContactSearchSnapshot = { requestId: null, status: 'idle', result: null, adding: false, outcome: 'none', message: '' }
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => boolean,
    private readonly changed: () => void, private readonly refresh: () => void) {}
  get snapshot(): ContactSearchSnapshot { return { ...this.value, result: this.value.result ? { ...this.value.result } : null } }
  private publish(): void { if (!this.closed) this.changed() }
  pause(): void {
    this.owner?.abort.abort(); this.owner = null
    this.value = { ...this.value, status: 'idle', result: null, outcome: this.job ? 'uncertain' : this.value.outcome,
      message: this.job ? tr('연락처 저장 결과를 확인해야 합니다. 연결 후 목록을 다시 불러와 주세요.') : '' }; this.publish()
  }
  async search(id: string, publicId: string): Promise<void> {
    if (this.closed || !this.allowed() || this.job) throw new Error(tr('연결과 진행 중인 연락처 저장을 확인해 주세요.'))
    this.pause()
    const owner: Search = { id, publicId, abort: new AbortController(), result: null }; this.owner = owner
    this.value = { requestId: id, status: 'loading', result: null, adding: false, outcome: 'none', message: '' }; this.publish()
    try {
      const result = await lookupContact(this.auth, publicId, owner.abort.signal)
      if (this.owner !== owner || !this.allowed()) return
      if (!result || result.uid === this.uid) { this.value.status = 'empty'; this.value.message = result ? tr('본인은 연락처에 추가할 수 없습니다.') : tr('검색 가능한 사용자를 찾지 못했습니다.') }
      else { owner.result = result; this.value.status = 'ready'; this.value.result = { uid: result.uid, displayName: result.displayName } }
    } catch {
      if (this.owner !== owner) return
      this.value.status = 'error'; this.value.message = tr('ID 검색을 완료하지 못했습니다. 연결을 확인하고 잠시 후 다시 검색해 주세요.')
    }
    this.publish()
  }
  async add(id: string): Promise<void> {
    const owner = this.owner
    if (this.closed || !this.allowed() || this.job || !owner?.result || owner.id !== id || this.value.outcome !== 'none') throw new Error(tr('사용자를 다시 검색해 주세요.'))
    this.value.adding = true; this.value.message = ''; this.publish()
    const task = (async () => {
      let reader: FirestoreReader | null = null, mayWrite = false
      try {
        const fresh = await lookupContact(this.auth, owner.publicId, owner.abort.signal)
        if (!fresh || fresh.uid !== owner.result!.uid || this.owner !== owner || !this.allowed()) throw new ContactWriteFailure(false)
        reader = new FirestoreReader(this.auth); mayWrite = true
        const outcome = await reader.addContact(this.uid, fresh, owner.abort.signal)
        if (this.owner !== owner) return
        this.value.outcome = outcome; this.value.message = outcome === 'added' ? tr('연락처에 추가했습니다. 목록에서 선택해 주세요.') : tr('이미 저장된 연락처입니다. 목록을 다시 확인해 주세요.')
        if (this.allowed()) this.refresh()
      } catch (error) {
        if (this.owner !== owner) return
        const uncertain = error instanceof ContactWriteFailure ? error.uncertain : mayWrite
        this.value.outcome = uncertain ? 'uncertain' : 'rejected'
        this.value.message = uncertain ? tr('저장 결과를 확인하지 못했습니다. 자동으로 다시 추가하지 않습니다. 연락처 목록을 확인해 주세요.') : tr('연락처를 추가하지 못했습니다. ID와 공개 상태를 다시 확인해 주세요.')
      } finally { reader?.close() }
    })()
    this.job = task
    try { await task } finally { this.job = null; this.value.adding = false; this.publish() }
  }
  closeSearch(id: string): void { if (this.owner?.id === id && !this.job) { this.pause(); this.value.requestId = null; this.publish() } }
  async close(): Promise<void> { this.closed = true; this.pause(); await this.job }
}
