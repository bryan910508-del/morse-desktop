import { language, tr, type Language } from './i18n'
// Chat translation (MorseMessenger iOS: message menu "번역" and "전체번역"), on this Mac only.
export type TranslationResult =
  | { status: 'translated'; text: string }
  | { status: 'same-language' | 'unsupported' | 'not-installed' | 'unavailable' | 'failed' }

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
export const translationUnavailableNote = (): string => tr('번역은 macOS 26 이상의 Mac에서 쓸 수 있어요.')

export function translationMessage(result: TranslationResult): string {
  switch (result.status) {
    case 'translated': return ''
    case 'same-language': return tr('이미 한국어로 된 메시지예요.')
    case 'unsupported': return tr('이 언어는 이 Mac에서 번역할 수 없어요.')
    case 'not-installed': return tr('번역 언어를 내려받아야 해요. 시스템 설정의 번역 언어에서 내려받아 주세요.')
    case 'unavailable': return translationUnavailableNote()
    default: return tr('번역할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }
}
