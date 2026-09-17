import { storyCaptionDraftTarget, type StoryCaptionDraftTarget } from './story-caption-drafts'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionDraft, type StoryCaptionDraft } from './story-caption-drafts'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface StoryCaptionSavePrepare extends StoryCaptionDraftTarget { id: string; draftRevision: string; draft: StoryCaptionDraft }
export interface StoryCaptionSaveRequest extends StoryCaptionSavePrepare { ownerId: string }
export type StoryCaptionSaveState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingStoryCaptionSave extends StoryCaptionSaveRequest { state: StoryCaptionSaveState }
export interface StoryCaptionSaveObservation { outcome: 'matching' | 'original' | 'different' | 'expired' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface StoryCaptionSaveSnapshot { observation: StoryCaptionSaveObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingStoryCaptionSave | null; message: string }
export interface StoryCaptionSaveAction { id: string; state: StoryCaptionSaveState; action: 'send' | 'check' | 'dismiss' }
const prepareKeys = ['id', 'storyId', 'privacy', 'draftRevision', 'draft']
export function storyCaptionSavePrepare(raw: unknown): StoryCaptionSavePrepare {
  const v = object(raw), draft = storyCaptionDraft(v.draft)
  if (Object.keys(v).some(k => !prepareKeys.includes(k)) || (draft.caption === draft.baseCaption)) throw new Error(tr('원문에서 변경한 설명을 먼저 기기에 저장해 주세요.'))
  const points = Array.from(draft.caption)
  if (points.length > 2000 || points.some(char => { const value = char.codePointAt(0)!; return value >= 0xD800 && value <= 0xDFFF })) throw new Error(tr('서버에 저장할 설명은 2,000자까지 입력해 주세요. 내용을 자동으로 자르지 않습니다.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), draftRevision: backgroundPhotoId(v.draftRevision), draft }
}
export function storyCaptionSaveRequest(raw: unknown): StoryCaptionSaveRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => ![...prepareKeys, 'ownerId'].includes(k))) throw new Error(tr('현재 계정의 스토리 저장 내용을 확인해 주세요.'))
  return { ...storyCaptionSavePrepare(Object.fromEntries(prepareKeys.map(k => [k, v[k]]))), ownerId: identifier(v.ownerId) }
}
export function storyCaptionSaveAction(raw: unknown): StoryCaptionSaveAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 스토리 수정 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as StoryCaptionSaveState, action: v.action }
}
