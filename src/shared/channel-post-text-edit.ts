import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface ChannelPostTextTarget { id: string; requestId: string; channelId: string; postId: string; revision: string; original: string }
export interface ChannelPostTextEdit extends ChannelPostTextTarget { text: string }
export interface ChannelPostTextResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelPostTextEdit(raw: unknown): ChannelPostTextEdit {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'channelId', 'postId', 'revision', 'original', 'text'].includes(k)) ||
    typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision) || typeof v.original !== 'string' || v.original.length > 5000 ||
    typeof v.text !== 'string' || !v.text.trim() || v.text.length > 5000 || v.text === v.original) throw new Error(tr('최신 내 게시물에서 1~5,000자 본문 변경을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), channelId: identifier(v.channelId), postId: identifier(v.postId), revision: v.revision, original: v.original, text: v.text }
}
