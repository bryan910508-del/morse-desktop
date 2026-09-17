import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelShareRequest { requestId: string; channelId: string; channelVersion: string; post?: { id: string; revision: string } }
export function channelShareRequest(raw: unknown): ChannelShareRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'channelId', 'channelVersion', 'post'].includes(k)) || typeof v.channelVersion !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.channelVersion)) throw new Error(tr('현재 공개 채널에서 공유 링크를 다시 선택해 주세요.'))
  let post: ChannelShareRequest['post']
  if (v.post !== undefined) {
    const p = object(v.post)
    if (Object.keys(p).some(k => !['id', 'revision'].includes(k)) || typeof p.revision !== 'string' || !/^[a-f0-9]{64}$/.test(p.revision)) throw new Error(tr('현재 공개 게시물에서 공유 링크를 다시 선택해 주세요.'))
    post = { id: identifier(p.id), revision: p.revision }
  }
  return { requestId: identifier(v.requestId), channelId: identifier(v.channelId), channelVersion: v.channelVersion, ...(post ? { post } : {}) }
}
export function channelShareURL(channelId: string, postId?: string): string {
  if (channelId === 'post') throw new Error(tr('이 채널 ID는 기존 공유 링크에서 지원하지 않습니다.'))
  return `https://talky-a38c3.web.app/channel/${encodeURIComponent(identifier(channelId))}${postId === undefined ? '' : `/post/${encodeURIComponent(identifier(postId))}`}`
}

export interface PublicChannelLinkRequest { requestId: string; url: string }
export function publicChannelLinkTarget(raw: unknown): { channelId: string; postId: string | null } {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error(tr('채널 공유 HTTPS 주소를 입력해 주세요.'))
  const text = raw.trim()
  let url: URL
  try { url = new URL(text) } catch { throw new Error(tr('채널 공유 HTTPS 주소를 입력해 주세요.')) }
  if (url.protocol !== 'https:' || url.hostname !== 'talky-a38c3.web.app' || url.username || url.password || url.port || url.search || url.hash) throw new Error(tr('기존 채널 공유 HTTPS 주소만 열 수 있습니다.'))
  const parts = url.pathname.split('/')
  if (parts[1] !== 'channel' || !(parts.length === 3 || (parts.length === 5 && parts[3] === 'post'))) throw new Error(tr('채널 또는 게시물 공유 주소를 입력해 주세요.'))
  const id = identifier(parts[2]), postId = parts.length === 5 ? identifier(parts[4]) : null
  if (channelShareURL(id, postId ?? undefined) !== text) throw new Error(tr('채널 공유 주소를 변경 없이 입력해 주세요.'))
  return { channelId: id, postId }
}
export function publicChannelLinkRequest(raw: unknown): PublicChannelLinkRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'url'].includes(k))) throw new Error(tr('채널 공유 주소를 다시 입력해 주세요.'))
  const target = publicChannelLinkTarget(v.url)
  return { requestId: identifier(v.requestId), url: channelShareURL(target.channelId, target.postId ?? undefined) }
}

// Inspect a bounded number of exact tokens without fetching or repairing links.
export function publicSharingLinks(text: string): { urls: string[]; limited: boolean } {
  const urls = new Set<string>()
  if (!text || text.length > 30000) return { urls: [], limited: Boolean(text) }
  let examined = 0
  for (const match of text.matchAll(/(?:^|\s)(https:\/\/talky-a38c3\.web\.app\/channel\/[^\s]+)/g)) {
    if (++examined > 20) return { urls: [...urls], limited: true }
    try { const target = publicChannelLinkTarget(match[1]); urls.add(channelShareURL(target.channelId, target.postId ?? undefined)) } catch { /* Preserve the original body without guessing corrected URLs. */ }
  }
  return { urls: [...urls], limited: false }
}

export function channelShareText(name: string, channelId: string, postId?: string): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 512) throw new Error(tr('현재 채널 이름을 다시 확인해 주세요.'))
  return tr('📢 [{0}] 채널을 공유했어요\n{1}', [name, channelShareURL(channelId, postId)])
}
