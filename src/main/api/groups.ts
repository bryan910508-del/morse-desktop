import type { GroupCreateRequest } from '../../shared/group-create'
import type { GroupMembersRequest } from '../../shared/group-members'
import type { GroupLeaveRequest } from '../../shared/group-leave'
import type { GroupRemovalRequest } from '../../shared/group-removal'
import { createGroup, GroupCreateFailure } from '../network/group-create-api'
import { addGroupMembers, GroupMembersFailure } from '../network/group-members-api'
import { leaveGroup, GroupLeaveFailure } from '../network/group-leave-api'
import { removeGroupMember, GroupRemovalFailure } from '../network/group-removal-api'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { decodeDialog, documents, stringField, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

export type GroupResult = 'done' | 'unconfirmed'
export interface GroupSources {
  create(request: GroupCreateRequest): void
  members(request: GroupMembersRequest): void
  leave(request: GroupLeaveRequest): void
  removal(request: GroupRemovalRequest): void
}

// Api::ChatParticipants: one server request per user action. A definite
// rejection is reported to the caller. An unknown outcome is settled by one
// read of the chat document; nothing is sent again automatically.
export class GroupApi {
  private readonly running = new Set<AbortController>()
  private closed = false

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void, private readonly sources: GroupSources,
    private readonly newChatAutoDelete: () => { seconds: number; myOnly: boolean } = () => ({ seconds: 0, myOnly: false })) {}

  private async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    this.allowed()
    const abort = new AbortController()
    this.running.add(abort)
    try { return await work(AbortSignal.any([abort.signal, this.auth.signal])) }
    finally { this.running.delete(abort) }
  }
  private async members(chatId: string, signal: AbortSignal): Promise<{ doc: FirestoreDocument; participants: string[] } | null> {
    const reader = new FirestoreReader(this.auth)
    try {
      const doc = await reader.getDocument(`${documents}/chats/${chatId}`, signal)
      if (!doc) return null
      const summary = decodeDialog(doc, this.uid).summary
      return summary.kind === 'group' ? { doc, participants: summary.participantUids } : null
    } catch { return null }
    finally { reader.close() }
  }

  create(request: GroupCreateRequest): Promise<GroupResult> {
    this.sources.create(request)
    return this.run(async signal => {
      try {
        await createGroup(this.auth, this.uid, request, signal, () => { this.allowed(); this.sources.create(request) }, this.newChatAutoDelete())
        return 'done'
      } catch (error) {
        if (!(error instanceof GroupCreateFailure) || !error.uncertain) throw new Error(tr('그룹을 만들지 못했습니다. 이름과 참여자를 확인해 주세요.'))
        const current = await this.members(request.chatId, signal)
        return current && stringField(current.doc.fields, 'createdBy', 160) === this.uid ? 'done' : 'unconfirmed'
      }
    })
  }

  addMembers(request: GroupMembersRequest): Promise<GroupResult> {
    this.sources.members(request)
    return this.run(async signal => {
      try {
        await addGroupMembers(this.auth, this.uid, request, signal, () => { this.allowed(); this.sources.members(request) })
        return 'done'
      } catch (error) {
        if (!(error instanceof GroupMembersFailure) || !error.uncertain) throw new Error(tr('참여자를 추가하지 못했습니다. 최신 그룹 정보를 확인해 주세요.'))
        const current = await this.members(request.chatId, signal)
        if (!current) return 'unconfirmed'
        if (request.addUids.every(uid => current.participants.includes(uid))) return 'done'
        throw new Error(tr('참여자를 추가하지 못했습니다. 다시 시도해 주세요.'))
      }
    })
  }

  leave(request: GroupLeaveRequest): Promise<GroupResult> {
    this.sources.leave(request)
    return this.run(async signal => {
      try {
        await leaveGroup(this.auth, this.uid, request, signal, () => { this.allowed(); this.sources.leave(request) })
        return 'done'
      } catch (error) {
        if (!(error instanceof GroupLeaveFailure) || !error.uncertain) throw new Error(tr('그룹에서 나가지 못했습니다.'))
        const current = await this.members(request.chatId, signal)
        if (!current) return 'unconfirmed'
        if (!current.participants.includes(this.uid)) return 'done'
        throw new Error(tr('그룹에서 나가지 못했습니다. 다시 시도해 주세요.'))
      }
    })
  }

  removeMember(request: GroupRemovalRequest): Promise<GroupResult> {
    this.sources.removal(request)
    return this.run(async signal => {
      try {
        await removeGroupMember(this.auth, this.uid, request, signal, () => { this.allowed(); this.sources.removal(request) })
        return 'done'
      } catch (error) {
        if (!(error instanceof GroupRemovalFailure) || !error.uncertain) throw new Error(tr('참여자를 내보내지 못했습니다.'))
        const current = await this.members(request.chatId, signal)
        if (!current) return 'unconfirmed'
        if (!current.participants.includes(request.removeUid)) return 'done'
        throw new Error(tr('참여자를 내보내지 못했습니다. 다시 시도해 주세요.'))
      }
    })
  }

  close(): void {
    this.closed = true
    for (const abort of this.running) abort.abort()
    this.running.clear()
  }
}
