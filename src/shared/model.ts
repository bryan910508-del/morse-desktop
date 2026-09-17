import type { StoryReplyWireFields } from './story-reply-send'
import type { DiscussionJoinRequest, DiscussionJoinAction, DiscussionJoinSnapshot } from './channel-discussion-join'
import type { ChannelJoinDecisionRequest, ChannelJoinDecisionAction, ChannelJoinDecisionSnapshot } from './channel-join-decisions'
import type { ChannelAccessRequest, ChannelAccessAction, ChannelAccessEditSnapshot } from './channel-access-edit'
import type { ChannelPhotoBinding, ChannelPhotoUploadRequest, ChannelPhotoUploadAction, ChannelPhotoUploadSnapshot } from './channel-photo-upload'
import type { ShortcutCommand } from './shortcuts'
import type { Language } from './i18n'
import type { AuthenticationBridge, AuthenticationSnapshot } from './auth'
import type { OutgoingSnapshot, PendingDirect } from './delivery'
import type { ReadCursor, ReadSyncState } from './read-receipts'
import type { MessageActionRequest, MessageActionsSnapshot, ReactionSummary } from './message-actions'
import type { AttachmentSummary, MediaReady, MediaRequest } from './media'
import type { AttachmentDraft, AttachmentMode, AttachmentDropMode } from './uploads'
import type { NotificationStatus } from './notifications'
import type { SearchSnapshot } from './search'
import type { BioEdit, BioSaveResult, ProfileSnapshot } from './profile'
import type { ContactsSnapshot, ContactSearchSnapshot } from './contacts'
import type { ContactDetailsEdit } from './contact-details'
import type { ReplyBinding, ReplyDraftSnapshot } from './reply-draft'
import type { ForwardProgress, ForwardRequest, ForwardSource, ForwardTarget } from './forward'
import type { MediaMetadata } from './media-metadata'
import type { ForwardBatchRequest } from './forward-batch'
import type { ParticipantAddRequest, ParticipantAddResult, ParticipantContactRequest, ParticipantsSnapshot } from './participants'
import type { DialogPinRequest, DialogPinSnapshot } from './dialog-pins'
import type { ManualUnreadRequest, ManualUnreadSnapshot } from './manual-unread'
import { defaultChatBackground, type BackgroundPhotoScope, type ChatBackground, type ChatBackgroundEdit, type ChatBackgroundRecord } from './chat-background'
import type { ProfileNameEdit, ProfileNameSaveResult } from './profile-name'
import type { ProfilePhotoClear, ProfilePhotoClearResult } from './profile-photo-clear'
import type { ProfilePhotoHistoryAction, ProfilePhotoUploadAction } from './profile-photo-upload'
import type { ContactPhotoBinding, ContactPhotoEdit, ContactPhotoStorage, ContactPhotoRemoval } from './contact-photo'
import type { BackgroundStorageSnapshot, BackgroundStorageRemoval } from './background-storage'
import type { GroupCreateRequest } from './group-create'
import type { GroupMembersRequest } from './group-members'
import type { GroupLeaveRequest } from './group-leave'
import type { GroupRemovalRequest } from './group-removal'
import type { GroupNameEdit, GroupNameResult } from './group-name'
import type { GroupPhotoBinding, GroupPhotoUploadRequest, GroupPhotoUploadAction, GroupPhotoUploadSnapshot } from './group-photo-upload'
import type { GroupPhotoRequest, GroupPhotoClear, GroupPhotoResult } from './group-photo'
import type { GroupAnnouncementEdit, GroupAnnouncementResult } from './group-announcement'

export type ThemePreference = 'system' | 'dark' | 'black' | 'light'
export type Area = 'chats' | 'contacts' | 'channels' | 'notes' | 'settings'
export type ConnectionState = 'offline' | 'connecting' | 'registering' | 'ready' | 'suspended' | 'rejected'

export interface Preferences {
  theme: ThemePreference
  messageFontSize: number
  chatBackground: ChatBackground
  enterToSend: boolean
  notifications: boolean
  showNotificationPreview: boolean
  closeToTray: boolean
  storyStealth: boolean
  showUnreadBadge: boolean
  autoDeleteDefaultSeconds: number
  autoDeleteOnlyMyMessages: boolean
  // MorseMessenger iOS chatAutoTranslateGemini: "전체번역" in every chat but memo.
  autoTranslateChats: boolean
  // Telegram's automatic media download: a received photo shows in the bubble without being asked
  // for. Morse keeps no small size for a photo, so this fetches the picture itself within a cap.
  autoDownloadPhotos: boolean
  // Telegram's record button (Core::Settings::recordVideoMessages): a click switches between a voice and a
  // video message, and the choice is kept.
  recordVideoMessages: boolean
  // iOS ChatSettingsView «입력 중 표시 보내기» and PowerSavingView «입력 중 표시 끄기» (MorsePowerSaving).
  sendTypingIndicator: boolean
  disableTypingIndicators: boolean
  // iOS NotificationSettingsView (MorsePushPreferences): 1:1 and group notifications, sound, notifications while
  // the app is in use, and the badge counting messages or chats.
  notifyPersonal: boolean
  notifyGroup: boolean
  // «채널»: new posts of subscribed channels (pushChannelEnabled).
  notifyChannel: boolean
  notificationSound: boolean
  inAppNotifications: boolean
  badgeMode: 'messages' | 'chats'
  // iOS ChatSettingsView «맞춤법 검사» (chatSpellCheckEnabled).
  spellCheck: boolean
  // iOS DataStorageView «사진 화질» (PhotoSendQuality).
  photoSendQuality: import('./photo-quality').PhotoSendQuality
  // iOS DataStorageView «영상 화질» (videoQuality).
  videoSendQuality: import('./photo-quality').PhotoSendQuality
  // iOS PowerSavingView (MorsePowerSaving): automation and the options that mean something on a desktop.
  powerSavingAuto: boolean
  powerSavingAlwaysOn: boolean
  compressMediaUploads: boolean
  reduceMessageAnimations: boolean
  // iOS LanguagePickerView (talky.appLanguage): null until chosen, when the system's language is used if Morse has it.
  language: Language | null
}
export const defaultPreferences: Preferences = {
  theme: 'system', messageFontSize: 14, chatBackground: defaultChatBackground, enterToSend: true, notifications: true, showNotificationPreview: false,
  storyStealth: false, closeToTray: false, showUnreadBadge: true, autoDeleteDefaultSeconds: 0, autoDeleteOnlyMyMessages: false, autoTranslateChats: false,
  autoDownloadPhotos: true, recordVideoMessages: false, sendTypingIndicator: true, disableTypingIndicators: false,
  notifyPersonal: true, notifyGroup: true, notifyChannel: true, notificationSound: true, inAppNotifications: true, badgeMode: 'messages', spellCheck: true,
  photoSendQuality: 'auto', videoSendQuality: 'auto', powerSavingAuto: true, powerSavingAlwaysOn: false, compressMediaUploads: false, reduceMessageAnimations: false, language: null
}

export interface AccountProfile {
  uid: string
  userId: string
  displayName: string
  photoURL?: string
}

// Full server precision is retained, including timestamp ties across history pages.
export interface MessagePosition {
  seconds: number
  nanoseconds: number
  id: string
}

export interface DialogSummary {
  composeAccess?: boolean
  composeMessage?: string
  historyAccess?: 'loading' | 'blocked' | 'ready'
  historyMessage?: string
  avatar?: import('./group-photo').GroupPhotoImage | null
  id: string
  version: string
  kind: 'direct' | 'group' | 'secret'
  title: string
  participantUids: string[]
  preview: string
  unreadCount: number
  markedUnread: boolean
  readPositions: Record<string, ReadCursor>
  readSync: ReadSyncState
  pinned: boolean
  pinVersion: string
  muted: boolean
  archived: boolean
  discussion?: boolean
  // chats/{id}.channelId of a channel discussion group: the chat keeps only the picture address the
  // server copied when it was created, so the row falls back to the channel's own picture.
  channelId?: string
  // The discussion group of a channel that is not public (or whose channel could not be read): iOS
  // ChannelDiscussionProtection keeps it out of screenshots and screen recordings.
  contentProtected?: boolean
  autoDeleteSeconds?: number
  autoDeleteMyOnly?: boolean
  createdBy?: string
  // chats/{id}.pinnedForAllMessageIds ("모두에게 고정").
  pinnedForAll?: string[]
  // chats.unseenReactionByUid[me]: someone else's newest reaction to my message, until this account sees it.
  unseenReaction?: { messageId: string; emoji: string; reactionVersion: number }
  // A group's topics when isForumEnabled, and the topic this device shows (null: «모두»).
  forum?: import('./forum').ForumState
  forumSelected?: string | null
  top: MessagePosition | null
}

export type MessageKind = 'text' | 'image' | 'video' | 'voice' | 'file' | 'sticker' | 'channelPost' | 'location' | 'event' | 'unsupported'
export type ReplyPreview = { state: 'loading' | 'unavailable' | 'error' } |
  { state: 'ready'; senderName: string; kind: MessageKind; text: string }
export interface ChatMessage {
  id: string
  chatId: string
  senderId: string
  senderName?: string
  kind: MessageKind
  text: string
  position: MessagePosition
  serverConfirmed: boolean
  encrypted: boolean
  silent?: boolean
  circular?: boolean
  mediaMetadata?: MediaMetadata | null
  readEligible: boolean
  state: 'pending' | 'sent' | 'failed'
  categoryId?: string
  replyToId?: string
  storySource?: import('./message-story-source').MessageStorySource | null
  reply?: ReplyPreview
  edited: boolean
  version: string
  system: boolean
  // A channel post mirrored into the channel's discussion room (server onChannelPostCreated).
  channelPost?: { channelId: string; postId: string; channelName: string }
  reactions: ReactionSummary[]
  attachments?: AttachmentSummary[]
  caption?: string
}

export interface TextSendWire extends StoryReplyWireFields {
  id: string
  chatId: string
  senderId: string
  type: 'text'
  text: string
  isSilent: boolean
  isEncrypted: false
  protocolVersion: 3
  replyToId?: string
  // iOS stampOutgoingCategoryIfNeeded: a message sent into a group with topics carries one.
  categoryId?: string
  peerUid?: string
  chatType?: 'direct'
  // Read by the server only when this first message creates the direct chat.
  autoDeleteSeconds?: number
  autoDeleteMyOnly?: boolean
}

export interface SendAcknowledgement {
  id: string
  chatId: string
  senderId: string
  createdAt: number
  alreadyExisted: boolean
}
export interface MediaSendWire extends Omit<TextSendWire, 'type'>, MediaMetadata {
  type: 'image' | 'video' | 'file' | 'voice' | 'sticker'
  mediaUrl: string
  mediaKeys?: string[]
  fileName?: string
  fileSize?: number
  imageCaption?: string
  videoCaption?: string
  thumbnailUrl?: '__blind__'
}
export type SendWire = TextSendWire | MediaSendWire
export interface OutgoingOperation {
  sequence: number
  wire: TextSendWire
  attempts: number
  nextAttemptAt: number
}
export interface HistoryPage { messages: ChatMessage[]; before: MessagePosition | null; hasMore: boolean }
export type ReadStatus = 'loading' | 'ready' | 'error'
export interface HistorySnapshot extends HistoryPage {
  revision: number
  status: ReadStatus | 'unsupported'
  message: string
  newerAvailable: boolean
  focusMessageId?: string
}
export interface DesktopSnapshot {
  revision: number
  appVersion: string
  platform: 'macOS' | 'Windows' | 'unsupported'
  preferences: Preferences
  systemDark: boolean
  accounts: AccountProfile[]
  activeAccountUid: string | null
  connection: ConnectionState
  dialogs: DialogSummary[]
  // Dialogs that are open without being rows of the list (deleted here, or nothing left after a delete for everyone):
  // Telegram keeps a History per peer whether or not it is in the chat list. Look a chat up with dialogById().
  openDialogs: DialogSummary[]
  dialogStatus: ReadStatus
  dialogMessage: string
  dialogPin: DialogPinSnapshot | null
  manualUnread: ManualUnreadSnapshot | null
  dialogActionsAvailable: boolean
  signInAvailable: boolean
  authentication: AuthenticationSnapshot
  appLock: import('./app-lock').AppLockSnapshot
  accountStates: import('./auth').AccountAuthState[]
  addingAccount: boolean
  maxAccounts: number
  // Last seen of the people on screen for the active account (presenceRedacted/{me}/{peer}).
  presence: Record<string, import('./presence').PeerPresence>
  pinnedMessages: import('./pinned-messages').PinnedMessagesSnapshot | null
  typing: { chatId: string; until: number } | null
  // Telegram's dialog row «typing…»: who is typing in the chat list's first chats.
  listTyping?: Record<string, { until: number; names: string[] }>
  postLikers: import('./post-likers').PostLikersSnapshot | null
  stickers: import('./stickers').StickerItem[] | null
  // The sticker set sheet that is open, and the sets this account installed (null until known).
  stickerPack: import('./sticker-packs').StickerPackSnapshot | null
  stickerPacks: import('./sticker-packs').StickerPack[] | null
  deferredMessages: import('./deferred-send').DeferredMessagesSnapshot | null
  channelInquiries: import('./channel-inquiries').ChannelInquiriesSnapshot | null
  // 1:1 channel inquiry rooms shown in the chat list beside the chats.
  inquiryRows: import('./channel-inquiries').InquiryRow[]
  // The active account's chat folders as they are on the server; null until they are known.
  chatFolders: import('./chat-folders').ChatFolder[] | null
  notifications: NotificationStatus
  platformIntegration: { trayAvailable: boolean; message: string }
  selfProfile: ProfileSnapshot | null
  contacts: ContactsSnapshot | null
  channels: import('./channels').ChannelsSnapshot | null
  participants: ParticipantsSnapshot | null
  contactSearch: ContactSearchSnapshot | null
  pendingDirects: PendingDirect[]
  channelJoinDecisions: ChannelJoinDecisionSnapshot | null
  channelAccess: ChannelAccessEditSnapshot | null
  channelPhotoUpload: ChannelPhotoUploadSnapshot | null
  groupPhotoUpload: GroupPhotoUploadSnapshot | null
  channelPublicPreview: import('./channel-public-preview').PublicChannelPreviewSnapshot | null
  ownStories: import('./own-stories').OwnStoriesSnapshot | null
  spaceNotes: import('./space-notes').SpaceNotesSnapshot | null
  channelDiscovery: import('./channel-discovery').ChannelDiscoverySnapshot | null
  channelHome: import('./channel-home').ChannelHomeSnapshot | null
  channelStories: import('./channel-stories').ChannelStoriesSnapshot | null
  appUpdate: import('./app-updates').AppUpdateSnapshot
  contactStoryPhotoAudio: import('./contact-story-photo-audio').ContactStoryPhotoAudioSnapshot | null
  contactAudienceStoryVideo: import('./contact-audience-story-video').ContactAudienceStoryVideoSnapshot | null
  contactAudienceStoryPhoto: import('./contact-audience-story-photo').ContactAudienceStoryPhotoSnapshot | null
  contactStoryAudience: import('./contact-story-audience').ContactStoryAudienceSnapshot | null
  contactPublicStoryVideo: import('./contact-public-story-video').ContactPublicStoryVideoSnapshot | null
  contactPublicStoryPhoto: import('./contact-public-story-photo').ContactPublicStoryPhotoSnapshot | null
  storyPublication: import('./story-publication').StoryPublicationSnapshot | null
  storyReplyDraft: import('./story-reply-draft').StoryReplyDraftSnapshot | null
  storyViewReceipt: import('./story-view-receipt').StoryViewReceiptSnapshot | null
  storyReactionChange: import('./story-reaction-change').StoryReactionChangeSnapshot | null
  storyHiddenChange: import('./story-hidden-change').StoryHiddenChangeSnapshot | null
  storyPrivacyMove: import('./story-privacy-move').StoryPrivacyMoveSnapshot | null
  storyRemoval: import('./story-removal').StoryRemovalSnapshot | null
  noteRemoval: import('./space-note-removal').NoteRemovalSnapshot | null
  storyCaptionSave: import('./story-caption-save').StoryCaptionSaveSnapshot | null
  noteTextSave: import('./space-note-text-save').NoteTextSaveSnapshot | null
  noteCreation: import('./space-note-creation').NoteCreationSnapshot | null
  channelCreation: import('./channel-creation').ChannelCreationSnapshot | null
  postCreation: import('./channel-post-creation').PostCreationSnapshot | null
  commentCreation: import('./channel-comment-creation').CommentCreationSnapshot | null
  canReadCommentDrafts: boolean
  discussionJoin: DiscussionJoinSnapshot | null
}

// Data::Changes equivalent: only the top-level slices and dialog rows that
// changed since `base` are sent. A renderer at another revision resyncs.
export interface DataBatch {
  base: number
  revision: number
  fields: Partial<Omit<DesktopSnapshot, 'revision' | 'dialogs'>>
  dialogs?: { order: string[]; upsert: DialogSummary[]; remove: string[] }
}

export type DesktopEvent =
  | { type: 'data'; batch: DataBatch }
  | {type:'voice-capture-revoked';id:string}
  | { type: 'background-photo-availability'; available: boolean }
  | { type: 'chat-background-changed'; accountUid: string; chatId: string; background: ChatBackgroundRecord }
  | { type: 'forward-progress'; accountUid: string; progress: ForwardProgress }
  | { type: 'snapshot'; snapshot: DesktopSnapshot }
  | { type: 'messages-changed'; accountUid: string; chatId: string }
  | { type: 'history-changed'; accountUid: string; chatId: string; history: HistorySnapshot }
  | { type: 'queued-voice-revoked'; requestId:string }
  | { type: 'outgoing-changed'; accountUid: string; chatId: string; outgoing: OutgoingSnapshot }
  | { type: 'reply-draft-changed'; accountUid: string; chatId: string; reply: ReplyDraftSnapshot }
  | { type: 'actions-changed'; accountUid: string; chatId: string; actions: MessageActionsSnapshot }
  | { type: 'media-progress'; accountUid: string; requestId: string; loaded: number; total: number | null }
  | { type: 'shortcut'; command: ShortcutCommand }
  | { type: 'open-notification-chat'; accountUid: string; chatId: string }
  | { type: 'search-changed'; accountUid: string; chatId: string; search: SearchSnapshot }
  | { type: 'error'; message: string }
  // A picked video is being compressed before the send box opens.
  | { type: 'attachment-preparing'; active: boolean }
  // A morse:// or talky:// link is waiting for the window (takeOpenLink).
  | { type: 'open-link' }
  // macOS hides the window buttons in full screen, so the title strip they need goes away.
  | { type: 'full-screen'; value: boolean }
  | { type: 'prepare-close'; requestId: string }

export interface DesktopBridge {
  // The language this window was started in; a change is saved and applies after relaunchApp.
  readonly language: Language
  relaunchApp(): Promise<void>
  // Whether power saving's «업로드 자동 압축» applies now (the window knows the battery).
  setPowerSavingState(compressUploads: boolean): Promise<void>
  setContentProtection(enabled: boolean): Promise<void>
  // The web address of the morse:// or talky:// link the app was opened with, once.
  takeOpenLink(): Promise<string | null>
  createGroup(accountUid: string, request: GroupCreateRequest): Promise<'done' | 'unconfirmed'>
  addGroupMembers(accountUid: string, request: GroupMembersRequest): Promise<'done' | 'unconfirmed'>
  leaveGroup(accountUid: string, request: GroupLeaveRequest): Promise<'done' | 'unconfirmed'>
  removeGroupMember(accountUid: string, request: GroupRemovalRequest): Promise<'done' | 'unconfirmed'>
  closeFriendList(accountUid: string): Promise<string[]>
  setCloseFriend(accountUid: string, peerUid: string, add: boolean): Promise<void>
  joinChannel(accountUid: string, channelId: string): Promise<'joined' | 'pending' | 'unconfirmed'>
  leaveChannel(accountUid: string, channelId: string): Promise<'done' | 'unconfirmed'>
  storyBar(accountUid: string, peers: string[], force: boolean): Promise<import('./story-bar').StoryBarResult>
  clearChatHistory(accountUid: string, chatId: string): Promise<'done' | 'unconfirmed'>
  // Telegram's "Delete chat": for me only hides the room here, for everyone removes it.
  deleteChat(accountUid: string, chatId: string, forEveryone: boolean): Promise<'done' | 'unconfirmed'>
  hideMessages(accountUid: string, chatId: string, messageIds: string[]): Promise<'done'>
  setContactFlags(accountUid: string, uid: string, patch: { favorite?: boolean; archived?: boolean }): Promise<'done'>
  setChatFlags(accountUid: string, chatId: string, patch: { muted?: boolean; archived?: boolean; category?: string | null }): Promise<'done'>
  setGroupForum(accountUid: string, chatId: string, enabled: boolean): Promise<'done'>
  addForumCategory(accountUid: string, chatId: string, name: string): Promise<'done'>
  restoreChat(accountUid: string, chatId: string): Promise<'done'>
  prepareMemoChat(accountUid: string): Promise<string>
  blockedUsers(accountUid: string): Promise<import('./account-tools').BlockedUser[]>
  setBlockedUser(accountUid: string, target: import('./account-tools').BlockTarget, blocked: boolean): Promise<void>
  signInSessions(accountUid: string): Promise<import('./account-tools').SignInSession[]>
  revokeSignInSessions(accountUid: string, sessionId: string | null): Promise<void>
  // A null current code uses the code kept on this device for an Apple sign-up.
  changeBackupCode(accountUid: string, currentCode: string | null): Promise<{ backupCode: string; confirmed: boolean }>
  hasStoredBackupCode(accountUid: string): Promise<boolean>
  lastSeenPrivacy(accountUid: string): Promise<import('./account-tools').LastSeenPrivacy>
  setLastSeenPrivacy(accountUid: string, value: import('./account-tools').LastSeenPrivacy): Promise<void>
  report(accountUid: string, request: import('./reports').ReportRequest): Promise<void>
  accountPrivacy(accountUid: string): Promise<import('./account-tools').AccountPrivacy>
  setPrivateMode(accountUid: string, value: boolean): Promise<'done' | 'unconfirmed'>
  setAutoDeleteMonths(accountUid: string, months: number): Promise<void>
  requestDataExport(accountUid: string): Promise<import('./account-tools').DataExport>
  openDataExport(url: string): Promise<void>
  deleteAccount(accountUid: string): Promise<void>
  createInviteLink(accountUid: string): Promise<import('./account-tools').InviteLink>
  useInviteLink(accountUid: string, link: string): Promise<import('./account-tools').InviteCreator>
  chatFolders(accountUid: string): Promise<import('./chat-folders').ChatFolder[]>
  saveChatFolder(accountUid: string, folder: import('./chat-folders').ChatFolder, create: boolean): Promise<'done' | 'unconfirmed'>
  deleteChatFolder(accountUid: string, folderId: string): Promise<'done' | 'unconfirmed'>
  reorderChatFolders(accountUid: string, folderIds: string[]): Promise<'done' | 'unconfirmed'>
  setChatAutoDelete(accountUid: string, chatId: string, seconds: number, myOnly: boolean): Promise<'done' | 'unconfirmed'>
  openSubscriberInquiry(accountUid: string, channelId: string): Promise<string>
  openInquiryList(accountUid: string, request: import('./channel-inquiries').InquiryListRequest): Promise<void>
  closeInquiryList(accountUid: string, requestId: string): Promise<void>
  openInquiryThread(accountUid: string, request: import('./channel-inquiries').InquiryThreadRequest): Promise<void>
  closeInquiryThread(accountUid: string, requestId: string): Promise<void>
  sendInquiryMessage(accountUid: string, request: import('./channel-inquiries').InquiryTextRequest): Promise<'sent' | 'unconfirmed'>
  pickInquiryPhoto(accountUid: string): Promise<Uint8Array | null>
  sendInquiryPhoto(accountUid: string, request: import('./channel-inquiries').InquiryPhotoRequest, bytes: Uint8Array): Promise<'sent' | 'unconfirmed'>
  pickInquiryAttachment(accountUid: string, request: import('./channel-inquiries').InquiryThreadRequest, mode: import('./channel-inquiries').InquiryAttachmentMode): Promise<import('./uploads').AttachmentDraft | null>
  sendInquiryAttachment(accountUid: string, request: import('./channel-inquiries').InquiryAttachmentRequest, video: import('./uploads').VideoFacts | null): Promise<'sent' | 'unconfirmed'>
  discardInquiryAttachment(accountUid: string, id: string): Promise<void>
  finishInquiryVoice(accountUid: string, target: import('./channel-inquiries').InquiryVoiceTarget, bytes: Uint8Array): Promise<import('./voice-capture').VoiceCapturePreview>
  sendInquiryVoice(accountUid: string, request: import('./channel-inquiries').InquiryVoiceRequest): Promise<'sent' | 'unconfirmed'>
  beginInquiryVoice(accountUid: string, target: import('./channel-inquiries').InquiryVoiceTarget): Promise<import('./voice-capture').VoiceCaptureGrant>
  // A recording step for voice-check.log: a fixed step name and, for a failure, the error's name only.
  recordVoiceStep(step: { surface: 'chat' | 'inquiry'; step: string; name?: string }): void
  // A video message: the grant covers the camera too; activation uses the voice grant's own call.
  beginRoundVideo(accountUid: string, target: import('./voice-capture').VoiceCaptureTarget): Promise<import('./voice-capture').VoiceCaptureGrant>
  sendRoundVideo(accountUid: string, request: import('./round-video').RoundVideoSendRequest, bytes: Uint8Array): Promise<void>
  beginInquiryRoundVideo(accountUid: string, target: import('./channel-inquiries').InquiryVoiceTarget): Promise<import('./voice-capture').VoiceCaptureGrant>
  sendInquiryRoundVideo(accountUid: string, request: import('./channel-inquiries').InquiryVoiceTarget & { messageId: string; duration: number; thumb: string }, bytes: Uint8Array): Promise<'sent' | 'unconfirmed'>
  activateInquiryVoice(accountUid: string, target: import('./channel-inquiries').InquiryVoiceTarget): Promise<import('./voice-capture').VoiceCaptureGrant>
  editInquiryMessage(accountUid: string, request: import('./channel-inquiries').InquiryTextRequest): Promise<void>
  deleteInquiryMessage(accountUid: string, request: import('./channel-inquiries').InquiryTargetRequest): Promise<void>
  clearInquiryHistory(accountUid: string, request: import('./channel-inquiries').InquiryThreadRequest): Promise<'done' | 'unconfirmed'>
  refreshDiscussionJoin(accountUid: string): Promise<void>
  prepareDiscussionJoin(accountUid: string, request: DiscussionJoinRequest): Promise<void>
  discussionJoinAction(accountUid: string, action: DiscussionJoinAction): Promise<void>
  pickBackgroundPhoto(scope: BackgroundPhotoScope): Promise<{ id: string; bytes: Uint8Array } | null>
  pickBuiltinBackgroundPhoto(scope: BackgroundPhotoScope): Promise<{ id: string; bytes: Uint8Array } | null>
  prepareBackgroundPhoto(id: string, bytes: Uint8Array): Promise<void>
  releaseBackgroundPhoto(id: string): Promise<void>
  backgroundPhotoURL(scope: BackgroundPhotoScope, id: string): Promise<string>
  releaseBackgroundPhotoURL(token: string): Promise<void>
  chatBackground(accountUid: string, chatId: string): Promise<ChatBackgroundRecord>
  saveChatBackground(accountUid: string, chatId: string, edit: ChatBackgroundEdit): Promise<ChatBackgroundRecord>
  backgroundStorage(accountUid: string): Promise<BackgroundStorageSnapshot>
  removeStoredBackground(accountUid: string, removal: BackgroundStorageRemoval): Promise<void>
  setManualUnread(accountUid: string, request: ManualUnreadRequest): Promise<void>
  checkManualUnread(accountUid: string, chatId: string): Promise<void>
  setDialogPin(accountUid: string, request: DialogPinRequest): Promise<void>
  checkDialogPin(accountUid: string, chatId: string): Promise<void>
  openParticipants(accountUid: string, chatId: string, requestId: string): Promise<void>
  closeParticipants(accountUid: string, requestId: string): Promise<void>
  participantContact(accountUid: string, request: ParticipantContactRequest): Promise<string>
  addParticipantContact(accountUid: string, request: ParticipantAddRequest): Promise<ParticipantAddResult>
  addChatContact(accountUid: string, request: import('./participants').ChatContactRequest): Promise<import('./participants').ParticipantAddResult>
  saveGroupName(accountUid: string, request: GroupNameEdit): Promise<GroupNameResult>
  refreshChannelJoinDecisions(accountUid: string): Promise<void>
  prepareChannelJoinDecision(accountUid: string, request: ChannelJoinDecisionRequest): Promise<void>
  channelJoinDecisionAction(accountUid: string, action: ChannelJoinDecisionAction): Promise<void>
  refreshChannelAccess(accountUid: string): Promise<void>
  prepareChannelAccess(accountUid: string, request: ChannelAccessRequest): Promise<void>
  channelAccessAction(accountUid: string, action: ChannelAccessAction): Promise<void>
  pickChannelPhoto(accountUid: string, binding: ChannelPhotoBinding): Promise<{ id: string; bytes: Uint8Array } | null>
  queueChannelPhoto(accountUid: string, request: ChannelPhotoUploadRequest, bytes: Uint8Array): Promise<void>
  channelPhotoUploadAction(accountUid: string, action: ChannelPhotoUploadAction): Promise<void>
  pickGroupPhoto(accountUid: string, binding: GroupPhotoBinding): Promise<{ id: string; bytes: Uint8Array } | null>
  queueGroupPhoto(accountUid: string, request: GroupPhotoUploadRequest, bytes: Uint8Array): Promise<void>
  groupPhotoUploadAction(accountUid: string, action: GroupPhotoUploadAction): Promise<void>
  loadGroupPhoto(accountUid: string, request: GroupPhotoRequest): Promise<void>
  setVisibleDialogPhotos(accountUid: string, chatIds: string[]): Promise<void>
  setVisibleContactPhotos(accountUid: string, uids: string[]): Promise<void>
  rebaseNoteEditDraft(accountUid: string, request: import('./space-note-edit-rebase').NoteEditRebaseRequest): Promise<import('./space-note-edit-drafts').NoteEditDraftRecord>
  compareNoteEditDraft(accountUid: string, request: import('./space-note-edit-comparison').NoteEditComparisonRequest): Promise<import('./space-note-edit-comparison').NoteEditComparisonResult>
  closeNoteEditComparison(accountUid: string, id: string): Promise<void>
  startStoryCaptionDraft(accountUid: string, target: import('./story-caption-drafts').StoryCaptionDraftStart): Promise<import('./story-caption-drafts').StoryCaptionDraftRecord>
  readStoryCaptionDraft(accountUid: string, target: import('./story-caption-drafts').StoryCaptionDraftTarget): Promise<import('./story-caption-drafts').StoryCaptionDraftRecord>
  saveStoryCaptionDraft(accountUid: string, request: import('./story-caption-drafts').StoryCaptionDraftWrite): Promise<import('./story-caption-drafts').StoryCaptionDraftRecord>
  startNoteEditDraft(accountUid: string, target: import('./space-note-edit-drafts').NoteEditDraftStart): Promise<import('./space-note-edit-drafts').NoteEditDraftRecord>
  readNoteEditDraft(accountUid: string, target: import('./space-note-edit-drafts').NoteEditDraftTarget): Promise<import('./space-note-edit-drafts').NoteEditDraftRecord>
  saveNoteEditDraft(accountUid: string, request: import('./space-note-edit-drafts').NoteEditDraftWrite): Promise<import('./space-note-edit-drafts').NoteEditDraftRecord>
  setSpaceNotePin(accountUid: string, request: import('./space-note-pin').NotePinRequest): Promise<import('./space-note-pin').NotePinResult>
  readStoryViewRecords(accountUid: string, request: import('./story-view-records').StoryViewRecordsRequest): Promise<import('./story-view-records').StoryViewRecordsResult>
  readStoryHiddenAudience(accountUid: string, request: import('./story-hidden-audience').StoryHiddenAudienceRequest): Promise<import('./story-hidden-audience').StoryHiddenAudienceResult>
  closeStoryViewRecords(accountUid: string, id: string): Promise<void>
  closeStoryHiddenAudience(accountUid: string, id: string): Promise<void>
  sendStoryReply(accountUid: string, request: import('./story-reply-send').StoryReplySendRequest): Promise<import('./story-reply-send').StoryReplySendReceipt>
  saveStoryReplyText(accountUid: string, request: import('./story-reply-text').StoryReplyTextWrite): Promise<import('./story-reply-text').StoryReplyTextRecord>
  refreshStoryReplyDraft(accountUid: string): Promise<void>
  prepareStoryReplyDraft(accountUid: string, request: import('./story-reply-draft').StoryReplyDraftPrepare): Promise<void>
  storyReplyDraftAction(accountUid: string, action: import('./story-reply-draft').StoryReplyDraftAction): Promise<void>
  refreshStoryViewReceipt(accountUid: string): Promise<void>
  prepareStoryViewReceipt(accountUid: string, request: import('./story-view-receipt').StoryViewReceiptPrepare): Promise<void>
  storyViewReceiptAction(accountUid: string, action: import('./story-view-receipt').StoryViewReceiptAction): Promise<void>
  refreshStoryReactionChange(accountUid: string): Promise<void>
  prepareStoryReactionChange(accountUid: string, request: import('./story-reaction-change').StoryReactionChangePrepare): Promise<void>
  storyReactionChangeAction(accountUid: string, action: import('./story-reaction-change').StoryReactionChangeAction): Promise<void>
  refreshStoryHiddenChange(accountUid: string): Promise<void>
  refreshStoryPrivacyMove(accountUid: string): Promise<void>
  refreshStoryRemoval(accountUid: string): Promise<void>
  refreshNoteRemoval(accountUid: string): Promise<void>
  prepareStoryHiddenChange(accountUid: string, request: import('./story-hidden-change').StoryHiddenChangePrepare): Promise<void>
  prepareStoryPrivacyMove(accountUid: string, request: import('./story-privacy-move').StoryPrivacyMovePrepare): Promise<void>
  prepareStoryRemoval(accountUid: string, request: import('./story-removal').StoryRemovalPrepare): Promise<void>
  prepareNoteRemoval(accountUid: string, request: import('./space-note-removal').NoteRemovalPrepare): Promise<void>
  storyHiddenChangeAction(accountUid: string, action: import('./story-hidden-change').StoryHiddenChangeAction): Promise<void>
  storyPrivacyMoveAction(accountUid: string, action: import('./story-privacy-move').StoryPrivacyMoveAction): Promise<void>
  storyRemovalAction(accountUid: string, action: import('./story-removal').StoryRemovalAction): Promise<void>
  noteRemovalAction(accountUid: string, action: import('./space-note-removal').NoteRemovalAction): Promise<void>
  refreshStoryCaptionSave(accountUid: string): Promise<void>
  refreshNoteTextSave(accountUid: string): Promise<void>
  prepareStoryCaptionSave(accountUid: string, request: import('./story-caption-save').StoryCaptionSavePrepare): Promise<void>
  prepareNoteTextSave(accountUid: string, request: import('./space-note-text-save').NoteTextSavePrepare): Promise<void>
  storyCaptionSaveAction(accountUid: string, action: import('./story-caption-save').StoryCaptionSaveAction): Promise<void>
  noteTextSaveAction(accountUid: string, action: import('./space-note-text-save').NoteTextSaveAction): Promise<void>
  refreshNoteCreation(accountUid: string): Promise<void>
  prepareNoteCreation(accountUid: string, request: import('./space-note-creation').NoteCreationPrepare): Promise<void>
  noteCreationAction(accountUid: string, action: import('./space-note-creation').NoteCreationAction): Promise<void>
  refreshStoryPublication(accountUid: string): Promise<void>
  prepareStoryPublication(accountUid: string, request: import('./story-publication').StoryPublicationPrepare): Promise<void>
  storyPublicationAction(accountUid: string, action: import('./story-publication').StoryPublicationAction): Promise<void>
  previewStoryComposerVideo(accountUid: string, source: import('./story-composer-video').StoryVideoSource): Promise<string>
  prepareStoryVideoPoster(accountUid: string, request: import('./story-composer-video').StoryVideoPosterRequest, bytes: Uint8Array): Promise<import('./story-composer-video').StoryVideoPoster>
  beginVoiceCapture(accountUid:string,target:import('./voice-capture').VoiceCaptureTarget):Promise<import('./voice-capture').VoiceCaptureGrant>
  activateVoiceCapture(accountUid:string,target:import('./voice-capture').VoiceCaptureTarget):Promise<import('./voice-capture').VoiceCaptureGrant>
  finishVoiceCapture(accountUid:string,target:import('./voice-capture').VoiceCaptureTarget,bytes:Uint8Array):Promise<import('./voice-capture').VoiceCapturePreview>
  sendVoiceCapture(accountUid:string,request:import('./voice-send').VoiceSendRequest):Promise<void>
  resolveVoiceDraftNavigation(accountUid:string,request:import('./voice-draft-storage').VoiceDraftStorageNavigation):Promise<import('./voice-draft-storage').VoiceDraftNavigationResult>
  voiceDraftStorage(accountUid:string):Promise<import('./voice-draft-storage').VoiceDraftStorageSnapshot>
  removeStoredVoiceDraft(accountUid:string,removal:import('./voice-draft-storage').VoiceDraftStorageRemoval):Promise<void>
  readVoiceDraft(accountUid:string,chatId:string):Promise<import('./voice-draft').VoiceDraftRecord>
  writeVoiceDraft(accountUid:string,request:import('./voice-draft').VoiceDraftWrite):Promise<import('./voice-draft').VoiceDraftRecord>
  restoreVoiceDraft(accountUid:string,reference:import('./voice-draft').VoiceDraftReference):Promise<{record:import('./voice-draft').VoiceDraftRecord;preview:import('./voice-capture').VoiceCapturePreview}>
  openQueuedVoice(accountUid:string,request:import('./voice-queue-preview').VoiceQueueOpen):Promise<import('./voice-queue-preview').VoiceQueueView>
  releaseQueuedVoice(requestId:string):Promise<void>
  releaseVoiceCapture(id:string):Promise<void>
  readStoryComposerAudio(accountUid:string,target:import('./story-composer-drafts').StoryComposerDraftTarget):Promise<import('./story-composer-audio-storage').StoryComposerAudioRecord>
  saveStoryComposerAudio(accountUid:string,request:import('./story-composer-audio-storage').StoryComposerAudioWrite):Promise<import('./story-composer-audio-storage').StoryComposerAudioRecord>
  previewStoryComposerAudio(accountUid:string,source:import('./story-composer-audio').StoryAudioSource):Promise<string>
  confirmStoryComposerAudio(accountUid:string,request:import('./story-composer-audio').StoryAudioConfirm):Promise<import('./story-composer-audio').StoryAudioReady>
  pickStoryComposerAudio(accountUid: string, target: import('./story-composer-photo').StoryComposerPhotoTarget): Promise<import('./story-composer-audio').StoryAudioCandidate | null>
  releaseStoryComposerAudio(id: string): Promise<void>
  pickStoryComposerVideo(accountUid: string, target: import('./story-composer-photo').StoryComposerPhotoTarget): Promise<import('./story-composer-video').StoryVideoCandidate | null>
  releaseStoryComposerVideo(id: string): Promise<void>
  checkStoryVideoPublication(accountUid: string, request: import('./story-video-observation').StoryVideoObservationRequest): Promise<import('./story-video-observation').StoryVideoObservation>
  publishStoryVideoPublication(accountUid: string, request: import('./story-video-publication-commit').StoryVideoPublishRequest): Promise<import('./story-video-publication').PendingStoryVideoPublication>
  uploadStoryVideoPublication(accountUid: string, request: import('./story-video-publication').StoryVideoUploadRequest): Promise<import('./story-video-publication').PendingStoryVideoPublication>
  pauseStoryVideoUpload(accountUid: string): Promise<void>
  readStoryVideoPublication(accountUid: string): Promise<import('./story-video-publication').PendingStoryVideoPublication | null>
  prepareStoryVideoPublication(accountUid: string, request: import('./story-video-publication').StoryVideoPublicationPrepare): Promise<import('./story-video-publication').PendingStoryVideoPublication | null>
  dismissStoryVideoPublication(accountUid: string, id: string): Promise<null>
  readStoryComposerVideo(accountUid: string, target: import('./story-composer-drafts').StoryComposerDraftTarget): Promise<import('./story-composer-video-storage').StoryComposerVideoRecord>
  saveStoryComposerVideo(accountUid: string, request: import('./story-composer-video-storage').StoryComposerVideoWrite): Promise<import('./story-composer-video-storage').StoryComposerVideoRecord>
  readStoryComposerPhoto(accountUid: string, target: import('./story-composer-drafts').StoryComposerDraftTarget): Promise<import('./story-composer-photo').StoryComposerPhotoRecord>
  pickStoryComposerPhoto(accountUid: string, target: import('./story-composer-photo').StoryComposerPhotoTarget): Promise<{ id: string; bytes: Uint8Array } | null>
  saveStoryComposerPhoto(accountUid: string, request: import('./story-composer-photo').StoryComposerPhotoWrite, full?: Uint8Array, thumbnail?: Uint8Array): Promise<import('./story-composer-photo').StoryComposerPhotoRecord>
  saveStoryComposerDraft(accountUid: string, request: import('./story-composer-drafts').StoryComposerDraftWrite): Promise<import('./story-composer-drafts').StoryComposerDraftRecord>
  saveNoteDraft(accountUid: string, request: import('./space-note-drafts').NoteDraftWrite): Promise<import('./space-note-drafts').NoteDraftRecord>
  searchNotePage(accountUid: string, request: import('./space-note-search').NotePageSearch): Promise<import('./space-note-search').NotePageSearchResult>
  pageSpaceNotes(accountUid: string, request: import('./space-notes').SpaceNotesPageRequest): Promise<void>
  openOwnStoryAudio(accountUid: string, request: import('./own-story-audio').OwnStoryAudioRequest): Promise<void>
  closeOwnStoryAudio(accountUid: string, selectionId: string): Promise<void>
  openOwnStoryVideo(accountUid: string, request: import('./own-story-video').OwnStoryVideoRequest): Promise<void>
  closeOwnStoryVideo(accountUid: string, selectionId: string): Promise<void>
  openOwnStoryPhoto(accountUid: string, request: import('./own-story-photo').OwnStoryPhotoRequest): Promise<void>
  closeOwnStoryPhoto(accountUid: string, selectionId: string): Promise<void>
  readContactStoryReaction(accountUid: string, request: import('./contact-story-reaction').ContactStoryReactionRequest): Promise<import('./contact-story-reaction').ContactStoryReactionResult>
  closeContactStoryReaction(accountUid: string, id: string): Promise<void>
  openContactStoryPhotoAudio(accountUid: string, request: import('./contact-story-photo-audio').ContactStoryPhotoAudioRequest): Promise<void>
  closeContactStoryPhotoAudio(accountUid: string, id: string): Promise<void>
  openContactAudienceStoryVideo(accountUid: string, request: import('./contact-audience-story-video').ContactAudienceStoryVideoRequest): Promise<void>
  closeContactAudienceStoryVideo(accountUid: string, id: string): Promise<void>
  openContactAudienceStoryPhoto(accountUid: string, request: import('./contact-audience-story-photo').ContactAudienceStoryPhotoRequest): Promise<void>
  closeContactAudienceStoryPhoto(accountUid: string, id: string): Promise<void>
  readContactAudienceStories(accountUid: string, request: import('./contact-audience-stories').ContactAudienceStoriesRequest): Promise<import('./contact-audience-stories').ContactAudienceStoriesResult>
  pageContactAudienceStories(accountUid: string, request: import('./contact-audience-stories').ContactAudienceStoriesPageRequest): Promise<import('./contact-audience-stories').ContactAudienceStoriesResult>
  closeContactAudienceStories(accountUid: string, id: string): Promise<void>
  openContactStoryAudience(accountUid: string, request: import('./contact-story-audience').ContactStoryAudienceRequest): Promise<void>
  closeContactStoryAudience(accountUid: string, id: string): Promise<void>
  openContactPublicStoryVideo(accountUid: string, request: import('./contact-public-story-video').ContactPublicStoryVideoRequest): Promise<void>
  closeContactPublicStoryVideo(accountUid: string, selectionId: string): Promise<void>
  openContactPublicStoryPhoto(accountUid: string, request: import('./contact-public-story-photo').ContactPublicStoryPhotoRequest): Promise<void>
  closeContactPublicStoryPhoto(accountUid: string, selectionId: string): Promise<void>
  readContactPublicStories(accountUid: string, request: import('./contact-public-stories').ContactPublicStoriesRequest): Promise<import('./contact-public-stories').ContactPublicStoriesResult>
  pageContactPublicStories(accountUid: string, request: import('./contact-public-stories').ContactPublicStoriesPageRequest): Promise<import('./contact-public-stories').ContactPublicStoriesResult>
  closeContactPublicStories(accountUid: string, id: string): Promise<void>
  openOwnStories(accountUid: string, request: import('./own-stories').OwnStoriesRequest): Promise<void>
  pageOwnStories(accountUid: string, request: import('./own-stories').OwnStoriesPageRequest): Promise<void>
  closeOwnStories(accountUid: string, requestId: string): Promise<void>
  openContactAudienceStoryLink(accountUid: string, request: import('./contact-audience-story-link').ContactAudienceStoryLinkRequest): Promise<void>
  openContactPublicStoryLink(accountUid: string, request: import('./contact-public-story-link').ContactPublicStoryLinkRequest): Promise<void>
  openStoryCaptionLink(accountUid: string, request: import('./story-caption-link').StoryCaptionLinkRequest): Promise<void>
  selectOwnStory(accountUid: string, request: import('./own-stories').OwnStorySelection): Promise<void>
  openSpaceNotes(accountUid: string, requestId: string): Promise<void>
  closeSpaceNotes(accountUid: string, requestId: string): Promise<void>
  selectSpaceNote(accountUid: string, request: import('./space-notes').SpaceNoteSelection): Promise<void>
  setChannelsVisible(accountUid: string, visible: boolean): Promise<void>
  refreshChannels(accountUid: string): Promise<void>
  openChannelPhotoClear(accountUid: string, request: import('./channel-photo-clear').ChannelPhotoClear): Promise<void>
  clearChannelPhoto(accountUid: string, request: import('./channel-photo-clear').ChannelPhotoClear): Promise<import('./channel-photo-clear').ChannelPhotoClearResult>
  closeChannelPhotoClear(accountUid: string, requestId: string): Promise<void>
  openChannelName(accountUid: string, request: import('./channel-name').ChannelNameEdit): Promise<void>
  saveChannelName(accountUid: string, request: import('./channel-name').ChannelNameEdit): Promise<import('./channel-name').ChannelNameResult>
  closeChannelName(accountUid: string, requestId: string): Promise<void>
  openChannelTags(accountUid: string, request: import('./channel-tags').ChannelTagsEdit): Promise<void>
  saveChannelTags(accountUid: string, request: import('./channel-tags').ChannelTagsEdit): Promise<import('./channel-tags').ChannelTagsResult>
  closeChannelTags(accountUid: string, requestId: string): Promise<void>
  openChannelIntroduction(accountUid: string, request: import('./channel-introduction').ChannelIntroductionEdit): Promise<void>
  saveChannelIntroduction(accountUid: string, request: import('./channel-introduction').ChannelIntroductionEdit): Promise<import('./channel-introduction').ChannelIntroductionResult>
  closeChannelIntroduction(accountUid: string, requestId: string): Promise<void>
  discussionLeaveWork(accountUid: string, request: import('./channel-discussion-navigation').ChannelDiscussionNavigation): Promise<import('./channel-discussion-leave-work').DiscussionLeaveWork>
  resolveDiscussionDeparture(accountUid: string, request: import('./channel-discussion-navigation').ChannelDiscussionNavigation): Promise<Omit<import('./group-leave').GroupLeaveRequest, 'id'>>
  discussionRowDeparture(accountUid: string, chatId: string): Promise<import('./channel-discussion-navigation').ChannelDiscussionNavigation>
  resolveChannelDiscussion(accountUid: string, request: import('./channel-discussion-navigation').ChannelDiscussionNavigation): Promise<import('./channel-discussion-navigation').ChannelDiscussionDestination>
  openChannelAdminAppointment(accountUid: string, request: import('./channel-admin-appointment').ChannelAdminAppointment): Promise<void>
  appointChannelAdmin(accountUid: string, request: import('./channel-admin-appointment').ChannelAdminAppointment): Promise<import('./channel-admin-appointment').ChannelAdminAppointmentResult>
  closeChannelAdminAppointment(accountUid: string, requestId: string): Promise<void>
  openChannelAdminRemoval(accountUid: string, request: import('./channel-admin-removal').ChannelAdminRemoval): Promise<void>
  removeChannelAdmin(accountUid: string, request: import('./channel-admin-removal').ChannelAdminRemoval): Promise<import('./channel-admin-removal').ChannelAdminRemovalResult>
  closeChannelAdminRemoval(accountUid: string, requestId: string): Promise<void>
  openChannelAdminPermissions(accountUid: string, request: import('./channel-admin-permissions').ChannelAdminPermissionsEdit): Promise<void>
  saveChannelAdminPermissions(accountUid: string, request: import('./channel-admin-permissions').ChannelAdminPermissionsEdit): Promise<import('./channel-admin-permissions').ChannelAdminPermissionsResult>
  closeChannelAdminPermissions(accountUid: string, requestId: string): Promise<void>
  openChannelAdmins(accountUid: string, request: import('./channel-admins').ChannelAdminsSelection): Promise<void>
  closeChannelAdmins(accountUid: string, requestId: string): Promise<void>
  openChannelSubscribers(accountUid: string, request: import('./channel-subscribers').ChannelSubscribersSelection): Promise<void>
  closeChannelSubscribers(accountUid: string, requestId: string): Promise<void>
  openChannelJoinRequests(accountUid: string, request: import('./channel-join-requests').ChannelJoinRequestsSelection): Promise<void>
  closeChannelJoinRequests(accountUid: string, requestId: string): Promise<void>
  openPublicPreviewPhotos(accountUid: string, request: import('./channel-public-preview').PublicChannelPhotosRequest): Promise<void>
  closePublicPreviewPhotos(accountUid: string, requestId: string): Promise<void>
  copyListedChannelShareText(accountUid: string, request: import('./channel-share').ChannelShareRequest): Promise<void>
  copyListedChannelLink(accountUid: string, request: import('./channel-share').ChannelShareRequest): Promise<void>
  copyPublicChannelShareText(accountUid: string, request: import('./channel-share').ChannelShareRequest): Promise<void>
  copyPublicChannelLink(accountUid: string, request: import('./channel-share').ChannelShareRequest): Promise<void>
  openPublicPreviewMembership(accountUid: string, request: import('./channel-membership-info').ChannelMembershipRequest): Promise<void>
  closePublicPreviewMembership(accountUid: string, requestId: string): Promise<void>
  showChannelCover(accountUid: string, request: import('./channels').ChannelCoverRequest): Promise<void>
  hideChannelCover(accountUid: string, requestId: string): Promise<void>
  setVisibleChannelPhotos(accountUid: string, ids: string[]): Promise<void>
  resolveChannelPostPin(accountUid: string, request: import('./channel-post-pin-resolution').ChannelPostPinResolution): Promise<import('./channel-post-pin-resolution').ChannelPostPinResolutionResult>
  clearChannelPostExtraPin(accountUid: string, request: import('./channel-post-extra-pin').ChannelPostExtraPinRequest): Promise<import('./channel-post-extra-pin').ChannelPostExtraPinResult>
  saveChannelPostPin(accountUid: string, request: import('./channel-post-pin-edit').ChannelPostPinEdit): Promise<import('./channel-post-pin-edit').ChannelPostPinResult>
  saveChannelPostText(accountUid: string, request: import('./channel-post-text-edit').ChannelPostTextEdit): Promise<import('./channel-post-text-edit').ChannelPostTextResult>
  setChannelPostLike(accountUid: string, request: import('./channel-post-like').ChannelPostLikeRequest): Promise<import('./channel-post-like').ChannelPostLikeResult>
  removePublicPreviewComment(accountUid: string, request: import('./channel-comment-removal').ChannelCommentRemoval): Promise<import('./channel-comment-removal').ChannelCommentRemovalResult>
  removeChannelComment(accountUid: string, request: import('./channel-comment-removal').ChannelCommentRemoval): Promise<import('./channel-comment-removal').ChannelCommentRemovalResult>
  setPostVisibility(accountUid: string, request: import('./channel-post-visibility').PostVisibilityRequest): Promise<import('./channel-post-visibility').PostVisibilityResult>
  removeChannelPost(accountUid: string, request: import('./channel-post-removal').PostRemovalTarget): Promise<import('./channel-post-removal').PostRemovalResult>
  setPublicPreviewLike(accountUid: string, request: import('./channel-post-like').ChannelPostLikeRequest): Promise<import('./channel-post-like').ChannelPostLikeResult>
  openPublicPreviewComments(accountUid: string, request: import('./channel-comments').ChannelCommentsRequest): Promise<void>
  closePublicPreviewComments(accountUid: string, selectionId: string): Promise<void>
  openPublicPreviewMedia(accountUid: string, request: import('./channel-post-media').ChannelPostMediaRequest): Promise<void>
  closePublicPreviewMedia(accountUid: string, selectionId: string): Promise<void>
  openPublicChannelLink(accountUid: string, request: import('./channel-share').PublicChannelLinkRequest): Promise<void>
  openPublicChannelPreview(accountUid: string, request: import('./channel-public-preview').PublicChannelPreviewRequest): Promise<void>
  closePublicChannelPreview(accountUid: string, requestId: string): Promise<void>
  openPublicPreviewChannelFeed(accountUid: string, requestId: string): Promise<void>
  loadPublicPreviewPosts(accountUid: string, requestId: string): Promise<void>
  searchPublicChannels(accountUid: string, request: import('./channel-discovery').ChannelDiscoveryRequest): Promise<void>
  // iOS channel tab: recent posts of the account's channels, the discover rail and categories.
  openChannelHome(accountUid: string): Promise<void>
  checkAppUpdate(): Promise<void>
  installAppUpdate(): Promise<void>
  closeChannelHome(accountUid: string): Promise<void>
  refreshChannelHome(accountUid: string): Promise<void>
  likeChannelHomePost(accountUid: string, channelId: string, postId: string): Promise<void>
  setVisibleChannelStories(accountUid: string, channelIds: string[]): Promise<void>
  channelStoryMedia(accountUid: string, channelId: string, storyId: string): Promise<import('./channel-stories').ChannelStoryMedia>
  markChannelStoryViewed(accountUid: string, channelId: string, storyId: string): Promise<void>
  reactToChannelStory(accountUid: string, channelId: string, storyId: string, emoji: string): Promise<string | null>
  publishChannelStory(accountUid: string, input: import('./channel-stories').ChannelStoryPublish): Promise<void>
  removeChannelStory(accountUid: string, channelId: string, storyId: string): Promise<void>
  openChannelCategory(accountUid: string, category: string): Promise<void>
  closeChannelCategory(accountUid: string): Promise<void>
  closeChannelDiscovery(accountUid: string, requestId: string): Promise<void>
  refreshChannelCreation(accountUid: string): Promise<void>
  prepareChannelCreation(accountUid: string, request: import('./channel-creation').ChannelCreationPrepare): Promise<void>
  channelCreationAction(accountUid: string, action: import('./channel-creation').ChannelCreationAction): Promise<void>
  refreshPostCreation(accountUid: string): Promise<void>
  preparePostCreation(accountUid: string, request: import('./channel-post-creation').PostCreationPrepare, photos?: Uint8Array[]): Promise<void>
  pickChannelPostPhotos(accountUid: string, remaining: number): Promise<Uint8Array[]>
  postCreationAction(accountUid: string, action: import('./channel-post-creation').PostCreationAction): Promise<void>
  refreshCommentCreation(accountUid: string): Promise<void>
  prepareCommentCreation(accountUid: string, request: import('./channel-comment-creation').CommentCreationPrepare): Promise<void>
  commentCreationAction(accountUid: string, action: import('./channel-comment-creation').CommentCreationAction): Promise<void>
  readPostDraft(accountUid: string, target: import('./channel-post-drafts').PostDraftTarget): Promise<import('./channel-post-drafts').PostDraftRecord>
  savePostDraft(accountUid: string, request: import('./channel-post-drafts').PostDraftWrite): Promise<import('./channel-post-drafts').PostDraftRecord>
  selectCommentDraftParent(accountUid: string, request: import('./channel-comment-drafts').CommentDraftParent): Promise<import('./channel-comment-drafts').CommentDraftRecord>
  readCommentDraft(accountUid: string, target: import('./channel-comment-drafts').CommentDraftTarget): Promise<import('./channel-comment-drafts').CommentDraftRecord>
  saveCommentDraft(accountUid: string, request: import('./channel-comment-drafts').CommentDraftWrite): Promise<import('./channel-comment-drafts').CommentDraftRecord>
  openChannelComments(accountUid: string, request: import('./channel-comments').ChannelCommentsRequest): Promise<void>
  closeChannelComments(accountUid: string, selectionId: string): Promise<void>
  openChannelPosts(accountUid: string, request: import('./channel-posts').ChannelPostsRequest): Promise<void>
  openChannelPostMedia(accountUid: string, request: import('./channel-post-media').ChannelPostMediaRequest): Promise<void>
  closeChannelPostMedia(accountUid: string, selectionId: string): Promise<void>
  closeChannelPosts(accountUid: string, requestId: string): Promise<void>
  clearGroupPhoto(accountUid: string, request: GroupPhotoClear): Promise<GroupPhotoResult>
  saveGroupAnnouncement(accountUid: string, request: GroupAnnouncementEdit): Promise<GroupAnnouncementResult>
  forwardTargets(accountUid: string, source: ForwardSource): Promise<ForwardTarget[]>
  forwardText(accountUid: string, request: ForwardRequest): Promise<void>
  forwardBatch(accountUid: string, request: ForwardBatchRequest): Promise<void>
  forwardMedia(accountUid: string, request: ForwardRequest): Promise<void>
  cancelForward(accountUid: string, operationId: string): Promise<boolean>
  authentication: AuthenticationBridge
  appLock: import('./app-lock').AppLockBridge
  snapshot(): Promise<DesktopSnapshot>
  updatePreferences(patch: Partial<Preferences>): Promise<DesktopSnapshot>
  refreshProfile(accountUid: string): Promise<void>
  saveBio(accountUid: string, edit: BioEdit): Promise<BioSaveResult>
  saveProfileName(accountUid: string, edit: ProfileNameEdit): Promise<ProfileNameSaveResult>
  clearProfilePhoto(accountUid: string, edit: ProfilePhotoClear): Promise<ProfilePhotoClearResult>
  pickProfilePhoto(accountUid: string, version: string): Promise<{ id: string; bytes: Uint8Array } | null>
  queueProfilePhoto(accountUid: string, version: string, id: string, bytes: Uint8Array): Promise<void>
  profilePhotoUploadAction(accountUid: string, action: ProfilePhotoUploadAction): Promise<void>
  profilePhotoHistoryAction(accountUid: string, action: ProfilePhotoHistoryAction): Promise<void>
  pickContactPhoto(accountUid: string, binding: ContactPhotoBinding): Promise<{ id: string; bytes: Uint8Array } | null>
  saveContactPhoto(accountUid: string, edit: ContactPhotoEdit, bytes?: Uint8Array): Promise<void>
  contactPhotoStorage(accountUid: string): Promise<ContactPhotoStorage>
  removeStoredContactPhoto(accountUid: string, removal: ContactPhotoRemoval): Promise<void>
  copyProfileId(accountUid: string): Promise<void>
  openContactProfile(accountUid: string, uid: string, requestId: string): Promise<void>
  closeContactProfile(accountUid: string, requestId: string): Promise<void>
  copyContactId(accountUid: string, requestId: string): Promise<void>
  saveContactDetails(accountUid: string, requestId: string, edit: ContactDetailsEdit): Promise<void>
  deleteContact(accountUid: string, requestId: string, operationId: string, version: string): Promise<void>
  undoContactDelete(accountUid: string, operationId: string): Promise<boolean>
  searchContact(accountUid: string, requestId: string, publicId: string): Promise<void>
  addContact(accountUid: string, requestId: string): Promise<void>
  closeContactSearch(accountUid: string, requestId: string): Promise<void>
  startContactChat(accountUid: string, requestId: string): Promise<string>
  discardDirectDraft(accountUid: string, chatId: string): Promise<void>
  thirdPartyNotices(): Promise<string>
  history(accountUid: string, chatId: string, before?: MessagePosition): Promise<HistorySnapshot>
  latestHistory(accountUid: string, chatId: string): Promise<HistorySnapshot>
  closeHistory(accountUid: string, chatId: string): Promise<void>
  searchMessages(accountUid: string, chatId: string, searchId: string, query: string): Promise<SearchSnapshot>
  moreSearch(accountUid: string, chatId: string, searchId: string): Promise<SearchSnapshot>
  sharedMedia(accountUid: string, chatId: string, searchId: string, filter: import('./search').SharedMediaFilter): Promise<SearchSnapshot>
  closeSearch(accountUid: string, chatId: string, searchId: string): Promise<void>
  jumpSearch(accountUid: string, chatId: string, searchId: string, messageId: string): Promise<HistorySnapshot>
  jumpReply(accountUid: string, chatId: string, messageId: string, version: string): Promise<HistorySnapshot>
  jumpDate(accountUid: string, chatId: string, at: number): Promise<HistorySnapshot>
  refreshDialogs(accountUid: string): Promise<void>
  markVisibleRead(accountUid: string, chatId: string, revision: number, messageId: string): Promise<boolean>
  openMedia(accountUid: string, chatId: string, request: MediaRequest): Promise<MediaReady>
  closeMedia(accountUid: string, requestId: string): Promise<void>
  // Telegram's automatic media download: the picture of one photo message, if it can be previewed.
  photoPreview(accountUid: string, chatId: string, request: import('./media').MediaRequest): Promise<string | null>
  photoThumb(accountUid: string, chatId: string, request: import('./media').MediaRequest): Promise<string | null>
  saveMedia(accountUid: string, requestId: string): Promise<boolean>
  pickAttachment(accountUid: string, chatId: string, mode: AttachmentMode): Promise<AttachmentDraft | null>
  dropAttachments(accountUid: string, chatId: string, files: File[], mode: AttachmentDropMode): Promise<AttachmentDraft | null>
  pasteAttachments(accountUid: string, chatId: string, files: File[]): Promise<AttachmentDraft>
  discardAttachment(accountUid: string, id: string): Promise<void>
  replaceAttachmentImage(accountUid: string, chatId: string, id: string, itemId: string, bytes: Uint8Array): Promise<AttachmentDraft>
  editAttachmentVideo(accountUid: string, chatId: string, id: string, itemId: string, edit: { start: number; end: number; preset: import('./photo-quality').VideoSendPreset; overlay?: Uint8Array }): Promise<AttachmentDraft>
  cacheUsage(): Promise<number>
  clearCache(): Promise<'done'>
  sendAttachment(accountUid: string, chatId: string, id: string, caption: string, itemIds: string[], reply?: ReplyBinding | null, video?: import('./uploads').VideoFacts | null): Promise<void>
  messageActions(accountUid: string, chatId: string): Promise<MessageActionsSnapshot>
  mutateMessage(accountUid: string, chatId: string, request: MessageActionRequest): Promise<void>
  checkMessageAction(accountUid: string, chatId: string, operationId: string): Promise<void>
  dismissMessageAction(accountUid: string, chatId: string, operationId: string): Promise<void>
  draft(accountUid: string, chatId: string): Promise<string>
  saveDraft(accountUid: string, chatId: string, text: string): Promise<void>
  replyDraft(accountUid: string, chatId: string): Promise<ReplyDraftSnapshot>
  selectReply(accountUid: string, chatId: string, messageId: string, version: string): Promise<void>
  cancelReply(accountUid: string, chatId: string, selectionId: string): Promise<void>
  translationGate(accountUid: string, chatId: string, messageId: string): Promise<boolean>
  translateMessage(accountUid: string, chatId: string, messageId: string): Promise<import('./translation').TranslationResult>
  pinMessage(accountUid: string, request: import('./pinned-messages').PinMessageRequest): Promise<'done'>
  jumpPinned(accountUid: string, chatId: string, messageId: string): Promise<HistorySnapshot>
  openTranslationSettings(): Promise<void>
  openMessageLink(url: string): Promise<void>
  openSupportChat(accountUid: string): Promise<string>
  openPostLikers(accountUid: string, request: import('./post-likers').PostLikersRequest): Promise<'done'>
  addSticker(accountUid: string, bytes: Uint8Array): Promise<string>
  stickerCutout(accountUid: string, bytes: Uint8Array): Promise<Uint8Array>
  // The square of a GIF or MP4 sticker, cut by the Mac media helper; null where the helper is not available.
  stickerCropAnimated(accountUid: string, bytes: Uint8Array, kind: 'gif' | 'mp4', square: { x: number; y: number; size: number }): Promise<Uint8Array | null>
  transcribeVoice(accountUid: string, bytes: Uint8Array): Promise<import('./transcript').TranscriptResult>
  removeSticker(accountUid: string, id: string): Promise<'done'>
  sendSticker(accountUid: string, chatId: string, id: string, stickerId: string, reply: import('./reply-draft').ReplyBinding | null): Promise<void>
  // Telegram StickerPackScreen (iOS MorseStickerPackSheet): the set a tapped sticker belongs to, install/remove,
  // and sending one of its stickers into the chat the sheet was opened from.
  openStickerPack(accountUid: string, chatId: string, messageId: string, version: string): Promise<void>
  closeStickerPack(accountUid: string): Promise<void>
  installStickerPack(accountUid: string, setId: string): Promise<void>
  uninstallStickerPack(accountUid: string, setId: string): Promise<void>
  ownedStickerPacks(accountUid: string): Promise<import('./sticker-packs').StickerPack[]>
  createStickerPack(accountUid: string, title: string): Promise<import('./sticker-packs').StickerPack>
  addStickerToPack(accountUid: string, setId: string, bytes: Uint8Array): Promise<import('./sticker-packs').StickerPack>
  sendPackSticker(accountUid: string, chatId: string, id: string, setId: string, itemId: string, reply: import('./reply-draft').ReplyBinding | null): Promise<void>
  closePostLikers(accountUid: string, requestId: string): Promise<void>
  reportTyping(uid: string, chatId: string, typing: boolean): Promise<void>
  sendText(accountUid: string, chatId: string, text: string, operationId: string, reply?: ReplyBinding | null, silent?: boolean): Promise<void>
  sendDeferred(accountUid: string, request: import('./deferred-send').DeferredSendRequest): Promise<'done'>
  scheduleEventReminder(accountUid: string, request: import('./chat-event').EventReminderRequest): Promise<'done'>
  cancelDeferred(accountUid: string, chatId: string, kind: import('./deferred-send').DeferredKind, messageId: string): Promise<'done'>
  retryMessage(accountUid: string, chatId: string, messageId: string): Promise<void>
  outgoing(accountUid: string, chatId: string): Promise<OutgoingSnapshot>
  discardOutgoing(accountUid: string, chatId: string, messageId: string): Promise<void>
  completeClose(requestId: string, success: boolean): Promise<void>
  onEvent(listener: (event: DesktopEvent) => void): () => void
}

export function comparePosition(a: MessagePosition, b: MessagePosition): number {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
export function positionAt(milliseconds: number, id: string): MessagePosition {
  const seconds = Math.floor(milliseconds / 1000)
  return { seconds, nanoseconds: Math.round((milliseconds - seconds * 1000) * 1_000_000), id }
}
export function positionMilliseconds(position: MessagePosition): number {
  return position.seconds * 1000 + position.nanoseconds / 1_000_000
}
