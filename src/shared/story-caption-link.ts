import { object } from './validation'
import { storyCaptionDraftStart, type StoryCaptionDraftStart } from './story-caption-drafts'
import { tr } from './i18n'
export interface StoryCaptionLinkRequest extends StoryCaptionDraftStart { url: string }
function webLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || !/^https?:\/\//i.test(raw) || /[\\\u0000-\u0020\u007f]/u.test(raw)) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048) return null
    return url.href
  } catch { return null }
}
export function firstStoryCaptionLink(caption: string): string | null {
  if (caption.length > 8000) return null
  // Preserve token boundaries and punctuation; do not guess a repaired address.
  for (const part of caption.split(/\s+/u)) { const url = webLink(part); if (url) return url }
  return null
}
export function storyCaptionLinkRequest(raw: unknown): StoryCaptionLinkRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['requestId', 'storyId', 'privacy', 'version', 'url'].includes(key))) throw new Error(tr('현재 스토리 설명에서 링크를 선택해 주세요.'))
  const url = webLink(v.url)
  if (!url || url !== v.url) throw new Error(tr('확인할 수 있는 웹 주소를 선택해 주세요.'))
  const { url: _url, ...target } = v
  return { ...storyCaptionDraftStart(target), url }
}
