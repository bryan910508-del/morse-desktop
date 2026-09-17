import { channelCategories, channelChatModes, channelJoinPolicies, type ChannelAccessInfo, type ChannelSetting } from '../../shared/channel-access'
import type { FirestoreDocument, WireObject } from '../network/firestore-values'
import { object } from '../../shared/validation'
function enumeration<T extends string>(raw: WireObject | undefined, values: Record<T, string>, fallback: T): ChannelSetting<T> {
  if (raw === undefined) return { value: fallback, origin: 'default' }
  try {
    const value = object(raw).stringValue
    if (typeof value === 'string' && Object.hasOwn(values, value)) return { value: value as T, origin: 'stored' }
  } catch { /* Unknown values are not silently treated as permissive defaults. */ }
  return { value: null, origin: 'unknown' }
}
function booleanSetting(raw: WireObject | undefined): ChannelSetting<boolean> {
  if (raw === undefined) return { value: true, origin: 'default' }
  try { const value = object(raw).booleanValue; if (typeof value === 'boolean') return { value, origin: 'stored' } } catch { /* Read other settings independently. */ }
  return { value: null, origin: 'unknown' }
}
export function channelAccessInfo(doc: FirestoreDocument): ChannelAccessInfo {
  const f = doc.fields
  let category: ChannelAccessInfo['category'] = f.category === undefined ? 'none' : 'unknown'
  try { const raw = object(f.category).stringValue; if (typeof raw === 'string' && Object.hasOwn(channelCategories, raw)) category = raw as keyof typeof channelCategories } catch { /* Missing and malformed stay distinct. */ }
  let publicFlag: boolean | null = null, rawType: string | null = null
  try { const raw = object(f.isPublic).booleanValue; if (typeof raw === 'boolean') publicFlag = raw } catch { /* Not an access grant. */ }
  try { const raw = object(f.type).stringValue; if (typeof raw === 'string') rawType = raw } catch { /* The existing channel decoder owns its displayed type. */ }
  return {
    joinPolicy: enumeration(f.joinPolicy, channelJoinPolicies, 'open'), chatMode: enumeration(f.chatMode, channelChatModes, 'broadcast'),
    historyVisible: booleanSetting(f.discussionHistoryVisible), category, publicFlag,
    visibilityConflict: publicFlag !== null && rawType !== null && ['public', 'private', 'invite'].includes(rawType) && (rawType === 'public') !== publicFlag
  }
}

// Explicitly usable values for a future write; display defaults alone grant nothing.
export function editableChannelAccess(doc: FirestoreDocument): import('../../shared/channel-access-edit').ChannelAccessSettings | null {
  const access = channelAccessInfo(doc)
  let type: 'public' | 'private' | 'invite' | null = null
  try {
    const raw = doc.fields.type === undefined ? access.publicFlag === null ? null : access.publicFlag ? 'public' : 'private' : object(doc.fields.type).stringValue
    if (raw === 'public' || raw === 'private' || raw === 'invite') type = raw
  } catch { /* Invalid type disables editing. */ }
  if (!type || access.publicFlag === null || access.visibilityConflict || !access.joinPolicy.value || !access.chatMode.value || access.historyVisible.value === null || (type === 'public' && access.category === 'unknown')) return null
  return { type, joinPolicy: access.joinPolicy.value, chatMode: access.chatMode.value, historyVisible: access.historyVisible.value, category: type !== 'public' || access.category === 'none' || access.category === 'unknown' ? null : access.category }
}
