import type { PublicChannelMetadata } from '../../shared/channel-public-preview'
import type { ChannelDiscoveryRow } from '../../shared/channel-discovery'
import { readChannelTags } from '../../shared/channel-tags'
import { childId, documents, documentVersion, mapField, numberField, stringField, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
// A channel as its plain share link shows it. MorseIOS opens any channel from https://…/channel/<id>, public or not
// (ChannelDetailView), and a closed one can then be asked to join. Every signed-in account may read the channel
// document (firestore.rules match /channels/{channelId}); its posts are open to everyone only when it is public
// (canReadChannelPost). `access` says which: 'public' exactly as publicChannelMetadata has always required it,
// otherwise the stored type of a closed channel.
export function linkedChannelMetadata(doc: FirestoreDocument): PublicChannelMetadata {
  const id = childId(doc.name, `${documents}/channels`), f = doc.fields, version = documentVersion(doc)
  const name = stringField(f, 'name', 512), type = stringField(f, 'type', 32), tags = readChannelTags(f.tags)
  if ((f.type !== undefined && typeof f.type.stringValue !== 'string') || !version || !name.trim() || (f.id !== undefined && f.id.stringValue !== id) || !f.createdAt?.timestampValue) throw new Error(tr('채널을 찾지 못했습니다.'))
  const access: PublicChannelMetadata['access'] = f.isPublic?.booleanValue === true && (!type || type === 'public') ? 'public' : type === 'invite' ? 'invite' : 'private'
  const created = timestamp(f.createdAt.timestampValue, id)
  let subscriberCount: number | null = null
  if (f.subscriberCount && (f.subscriberCount.integerValue !== undefined || f.subscriberCount.doubleValue !== undefined)) {
    const count = numberField(f, 'subscriberCount'); if (Number.isSafeInteger(count) && count >= 0) subscriberCount = count
  }
  let storedPostCount: number | null = null
  try {
    if (f.postCount && (f.postCount.integerValue !== undefined || f.postCount.doubleValue !== undefined)) {
      const count = numberField(f, 'postCount'); if (Number.isSafeInteger(count) && count >= 0) storedPostCount = count
    }
  } catch { /* Optional stored metadata does not grant or revoke public post access. */ }
  return { id, version, name, description: stringField(f, 'description', 10000), tags, subscriberCount, created, storedPostCount, access }
}
// A public channel: what search finds, what may be shared and what shows its posts to anyone.
export function publicChannelMetadata(doc: FirestoreDocument): PublicChannelMetadata {
  const metadata = linkedChannelMetadata(doc)
  if (metadata.access !== 'public') throw new Error(tr('현재 공개 채널을 확인할 수 없습니다.'))
  return metadata
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
