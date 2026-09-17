import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelTagsEdit { id: string; requestId: string; channelId: string; version: string; tags: string[] }
export interface ChannelTagsResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
const blocked = new Set(['admin', 'official', 'talky', 'support', 'help', 'api', 'null', 'sex', 'porn', 'xxx', 'nazi', 'spam'])
export function normalizeChannelTag(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 512) throw new Error(tr('태그를 다시 입력해 주세요.'))
  let tag = raw.trim()
  while (tag.startsWith('#')) tag = tag.slice(1).trim()
  tag = tag.replace(/[A-Z]/g, letter => letter.toLowerCase())
  // A conservative UTF-16 bound; combining-mark graphemes need separate support.
  if (tag.length < 2 || tag.length > 20 || !/^[\p{L}\p{N}_]+$/u.test(tag) || blocked.has(tag.toLowerCase())) throw new Error(tr('태그는 공백 없이 문자·숫자·밑줄 2~20자로 입력해 주세요. 예약어는 사용할 수 없습니다.'))
  return tag
}
export function channelTagsEdit(raw: unknown): ChannelTagsEdit {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'channelId', 'version', 'tags'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) || !Array.isArray(value.tags) || value.tags.length > 8) throw new Error(tr('최신 채널 정보를 확인하고 태그를 최대 8개 입력해 주세요.'))
  const tags = value.tags.map(normalizeChannelTag)
  if (new Set(tags).size !== tags.length) throw new Error(tr('중복 태그를 하나만 남겨 주세요.'))
  return { id: identifier(value.id), requestId: identifier(value.requestId), channelId: identifier(value.channelId), version: value.version, tags }
}
// Read separately from input policy so existing server values are never silently normalized.
export function readChannelTags(raw: unknown): string[] | null {
  if (raw === undefined) return []
  try {
    const field = object(raw)
    if (!field.arrayValue) return null
    const values = object(field.arrayValue).values ?? []
    if (!Array.isArray(values) || values.length > 8) return null
    return values.map(value => {
      const tag = object(value).stringValue
      if (typeof tag !== 'string' || tag.length > 512) throw new Error('Invalid channel tag')
      return tag
    })
  } catch { return null }
}
