import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { callMorseFunction, MorseCallableFailure } from '../network/morse-callable'
import { tr } from '../../shared/i18n'

// B105, tdesktop's «Delete channel» (edit_peer_info_box.cpp:1834-1841 the button in the owner's edit box, 3066-3101 a
// confirm box, then one channels.deleteChannel): one server call per user action, deleteMorseChannel, which checks the
// owner, deletes the channel and leaves the rest to the server (B110: a client deleting only the document left
// subscription indexes behind). An unknown outcome is settled by reading the channel, never by calling again.
export interface ChannelDeletionPort {
  remove(channelId: string): Promise<void>
  channel(channelId: string): Promise<FirestoreDocument | null>
}

export function firestoreChannelDeletion(auth: ReadCredentials, allowed: () => void): { port: ChannelDeletionPort; close(): void } {
  const reader = new FirestoreReader(auth)
  return {
    close: () => reader.close(),
    port: {
      remove: async channelId => {
        const result = await callMorseFunction(auth, 'deleteMorseChannel', { channelId }, auth.signal, { validate: allowed, limit: 64 * 1024 })
        if (result.ok !== true) throw new MorseCallableFailure('unknown', 'INVALID_RESPONSE')
      },
      channel: channelId => reader.getDocument(`${documents}/channels/${channelId}`, auth.signal)
    }
  }
}

export class ChannelDeletionApi {
  private closed = false

  constructor(private readonly allowed: () => void, private readonly open: () => { port: ChannelDeletionPort; close(): void }) {}

  async delete(channelId: string): Promise<'done' | 'unconfirmed'> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
    const { port, close } = this.open()
    try {
      try { await port.remove(channelId); return 'done' }
      catch (error) {
        if (!(error instanceof MorseCallableFailure)) throw new Error(tr('채널을 삭제하지 못했습니다. 연결을 확인해 주세요.'))
        if (error.delivery === 'answered') {
          if (error.status === 'NOT_FOUND') return 'done'
          if (error.status === 'PERMISSION_DENIED') throw new Error(tr('채널 소유자만 채널을 삭제할 수 있습니다.'))
          throw new Error(tr('채널을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
        }
        if (!error.uncertain) throw new Error(tr('채널을 삭제하지 못했습니다. 연결을 확인해 주세요.'))
      }
      let after: FirestoreDocument | null
      try { after = await port.channel(channelId) } catch { return 'unconfirmed' }
      if (after) throw new Error(tr('채널을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
      return 'done'
    } finally { close() }
  }

  close(): void { this.closed = true }
}
