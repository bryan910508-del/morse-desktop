import { discussionComposePolicy, type DiscussionComposePolicy } from './channel-discussion-compose'
import type { MessagePosition } from '../../shared/model'
import { comparePosition } from '../../shared/model'
import { identifier } from '../../shared/validation'
import { channelAdminIndex } from './channel-admin-values'
import type { FirestoreReader } from '../network/firestore-rpc'
import { documents, stringField, timestamp, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

type Policy = { state: 'loading' | 'blocked' | 'ready'; cutoff: MessagePosition | null; message: string }
interface Batch { ids: string[]; state: 'loading' | 'blocked' | 'ready'; rows: Map<string, FirestoreDocument>; stop(): void }
// Any discussion marker requires resolution; malformed markers never become ordinary chats.
export function discussionChannel(doc: FirestoreDocument): string | null {
  const f = doc.fields, marked = doc.name.split('/').at(-1)?.startsWith('channel_discuss_') ||
    (f.isChannelDiscussion !== undefined && f.isChannelDiscussion.booleanValue !== false) ||
    (f.channelId !== undefined && f.channelId.stringValue !== '')
  if (!marked) return null
  if (f.type?.stringValue !== 'group' || f.isChannelDiscussion?.booleanValue !== true) throw new Error('Invalid discussion marker')
  return identifier(f.channelId?.stringValue)
}
export class ChannelDiscussionHistory {
  private reader: FirestoreReader | null = null
  private batches: Batch[] = []
  private signature = ''
  private generation = 0
  constructor(private readonly uid: string, private readonly signal: AbortSignal, private readonly changed: () => void) {}
  clear(): void { this.generation++; for (const batch of this.batches) batch.stop(); this.batches = []; this.reader = null; this.signature = '' }
  setSource(reader: FirestoreReader | null, chats: Map<string, FirestoreDocument>): void {
    const ids = [...new Set([...chats.values()].flatMap(doc => { try { const id = discussionChannel(doc); return id ? [id] : [] } catch { return [] } }))].sort().slice(0, 100)
    const signature = JSON.stringify(ids)
    if (this.reader === reader && this.signature === signature) return
    this.clear(); this.reader = reader; this.signature = signature
    if (!reader || this.signal.aborted) return
    const generation = this.generation
    for (let offset = 0; offset < ids.length; offset += 30) {
      const group = ids.slice(offset, offset + 30)
      const paths = group.flatMap(id => [`${documents}/channels/${id}`, `${documents}/channels/${id}/subscribers/${this.uid}`, `${documents}/channels/${id}/admins/${this.uid}`])
      const batch: Batch = { ids: group, state: 'loading', rows: new Map(), stop: () => {} }
      this.batches.push(batch)
      let starting = true
      batch.stop = reader.watch({ documents: { documents: paths } }, this.signal, {
        snapshot: rows => {
          if (generation !== this.generation) return
          batch.rows = rows; batch.state = [...rows].every(([name, doc]) => paths.includes(name) && doc.name === name) ? 'ready' : 'blocked'
          if (batch.state === 'blocked') batch.rows.clear()
          this.changed()
        }, state: state => {
          if (generation !== this.generation || state === 'ready') return
          batch.state = state === 'loading' ? 'loading' : 'blocked'; batch.rows.clear()
          if (!starting) this.changed()
        }
      }, paths.length, 1024 * 1024)
      starting = false
    }
  }
  apply(chat: FirestoreDocument, dialog: ReadDialog): void {
    let id: string | null
    try { id = discussionChannel(chat) } catch { this.assign(dialog, { state: 'blocked', cutoff: null, message: tr('토론방 소속 정보를 확인할 수 없습니다.') }); return }
    if (!id) return
    let compose: DiscussionComposePolicy | undefined
    let policy: Policy = { state: 'blocked', cutoff: null, message: tr('토론방 기록 정책을 확인할 수 없습니다. 대화 목록을 다시 조회해 주세요.') }
    const batch = this.batches.find(value => value.ids.includes(id!))
    if (batch?.state === 'loading') policy = { state: 'loading', cutoff: null, message: tr('토론방 기록 공개 범위를 확인하는 중…') }
    else if (batch?.state === 'ready') {
      try {
        const path = `${documents}/channels/${id}`, channel = batch.rows.get(path)
        if (!channel || stringField(channel.fields, 'discussionChatId', 160) !== dialog.summary.id) throw new Error('Discussion reference mismatch')
        const owner = identifier(stringField(channel.fields, 'ownerId', 160))
        if (stringField(chat.fields, 'createdBy', 160) !== owner) throw new Error('Discussion owner mismatch')
        const raw = channel.fields.discussionHistoryVisible
        const visible = raw === undefined ? true : raw.booleanValue
        if (typeof visible !== 'boolean') throw new Error('Unknown history policy')
        if (visible || owner === this.uid) policy = { state: 'ready', cutoff: null, message: raw === undefined ? tr('토론 이전 기록 공개 · 기본값') : tr('토론 이전 기록 열람 가능') }
        else {
          const index = channelAdminIndex(channel).ids, admin = batch.rows.get(`${path}/admins/${this.uid}`)
          if (!index) throw new Error('Unknown administrator index')
          if (index.has(this.uid) && admin) policy = { state: 'ready', cutoff: null, message: tr('확인된 관리자 · 토론 이전 기록 열람 가능') }
          else {
            const subscriber = batch.rows.get(`${path}/subscribers/${this.uid}`)
            if (!subscriber || (subscriber.fields.uid !== undefined && stringField(subscriber.fields, 'uid', 160) !== this.uid) || !subscriber.fields.subscribedAt?.timestampValue) throw new Error('Subscription time unavailable')
            const cutoff = timestamp(subscriber.fields.subscribedAt.timestampValue, '')
            if (cutoff.seconds === 0 && cutoff.nanoseconds === 0) throw new Error('Invalid subscription time')
            policy = { state: 'ready', cutoff, message: tr('구독 시각 이후의 토론 기록만 표시합니다.') }
          }
        }
        if (policy.state === 'ready') compose = discussionComposePolicy(this.uid, channel, batch.rows.get(`${path}/subscribers/${this.uid}`), batch.rows.get(`${path}/admins/${this.uid}`))
      } catch { /* Keep uncertainty closed; never turn failed lookup into unlimited history. */ }
    } else if (!batch && this.reader) policy.message = tr('토론방 기록 정책은 계정당 채널 100개까지 조회합니다. 이 토론방의 기록은 표시하지 않습니다.')
    this.assign(dialog, policy, compose)
  }
  private assign(dialog: ReadDialog, policy: Policy, compose?: DiscussionComposePolicy): void {
    dialog.summary.composeAccess = policy.state === 'ready' && compose?.allowed === true
    dialog.summary.composeMessage = policy.state !== 'ready' ? tr('토론방 기록·작성 조건을 확인하는 동안 전송을 보류합니다. 기존 입력과 대기 항목은 보관합니다.') : compose?.message || ''
    dialog.summary.historyAccess = policy.state; dialog.summary.historyMessage = policy.message
    dialog.cutoff = policy.cutoff
    if (policy.state !== 'ready' || (policy.cutoff && (!dialog.summary.top || comparePosition(dialog.summary.top, policy.cutoff) < 0))) dialog.summary.preview = ''
  }
}
