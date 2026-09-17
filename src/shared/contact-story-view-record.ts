import { contactStoryReactionRequest, type ContactStoryReactionRequest } from './contact-story-reaction'
import { tr } from './i18n'
export interface ContactStoryViewRecordRequest extends ContactStoryReactionRequest {}
export interface ContactStoryViewRecordValue { listed: boolean; viewerFieldPresent: boolean; timeField: 'missing' | 'absent' | 'stored'; viewedAt: number | null }
export interface ContactStoryViewRecordResult extends ContactStoryViewRecordRequest { ownerId: string; outcome: 'ready' | 'changed' | 'expired' | 'absent' | 'unavailable'; current: ContactStoryViewRecordValue | null; observedAt: number; expiresAt: number; message: string }
export function contactStoryViewRecordRequest(raw: unknown): ContactStoryViewRecordRequest { try { return contactStoryReactionRequest(raw) } catch { throw new Error(tr('현재 스토리 설명에서 본인의 열람 기록을 확인해 주세요.')) } }
