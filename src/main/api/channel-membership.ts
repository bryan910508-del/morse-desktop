import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField } from '../network/firestore-values'
import { callChannelMembership, ChannelMembershipFailure } from '../network/channel-membership-api'
import { tr } from '../../shared/i18n'

// Api::JoinChannel / LeaveChannel: one server call per user action. An unknown
// outcome is settled by reading the caller's own subscription documents; the
// request is never sent again automatically.
export class ChannelMembershipApi {
  private closed = false

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void) {}

  private start(): void {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
  }
  private async observe(channelId: string): Promise<'joined' | 'pending' | 'none' | null> {
    const reader = new FirestoreReader(this.auth)
    try {
      if (await reader.getDocument(`${documents}/users/${this.uid}/subscriptions/${channelId}`, this.auth.signal)) return 'joined'
      const request = await reader.getDocument(`${documents}/channels/${channelId}/joinRequests/${this.uid}`, this.auth.signal)
      return request && stringField(request.fields, 'status', 32) === 'pending' ? 'pending' : 'none'
    } catch { return null }
    finally { reader.close() }
  }

  async join(channelId: string): Promise<'joined' | 'pending' | 'unconfirmed'> {
    this.start()
    try { return await callChannelMembership(this.auth, 'joinMorseChannel', channelId, this.auth.signal, this.allowed) === 'pending' ? 'pending' : 'joined' }
    catch (error) {
      if (!(error instanceof ChannelMembershipFailure) || !error.uncertain) throw new Error(tr('채널에 가입할 수 없습니다. 채널이 없어졌거나 참여가 제한되었습니다.'))
      const state = await this.observe(channelId)
      return state === 'joined' || state === 'pending' ? state : 'unconfirmed'
    }
  }

  async leave(channelId: string): Promise<'done' | 'unconfirmed'> {
    this.start()
    try { await callChannelMembership(this.auth, 'leaveMorseChannel', channelId, this.auth.signal, this.allowed); return 'done' }
    catch (error) {
      if (!(error instanceof ChannelMembershipFailure) || !error.uncertain) throw new Error(tr('채널에서 나가지 못했습니다. 연결을 확인해 주세요.'))
      const state = await this.observe(channelId)
      if (state === 'joined') throw new Error(tr('채널에서 나가지 못했습니다. 잠시 후 다시 시도해 주세요.'))
      return state === null ? 'unconfirmed' : 'done'
    }
  }

  close(): void { this.closed = true }
}
