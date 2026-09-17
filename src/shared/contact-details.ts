import { identifier, object } from './validation'
import { tr } from './i18n'

export interface ContactDetails { nickname: string; note: string; version: string }
export interface ContactDetailsSnapshot extends ContactDetails { status: 'loading' | 'ready' | 'error' }
export interface ContactDetailsEdit { operationId: string; expectedVersion: string; nickname: string; note: string }
export function contactDetailsEdit(raw: unknown): ContactDetailsEdit {
  const value = object(raw)
  if (typeof value.nickname !== 'string' || value.nickname.length > 100 || /[\u0000-\u001f\u007f]/.test(value.nickname) ||
      typeof value.note !== 'string' || value.note.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.note)) throw new Error(tr('별칭은 100자, 개인 메모는 2,000자까지 입력해 주세요.'))
  return { operationId: identifier(value.operationId), expectedVersion: value.expectedVersion === '' ? '' : identifier(value.expectedVersion),
    nickname: value.nickname.trim(), note: value.note.trim() }
}
