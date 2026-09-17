import { identifier, object } from '../../shared/validation'
import { positionMilliseconds } from '../../shared/model'
import type { ContactStoryViewRecordValue } from '../../shared/contact-story-view-record'
import { timestamp, type FirestoreDocument } from './firestore-values'
export function currentViewerRecord(doc: FirestoreDocument, uid: string, preparing = false): ContactStoryViewRecordValue {
  const viewerField = doc.fields.viewerIds
  let listed = false
  if (viewerField !== undefined) {
    const values = object(viewerField.arrayValue).values ?? []
    if (!Array.isArray(values) || values.length > 1000) throw new Error('Unsupported viewer list')
    const ids = values.map(value => identifier(object(value).stringValue))
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate viewer list')
    listed = ids.includes(uid)
    if (preparing && !listed && ids.length >= 1000) throw new Error('Viewer list capacity')
  }
  const base = { listed, viewerFieldPresent: viewerField !== undefined }, field = doc.fields.viewedAtByUid
  if (field === undefined) return { ...base, timeField: 'missing', viewedAt: null }
  const entries = object(object(field.mapValue).fields ?? {})
  if (Object.keys(entries).length > 1000) throw new Error('Unsupported viewer timestamp map size')
  if (preparing && !Object.hasOwn(entries, uid) && Object.keys(entries).length >= 1000) throw new Error('Viewer timestamp capacity')
  if (!Object.hasOwn(entries, uid)) return { ...base, timeField: 'absent', viewedAt: null }
  const value = object(entries[uid])
  return { ...base, timeField: 'stored', viewedAt: positionMilliseconds(timestamp(value.timestampValue, uid)) }
}
