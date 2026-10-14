import type { ChatMessage, ReplyPreview } from '../../../shared/model'
import type { LocalOutgoing } from '../../../shared/delivery'
import { positionAt } from '../../../shared/model'

// B269 (tdesktop: a message being sent is a HistoryItem with its media, drawn by the same view as one received —
// MediaPhoto/MediaFile::createView, data_media_types.cpp:1076-1080·:1477-1508): a message on its way is drawn as the
// message the server's copy will be — its attachments, their sizes and placeholder — so nothing changes shape or kind
// when the copy arrives. Its pictures come from main's SendingMedia through the same preview calls the copy makes.
export const localMediaVersion = '0:0'
export function localMediaMessage(item: Pick<LocalOutgoing, 'id' | 'chatId' | 'media' | 'createdAt'>): ChatMessage | null {
  const media = item.media
  if (!media) return null
  const kind = media.kind === 'image' ? 'image' as const : media.kind === 'video' ? 'video' as const : media.kind === 'sticker' ? 'sticker' as const : 'file' as const
  return { id: item.id, chatId: item.chatId, senderId: '', kind: media.kind, text: '', caption: media.caption,
    // A picture and a sticker are drawn from what is already here; a video or a file opens once the server has it.
    attachments: media.parts.map(part => ({ index: part.index, kind, name: part.name, available: kind === 'image' || kind === 'sticker', blind: false })),
    // No server document yet: version 0:0 (a media request carries one — shared/media.ts mediaRequest), which main answers
    // from SendingMedia by the message id and nothing on the server matches.
    mediaMetadata: media.metadata, circular: media.circular === true, position: positionAt(item.createdAt, item.id), version: localMediaVersion,
    serverConfirmed: false, encrypted: false, silent: false, state: 'sent', readEligible: false, edited: false, system: false, reactions: [] } as ChatMessage
}
// B409 (tdesktop HistoryItem::setRealId, history_item.cpp:3309-3341: the item being sent and the one the server confirms
// are the same item, its id changed and repainted): every message on its way — text, emoji, media, a voice message — is
// the ChatMessage its server copy will be, drawn by the one MessageView, so the answer changes its state and not its row.
export function localChatMessage(item: LocalOutgoing, senderId: string, reply?: ReplyPreview): ChatMessage {
  const media = localMediaMessage(item)
  const base: ChatMessage = media ?? { id: item.id, chatId: item.chatId, senderId, kind: item.voicePreview ? 'voice' : 'text', text: item.voicePreview ? '' : item.text,
    attachments: [], position: positionAt(item.createdAt, item.id), version: localMediaVersion, serverConfirmed: false, encrypted: false, silent: false,
    state: 'sent', readEligible: false, edited: false, system: false, reactions: [] } as ChatMessage
  return { ...base, senderId, ...(reply ? { reply } : {}) }
}
// How far the message's media has gone up, 0 to 1, or null while it waits (tdesktop's radial: uploadingData offset/size,
// data_photo.cpp:223-233).
export function sendingProgress(progress: LocalOutgoing['progress']): number | null {
  return progress && progress.total > 0 ? Math.max(0, Math.min(1, progress.loaded / progress.total)) : null
}
