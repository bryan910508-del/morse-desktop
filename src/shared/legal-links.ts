// 6A-3 (App Store 1.2: the terms and the privacy policy readable from inside the app): the policy pages Morse hosts,
// https://talky-a38c3.web.app/{page}/{language}/, opened in the app's language. Korean, English and Russian have
// pages; any other language opens the English one. The trailing slash is the address the site answers without a
// redirect.
export type LegalPage = 'privacy' | 'community' | 'terms'
export const legalSite = 'https://talky-a38c3.web.app'
export function legalLanguage(language: string): 'ko' | 'en' | 'ru' {
  return language === 'ko' || language === 'en' || language === 'ru' ? language : 'en'
}
export function legalPageURL(page: LegalPage, language: string): string {
  return `${legalSite}/${page}/${legalLanguage(language)}/`
}
