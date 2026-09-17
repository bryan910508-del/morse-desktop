import type { ChannelJoinRequestsSelection, ChannelJoinRequestsSnapshot, ChannelJoinRequestRow } from '../../shared/channel-join-requests'
import { comparePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { documents, childId, documentVersion, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelJoinRequestsReader {
  private value: ChannelJoinRequestsSnapshot | null = null
  // Photos of the people listed, from the address the request keeps (see ChannelPeoplePhotos).
  people: PeoplePhotoResolver | null = null
  private photos = new Map<string, string>()
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private generation = 0
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (id: string) => { doc: FirestoreDocument; reader: FirestoreReader }, private readonly changed: () => void) {}
  private validate(channelId: string): ReturnType<ChannelJoinRequestsReader['source']> {
    this.auth.signal.throwIfAborted()
    const source = this.source(channelId)
    if ((this.reader && this.reader !== source.reader) || stringField(source.doc.fields, 'ownerId', 160) !== this.uid) throw new Error('Channel owner unavailable')
    return source
  }
  get snapshot(): ChannelJoinRequestsSnapshot | null {
    if (!this.value) return null
    try { this.validate(this.value.channelId); return { ...this.value, rows: this.value.rows.map(row => ({ ...row, photo: this.people?.(row.uid, this.photos.get(row.uid) ?? null) ?? null, requested: row.requested ? { ...row.requested } : null })) } }
    catch { return { ...this.value, status: 'blocked', rows: [], message: tr('현재 소유자 권한을 확인할 수 없습니다. 가입 요청 목록을 다시 열어 주세요.') } }
  }
  open(request: ChannelJoinRequestsSelection): void {
    this.clear(); this.value = { ...request, status: 'loading', rows: [], message: '' }
    let source: ReturnType<ChannelJoinRequestsReader['validate']>
    try { source = this.validate(request.channelId); this.reader = source.reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 소유한 채널의 가입 요청만 조회할 수 있습니다.'); this.changed(); return }
    const parent = `${documents}/channels/${request.channelId}`, generation = this.generation
    const current = () => generation === this.generation && this.value?.requestId === request.requestId
    // A single equality retains pending records even when requestedAt is absent.
    // The sentinel prevents a limited ID-order subset from appearing complete.
    this.stop = source.reader.watch({ query: { parent, structuredQuery: { from: [{ collectionId: 'joinRequests' }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } }, limit: { value: 101 }
    } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        try {
          this.validate(request.channelId)
          if (rows.size > 100) { this.value.status = 'limit'; this.value.rows = []; this.value.message = tr('승인 대기 요청이 100건을 넘습니다. 일부만 표시하지 않습니다. 기존 모바일 앱에서 목록을 확인해 주세요.') }
          else {
            const photos = new Map<string, string>()
            const values: ChannelJoinRequestRow[] = [...rows].map(([name, doc]) => {
              if (name !== doc.name || stringField(doc.fields, 'status', 32) !== 'pending') throw new Error('Invalid pending request')
              const uid = identifier(childId(name, `${parent}/joinRequests`))
              if (doc.fields.uid !== undefined && stringField(doc.fields, 'uid', 160) !== uid) throw new Error('Request identity conflict')
              let requested: ChannelJoinRequestRow['requested'] = null, version: string | null = null
              try { if (doc.fields.requestedAt?.timestampValue) requested = timestamp(doc.fields.requestedAt.timestampValue, uid) } catch { /* Unknown time is never replaced by the current time. */ }
              try { version = documentVersion(doc) } catch { /* A readable row is not a valid mutation selection. */ }
              const cached = (key: string, max: number): string | null => { try { return stringField(doc.fields, key, max).trim() || null } catch { return null } }
              const photo = cached('photoURL', 10000)
              if (photo) photos.set(uid, photo)
              return { uid, version, requested, name: cached('displayName', 512), handle: cached('userId', 160) }
            })
            values.sort((a, b) => a.requested && b.requested ? comparePosition(b.requested, a.requested) : a.requested ? -1 : b.requested ? 1 : a.uid.localeCompare(b.uid))
            this.value.status = 'ready'; this.value.rows = values; this.photos = photos; this.value.message = ''
          }
        } catch { this.value.status = 'error'; this.value.rows = []; this.value.message = tr('가입 요청 데이터나 소유자 권한을 확인하지 못했습니다. 다시 조회해 주세요.') }
        this.changed()
      },
      state: (state, error) => {
        if (!current() || !this.value || state === 'ready') return
        this.value.status = state; this.value.rows = []
        this.value.message = state === 'loading' ? tr('가입 요청 목록 연결을 확인하고 있습니다.') : error?.code === 'index' ? tr('가입 요청 조회에 필요한 서버 인덱스를 확인해야 합니다.') : tr('가입 요청을 읽지 못했습니다. 연결·소유자 권한을 확인한 뒤 다시 조회해 주세요.')
        this.changed()
      }
    }, 101, 1024 * 1024)
    this.changed()
  }
  prune(): void {
    if (!this.value) return
    try { this.validate(this.value.channelId) }
    catch {
      const request = this.value; this.clear()
      this.value = { requestId: request.requestId, channelId: request.channelId, status: 'blocked', rows: [], message: tr('채널 정보나 소유자 권한이 변경되었습니다. 가입 요청 목록을 다시 열어 주세요.') }
    }
  }
  dismiss(requestId: string): void { if (this.value?.requestId === requestId) { this.clear(); this.changed() } }
  clear(): void { this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null }
}
