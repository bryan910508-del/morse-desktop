import type { PostDraftVisibility } from '../../../shared/channel-post-drafts'
import type { CommentReplyTarget } from '../../../shared/channel-comment-drafts'
import { desktop } from './store'
import { waitFor } from './contacts'
import { trackWrite } from './drafts'
import { controller } from './ui'
import { errorText } from './format'
import { confirmBox } from '../ui/layers'
import { tr } from '../../../shared/i18n'

type CreationState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
interface CreationAction { id: string; state: CreationState; action: 'send' | 'check' | 'dismiss' }
interface JournalSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; message: string; pending: { id: string; state: CreationState } | null; canCheck?: boolean; observation?: { message: string } | null }
export interface Journal {
  current(): JournalSnapshot | null
  refresh(): Promise<void>
  action(action: CreationAction): Promise<void>
  prepare(id: string): Promise<void>
}
export interface JournalMessages { waiting: string; denied: string; rejected: string }

// Thrown after the user was already told what happened; errorText turns it into no message.
export class SilentError extends Error { constructor() { super('silent'); this.name = 'SilentError' } }

// An earlier request whose result is unknown blocks the same kind of action. Nothing is
// sent again: on request the server state is read and, once the user agrees, the old
// device record is closed so a new request can start.
const offered = new Set<string>()
export function offerRecovery(key: string, check: (() => Promise<string | null>) | null, dismiss: () => Promise<unknown>): void {
  if (offered.has(key)) return
  offered.add(key)
  const recover = async (): Promise<void> => {
    const observed = check ? await check().catch(() => null) : null
    const text = tr('{0} 기록을 닫으면 새로 진행할 수 있습니다. 이전 요청이 이미 반영되었다면 같은 내용이 한 번 더 반영될 수 있습니다.', [observed || tr('서버에 반영되었는지 확인하지 못했습니다.')])
    if (!await confirmBox({ title: tr('결과를 모르는 이전 요청'), text, confirm: tr('기록 닫기') })) { offered.delete(key); return }
    try { await trackWrite(dismiss()); controller.toast(tr('이전 기록을 닫았습니다. 다시 시도해 주세요.')) }
    catch (reason) { offered.delete(key); controller.toast(errorText(reason, tr('기록을 닫지 못했습니다.')), 'error') }
  }
  controller.toast(tr('이전 요청의 결과를 아직 몰라 새로 진행할 수 없습니다.'), 'default', { label: tr('확인'), run: () => { void recover() } })
}

// The durable creation journals (prepare → send → confirm) run without review
// steps: one press saves, sends and closes the record. An uncertain send keeps
// its record and is never repeated automatically.
export async function runJournal(pipeline: Journal, messages: JournalMessages, id: string = crypto.randomUUID()): Promise<'done' | 'unconfirmed'> {
  const idle = () => { const value = pipeline.current(); return value && value.status !== 'loading' && !value.busy ? value : null }
  const initial = pipeline.current()
  if (!initial || (initial.status === 'loading' && !initial.busy)) await pipeline.refresh().catch(() => {})
  let state = await waitFor(idle, 10000, messages.waiting)
  if (state.status === 'error') { await pipeline.refresh(); state = await waitFor(idle, 10000, messages.waiting) }
  if (state.status !== 'ready') throw new Error(state.message || messages.waiting)
  const previous = state.pending
  if (previous?.state === 'submitted') {
    const latest = (): { id: string; state: CreationState } | null => { const value = pipeline.current()?.pending; return value?.id === previous.id ? value : null }
    offerRecovery(`journal:${previous.id}`, state.canCheck === undefined ? null : async () => {
      const current = latest()
      if (!current) return null
      await pipeline.action({ id: current.id, state: current.state, action: 'check' })
      return await waitFor(() => { const value = pipeline.current(); return value && !value.busy && value.observation ? value.observation.message : null }, 5000).catch(() => null)
    }, async () => {
      const current = latest()
      if (current) await pipeline.action({ id: current.id, state: current.state, action: 'dismiss' })
    })
    throw new SilentError()
  }
  if (previous) await trackWrite(pipeline.action({ id: previous.id, state: previous.state, action: 'dismiss' }))
  await trackWrite(pipeline.prepare(id))
  const record = () => { const value = idle(); return value?.pending?.id === id ? value : null }
  const prepared = await waitFor(record, 5000, messages.waiting)
  if (!prepared.canSend) {
    await pipeline.action({ id, state: 'prepared', action: 'dismiss' }).catch(() => {})
    throw new Error(messages.denied)
  }
  await trackWrite(pipeline.action({ id, state: 'prepared', action: 'send' }))
  const outcome = await waitFor(() => { const value = record(); return value && value.pending!.state !== 'prepared' ? value.pending!.state : null }, 5000).catch(() => null)
  if (outcome === 'confirmed' || outcome === 'rejected') await pipeline.action({ id, state: outcome, action: 'dismiss' }).catch(() => {})
  if (outcome === 'rejected') throw new Error(messages.rejected)
  return outcome === 'confirmed' ? 'done' : 'unconfirmed'
}

export function publishPost(accountUid: string, post: { channelId: string; text: string; visibility: PostDraftVisibility; draftRevision: string }, photos: Uint8Array[] = []): Promise<'done' | 'unconfirmed'> {
  return runJournal({
    current: () => desktop.value?.postCreation ?? null,
    refresh: () => window.morse.refreshPostCreation(accountUid),
    action: action => window.morse.postCreationAction(accountUid, action),
    prepare: id => window.morse.preparePostCreation(accountUid, { ...post, id }, photos)
  }, {
    waiting: tr('이전 글의 게시 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
    denied: tr('지금은 이 채널에 글을 게시할 수 없습니다. 권한과 연결을 확인해 주세요.'),
    rejected: tr('글을 게시하지 못했습니다. 작성한 내용은 초안에 남아 있습니다.')
  })
}

export function publishComment(accountUid: string, comment: { channelId: string; postId: string; text: string; draftRevision: string; parent: CommentReplyTarget | null; surface?: 'public-preview' }): Promise<'done' | 'unconfirmed'> {
  const { parent, surface, ...fields } = comment
  return runJournal({
    current: () => desktop.value?.commentCreation ?? null,
    refresh: () => window.morse.refreshCommentCreation(accountUid),
    action: action => window.morse.commentCreationAction(accountUid, action),
    prepare: id => window.morse.prepareCommentCreation(accountUid, { ...fields, id, ...(surface ? { surface } : {}), ...(parent ? { parent } : {}) })
  }, {
    waiting: tr('이전 댓글의 등록 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
    denied: tr('지금은 이 게시물에 댓글을 달 수 없습니다. 게시물과 연결을 확인해 주세요.'),
    rejected: tr('댓글을 등록하지 못했습니다. 작성한 내용은 초안에 남아 있습니다.')
  })
}
