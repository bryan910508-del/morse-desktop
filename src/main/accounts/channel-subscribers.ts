import type { ChannelSubscribersSelection, ChannelSubscribersSnapshot, ChannelSubscriberRow } from '../../shared/channel-subscribers'
import { comparePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { documents, childId, documentVersion, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import type { PeoplePhotoResolver } from './channel-people-photos'
import { tr } from '../../shared/i18n'

export class ChannelSubscribersReader {
  // Photos of the people listed, from the photo address this record keeps (see ChannelPeoplePhotos).
  people: PeoplePhotoResolver | null = null
  private photos = new Map<string, string>()
  private value: ChannelSubscribersSnapshot | null = null
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private generation = 0
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (id: string) => { doc: FirestoreDocument; reader: FirestoreReader }, private readonly changed: () => void) {}
  private validate(channelId: string): ReturnType<ChannelSubscribersReader['source']> {
    this.auth.signal.throwIfAborted()
    const source = this.source(channelId)
    if ((this.reader && this.reader !== source.reader) || stringField(source.doc.fields, 'ownerId', 160) !== this.uid) throw new Error('Channel owner unavailable')
    return source
  }
  get snapshot(): ChannelSubscribersSnapshot | null {
    if (!this.value) return null
    try { this.validate(this.value.channelId); return { ...this.value, rows: this.value.rows.map(row => ({ ...row, photo: this.people?.(row.uid, this.photos.get(row.uid) ?? null) ?? null, subscribed: row.subscribed ? { ...row.subscribed } : null })) } }
    catch { return { ...this.value, status: 'blocked', rows: [], message: tr('현재 소유자 권한을 확인할 수 없습니다. 구독자 목록을 다시 열어 주세요.') } }
  }
  open(request: ChannelSubscribersSelection): void {
    this.clear(); this.value = { ...request, status: 'loading', rows: [], message: '' }
    let source: ReturnType<ChannelSubscribersReader['validate']>
    try { source = this.validate(request.channelId); this.reader = source.reader }
    catch { this.value.status = 'blocked'; this.value.message = tr('현재 소유한 채널의 구독자만 조회할 수 있습니다.'); this.changed(); return }
    const parent = `${documents}/channels/${request.channelId}`, generation = this.generation
    const current = () => generation === this.generation && this.value?.requestId === request.requestId
    // No timestamp ordering: legacy records without subscribedAt remain visible.
    this.stop = source.reader.watch({ query: { parent, structuredQuery: { from: [{ collectionId: 'subscribers' }], limit: { value: 101 } } } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        try {
          this.validate(request.channelId)
          if (rows.size > 100) { this.value.status = 'limit'; this.value.rows = []; this.value.message = tr('구독 기록이 100건을 넘습니다. 일부만 전체 목록처럼 표시하지 않습니다. 기존 모바일 앱에서 확인해 주세요.') }
          else {
            const photos = new Map<string, string>()
            const values: ChannelSubscriberRow[] = [...rows].map(([name, doc]) => {
              if (name !== doc.name) throw new Error('Invalid subscriber scope')
              const uid = identifier(childId(name, `${parent}/subscribers`))
              if (doc.fields.uid !== undefined && stringField(doc.fields, 'uid', 160) !== uid) throw new Error('Subscriber identity conflict')
              let subscribed: ChannelSubscriberRow['subscribed'] = null, version: string | null = null
              try { if (doc.fields.subscribedAt?.timestampValue) subscribed = timestamp(doc.fields.subscribedAt.timestampValue, uid) } catch { /* Unknown time is not replaced by now. */ }
              try { version = documentVersion(doc) } catch { /* Readable cached information does not authorize edits. */ }
              const cached = (key: string, max: number): string | null => { try { return stringField(doc.fields, key, max).trim() || null } catch { return null } }
              const photo = cached('photoURL', 10000)
              if (photo) photos.set(uid, photo)
              return { uid, version, name: cached('displayName', 512), handle: cached('userId', 160), subscribed }
            })
            values.sort((a, b) => a.subscribed && b.subscribed ? comparePosition(b.subscribed, a.subscribed) : a.subscribed ? -1 : b.subscribed ? 1 : a.uid.localeCompare(b.uid))
            this.value.status = 'ready'; this.value.rows = values; this.photos = photos; this.value.message = ''
          }
        } catch { this.value.status = 'error'; this.value.rows = []; this.value.message = tr('구독 기록이나 소유자 권한을 확인하지 못했습니다. 다시 조회해 주세요.') }
        this.changed()
      },
      state: (state, error) => {
        if (!current() || !this.value || state === 'ready') return
        this.value.status = state; this.value.rows = []
        this.value.message = state === 'loading' ? tr('구독자 목록 연결을 확인하고 있습니다.') : error?.code === 'index' ? tr('구독자 조회에 필요한 서버 인덱스를 확인해야 합니다.') : tr('구독자를 읽지 못했습니다. 연결·소유자 권한을 확인한 뒤 다시 조회해 주세요.')
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
      this.value = { requestId: request.requestId, channelId: request.channelId, status: 'blocked', rows: [], message: tr('채널 정보나 소유자 권한이 변경되었습니다. 구독자 목록을 다시 열어 주세요.') }
    }
  }
  dismiss(requestId: string): void { if (this.value?.requestId === requestId) { this.clear(); this.changed() } }
  clear(): void { this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null }
}
