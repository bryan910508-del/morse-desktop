import { autoDeleteSecondsValue } from '../../shared/chat-auto-delete'
import { autoDeleteNoticeText, autoDeleteWirePrefix, type AutoDeleteNotice } from '../../shared/auto-delete-notice'
import { messageStorySource } from './message-story-source'
import type { ChatMessage, DialogSummary, MessagePosition } from '../../shared/model'
import { comparePosition, positionMilliseconds } from '../../shared/model'
import { identifier, object } from '../../shared/validation'
import { idleReadSync, outboxReadTill, readCursor } from '../../shared/read-receipts'
import { mediaCaption, mediaResources } from '../media/media-document'
import { messageMediaMetadata } from '../media/message-media-metadata'
import { tr } from '../../shared/i18n'

export type WireObject = Record<string, unknown>
export interface FirestoreDocument { name: string; fields: Record<string, WireObject>; updateTime?: WireObject }
export interface ReadDialog { summary: DialogSummary; cutoff: MessagePosition | null; participantNames: Record<string, string>; accountUid: string }
export const database = 'projects/talky-a38c3/databases/(default)'
export const documents = `${database}/documents`
export const pageSize = 80
export const historyLimit = 320
export class ReadFailure extends Error {
  constructor(readonly code: 'network' | 'permission' | 'index' | 'data' | 'cancelled') {
    super({ network: tr('대화를 불러오지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.'),
      permission: tr('이 대화를 읽을 권한을 확인하지 못했습니다.'), index: tr('대화 조회에 필요한 서버 인덱스를 확인해야 합니다.'),
      data: tr('대화 데이터를 읽을 수 없습니다.'), cancelled: tr('대화 조회가 취소되었습니다.') }[code])
  }
}
export function document(value: unknown): FirestoreDocument {
  const raw = object(value)
  if (typeof raw.name !== 'string' || !raw.name.startsWith(`${documents}/`)) throw new ReadFailure('data')
  const updateTime = raw.updateTime === undefined ? undefined : object(raw.updateTime)
  if (updateTime) timestamp(updateTime, '')
  return { name: raw.name, fields: object(raw.fields ?? {}) as Record<string, WireObject>, updateTime }
}
export function documentVersion(doc: FirestoreDocument): string {
  if (!doc.updateTime) return ''
  const at = timestamp(doc.updateTime, '')
  return `${at.seconds}:${at.nanoseconds}`
}
export function messageReactions(doc: FirestoreDocument, uid: string, names: Record<string, string> = {}): ChatMessage['reactions'] {
  const map = mapField(doc.fields, 'reactions')
  return reactionsFromMap(Object.fromEntries(Object.entries(map).map(([emoji, value]) => {
    const users = object(value.arrayValue ?? {}).values
    return [emoji, Array.isArray(users) ? users.map(item => object(item).stringValue) : null]
  })), uid, names)
}
// A message's reactions as {emoji: [uid…]} — the document's map, or the full state a reactionUpdated event carries.
export function reactionsFromMap(map: Record<string, unknown>, uid: string, names: Record<string, string> = {}): ChatMessage['reactions'] {
  return Object.entries(map).flatMap(([emoji, users]) => {
    if (!emoji.length || emoji.length > 32 || !Array.isArray(users)) return []
    const ids = new Set(users.filter((id): id is string => typeof id === 'string' && Boolean(id) && id.length <= 160))
    const people = [...ids].sort((a, b) => a === uid ? -1 : b === uid ? 1 : 0).slice(0, 50).map(id => ({ uid: id, name: id === uid ? tr('나') : names[id] || tr('참여자') }))
    return ids.size ? [{ emoji, count: ids.size, selected: ids.has(uid), users: people }] : []
  }).sort((a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : 1))
}
// reactionVersion on a message document: how many reaction writes it has had.
export function reactionVersion(doc: FirestoreDocument): number {
  const value = Number(object(doc.fields.reactionVersion ?? {}).integerValue ?? 0)
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}
export function childId(name: string, parent: string): string {
  if (!name.startsWith(`${parent}/`)) throw new ReadFailure('data')
  return identifier(name.slice(parent.length + 1))
}
function field(fields: Record<string, WireObject>, key: string): WireObject { return object(fields[key] ?? {}) }
export function stringField(fields: Record<string, WireObject>, key: string, max = 30000): string {
  const value = field(fields, key).stringValue
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > max) throw new ReadFailure('data')
  return value
}
export function boolField(fields: Record<string, WireObject>, key: string): boolean { return field(fields, key).booleanValue === true }
// Existing iOS message ingress accepts these legacy Boolean representations.
function messageFlag(fields: Record<string, WireObject>, key: string): boolean {
  const value = field(fields, key)
  if (typeof value.booleanValue === 'boolean') return value.booleanValue
  if (value.integerValue !== undefined || value.doubleValue !== undefined) return numberField(fields, key) !== 0
  return typeof value.stringValue === 'string' && ['true', '1'].includes(value.stringValue.trim().toLowerCase())
}
export function numberField(fields: Record<string, WireObject>, key: string): number {
  const value = field(fields, key)
  const number = Number(value.integerValue ?? value.doubleValue ?? 0)
  if (!Number.isFinite(number)) throw new ReadFailure('data')
  return number
}
export function mapField(fields: Record<string, WireObject>, key: string): Record<string, WireObject> {
  return object(object(field(fields, key).mapValue ?? {}).fields ?? {}) as Record<string, WireObject>
}
export function timestamp(raw: unknown, id: string): MessagePosition {
  const value = object(raw)
  const seconds = Number(value.seconds ?? 0), nanoseconds = Number(value.nanos ?? 0)
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253402300799 ||
      !Number.isSafeInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) throw new ReadFailure('data')
  return { seconds, nanoseconds, id }
}
function timeField(fields: Record<string, WireObject>, key: string, id: string): MessagePosition | null {
  const value = field(fields, key).timestampValue
  return value === undefined ? null : timestamp(value, id)
}
export function positionValue(position: MessagePosition): WireObject {
  return { timestampValue: { seconds: String(position.seconds), nanos: position.nanoseconds } }
}
export function rawPosition(doc: FirestoreDocument, chatId: string): MessagePosition {
  const id = childId(doc.name, `${documents}/chats/${identifier(chatId)}/messages`)
  const position = timeField(doc.fields, 'createdAt', id)
  if (!position) throw new ReadFailure('data')
  return position
}
export function decodeDialog(doc: FirestoreDocument, uid: string): ReadDialog {
  const id = childId(doc.name, `${documents}/chats`), f = doc.fields
  const kind = stringField(f, 'type', 32)
  if (!['direct', 'group', 'secret'].includes(kind)) throw new ReadFailure('data')
  const rawParticipants = object(field(f, 'participantUids').arrayValue ?? {}).values
  if (!Array.isArray(rawParticipants) || rawParticipants.length > 10000) throw new ReadFailure('data')
  const participants = rawParticipants.map(value => identifier(object(value).stringValue))
  if (!participants.includes(uid)) throw new ReadFailure('permission')
  const other = participants.find(value => value !== uid)
  const info = mapField(f, 'participantInfo')
  const participantNames = Object.fromEntries(participants.map(id => {
    const participant = mapField(info, id)
    return [id, boolField(participant, 'accountDeleted') ? tr('탈퇴한 계정') : stringField(participant, 'displayName', 512) || tr('참여자')]
  }))
  const peer = other ? mapField(info, other) : {}
  const title = id === `memo_${uid}` ? tr('내 메모') : kind === 'group' ? stringField(f, 'name', 512) || tr('이름 없는 그룹') :
    boolField(peer, 'accountDeleted') ? tr('탈퇴한 계정') : stringField(peer, 'displayName', 512) || stringField(f, 'name', 512) || tr('알 수 없음')
  const cutoff = kind === 'direct' ? timeField(f, 'historyRevokedAt', '') : null
  const top = timeField(f, 'lastMessageAt', id)
  const readTimes = mapField(f, 'lastReadAt'), readIds = mapField(f, 'lastReadMessageId')
  const readPositions = Object.fromEntries(participants.flatMap(participant => {
    const messageId = stringField(readIds, participant, 160)
    if (messageId) identifier(messageId)
    const at = timeField(readTimes, participant, messageId)
    return at && positionMilliseconds(at) > 0 ? [[participant, readCursor(at)]] : []
  }))
  let preview = stringField(f, 'lastMessage', 100000)
  if (kind === 'secret') preview = tr('비밀 대화')
  else if (preview.startsWith('__deleted__:') || (cutoff && top && comparePosition(top, cutoff) < 0)) preview = ''
  else if (preview.startsWith(autoDeleteWirePrefix)) preview = ''
  else if (preview === '__TALKY_SECRET__') preview = tr('비밀 메시지')
  return { summary: { id, version: documentVersion(doc), kind: kind as DialogSummary['kind'], title, participantUids: participants,
    preview: preview.slice(0, 300), top, unreadCount: Math.max(0, Math.trunc(numberField(mapField(f, 'unreadCounts'), uid))),
    markedUnread: boolField(mapField(f, 'manualUnread'), uid), readPositions, outboxRead: outboxReadTill(readPositions, participants.filter(participant => participant !== uid)), readSync: idleReadSync,
    // isArchived / isMuted in the shared room document are another person's choice as often as this one's;
    // this device's own flags are applied by the session (ChatFlags).
    pinned: false, pinVersion: '', archived: false, muted: false,
    discussion: boolField(f, 'isChannelDiscussion'), channelId: stringField(f, 'channelId', 160) || undefined, autoDeleteSeconds: autoDeleteSecondsValue(numberField(f, 'autoDeleteSeconds')), autoDeleteMyOnly: boolField(f, 'autoDeleteMyOnly'), createdBy: stringField(f, 'createdBy', 160), pinnedForAll: pinnedMessageIds(f), unseenReaction: unseenReaction(f, uid), forum: kind === 'group' ? forumState(f) : undefined }, cutoff, participantNames, accountUid: uid }
}
// MorseChatForumFirestore.applyForumFields / parseCategories.
function forumState(fields: Record<string, WireObject>): DialogSummary['forum'] {
  try {
    if (!boolField(fields, 'isForumEnabled')) return undefined
    const values = (fields.forumCategories as { arrayValue?: { values?: unknown } } | undefined)?.arrayValue?.values
    const categories = (Array.isArray(values) ? values : []).slice(0, 100).flatMap(value => {
      const item = mapField({ item: value as WireObject }, 'item')
      const id = stringField(item, 'id', 160), name = stringField(item, 'name', 200)
      if (!id || !name.trim()) return []
      const icon = stringField(item, 'icon', 64)
      return [{ id, name, sortOrder: Math.trunc(numberField(item, 'sortOrder')), isGeneral: item.isGeneral ? boolField(item, 'isGeneral') : id === 'general', ...(icon ? { icon } : {}) }]
    }).sort((a, b) => a.sortOrder - b.sortOrder)
    return { categories, generalId: stringField(fields, 'generalForumCategoryId', 160) || 'general' }
  } catch { return undefined }
}
// AppState.resolveMyUnseenReaction: messageId, emoji, another person's actorUid and a positive reactionVersion.
function unseenReaction(fields: Record<string, WireObject>, uid: string): DialogSummary['unseenReaction'] {
  try {
    const payload = mapField(mapField(fields, 'unseenReactionByUid'), uid)
    const messageId = stringField(payload, 'messageId', 160), emoji = stringField(payload, 'emoji', 64), actor = stringField(payload, 'actorUid', 160)
    const version = numberField(payload, 'reactionVersion')
    if (!messageId || !emoji.trim() || !actor || actor === uid || !Number.isSafeInteger(version) || version <= 0) return undefined
    return { messageId: identifier(messageId), emoji, reactionVersion: version }
  } catch { return undefined }
}
// chats/{id}.pinnedForAllMessageIds: message ids pinned for everyone (unreadable entries are left out).
export function pinnedMessageIds(fields: Record<string, WireObject>): string[] {
  const values = (fields.pinnedForAllMessageIds as { arrayValue?: { values?: unknown } } | undefined)?.arrayValue?.values
  if (!Array.isArray(values)) return []
  return [...new Set(values.flatMap(value => { try { return [identifier((value as { stringValue?: unknown }).stringValue)] } catch { return [] } }))].slice(0, 100)
}
// PostAspectRatio, as the channel wrote it on the post and onChannelPostCreated mirrored into the room.
// «auto» is the picture's own shape, which only the picture itself can tell.
const postAspects: Record<string, number> = { '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9 }
export function postAspectRatio(raw: string): number | null { return postAspects[raw] ?? null }
export function historyReadable(dialog: ReadDialog): boolean { return dialog.summary.historyAccess === undefined || dialog.summary.historyAccess === 'ready' }
export function decodeMessage(doc: FirestoreDocument, dialog: ReadDialog, now = Date.now()): ChatMessage | null {
  if (!historyReadable(dialog)) return null
  const position = rawPosition(doc, dialog.summary.id), f = doc.fields
  if (dialog.cutoff && comparePosition(position, dialog.cutoff) < 0) return null
  const deleteAt = timeField(f, 'deleteAt', position.id)
  if (deleteAt && positionMilliseconds(deleteAt) <= now) return null
  const text = stringField(f, 'text', 100000)
  if (text.startsWith('__deleted__:') || boolField(f, 'isDeleted') || timeField(f, 'deletedAt', position.id)) return null
  const encrypted = messageFlag(f, 'isEncrypted') || dialog.summary.kind === 'secret' || text === '__TALKY_SECRET__'
  const declaredKind = stringField(f, 'type', 64)
  const rawKind = messageFlag(f, 'isCircleVideo') && (!declaredKind || declaredKind === 'text') ? 'video' : declaredKind || 'unsupported'
  const kind = ['text', 'image', 'video', 'voice', 'file', 'sticker', 'channelPost', 'location', 'event'].includes(rawKind) ? rawKind : 'unsupported'
  const senderId = stringField(f, 'senderId', 160)
  const system = messageFlag(f, 'isSystem') || text.startsWith(autoDeleteWirePrefix)
  if (!senderId && !system) throw new ReadFailure('data')
  const replyId = encrypted || system ? '' : stringField(f, 'replyToId', 160).trim() || stringField(f, 'reply_to', 160).trim()
  if (replyId) identifier(replyId)
  // A channel post card is a system message that carries the post's own picture; every other system line carries none.
  const card = kind === 'channelPost' ? { channelId: stringField(f, 'channelId', 160), postId: stringField(f, 'channelPostId', 160), channelName: stringField(f, 'channelName', 512),
    ...(postAspectRatio(stringField(f, 'aspectRatio', 16)) ? { ratio: postAspectRatio(stringField(f, 'aspectRatio', 16))! } : {}) } : null
  const attachments = system && !card ? [] : mediaResources(doc, dialog.summary.id, kind, encrypted).map(resource => resource.summary)
  const circular = messageFlag(f, 'isCircleVideo')
  return { id: position.id, chatId: dialog.summary.id, senderId,
    senderName: dialog.summary.kind === 'group' && !system ? dialog.participantNames[senderId] || tr('참여자') : undefined,
    kind: kind as ChatMessage['kind'], text: encrypted ? '' : system ? autoDeleteNoticeText(autoDeleteNoticeFields(f), text) || tr('시스템 메시지') : ['image', 'video', 'voice', 'file', 'sticker'].includes(kind) ? '' : text,
    ...(card?.channelId && card.postId ? { channelPost: card } : {}),
    attachments, mediaMetadata: encrypted || system ? null : messageMediaMetadata(doc, kind, attachments.length, circular),
    caption: encrypted || system ? '' : mediaCaption(doc, kind),
    position, serverConfirmed: true, encrypted, silent: messageFlag(f, 'isSilent'), circular, state: 'sent', edited: messageFlag(f, 'isEdited'),
    version: documentVersion(doc), system, reactions: encrypted ? [] : messageReactions(doc, dialog.accountUid, dialog.participantNames),
    storySource: encrypted || system ? null : messageStorySource(doc),
    replyToId: replyId || undefined,
    categoryId: encrypted || system ? undefined : stringField(f, 'categoryId', 160) || undefined,
    readEligible: Boolean(senderId) && !encrypted && stringField(f, 'status', 32) !== 'failed' &&
      (!system || kind === 'channelPost') && (!stringField(f, 'chatId', 160) || stringField(f, 'chatId', 160) === dialog.summary.id) }
}
// The values the server writes behind an auto-delete notice, when it wrote them.
export function autoDeleteNoticeFields(f: Record<string, WireObject>): AutoDeleteNotice | null {
  if (stringField(f, 'systemKind', 64) !== 'autoDeletePolicy') return null
  const actorName = stringField(f, 'autoDeleteActorName', 512).trim()
  return actorName ? { actorName, seconds: autoDeleteSecondsValue(Math.trunc(numberField(f, 'autoDeleteSeconds'))), myOnly: boolField(f, 'autoDeleteMyOnly') } : null
}
export function expiry(doc: FirestoreDocument): number | null {
  const value = timeField(doc.fields, 'deleteAt', '')
  return value ? positionMilliseconds(value) : null
}
export function messagesQuery(dialog: ReadDialog, before?: MessagePosition): WireObject {
  if (!historyReadable(dialog)) throw new ReadFailure('permission')
  const query: WireObject = { from: [{ collectionId: 'messages' }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
    limit: { value: pageSize + 1 } }
  if (dialog.cutoff) query.where = { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: positionValue(dialog.cutoff) } }
  if (before) query.startAt = { before: false, values: [positionValue(before),
    { referenceValue: `${documents}/chats/${dialog.summary.id}/messages/${identifier(before.id)}` }] }
  return query
}
