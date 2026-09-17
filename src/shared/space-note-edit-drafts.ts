import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface NoteEditDraftTarget { noteId: string }
export interface NoteEditDraftStart extends NoteEditDraftTarget { requestId: string; version: string }
export interface NoteEditDraft { baseVersion: string; baseTitle: string; baseBody: string; title: string; body: string }
export interface NoteEditDraftRecord extends NoteEditDraftTarget { revision: string | null; draft: NoteEditDraft | null }
export interface NoteEditDraftRow extends NoteEditDraftTarget { title: string; preview: string; revision: string }
export interface NoteEditDraftWrite extends NoteEditDraftTarget { expected: string; revision: string; draft: NoteEditDraft | null }
const version = (raw: unknown): string => { if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('노트 원본의 버전을 확인해 주세요.')); return raw }
export function noteEditDraftTarget(raw: unknown): NoteEditDraftTarget {
  const v = object(raw)
  if (Object.keys(v).some(k => k !== 'noteId')) throw new Error(tr('편집 초안을 다시 선택해 주세요.'))
  return { noteId: identifier(v.noteId) }
}
export function noteEditDraftStart(raw: unknown): NoteEditDraftStart {
  const v = object(raw)
  if (Object.keys(v).some(k => !['noteId', 'requestId', 'version'].includes(k))) throw new Error(tr('현재 노트에서 편집을 시작해 주세요.'))
  return { noteId: identifier(v.noteId), requestId: identifier(v.requestId), version: version(v.version) }
}
export function noteEditDraft(raw: unknown): NoteEditDraft {
  const v = object(raw)
  if (Object.keys(v).some(k => !['baseVersion', 'baseTitle', 'baseBody', 'title', 'body'].includes(k)) || [v.baseTitle, v.title].some(value => typeof value !== 'string' || value.length > 200) || [v.baseBody, v.body].some(value => typeof value !== 'string' || value.length > 120000)) throw new Error(tr('제목200자·본문120,000자와 편집 원본을 확인해 주세요.'))
  return { baseVersion: version(v.baseVersion), baseTitle: v.baseTitle as string, baseBody: v.baseBody as string, title: v.title as string, body: v.body as string }
}
export function noteEditDraftWrite(raw: unknown): NoteEditDraftWrite {
  const v = object(raw)
  if (Object.keys(v).some(k => !['noteId', 'expected', 'revision', 'draft'].includes(k))) throw new Error(tr('현재 편집 초안의 저장 버전을 확인해 주세요.'))
  const expected = backgroundPhotoId(v.expected), revision = backgroundPhotoId(v.revision)
  if (expected === revision) throw new Error(tr('새 저장 버전이 필요합니다.'))
  return { noteId: identifier(v.noteId), expected, revision, draft: v.draft === null ? null : noteEditDraft(v.draft) }
}
