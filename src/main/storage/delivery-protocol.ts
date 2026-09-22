import type { StoryReplyDetachCommand } from './story-reply-detach-table'
import type { StoryReplySendCommand } from './story-reply-send-table'
import type { StoryReplyDraftCommand } from './story-reply-draft-table'
import type { StoryViewReceiptCommand } from './story-view-receipt-table'
import type { StoryReactionChangeCommand } from './story-reaction-change-table'
import type { StoryPublicationCommand } from './story-publication-table'
import type { StoryVideoPublicationCommand } from './story-video-publication-table'
import type { StoryComposerAudioCommand } from './story-composer-audios'
import type { StoryComposerVideoCommand } from './story-composer-videos'
import type { StoryComposerPhotoCommand } from './story-composer-photos'
import type { StoryComposerDraftCommand } from './story-composer-drafts'
import type { StoryHiddenChangeCommand } from './story-hidden-change-table'
import type { StoryPrivacyMoveCommand } from './story-privacy-move-table'
import type { StoryRemovalCommand } from './story-removal-table'
import type { StoryCaptionSaveCommand } from './story-caption-save-table'
import type { StoryCaptionDraftCommand } from './story-caption-drafts'
import type { NoteRemovalCommand } from './space-note-removal-table'
import type { NoteTextSaveCommand } from './space-note-text-save-table'
import type { NoteEditDraftCommand } from './space-note-edit-drafts'
import type { NoteCreationCommand } from './space-note-creation-table'
import type { NoteDraftCommand } from './space-note-drafts'
import type { ChannelCreationCommand } from './channel-creation-table'
import type { CommentCreationCommand } from './channel-comment-creation-table'
import type { PostCreationCommand } from './channel-post-creation-table'
import type { PostDraftCommand } from './channel-post-drafts'
import type { CommentDraftCommand } from './channel-comment-drafts'
import type { DiscussionJoinCommand } from './channel-discussion-join-table'
import type { DiscussionLeaveWorkCommand } from './discussion-leave-work'
import type { ChannelJoinDecisionCommand } from './channel-join-decision-table'
import type { ChannelAccessCommand } from './channel-access-table'
import type { ChannelPhotoUploadCommand } from './channel-photo-upload-table'
import type { LocalOutgoing } from '../../shared/delivery'
import type { SendWire, TextSendWire } from '../../shared/model'
import type { UploadCommand, UploadDescriptor, UploadPart } from './upload-protocol'
import type { ReadReceiptCommand } from './read-receipt-protocol'
import type { MessageActionCommand } from './message-action-protocol'
import type { NotificationCommand } from './notification-protocol'
import type { PendingDirectCommand } from './pending-direct-table'
import type { ReplyDraftCommand } from './reply-draft-table'
import type { MessageBookmarkCommand } from './message-bookmark-table'
import type { HiddenChatCommand } from './hidden-chat-table'
import type { HiddenMessageCommand } from './hidden-message-table'
import type { ChatFlagCommand } from './chat-flag-table'
import type { ContactFlagCommand } from './contact-flag-table'
import type { StickerCommand } from './sticker-table'
import type { UserpicCommand } from './userpic-cache-table'
import type { MediaCacheCommand } from './media-cache-table'
import type { PeerPhotoCommand } from './peer-photo-table'
import type { EventReminderCommand } from './event-reminder-table'
import type { ReplyBinding } from '../../shared/reply-draft'
import type { ContactDetailsCommand } from './contact-details-table'
import type { ForwardCommand } from './forward-table'
import type { ForwardTextBatchCommand } from './forward-text-batch-table'
import type { ForwardBatchCommand } from './forward-batch-protocol'
import type { ChatBackgroundCommand } from './chat-background-table'
import type { ProfileUploadCommand } from './profile-photo-upload-table'
import type { ContactPhotoCommand } from './contact-photo-table'
import type { GroupPhotoUploadCommand } from './group-photo-upload-table'

export interface StoredIntent extends Omit<LocalOutgoing, 'busy' | 'retryable'> {
  forwardOperationId?: string
  sequence: number
  wire: SendWire
  upload?: UploadDescriptor
  parts?: UploadPart[]
}
export type DeliveryCommand =
  | import('./voice-draft-storage-table').VoiceDraftStorageCommand
  | import('./voice-draft-table').VoiceDraftCommand
  | DiscussionLeaveWorkCommand
  | GroupPhotoUploadCommand
  | ChannelPhotoUploadCommand
  | ChannelAccessCommand
  | StoryReplyDetachCommand | StoryReplySendCommand | StoryReplyDraftCommand | StoryViewReceiptCommand | StoryReactionChangeCommand | StoryHiddenChangeCommand | StoryPrivacyMoveCommand | StoryRemovalCommand | StoryCaptionSaveCommand | StoryCaptionDraftCommand | NoteRemovalCommand | NoteTextSaveCommand | NoteEditDraftCommand | NoteCreationCommand | StoryPublicationCommand | StoryVideoPublicationCommand | StoryComposerAudioCommand | StoryComposerVideoCommand | StoryComposerPhotoCommand | StoryComposerDraftCommand | NoteDraftCommand | ChannelCreationCommand | PostCreationCommand | PostDraftCommand | CommentCreationCommand | CommentDraftCommand
  | DiscussionJoinCommand
  | ChannelJoinDecisionCommand
  | ContactPhotoCommand
  | ProfileUploadCommand
  | ChatBackgroundCommand
  | ReadReceiptCommand
  | MessageActionCommand
  | NotificationCommand
  | PendingDirectCommand
  | ReplyDraftCommand
  | MessageBookmarkCommand
  | HiddenChatCommand
  | HiddenMessageCommand
  | ChatFlagCommand
  | ContactFlagCommand
  | StickerCommand
  | UserpicCommand
  | MediaCacheCommand
  | PeerPhotoCommand
  | EventReminderCommand
  | ContactDetailsCommand
  | ForwardCommand
  | ForwardTextBatchCommand
  | ForwardBatchCommand
  | UploadCommand
  | { kind: 'voice-queue-source'; reference: import('../../shared/voice-queue-preview').VoiceQueueReference }
  | { kind: 'ready' }
  | { kind: 'list'; chatId?: string }
  | { kind: 'draft'; chatId: string }
  | { kind: 'save-draft'; chatId: string; text: string }
  | { kind: 'text-known'; wire: TextSendWire }
  | { kind: 'enqueue'; wire: TextSendWire; expectedDraft: string; reply: ReplyBinding | null }
  | { kind: 'claim'; id: string }
  | { kind: 'release-unemitted'; id: string }
  | { kind: 'state'; id: string; state: 'queued' | 'failed' | 'uncertain' | 'uploading' | 'upload-failed'; reason: string }
  | { kind: 'finish'; id: string; discarded: boolean }
  | { kind: 'prune'; allowed: string[] }
  | { kind: 'close'; purge: boolean }
