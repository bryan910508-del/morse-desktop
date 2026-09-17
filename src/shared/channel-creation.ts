import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelCreationPrepare { id: string; name: string; description: string }
export interface ChannelCreationOwner { ownerId: string; profileVersion: string; ownerInfo: { userId: string; displayName: string; photoURL: string; publicKey: string } }
export interface ChannelCreationRequest extends ChannelCreationPrepare, ChannelCreationOwner {}
export type ChannelCreationState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingChannelCreation extends ChannelCreationRequest { state: ChannelCreationState }
export interface ChannelCreationObservation { outcome: 'matching' | 'different' | 'absent' | 'unavailable'; discussion: 'none' | 'known' | 'unknown' | 'unobserved'; observedAt: number; message: string }
export interface ChannelCreationSnapshot {
  observation: ChannelCreationObservation | null; canCheck: boolean
  status: 'loading' | 'ready' | 'error'; busy: boolean; canPrepare: boolean; canSend: boolean; message: string
  pending: (ChannelCreationPrepare & { state: ChannelCreationState; ownerName: string }) | null
}
export interface ChannelCreationAction { id: string; state: ChannelCreationState; action: 'send' | 'dismiss' | 'check' }
const fail = (): never => { throw new Error(tr('채널 이름은 1~50자, 소개는 500자 이내로 입력하고 현재 소유자 정보를 확인해 주세요.')) }
export function channelCreationPrepare(raw: unknown): ChannelCreationPrepare {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'name', 'description'].includes(k)) || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 50 || typeof v.description !== 'string' || v.description.length > 500) return fail()
  return { id: backgroundPhotoId(v.id), name: v.name, description: v.description }
}
export function channelCreationRequest(raw: unknown): ChannelCreationRequest {
  const v = object(raw), owner = object(v.ownerInfo)
  if (Object.keys(v).some(k => !['id', 'name', 'description', 'ownerId', 'profileVersion', 'ownerInfo'].includes(k)) ||
    typeof v.profileVersion !== 'string' || !/^\d+:\d{1,9}$/.test(v.profileVersion) ||
    Object.keys(owner).some(k => !['userId', 'displayName', 'photoURL', 'publicKey'].includes(k))) return fail()
  for (const [key, max] of [['userId', 160], ['displayName', 512], ['photoURL', 10000], ['publicKey', 16000]] as const) if (typeof owner[key] !== 'string' || owner[key].length > max) return fail()
  if (!owner.userId || !(owner.displayName as string).trim()) return fail()
  return { ...channelCreationPrepare({ id: v.id, name: v.name, description: v.description }), ownerId: identifier(v.ownerId), profileVersion: v.profileVersion,
    ownerInfo: { userId: owner.userId as string, displayName: owner.displayName as string, photoURL: owner.photoURL as string, publicKey: owner.publicKey as string } }
}
export function channelCreationAction(raw: unknown): ChannelCreationAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(v.state)) || (v.action !== 'send' && v.action !== 'dismiss' && v.action !== 'check')) return fail()
  return { id: backgroundPhotoId(v.id), state: v.state as ChannelCreationState, action: v.action }
}
