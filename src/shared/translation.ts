import { language, tr, type Language } from './i18n'
// Chat translation (MorseMessenger iOS: message menu "번역" and "전체번역"), on this Mac only.
export type TranslationResult =
  | { status: 'translated'; text: string }
  | { status: 'same-language' | 'unsupported' | 'not-installed' | 'unavailable' | 'failed' | 'rate-limited' }

// The interface language of Morse Desktop; translations are made into it, as iOS translates into currentLanguage.
export function translationTarget(): Language { return language() }
export const maxTranslationText = 10000

// B51: what this device's own helpers can do. Translation uses the Translation framework's session API (macOS 26,
// Darwin 25), background removal Vision's subject mask (macOS 14, Darwin 23), voice to text Speech on any Mac Desktop
// runs on. Windows has none of them yet: Telegram translates on its server there (R-63), Morse Windows translation is
// still to come. A feature that cannot work is left out or says so, instead of failing without a word.
export interface OnDeviceFeatures { translation: boolean; voiceToText: boolean; backgroundRemoval: boolean }
export function onDeviceFeatures(platform: string, kernelRelease: string, helpers: { translate: boolean; media: boolean }): OnDeviceFeatures {
  const darwin = platform === 'darwin' ? Number.parseInt(kernelRelease, 10) || 0 : 0
  return { translation: darwin >= 25 && helpers.translate, voiceToText: darwin > 0 && helpers.media, backgroundRemoval: darwin >= 23 && helpers.media }
}
// B343: where a translation is made — tdesktop CreateTranslateProvider (lang/translate_provider.cpp:34-46, v7.3.0 42f8a36d;
// v7.3.1 changes no translation file): this device's own translation when it can, else the server's. Morse asks the
// server only while its switch is on for this account (app_config/server_translation or the account's featureAccess,
// morse-feature-switch decide); with neither there is no translation, as before.
export type TranslationRoute = 'device' | 'server' | 'none'
export function translationRoute(device: boolean, serverSwitch: boolean, forced?: string): TranslationRoute {
  // A development build may pin the route (MORSE_TRANSLATION_ROUTE) to try the server's on a Mac that translates itself.
  if (forced === 'device' || forced === 'server' || forced === 'none') return forced
  return device ? 'device' : serverSwitch ? 'server' : 'none'
}
export const translationAvailable = (route: TranslationRoute | undefined): boolean => route === 'device' || route === 'server'
// translateMorseMessages takes at most this many ids in one request (tdesktop sends the visible messages together:
// history_view_translate_tracker.cpp:273-306, translate_mtproto_provider.cpp:46-104).
export const serverTranslationBatch = 20
export const translationUnavailableNote = (): string => tr('번역은 macOS 26 이상의 Mac에서 쓸 수 있어요.')

export function translationMessage(result: TranslationResult): string {
  switch (result.status) {
    case 'translated': return ''
    case 'same-language': return tr('이미 한국어로 된 메시지예요.')
    case 'unsupported': return tr('이 언어는 이 Mac에서 번역할 수 없어요.')
    case 'not-installed': return tr('번역 언어를 내려받아야 해요. 시스템 설정의 번역 언어에서 내려받아 주세요.')
    case 'unavailable': return translationUnavailableNote()
    case 'rate-limited': return tr('번역을 너무 많이 했어요. 잠시 후 다시 시도해 주세요.')
    default: return tr('번역할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }
}

// B356: what the message menu offers «번역» on — any text with words in it, one's own too: tdesktop's menu asks only for
// an original text that is not to be skipped, not whether the message went out (history_view_context_menu.cpp:1901-1909).
// Not a secret chat's, an encrypted or a service line. «전체번역» stays with received messages (translate_tracker.cpp:116).
export function menuTranslatable(message: { kind: string; text: string; encrypted?: boolean; system?: boolean }, roomKind: string | undefined): boolean {
  return message.kind === 'text' && !message.encrypted && !message.system && roomKind !== 'secret' && Boolean(message.text.trim())
}

// B343b: which room a translation key names — a chat by its id, a 1:1 inquiry room by the key its messages already go
// under on this device (inquiryQueueChatId, `sub_inq_<inquiryId>`). translateMorseMessages takes both kinds
// (morse-translation.js:7, :51, :146).
export type TranslationRoom = { kind: 'chat' | 'inquiry'; roomId: string }
const inquiryKey = 'sub_inq_'
export function translationRoom(key: string): TranslationRoom {
  return key.startsWith(inquiryKey) ? { kind: 'inquiry', roomId: key.slice(inquiryKey.length) } : { kind: 'chat', roomId: key }
}
