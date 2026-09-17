import { backgroundPhotoId } from './chat-background'
import { postPhotoList, type PostPhotoInfo } from './channel-post-photo'
import { postDraftTarget, postDraftContent, type PostDraftTarget, type PostDraftContent } from './channel-post-drafts'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface PostCreationPrepare extends PostDraftTarget, PostDraftContent { id: string; draftRevision: string }
export interface PostCreationContext { authorId: string; title: string; channelVersion: string; role: 'owner' | 'administrator'; adminVersion: string | null; publicChannel: boolean; discussionId: string | null }
export interface PostCreationRequest extends PostCreationPrepare, PostCreationContext { photos: PostPhotoInfo[] }
export type PostCreationState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingPostCreation extends PostCreationRequest { state: PostCreationState }
export interface PostCreationObservation { outcome: 'matching' | 'different' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface PostCreationSnapshot { observation: PostCreationObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingPostCreation | null; message: string }
export interface PostCreationAction { id: string; state: PostCreationState; action: 'send' | 'check' | 'dismiss' }
const prepareKeys = ['channelId', 'text', 'visibility', 'id', 'draftRevision']
export function postCreationPrepare(raw: unknown, photoCount = 0): PostCreationPrepare {
  const v = object(raw), content = postDraftContent({ text: v.text, visibility: v.visibility })
  // A post needs text or at least one photo (ChannelService.createPost keeps text optional).
  if (Object.keys(v).some(k => !prepareKeys.includes(k)) || (!content.text.trim() && photoCount === 0)) throw new Error(tr('저장한 글 초안을 다시 확인해 주세요.'))
  return { ...postDraftTarget({ channelId: v.channelId }), ...content, id: backgroundPhotoId(v.id), draftRevision: backgroundPhotoId(v.draftRevision) }
}
export function postCreationRequest(raw: unknown): PostCreationRequest {
  const v = object(raw), photos = postPhotoList(v.photos), prepare = postCreationPrepare(Object.fromEntries(prepareKeys.map(k => [k, v[k]])), photos.length)
  const validVersion = (value: unknown): value is string => typeof value === 'string' && /^\d{1,12}:\d{1,9}$/.test(value)
  if (Object.keys(v).some(k => ![...prepareKeys, 'photos', 'authorId', 'title', 'channelVersion', 'role', 'adminVersion', 'publicChannel', 'discussionId'].includes(k)) ||
    typeof v.title !== 'string' || !v.title.trim() || v.title.length > 512 || !validVersion(v.channelVersion) || typeof v.publicChannel !== 'boolean' ||
    (v.role !== 'owner' && v.role !== 'administrator') || (v.role === 'owner' ? v.adminVersion !== null : !validVersion(v.adminVersion))) throw new Error(tr('현재 채널과 작성 권한을 다시 확인해 주세요.'))
  return { ...prepare, photos, authorId: identifier(v.authorId), title: v.title, channelVersion: v.channelVersion, role: v.role, adminVersion: v.adminVersion as string | null, publicChannel: v.publicChannel, discussionId: v.discussionId === null ? null : identifier(v.discussionId) }
}
export function postCreationAction(raw: unknown): PostCreationAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('글 게시 기록을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as PostCreationState, action: v.action }
}
