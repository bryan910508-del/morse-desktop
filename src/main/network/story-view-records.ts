import { identifier, object } from '../../shared/validation'
import { positionMilliseconds, type MessagePosition } from '../../shared/model'
import type { StoryViewRecordData } from '../../shared/story-view-records'
import { timestamp, type FirestoreDocument } from './firestore-values'
import { tr } from '../../shared/i18n'
export function storyViewRecords(doc: FirestoreDocument): StoryViewRecordData {
  const fields = doc.fields, missing: string[] = []
  const names: Record<string, string> = { viewerIds: tr('열람 목록'), reactionByUid: tr('반응'), viewedAtByUid: tr('열람 시각'), repostByUid: tr('재게시'), forwardByUid: tr('전달') }
  const viewers = (): string[] => {
    if (fields.viewerIds === undefined) { missing.push(names.viewerIds!); return [] }
    const value = object(fields.viewerIds.arrayValue).values ?? []
    if (!Array.isArray(value) || value.length > 1000) throw new Error('Unsupported viewer list')
    const ids = value.map(item => identifier(object(item).stringValue))
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate viewer list')
    return ids
  }
  function map<T>(key: string, parse: (value: Record<string, unknown>, uid: string) => T): Map<string, T> {
    const field = fields[key]
    if (field === undefined) { missing.push(names[key]!); return new Map() }
    const raw = object(object(field.mapValue).fields ?? {}), entries = Object.entries(raw)
    if (entries.length > 1000) throw new Error('Unsupported interaction map size')
    return new Map(entries.map(([uid, value]) => [identifier(uid), parse(object(value), uid)]))
  }
  const viewerIds = viewers(), viewerIndex = new Map(viewerIds.map((uid, index) => [uid, index]))
  const reactions = map('reactionByUid', value => {
    const text = value.stringValue
    if (typeof text !== 'string' || !text || text.length > 64 || Array.from(text).some(char => { const point = char.codePointAt(0)!; return point >= 0xD800 && point <= 0xDFFF })) throw new Error('Unsupported stored reaction')
    return text
  })
  const date = (value: Record<string, unknown>, uid: string): MessagePosition => timestamp(value.timestampValue, uid)
  const viewed = map('viewedAtByUid', date), reposted = map('repostByUid', date), forwarded = map('forwardByUid', date)
  // Match the iOS row union. A lone viewedAt map key is not an extra viewer row.
  const uids = new Set([...viewerIds, ...reactions.keys(), ...reposted.keys(), ...forwarded.keys()])
  if (uids.size > 1000) throw new Error('Unsupported combined story audience size')
  const compareTime = (a: MessagePosition, b: MessagePosition): number => a.seconds - b.seconds || a.nanoseconds - b.nanoseconds
  const records = [...uids].map(uid => {
    const times = [viewed.get(uid), reposted.get(uid), forwarded.get(uid)].filter((value): value is MessagePosition => value !== undefined)
    const latest = times.reduce<MessagePosition | null>((value, time) => !value || compareTime(time, value) > 0 ? time : value, null)
    return { uid, latest, index: viewerIndex.get(uid) ?? -1 }
  }).sort((a, b) => {
    if (a.latest && b.latest) { const difference = compareTime(b.latest, a.latest); if (difference) return difference }
    else if (a.latest || b.latest) return a.latest ? -1 : 1
    else if (a.index !== b.index) return b.index - a.index
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0
  })
  return {
    rows: records.map(({ uid, latest }) => ({ uid, viewed: viewerIndex.has(uid), reaction: reactions.get(uid) ?? null, reposted: reposted.has(uid), forwarded: forwarded.has(uid), latestAt: latest ? positionMilliseconds(latest) : null })),
    counts: { viewers: viewerIds.length, reactions: reactions.size, reposts: reposted.size, forwards: forwarded.size }, missing
  }
}
