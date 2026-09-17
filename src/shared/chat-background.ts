import { identifier, object } from './validation'
import { tr } from './i18n'

export const backgroundPresets = [
  { id: 'theme', label: tr('화면 테마'), group: tr('기본') },
  { id: 'morse', label: tr('Morse 글로우'), group: tr('기본') },
  { id: 'deep-blue', label: tr('딥 블루'), group: tr('단색') },
  { id: 'cipher', label: tr('사이퍼'), group: tr('단색') },
  { id: 'midnight', label: tr('미드나이트'), group: tr('단색') },
  { id: 'dark-teal', label: tr('다크 틸'), group: tr('단색') },
  { id: 'purple-night', label: tr('퍼플 나이트'), group: tr('단색') },
  { id: 'slate', label: tr('슬레이트'), group: tr('단색') },
  { id: 'deep-dive', label: tr('딥다이브'), group: tr('그라데이션') },
  { id: 'night-sky', label: tr('나이트스카이'), group: tr('그라데이션') },
  { id: 'ocean', label: tr('오션'), group: tr('그라데이션') },
  { id: 'sunset', label: tr('선셋'), group: tr('그라데이션') },
  { id: 'mocha', label: tr('모카'), group: tr('그라데이션') },
  { id: 'emerald', label: tr('에메랄드'), group: tr('그라데이션') }
] as const
export type ChatBackground = { preset: typeof backgroundPresets[number]['id']; brightness: number } |
  { preset: 'photo'; photoId: string; brightness: number; positionX: number; positionY: number }
export type BackgroundPhotoScope = { kind: 'device' } | { kind: 'chat'; accountUid: string; chatId: string }
export function backgroundPhotoScope(value: unknown): BackgroundPhotoScope {
  const record = object(value)
  if (record.kind === 'device' && Object.keys(record).length === 1) return { kind: 'device' }
  if (record.kind === 'chat' && Object.keys(record).every(key => ['kind', 'accountUid', 'chatId'].includes(key))) {
    return { kind: 'chat', accountUid: identifier(record.accountUid), chatId: identifier(record.chatId) }
  }
  throw new Error(tr('배경을 적용할 화면을 다시 선택해 주세요.'))
}
export function backgroundPhotoId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new Error(tr('사진을 다시 선택해 주세요.'))
  return value
}
export const defaultChatBackground: ChatBackground = { preset: 'theme', brightness: 0 }
export interface ChatBackgroundRecord { value: ChatBackground | null; version: string }
export interface ChatBackgroundEdit { operationId: string; expectedVersion: string; value: ChatBackground | null }

export function chatBackground(value: unknown): ChatBackground {
  const record = object(value)
  if (typeof record.brightness !== 'number' ||
    !Number.isInteger(record.brightness) || record.brightness < -100 || record.brightness > 100) throw new Error(tr('배경과 밝기를 다시 선택해 주세요.'))
  if (record.preset === 'photo') {
    if (Object.keys(record).some(key => !['preset', 'brightness', 'photoId', 'positionX', 'positionY'].includes(key)) ||
      ![record.positionX, record.positionY].every(position => typeof position === 'number' && Number.isInteger(position) && position >= 0 && position <= 100)) throw new Error(tr('사진 위치를 다시 선택해 주세요.'))
    return { preset: 'photo', brightness: record.brightness, photoId: backgroundPhotoId(record.photoId), positionX: record.positionX as number, positionY: record.positionY as number }
  }
  if (Object.keys(record).some(key => !['preset', 'brightness'].includes(key)) || !backgroundPresets.some(preset => preset.id === record.preset)) throw new Error(tr('배경을 다시 선택해 주세요.'))
  return { preset: record.preset as typeof backgroundPresets[number]['id'], brightness: record.brightness }
}
export function chatBackgroundEdit(value: unknown): ChatBackgroundEdit {
  const record = object(value)
  return { operationId: identifier(record.operationId), expectedVersion: record.expectedVersion === '' ? '' : identifier(record.expectedVersion),
    value: record.value === null ? null : chatBackground(record.value) }
}
export function sameBackground(a: ChatBackground | null, b: ChatBackground | null): boolean {
  return a === null || b === null ? a === b : a.preset === b.preset && a.brightness === b.brightness &&
    (a.preset !== 'photo' || (b.preset === 'photo' && a.photoId === b.photoId && a.positionX === b.positionX && a.positionY === b.positionY))
}
