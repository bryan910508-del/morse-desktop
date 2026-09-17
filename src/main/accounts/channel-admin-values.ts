import { channelAdminPermissionLabels, type ChannelAdminPermissionInfo, type ChannelAdminsSnapshot } from '../../shared/channel-admins'
import { identifier, object } from '../../shared/validation'
import type { FirestoreDocument, WireObject } from '../network/firestore-values'

export function channelAdminPermissions(doc: FirestoreDocument): ChannelAdminPermissionInfo {
  let fields: WireObject | null = {}, malformed = false
  try {
    if (doc.fields.permissions !== undefined) {
      const map = object(object(doc.fields.permissions).mapValue)
      fields = map.fields === undefined ? {} : object(map.fields)
    }
  } catch { fields = null; malformed = true }
  return Object.fromEntries(Object.keys(channelAdminPermissionLabels).map(key => {
    if (malformed || !fields) return [key, { value: null, origin: 'unknown' }]
    const raw = fields[key]
    if (raw === undefined) return [key, { value: key === 'canPostMessages', origin: 'default' }]
    try { const value = object(raw).booleanValue; if (typeof value === 'boolean') return [key, { value, origin: 'stored' }] } catch { /* Do not replace malformed flags by permissive defaults. */ }
    return [key, { value: null, origin: 'unknown' }]
  })) as ChannelAdminPermissionInfo
}
export function channelAdminIndex(doc: FirestoreDocument): { ids: Set<string> | null; origin: ChannelAdminsSnapshot['indexOrigin'] } {
  if (doc.fields.adminIds === undefined) return { ids: new Set(), origin: 'default' }
  try {
    const array = object(object(doc.fields.adminIds).arrayValue), values = array.values === undefined ? [] : array.values
    if (!Array.isArray(values) || values.length > 1000) throw new Error('Admin index bound')
    const ids = values.map(value => identifier(object(value).stringValue))
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate admin identity')
    return { ids: new Set(ids), origin: 'stored' }
  } catch { return { ids: null, origin: 'unknown' } }
}
