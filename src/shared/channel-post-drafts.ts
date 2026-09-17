import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export type PostDraftVisibility = 'public' | 'subscribers'
export interface PostDraftTarget { channelId: string }
export interface PostDraftContent { text: string; visibility: PostDraftVisibility }
export interface PostDraftRecord extends PostDraftTarget, PostDraftContent { revision: string | null }
export interface PostDraftWrite extends PostDraftTarget, PostDraftContent { expected: string | null; revision: string }
export function postDraftTarget(raw: unknown): PostDraftTarget {
  const v = object(raw)
  if (Object.keys(v).some(k => k !== 'channelId')) throw new Error(tr('글 초안의 채널을 다시 선택해 주세요.'))
  return { channelId: identifier(v.channelId) }
}
export function postDraftContent(raw: unknown): PostDraftContent {
  const v = object(raw)
  if (Object.keys(v).some(k => !['text', 'visibility'].includes(k)) || typeof v.text !== 'string' || v.text.length > 5000 || (v.visibility !== 'public' && v.visibility !== 'subscribers')) throw new Error(tr('본문은 5,000자 이내로 입력하고 공개 범위를 선택해 주세요.'))
  return { text: v.text, visibility: v.visibility as PostDraftVisibility }
}
export function postDraftWrite(raw: unknown): PostDraftWrite {
  const v = object(raw)
  if (Object.keys(v).some(k => !['channelId', 'text', 'visibility', 'expected', 'revision'].includes(k)) || v.expected === undefined) throw new Error(tr('현재 글 초안의 저장 버전을 확인해 주세요.'))
  const expected = v.expected === null ? null : backgroundPhotoId(v.expected), revision = backgroundPhotoId(v.revision)
  if (expected === revision) throw new Error(tr('새 초안 버전이 필요합니다.'))
  return { ...postDraftTarget({ channelId: v.channelId }), ...postDraftContent({ text: v.text, visibility: v.visibility }), expected, revision }
}
