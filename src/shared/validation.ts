import { autoDeleteSecondsValue } from './chat-auto-delete'
import type { MessagePosition, Preferences } from './model'
import { chatBackground } from './chat-background'
import { tr } from './i18n'

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(tr('잘못된 요청입니다.'))
  return value as Record<string, unknown>
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error(tr('잘못된 식별자입니다.'))
  return value
}
export function draftText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 30000) throw new Error(tr('메시지는 30,000자까지 입력할 수 있습니다.'))
  return value
}
export function outgoingText(value: unknown): string {
  const text = draftText(value).trim()
  if (!text || text.startsWith('__TALKY_AUTODEL__:') || text.startsWith('__deleted__:')) {
    throw new Error(tr('보낼 수 없는 메시지입니다.'))
  }
  return text
}
export function historyPosition(value: unknown): MessagePosition | undefined {
  if (value === undefined) return undefined
  const record = object(value)
  const { seconds, nanoseconds } = record
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0 ||
      typeof nanoseconds !== 'number' || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1_000_000_000) {
    throw new Error(tr('잘못된 메시지 위치입니다.'))
  }
  return { seconds, nanoseconds, id: identifier(record.id) }
}
type BooleanPreference = { [K in keyof Preferences]: Preferences[K] extends boolean ? K : never }[keyof Preferences]
const booleanPreferences = new Set<BooleanPreference>(['storyStealth', 'enterToSend', 'notifications', 'showNotificationPreview', 'closeToTray', 'showUnreadBadge',
  'autoDeleteOnlyMyMessages', 'autoTranslateChats', 'autoDownloadPhotos', 'recordVideoMessages', 'sendTypingIndicator', 'disableTypingIndicators',
  'notifyPersonal', 'notifyGroup', 'notifyChannel', 'notificationSound', 'inAppNotifications', 'spellCheck', 'powerSavingAuto', 'powerSavingAlwaysOn', 'compressMediaUploads', 'reduceMessageAnimations'])
export function preferencePatch(value: unknown): Partial<Preferences> {
  const record = object(value)
  const result: Partial<Preferences> = {}
  for (const key of Object.keys(record)) {
    if (key === 'language') {
      if (record.language !== null && record.language !== 'ko' && record.language !== 'en' && record.language !== 'ru') throw new Error(tr('언어를 다시 선택해 주세요.'))
      result.language = record.language
    } else if (key === 'theme') {
      if (typeof record.theme !== 'string' || !['system', 'dark', 'black', 'light'].includes(record.theme)) throw new Error(tr('지원하지 않는 테마입니다.'))
      result.theme = record.theme as Preferences['theme']
    } else if (key === 'chatBackground') {
      result.chatBackground = chatBackground(record.chatBackground)
    } else if (key === 'messageFontSize') {
      if (typeof record.messageFontSize !== 'number' || !Number.isInteger(record.messageFontSize) || record.messageFontSize < 13 || record.messageFontSize > 20) throw new Error(tr('메시지 글자 크기는 13부터 20까지 선택해 주세요.'))
      result.messageFontSize = record.messageFontSize
    } else if (key === 'autoDeleteDefaultSeconds') {
      if (typeof record.autoDeleteDefaultSeconds !== 'number' || autoDeleteSecondsValue(record.autoDeleteDefaultSeconds) !== record.autoDeleteDefaultSeconds) throw new Error(tr('자동 삭제 시간을 다시 선택해 주세요.'))
      result.autoDeleteDefaultSeconds = record.autoDeleteDefaultSeconds
    } else if (key === 'photoSendQuality') {
      if (record.photoSendQuality !== 'auto' && record.photoSendQuality !== 'original' && record.photoSendQuality !== 'compressed') throw new Error(tr('사진 화질을 다시 선택해 주세요.'))
      result.photoSendQuality = record.photoSendQuality
    } else if (key === 'videoSendQuality') {
      if (record.videoSendQuality !== 'auto' && record.videoSendQuality !== 'original' && record.videoSendQuality !== 'compressed') throw new Error(tr('영상 화질을 다시 선택해 주세요.'))
      result.videoSendQuality = record.videoSendQuality
    } else if (key === 'badgeMode') {
      if (record.badgeMode !== 'messages' && record.badgeMode !== 'chats') throw new Error(tr('배지 기준을 다시 선택해 주세요.'))
      result.badgeMode = record.badgeMode
    } else if (booleanPreferences.has(key as BooleanPreference)) {
      if (typeof record[key] !== 'boolean') throw new Error(tr('잘못된 설정입니다.'))
      result[key as BooleanPreference] = record[key]
    } else throw new Error(tr('지원하지 않는 설정입니다.'))
  }
  return result
}
