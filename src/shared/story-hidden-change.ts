import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { storyCaptionDraftTarget } from './story-caption-drafts'
import type { StoryHiddenAudienceRequest } from './story-hidden-audience'
import { storyHiddenAudienceRequest } from './story-hidden-audience'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface StoryHiddenChangePrepare extends StoryHiddenAudienceRequest { mode: 'add' | 'remove'; peerUid: string }
export interface StoryHiddenChangeRequest { id: string; ownerId: string; storyId: string; privacy: StoryPrivacy; version: string; expiresAt: number; caption: string; mode: 'add' | 'remove'; peerUid: string; displayName: string; contactVersion: string | null; original: string[]; desired: string[] }
export type StoryHiddenChangeState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingStoryHiddenChange extends StoryHiddenChangeRequest { state: StoryHiddenChangeState }
export interface StoryHiddenChangeObservation { outcome: 'matching' | 'original' | 'different' | 'expired' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface StoryHiddenChangeSnapshot { observation: StoryHiddenChangeObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingStoryHiddenChange | null; message: string }
export interface StoryHiddenChangeAction { id: string; state: StoryHiddenChangeState; action: 'send' | 'check' | 'dismiss' }
function version(value: unknown): string { if (typeof value !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value)) throw new Error(tr('현재 문서 버전을 확인해 주세요.')); return value }
function mode(value: unknown): 'add' | 'remove' { if (value !== 'add' && value !== 'remove') throw new Error(tr('숨김 추가 또는 해제를 선택해 주세요.')); return value }
function audience(value: unknown): string[] { if (!Array.isArray(value) || value.length > 1000) throw new Error(tr('지원 범위의 숨김 목록을 확인해 주세요.')); const list = value.map(identifier); if (new Set(list).size !== list.length) throw new Error(tr('중복된 숨김 대상입니다.')); return list }
export function storyHiddenChangePrepare(raw: unknown): StoryHiddenChangePrepare {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'storyId', 'privacy', 'version', 'mode', 'peerUid'].includes(k))) throw new Error(tr('현재 숨김 설정에서 대상을 선택해 주세요.'))
  const { mode: rawMode, peerUid, ...target } = v
  return { ...storyHiddenAudienceRequest(target), mode: mode(rawMode), peerUid: identifier(peerUid) }
}
export function storyHiddenChangeRequest(raw: unknown): StoryHiddenChangeRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'ownerId', 'storyId', 'privacy', 'version', 'expiresAt', 'caption', 'mode', 'peerUid', 'displayName', 'contactVersion', 'original', 'desired'].includes(k)) || typeof v.displayName !== 'string' || v.displayName.length > 512 || typeof v.caption !== 'string' || v.caption.length > 8000 || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= 0) throw new Error(tr('검토할 스토리 숨김 변경 내용을 확인해 주세요.'))
  const ownerId = identifier(v.ownerId), peerUid = identifier(v.peerUid), operation = mode(v.mode), original = audience(v.original), desired = audience(v.desired)
  if (operation === 'add' ? ownerId === peerUid || original.includes(peerUid) : !original.includes(peerUid)) throw new Error(tr('변경 대상이 현재 숨김 설정과 다릅니다.'))
  const expected = operation === 'add' ? [...original, peerUid] : original.filter(uid => uid !== peerUid)
  if (JSON.stringify(expected) !== JSON.stringify(desired) || (operation === 'remove' && v.contactVersion !== null)) throw new Error(tr('선택한 한 명만 변경할 수 있습니다.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), ownerId, peerUid, mode: operation, displayName: v.displayName, version: version(v.version), contactVersion: operation === 'add' ? version(v.contactVersion) : null, caption: v.caption, expiresAt: v.expiresAt, original, desired }
}
export function storyHiddenChangeAction(raw: unknown): StoryHiddenChangeAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 숨김 변경 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as StoryHiddenChangeState, action: v.action }
}
