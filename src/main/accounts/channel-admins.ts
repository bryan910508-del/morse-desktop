import type { ChannelAdminsSelection, ChannelAdminsSnapshot, ChannelAdminRow, ChannelAdminPermissionInfo } from '../../shared/channel-admins'
import { channelAdminIndex, channelAdminPermissions } from './channel-admin-values'
import { comparePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { documents, childId, documentVersion, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { tr } from '../../shared/i18n'

export class ChannelAdminsReader {
  // Photos of the people listed, from the photo address this record keeps (see ChannelPeoplePhotos).
  people: PeoplePhotoResolver | null = null
  private photos = new Map<string, string>()
  private value: ChannelAdminsSnapshot | null = null
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private generation = 0
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (id: string) => { doc: FirestoreDocument; reader: FirestoreReader }, private readonly changed: () => void) {}
  private validate(channelId: string): ReturnType<ChannelAdminsReader['source']> {
    this.auth.signal.throwIfAborted()
    const source = this.source(channelId)
    if ((this.reader && this.reader !== source.reader) || stringField(source.doc.fields, 'ownerId', 160) !== this.uid) throw new Error('Channel owner unavailable')
    return source
  }
  get snapshot(): ChannelAdminsSnapshot | null {
    if (!this.value) return null
    try {
      const source = this.validate(this.value.channelId), index = channelAdminIndex(source.doc)
      const rows = this.value.rows.map(row => ({ ...row, photo: this.people?.(row.uid, this.photos.get(row.uid) ?? null) ?? null, indexed: index.ids ? index.ids.has(row.uid) : null, appointed: row.appointed ? { ...row.appointed } : null,
        permissions: Object.fromEntries(Object.entries(row.permissions).map(([key, value]) => [key, { ...value }])) as ChannelAdminPermissionInfo }))
      const ids = new Set(rows.map(row => row.uid))
      return { ...this.value, rows, indexOrigin: index.origin, indexOnlyCount: this.value.status === 'ready' && index.ids ? [...index.ids].filter(uid => !ids.has(uid)).length : null }
    } catch { return { ...this.value, status: 'blocked', rows: [], indexOrigin: 'unknown', indexOnlyCount: null, message: tr('현재 소유자 권한을 확인할 수 없습니다. 관리자 목록을 다시 열어 주세요.') } }
  }
  open(request: ChannelAdminsSelection): void {
    this.clear(); this.value = { ...request, status: 'loading', rows: [], indexOrigin: 'unknown', indexOnlyCount: null, message: '' }
    let source: ReturnType<ChannelAdminsReader['validate']>
    try { source = this.validate(request.channelId); this.reader = source.reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 소유한 채널의 관리자만 조회할 수 있습니다.'); this.changed(); return }
    const parent = `${documents}/channels/${request.channelId}`, generation = this.generation
    const current = () => generation === this.generation && this.value?.requestId === request.requestId
    this.stop = source.reader.watch({ query: { parent, structuredQuery: { from: [{ collectionId: 'admins' }], limit: { value: 101 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        try {
          this.validate(request.channelId)
          if (rows.size > 100) { this.value.status = 'limit'; this.value.rows = []; this.value.message = tr('관리자 기록이 100건을 넘습니다. 일부만 전체 목록처럼 표시하지 않습니다.') }
          else {
            const photos = new Map<string, string>()
            const values: ChannelAdminRow[] = [...rows].map(([name, doc]) => {
              if (name !== doc.name) throw new Error('Invalid admin scope')
              const uid = identifier(childId(name, `${parent}/admins`))
              let appointed: ChannelAdminRow['appointed'] = null, version: string | null = null, displayName: string | null = null
              try { if (doc.fields.appointedAt?.timestampValue) appointed = timestamp(doc.fields.appointedAt.timestampValue, uid) } catch { /* Missing time is visible rather than dropping the administrator. */ }
              try { version = documentVersion(doc) } catch { /* Not an edit selection. */ }
              try { displayName = stringField(doc.fields, 'displayName', 512).trim() || null } catch { /* Cached name can be unavailable. */ }
              try { const photo = stringField(doc.fields, 'photoURL', 10000); if (photo) photos.set(uid, photo) } catch { /* No cached photo. */ }
              return { uid, version, name: displayName, appointed, permissions: channelAdminPermissions(doc), indexed: null }
            })
            values.sort((a, b) => a.appointed && b.appointed ? comparePosition(a.appointed, b.appointed) : a.appointed ? -1 : b.appointed ? 1 : a.uid.localeCompare(b.uid))
            this.value.status = 'ready'; this.value.rows = values; this.photos = photos; this.value.message = ''
          }
        } catch { this.value.status = 'error'; this.value.rows = []; this.value.message = tr('관리자 기록이나 소유자 권한을 확인하지 못했습니다. 다시 조회해 주세요.') }
        this.changed()
      },
      state: (state, error) => {
        if (!current() || !this.value || state === 'ready') return
        this.value.status = state; this.value.rows = []
        this.value.message = state === 'loading' ? tr('관리자 목록 연결을 확인하고 있습니다.') : error?.code === 'index' ? tr('관리자 조회에 필요한 서버 인덱스를 확인해야 합니다.') : tr('관리자를 읽지 못했습니다. 연결·소유자 권한을 확인한 뒤 다시 조회해 주세요.')
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
      this.value = { requestId: request.requestId, channelId: request.channelId, status: 'blocked', rows: [], indexOrigin: 'unknown', indexOnlyCount: null, message: tr('채널 정보나 소유자 권한이 변경되었습니다. 관리자 목록을 다시 열어 주세요.') }
    }
  }
  dismiss(requestId: string): void { if (this.value?.requestId === requestId) { this.clear(); this.changed() } }
  clear(): void { this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null }
}
