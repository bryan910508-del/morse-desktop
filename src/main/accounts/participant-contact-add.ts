import type { ParticipantAddResult } from '../../shared/participants'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ParticipantContactWriteFailure, type ContactCreateFields } from '../network/participant-contact-write'
import type { FirestoreDocument } from '../network/firestore-values'
import { recordContactStep } from '../platform/contact-diagnostics'
import { tr } from '../../shared/i18n'

export interface ChatContactTarget { id: string; chatId: string; uid: string }
interface Active { target: ChatContactTarget; abort: AbortController; task: Promise<ParticipantAddResult> }

// "Add to contacts" for a group member or a 1:1 peer (Telegram AddContactBox from a profile).
// One save runs per person; when it ends without a new contact it can be tried again, and a
// contact saved meanwhile is reported as existing instead of being written twice.
export class ParticipantContactAdd {
  private readonly running = new Map<string, Active>()
  private closed = false
  constructor(private readonly uid: string, private readonly auth: ReadCredentials,
    private readonly resolve: (target: ChatContactTarget, doc?: FirestoreDocument) => ContactCreateFields,
    private readonly refresh: () => void) {}
  pause(): void { for (const active of this.running.values()) active.abort.abort() }
  prune(): void {
    for (const active of this.running.values()) {
      try { this.resolve(active.target) } catch { active.abort.abort() }
    }
  }
  add(target: ChatContactTarget): Promise<ParticipantAddResult> {
    if (this.closed) throw new Error(tr('연락처 추가를 시작하지 못했습니다.'))
    const key = `${target.chatId}\n${target.uid}`, current = this.running.get(key)
    if (current) return current.task
    try { this.resolve(target) } catch (error) { recordContactStep('resolve-failed', error instanceof Error ? error.message : ''); throw error }
    const abort = new AbortController()
    const task = this.run(target, abort.signal).finally(() => { if (this.running.get(key)?.abort === abort) this.running.delete(key) })
    this.running.set(key, { target, abort, task })
    return task
  }
  private async run(target: ChatContactTarget, signal: AbortSignal): Promise<ParticipantAddResult> {
    let reader: FirestoreReader | null = null
    try {
      reader = new FirestoreReader(this.auth)
      const outcome = await reader.addParticipantContact(this.uid, target.chatId, target.uid, signal, doc => this.resolve(target, doc))
      recordContactStep(outcome)
      let message = outcome === 'added' ? tr('내 연락처에 추가했습니다.') : tr('이미 저장된 연락처입니다. 기존 연락처 정보는 유지했습니다.')
      // A failed refresh does not undo a confirmed commit or turn it into a retry.
      if (!signal.aborted && !this.closed) {
        try { this.refresh() } catch { message += tr(' 연락처 목록을 다시 불러와 주세요.') }
      }
      return { outcome, message }
    } catch (error) {
      if (error instanceof ParticipantContactWriteFailure) return { outcome: error.uncertain ? 'uncertain' : 'rejected', message: error.message }
      recordContactStep('start-failed', error instanceof Error ? error.message : '')
      return { outcome: 'rejected', message: tr('연락처 추가를 시작하지 못했습니다. 연결과 최신 참여자 정보를 확인해 주세요.') }
    } finally { reader?.close() }
  }
  async close(): Promise<void> {
    this.closed = true; this.pause()
    await Promise.allSettled([...this.running.values()].map(active => active.task))
    this.running.clear()
  }
}
