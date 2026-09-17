import { publicChannelMetadata } from './channel-discovery-values'
import type { ChannelMembershipRequest, ChannelMembershipSnapshot, ChannelMembershipInfo } from '../../shared/channel-membership-info'
import { channelDiscussionReference } from './channel-discussion-reference'
import { channelNotificationInfo } from './channel-notification-info'
import { identifier } from '../../shared/validation'
import type { FirestoreReader, ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

// These observations never grant membership, post access or mutation authority.
export class ChannelMembershipReader {
  private value: ChannelMembershipSnapshot | null = null
  private reader: FirestoreReader | null = null
  private stop: (() => void) | null = null
  private generation = 0
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly source: (id: string) => { doc: FirestoreDocument; reader: FirestoreReader }, private readonly changed: () => void, private readonly requirePublic = false) {}
  private validate(channelId: string): ReturnType<ChannelMembershipReader['source']> {
    this.auth.signal.throwIfAborted()
    const source = this.source(channelId)
    if (this.reader && this.reader !== source.reader) throw new Error('Channel read lifetime changed')
    return source
  }
  get snapshot(): ChannelMembershipSnapshot | null {
    if (!this.value) return null
    try { this.validate(this.value.channelId); return { ...this.value, info: this.value.info ? { ...this.value.info, discussion: { ...this.value.info.discussion }, notification: { ...this.value.info.notification } } : null } }
    catch { return { ...this.value, status: 'blocked', info: null, message: tr('현재 채널 정보를 확인할 수 없습니다. 가입 상태를 다시 열어 주세요.') } }
  }
  open(request: ChannelMembershipRequest): void {
    this.clear()
    this.value = { ...request, status: 'loading', info: null, message: '' }
    let source: ReturnType<ChannelMembershipReader['validate']>
    try { source = this.validate(request.channelId); this.reader = source.reader }
    catch { this.value.status = 'blocked'; this.value.message = this.requirePublic ? tr('현재 공개 미리보기에서 조회할 채널을 확인해 주세요.') : tr('현재 내 채널 목록에서 조회할 채널을 확인해 주세요.'); this.changed(); return }
    const channel = `${documents}/channels/${request.channelId}`
    const subscriber = `${channel}/subscribers/${this.uid}`, subscription = `${documents}/users/${this.uid}/subscriptions/${request.channelId}`, join = `${channel}/joinRequests/${this.uid}`
    const admin = `${channel}/admins/${this.uid}`
    const names = [channel, subscriber, subscription, join, admin], generation = this.generation
    const current = () => generation === this.generation && this.value?.requestId === request.requestId
    // One bounded document target: no collection-wide subscriber or request scan.
    this.stop = source.reader.watch({ documents: { documents: names } }, this.auth.signal, {
      snapshot: rows => {
        if (!current() || !this.value) return
        try {
          this.validate(request.channelId)
          if (rows.size > names.length || [...rows].some(([name, doc]) => !names.includes(name) || doc.name !== name)) throw new Error('Unexpected membership scope')
          const root = rows.get(channel)
          if (!root) throw new Error('Channel no longer exists')
          if (this.requirePublic) publicChannelMetadata(root)
          const owner = identifier(stringField(root.fields, 'ownerId', 160))
          const boundField = (path: string, key: string, expected: string) => {
            const doc = rows.get(path)
            // Older records can lack the redundant identity. The document path still binds the subject.
            if (doc && doc.fields[key] !== undefined && stringField(doc.fields, key, 160) !== expected) throw new Error('Membership identity conflict')
          }
          boundField(subscriber, 'uid', this.uid); boundField(subscription, 'channelId', request.channelId); boundField(join, 'uid', this.uid); boundField(admin, 'userId', this.uid)
          const joinDoc = rows.get(join), raw = joinDoc?.fields.status?.stringValue
          const joinRequest: ChannelMembershipInfo['joinRequest'] = !joinDoc ? 'none' : raw === 'pending' || raw === 'approved' || raw === 'denied' ? raw : 'unknown'
          this.value = { ...request, status: 'ready', info: { administrator: rows.has(admin), discussion: channelDiscussionReference(root), owned: owner === this.uid, subscriber: rows.has(subscriber), subscriptionListed: rows.has(subscription), joinRequest, notification: channelNotificationInfo(rows.get(subscription)) }, message: '' }
        } catch { this.value.info = null; this.value.status = 'error'; this.value.message = tr('채널 또는 본인의 가입 기록을 확인하지 못했습니다. 다시 조회해 주세요.') }
        this.changed()
      },
      state: state => {
        if (!current() || !this.value || state === 'ready') return
        this.value.info = null; this.value.status = state
        this.value.message = state === 'loading' ? tr('가입 상태 연결을 확인하고 있습니다.') : tr('가입 상태를 읽지 못했습니다. 연결과 권한을 확인한 뒤 다시 조회해 주세요.')
        this.changed()
      }
    }, 5, 1024 * 1024)
    this.changed()
  }
  prune(): void {
    if (!this.value) return
    try { this.validate(this.value.channelId) }
    catch {
      const request = this.value; this.clear()
      this.value = { requestId: request.requestId, channelId: request.channelId, status: 'blocked', info: null, message: this.requirePublic ? tr('현재 공개 채널을 확인할 수 없습니다. 가입 상태를 다시 열어 주세요.') : tr('현재 채널 목록을 확인할 수 없습니다. 가입 상태를 다시 열어 주세요.') }
    }
  }
  dismiss(requestId: string): void { if (this.value?.requestId === requestId) { this.clear(); this.changed() } }
  clear(): void { this.generation++; this.stop?.(); this.stop = null; this.reader = null; this.value = null }
}
