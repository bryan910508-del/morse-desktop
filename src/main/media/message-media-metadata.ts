import { mediaArrayFields, mediaMetadata, mediaNumberFields, maxThumbDataChars, type MediaMetadata } from '../../shared/media-metadata'
import type { FirestoreDocument } from '../network/firestore-values'

// Malformed optional metadata does not hide readable media. It prevents a
// forward from silently discarding or changing that media's semantic fields.
export function messageMediaMetadata(doc: FirestoreDocument, kind: string, count: number, circular: boolean): MediaMetadata | null {
  const raw: Record<string, unknown> = {}
  try {
    for (const key of mediaNumberFields) {
      const value = doc.fields[key]
      if (!value) continue
      const number = value.integerValue ?? value.doubleValue
      if (number === undefined || (typeof number !== 'string' && typeof number !== 'number') || (typeof number === 'string' && !/^\d+$/.test(number))) return null
      raw[key] = Number(number)
    }
    for (const key of mediaArrayFields) {
      const value = doc.fields[key]
      if (!value) continue
      const array = value.arrayValue as { values?: Record<string, unknown>[] } | undefined
      if (!array || (array.values !== undefined && !Array.isArray(array.values))) return null
      const values = array.values ?? []
      if (values.length > 1000) return null
      raw[key] = values.map(item => {
        const number = item.integerValue ?? item.doubleValue
        if (number === undefined || (typeof number !== 'number' && (typeof number !== 'string' || !/^\d+$/.test(number)))) throw new Error('Invalid numeric metadata')
        return Number(number)
      })
    }
    // A placeholder from another client may be anything; an unreadable one is simply left out so
    // the rest of the picture's information survives.
    const thumb = doc.fields.thumbData?.stringValue
    if (typeof thumb === 'string' && thumb && thumb.length <= maxThumbDataChars && /^[A-Za-z0-9+/]+={0,2}$/.test(thumb)) raw.thumbData = thumb
    if (circular) raw.isCircleVideo = true
    return mediaMetadata(raw, kind, count)
  } catch { return null }
}
