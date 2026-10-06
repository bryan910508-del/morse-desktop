export type DeliveryState = 'queued' | 'uncertain' | 'failed' | 'uploading' | 'upload-failed'
export interface LocalOutgoing {
  id: string
  chatId: string
  // B90: the order it was written in on this device (the outbox sequence); the history keeps it whatever the answers do.
  sequence: number
  text: string
  replyToId?: string
  forwarded?: boolean
  storyReply?: boolean
  voicePreview?: import('./voice-queue-preview').VoiceQueueMetadata
  createdAt: number
  // 'sent': the server has it and the history has not shown it yet (see OutboxPump.sent).
  state: DeliveryState | 'sent'
  reason: string
  busy: boolean
  retryable: boolean
  // A10 §4: refused because the operator restricted or banned this account — the menu offers the operator's mail.
  sanction?: import('./sanctions').Sanction
  // B73: the end of a restriction (ms), for the «제한 끝» line of that mail.
  sanctionUntil?: number
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
  // B178 §2-2: the peer's official mark (a «채팅으로 문의하기» chat with the support account before its first message).
  official?: import('./model').OfficialKind
  // The pair's dialog exists under another id (a chat made before ids were derived from the two accounts,
  // or by a released client): this row is not listed, and a window showing it moves to that dialog.
  supersededBy?: string
}
