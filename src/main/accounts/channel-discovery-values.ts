import type { PublicChannelMetadata } from '../../shared/channel-public-preview'
import type { ChannelDiscoveryRow } from '../../shared/channel-discovery'
import { readChannelTags } from '../../shared/channel-tags'
import { childId, documents, documentVersion, mapField, numberField, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
export function publicChannelMetadata(doc: FirestoreDocument): PublicChannelMetadata {
  const id = childId(doc.name, `${documents}/channels`), f = doc.fields, version = documentVersion(doc)
  const name = stringField(f, 'name', 512), type = stringField(f, 'type', 32), tags = readChannelTags(f.tags)
  if ((f.type !== undefined && typeof f.type.stringValue !== 'string') || !version || !name.trim() || f.isPublic?.booleanValue !== true || (type && type !== 'public') || (f.id !== undefined && f.id.stringValue !== id) || !f.createdAt?.timestampValue) throw new Error('Invalid public channel')
  const created = timestamp(f.createdAt.timestampValue, id)
  let subscriberCount: number | null = null
  if (f.subscriberCount && (f.subscriberCount.integerValue !== undefined || f.subscriberCount.doubleValue !== undefined)) {
    const count = numberField(f, 'subscriberCount'); if (Number.isSafeInteger(count) && count >= 0) subscriberCount = count
  }
  let storedPostCount: number | null = null, ownerName: string | null = null
  try {
    if (f.postCount && (f.postCount.integerValue !== undefined || f.postCount.doubleValue !== undefined)) {
      const count = numberField(f, 'postCount'); if (Number.isSafeInteger(count) && count >= 0) storedPostCount = count
    }
  } catch { /* Optional stored metadata does not grant or revoke public post access. */ }
  try { const name = stringField(mapField(f, 'ownerInfo'), 'displayName', 512); if (name.trim()) ownerName = name } catch { /* Do not substitute a user ID or fetch a private profile. */ }
  return { id, version, name, description: stringField(f, 'description', 10000), tags, subscriberCount, created, ownerName, storedPostCount }
}
export function discoveryRow(doc: FirestoreDocument, query: string, tag: string | null, branch: 'name' | 'tag'): ChannelDiscoveryRow {
  const row = publicChannelMetadata(doc), matchesName = row.name.startsWith(query), matchesTag = Boolean(tag && row.tags?.includes(tag))
  if ((branch === 'name' && !matchesName) || (branch === 'tag' && !matchesTag)) throw new Error('Channel query mismatch')
  return { id: row.id, version: row.version, name: row.name, description: row.description, tags: row.tags, subscriberCount: row.subscriberCount, matchesName, matchesTag }
}
export function mergeDiscoveryRows(groups: ChannelDiscoveryRow[][]): ChannelDiscoveryRow[] {
  const map = new Map<string, ChannelDiscoveryRow>()
  const newer = (a: string, b: string): boolean => { const [aSeconds, aNanos] = a.split(':').map(Number), [bSeconds, bNanos] = b.split(':').map(Number); return aSeconds! > bSeconds! || (aSeconds === bSeconds && aNanos! > bNanos!) }
  for (const rows of groups) for (const row of rows) { const previous = map.get(row.id); if (!previous || newer(row.version, previous.version)) map.set(row.id, row) }
  // Each row is one document observation, never a mix of fields from the two queries.
  return [...map.values()].sort((a, b) => Number(b.matchesTag) - Number(a.matchesTag) || Number(b.matchesName) - Number(a.matchesName) || (b.subscriberCount ?? -1) - (a.subscriberCount ?? -1) || a.id.localeCompare(b.id))
}
