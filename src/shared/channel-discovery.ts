import { identifier, object } from './validation'
import { normalizeChannelTag } from './channel-tags'
import { tr } from './i18n'
export interface ChannelDiscoveryRequest { requestId: string; query: string }
export interface ChannelDiscoveryRow { id: string; version: string; name: string; description: string; tags: string[] | null; subscriberCount: number | null; matchesName: boolean; matchesTag: boolean }
export type ChannelDiscoveryBranch = 'ready' | 'skipped' | 'index' | 'permission' | 'network' | 'data'
export interface ChannelDiscoverySnapshot {
  requestId: string | null; query: string; status: 'idle' | 'loading' | 'ready' | 'error' | 'expired'; rows: ChannelDiscoveryRow[]; message: string
  nameResult: ChannelDiscoveryBranch | null; tagResult: ChannelDiscoveryBranch | null; limited: boolean; observedAt: number | null
}
export function channelDiscoveryRequest(raw: unknown): ChannelDiscoveryRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'query'].includes(k)) || typeof v.query !== 'string' || v.query.length > 200) throw new Error(tr('채널 이름이나 태그를 1~50자로 입력해 주세요.'))
  let query = v.query.trim()
  while (query.startsWith('#')) query = query.slice(1).trim()
  if (!query || query.length > 50 || /[\u0000-\u001f\u007f]/.test(query)) throw new Error(tr('채널 이름이나 태그를 1~50자로 입력해 주세요.'))
  return { requestId: identifier(v.requestId), query }
}
export function discoveryTag(query: string): string | null { try { return normalizeChannelTag(query) } catch { return null } }
