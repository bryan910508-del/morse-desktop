import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface CloseFriendChangePrepare { id: string; mode: 'add' | 'remove'; peerUid: string; requestId: string | null; version: string | null }
export interface CloseFriendChangeRequest { id: string; ownerId: string; mode: 'add' | 'remove'; peerUid: string; displayName: string; version: string | null; contactVersion: string | null }
export type CloseFriendChangeState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingCloseFriendChange extends CloseFriendChangeRequest { state: CloseFriendChangeState }
export interface CloseFriendChangeObservation { outcome: 'present' | 'original' | 'different' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface CloseFriendChangeSnapshot { observation: CloseFriendChangeObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingCloseFriendChange | null; message: string }
export interface CloseFriendChangeAction { id: string; state: CloseFriendChangeState; action: 'send' | 'check' | 'dismiss' }
const version = (value: unknown): string => { if (typeof value !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value)) throw new Error(tr('현재 문서 버전을 확인해 주세요.')); return value }
export function closeFriendChangePrepare(raw: unknown): CloseFriendChangePrepare {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'mode', 'peerUid', 'requestId', 'version'].includes(k)) || (v.mode !== 'add' && v.mode !== 'remove') || (v.mode === 'add' && (v.requestId !== null || v.version !== null))) throw new Error(tr('현재 연락처 또는 친한 친구 목록에서 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), peerUid: identifier(v.peerUid), mode: v.mode, requestId: v.mode === 'add' ? null : identifier(v.requestId), version: v.mode === 'add' ? null : version(v.version) }
}
export function closeFriendChangeRequest(raw: unknown): CloseFriendChangeRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'ownerId', 'mode', 'peerUid', 'displayName', 'version', 'contactVersion'].includes(k)) || (v.mode !== 'add' && v.mode !== 'remove') || typeof v.displayName !== 'string' || v.displayName.length > 512 || (v.mode === 'add' && v.version !== null) || (v.mode === 'remove' && v.contactVersion !== null)) throw new Error(tr('검토할 친한 친구 변경 내용을 확인해 주세요.'))
  const ownerId = identifier(v.ownerId), peerUid = identifier(v.peerUid)
  if (v.mode === 'add' && ownerId === peerUid) throw new Error(tr('현재 연락처에서 다른 사용자를 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), ownerId, peerUid, mode: v.mode, displayName: v.displayName, version: v.mode === 'add' ? null : version(v.version), contactVersion: v.mode === 'remove' ? null : version(v.contactVersion) }
}
export function closeFriendChangeAction(raw: unknown): CloseFriendChangeAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 친한 친구 변경 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as CloseFriendChangeState, action: v.action }
}
