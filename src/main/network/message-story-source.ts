import { identifier, object } from '../../shared/validation'
import type { MessageStorySource } from '../../shared/message-story-source'
import type { FirestoreDocument } from './firestore-values'
const names = ['replyStoryId', 'replyStoryOwnerId', 'replyStoryOwnerName', 'replyStoryOwnerType', 'replyStoryExpiresAt', 'replyStoryThumbData', 'replyStoryThumbnailUrl', 'replyStoryMediaType', 'replyStoryText', 'replyStoryChannelId']
export function messageStorySource(doc: FirestoreDocument): MessageStorySource | null {
  const fields = doc.fields
  if (!names.some(name => fields[name] !== undefined)) return null
  try {
    const storyId = identifier(object(fields.replyStoryId).stringValue), ownerName = object(fields.replyStoryOwnerName).stringValue
    if (typeof ownerName !== 'string' || !ownerName.trim() || ownerName.length > 512 || Array.from(ownerName).some(char => { const code = char.codePointAt(0)!; return code >= 0xD800 && code <= 0xDFFF })) throw new Error('Unsupported story source name')
    const ownerId = fields.replyStoryOwnerId === undefined ? null : identifier(object(fields.replyStoryOwnerId).stringValue)
    const ownerType = fields.replyStoryOwnerType === undefined ? null : object(fields.replyStoryOwnerType).stringValue
    if (ownerType !== null && ownerType !== 'user' && ownerType !== 'channel') throw new Error('Unsupported story owner type')
    let expiresAt: number | null = null
    if (fields.replyStoryExpiresAt !== undefined) {
      const field = object(fields.replyStoryExpiresAt)
      if (field.integerValue !== undefined && field.doubleValue === undefined && typeof field.integerValue === 'string' && /^\d{1,16}$/.test(field.integerValue)) expiresAt = Number(field.integerValue)
      else if (field.doubleValue !== undefined && field.integerValue === undefined && typeof field.doubleValue === 'number') expiresAt = field.doubleValue
      else throw new Error('Unsupported story source expiry')
      // Existing iOS sends Unix milliseconds. Do not infer seconds from magnitude.
      if (!Number.isFinite(expiresAt) || expiresAt < 0 || expiresAt > 8640000000000000) throw new Error('Unsupported story source expiry')
    }
    return { status: 'ready', storyId, ownerId, ownerName, ownerType, expiresAt }
  } catch { return { status: 'unavailable' } }
}
