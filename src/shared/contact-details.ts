import { identifier, object } from './validation'
import { tr } from './i18n'

export interface ContactDetails { nickname: string; note: string; version: string }
export interface ContactDetailsSnapshot extends ContactDetails { status: 'loading' | 'ready' | 'error' }
export interface ContactDetailsEdit { operationId: string; expectedVersion: string; nickname: string; note: string }
// A11 §3: the saved name and note are kept on the server too (users/{me}/contactNames/{peer}), whose rules take a name
// of 64 characters and a note of 1,000 at most.
export const contactNameLimit = 64, contactNoteLimit = 1000
export function contactDetailsEdit(raw: unknown): ContactDetailsEdit {
  const value = object(raw)
  if (typeof value.nickname !== 'string' || value.nickname.length > contactNameLimit || /[\u0000-\u001f\u007f]/.test(value.nickname) ||
      typeof value.note !== 'string' || value.note.length > contactNoteLimit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.note)) throw new Error(tr('별칭은 64자, 개인 메모는 1,000자까지 입력해 주세요.'))
  return { operationId: identifier(value.operationId), expectedVersion: value.expectedVersion === '' ? '' : identifier(value.expectedVersion),
    nickname: value.nickname.trim(), note: value.note.trim() }
}
