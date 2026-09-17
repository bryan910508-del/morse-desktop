import type { MediaSendWire } from '../../shared/model'
import type { AttachmentFile } from '../../shared/uploads'
import type { ReplyBinding } from '../../shared/reply-draft'

export interface UploadRequest {
  // The library sticker this send carries (its SHA-256 id).
  sticker?: string
  voiceDraftRevision?:string
  voice?:import('../../shared/voice-send').VoiceUploadProof
  id: string
  chatId: string
  senderId: string
  caption: string
  itemIds: string[]
  reply: ReplyBinding | null
}

export interface UploadDescriptor extends Omit<AttachmentFile, 'kind'> {
  kind: MediaSendWire['type']
  chatId: string
  contentType: string
  path: string
  sha256: string
  md5: string
  session: string | null
}
export interface UploadPart { index: number; upload: UploadDescriptor; url: string | null }
export type UploadCommand =
  | { kind: 'attachment-known'; request: UploadRequest }
  | { kind: 'enqueue-attachment'; request: UploadRequest; wire: MediaSendWire; parts: { upload: UploadDescriptor; bytes: Uint8Array }[] }
  | { kind: 'upload-source'; id: string; index: number }
  | { kind: 'upload-session'; id: string; index: number; session: string }
  | { kind: 'upload-complete'; id: string; index: number; url: string }
  | { kind: 'upload-ready'; id: string }
