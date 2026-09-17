export type DeliveryState = 'queued' | 'uncertain' | 'failed' | 'uploading' | 'upload-failed'
export interface LocalOutgoing {
  id: string
  chatId: string
  text: string
  replyToId?: string
  forwarded?: boolean
  storyReply?: boolean
  voicePreview?: import('./voice-queue-preview').VoiceQueueMetadata
  createdAt: number
  state: DeliveryState
  reason: string
  busy: boolean
  retryable: boolean
  progress?: { loaded: number; total: number; current: number; count: number }
}
export interface OutgoingSnapshot {
  revision: number
  items: LocalOutgoing[]
  canCompose: boolean
  canDiscard?: boolean
  policyHeld?: boolean
  writingBlocked?: boolean
  message: string
}
export const maxQueuedMessages = 100
export interface PendingDirect {
  chatId: string
  peerUid: string
  displayName: string
  // The peer's live photo while the chat has no messages (DialogAvatars direct entry).
  avatar?: import('./group-photo').GroupPhotoImage | null
  createdAt: number
  canDiscard: boolean
  // The pair's dialog exists under another id (a chat made before ids were derived from the two accounts,
  // or by a released client): this row is not listed, and a window showing it moves to that dialog.
  supersededBy?: string
}
