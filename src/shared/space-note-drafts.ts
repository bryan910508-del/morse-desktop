import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface NoteDraftTarget { id: string }
export interface NoteDraftContent { title: string; body: string; pinned: boolean }
export interface NoteDraftRecord extends NoteDraftTarget, NoteDraftContent { revision: string | null }
export interface NoteDraftRow extends NoteDraftTarget { title: string; preview: string; pinned: boolean; revision: string }
export interface NoteDraftWrite extends NoteDraftTarget, NoteDraftContent { expected: string | null; revision: string }
export function noteDraftTarget(raw: unknown): NoteDraftTarget {
  const v = object(raw)
  if (Object.keys(v).some(k => k !== 'id')) throw new Error(tr('새 노트 초안을 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id) }
}
export function noteDraftContent(raw: unknown): NoteDraftContent {
  const v = object(raw)
  if (Object.keys(v).some(k => !['title', 'body', 'pinned'].includes(k)) || typeof v.title !== 'string' || v.title.length > 200 || typeof v.body !== 'string' || v.body.length > 120000 || typeof v.pinned !== 'boolean') throw new Error(tr('제목200자·본문120,000자와 고정 여부를 확인해 주세요.'))
  return { title: v.title, body: v.body, pinned: v.pinned }
}
export function noteDraftWrite(raw: unknown): NoteDraftWrite {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'title', 'body', 'pinned', 'expected', 'revision'].includes(k)) || v.expected === undefined) throw new Error(tr('현재 노트 초안의 저장 버전을 확인해 주세요.'))
  const expected = v.expected === null ? null : backgroundPhotoId(v.expected), revision = backgroundPhotoId(v.revision)
  if (expected === revision) throw new Error(tr('새 초안 저장 버전이 필요합니다.'))
  return { ...noteDraftTarget({ id: v.id }), ...noteDraftContent({ title: v.title, body: v.body, pinned: v.pinned }), expected, revision }
}
