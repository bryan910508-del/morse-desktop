import type { ChatMessage, SendAcknowledgement, SendWire, MessagePosition } from '../../shared/model'
import { positionAt } from '../../shared/model'
import { historyPosition, identifier, object } from '../../shared/validation'
import { compareReadCursor, readCursor, type ReadAcknowledgement } from '../../shared/read-receipts'
import { tr } from '../../shared/i18n'

export const serverContract = Object.freeze({
  socketURL: 'https://talky-server-production.up.railway.app',
  projectId: 'talky-a38c3',
  functionsRegion: 'asia-northeast3',
  clientProtocolVersion: 2,
  messageProtocolVersion: 3,
  capabilities: ['session-bound-registration', 'durable-message-ack', 'structured-reaction-errors']
})

export class ProtocolFailure extends Error {}
export class NotEmitted extends Error {}
export class MessageMutationFailure extends Error {
  constructor(message: string, readonly definitive = false) { super(message) }
}
export class ServerRejection extends Error {
  constructor(readonly reason: string) { super(tr('서버에서 요청을 처리하지 못했습니다.')) }
}

export function committedReadAck(raw: unknown, chatId: string, readerId: string, target: MessagePosition): ReadAcknowledgement {
  const body = object(raw)
  if (typeof body.error === 'string' && body.ok !== true) throw new ServerRejection(body.error)
  if (body.ok !== true || body.error !== undefined || body.persistedByServer !== true ||
      body.chatId !== chatId || body.readerId !== readerId || typeof body.alreadyExisted !== 'boolean' ||
      typeof body.lastReadAt !== 'number' || !Number.isFinite(body.lastReadAt) || body.lastReadAt <= 0 || body.lastReadAt > 253402300800000 ||
      typeof body.unreadCount !== 'number' || !Number.isSafeInteger(body.unreadCount) || body.unreadCount < 0 ||
      typeof body.messageId !== 'string') throw new ProtocolFailure(tr('읽음 저장 응답을 확인할 수 없습니다.'))
  const requested = readCursor(target), cursor = { at: body.lastReadAt, id: body.messageId }
  const legacyAhead = !cursor.id && body.alreadyExisted && cursor.at > requested.at
  if (!legacyAhead) identifier(cursor.id)
  const exactStoredTarget = cursor.id === requested.id && Math.abs(cursor.at - requested.at) < 0.001
  if ((!legacyAhead && !exactStoredTarget && compareReadCursor(cursor, requested) < 0) ||
      (!body.alreadyExisted && (cursor.id !== requested.id || cursor.at !== requested.at))) {
    throw new ProtocolFailure(tr('읽음 응답의 위치가 요청과 일치하지 않습니다.'))
  }
  return { cursor, unreadCount: body.unreadCount, alreadyExisted: body.alreadyExisted }
}

export function committedSendAck(raw: unknown, expected: SendWire): SendAcknowledgement {
  const body = object(raw)
  if (body.ok === false || typeof body.error === 'string') {
    throw new ServerRejection(typeof body.error === 'string' ? body.error : 'REJECTED')
  }
  if (body.ok !== true || body.persistedByServer !== true || body.serverOwnedMessage !== true ||
      body.id !== expected.id || body.chatId !== expected.chatId || body.senderId !== expected.senderId ||
      typeof body.createdAt !== 'number' || !Number.isFinite(body.createdAt) || body.createdAt <= 0 ||
      typeof body.alreadyExisted !== 'boolean') throw new ProtocolFailure(tr('서버 저장 응답을 확인할 수 없습니다.'))
  return { id: expected.id, chatId: expected.chatId, senderId: expected.senderId,
    createdAt: body.createdAt, alreadyExisted: body.alreadyExisted }
}

// Remote identity is mandatory: never synthesize UUIDs or receive-time history.
export function incomingMessage(raw: unknown, exactPosition?: MessagePosition): ChatMessage {
  const body = object(raw)
  const id = identifier(body.id)
  const chatId = identifier(body.chatId)
  const senderId = identifier(body.senderId)
  const kind = body.type ?? 'text'
  if (!['text', 'image', 'video', 'voice', 'file', 'sticker', 'channelPost', 'location', 'event', 'poll'].includes(String(kind))) {
    throw new ProtocolFailure(tr('지원하지 않는 메시지입니다.'))
  }
  const milliseconds = body.createdAt
  if (!exactPosition && (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0)) {
    throw new ProtocolFailure(tr('메시지 시각을 확인할 수 없습니다.'))
  }
  const position = exactPosition ? historyPosition(exactPosition)! : positionAt(milliseconds as number, id)
  if (position.id !== id) throw new ProtocolFailure(tr('메시지 위치가 일치하지 않습니다.'))
  return {
    id, chatId, senderId, kind: kind as ChatMessage['kind'],
    text: typeof body.text === 'string' ? body.text : '', position,
    serverConfirmed: true, encrypted: body.isEncrypted === true, state: 'sent', readEligible: false,
    replyToId: typeof body.replyToId === 'string' ? identifier(body.replyToId) : undefined,
    edited: body.isEdited === true, version: '', system: body.isSystem === true, reactions: []
  }
}
