import { AccountToolsApi } from '../api/account-tools'
import { VoiceDraftStorage } from './voice-draft-storage'
import { StoryReplyDraft } from './story-reply-draft'
import { StoryViewReceipt } from './story-view-receipt'
import { StoryReactionChange } from './story-reaction-change'
import { ContactStoryReaction } from './contact-story-reaction'
import { ContactStoryPhotoAudio } from './contact-story-photo-audio'
import { ContactAudienceStoryVideo } from './contact-audience-story-video'
import { ContactAudienceStoryPhoto } from './contact-audience-story-photo'
import { ContactAudienceStories } from './contact-audience-stories'
import { ContactStoryAudience } from './contact-story-audience'
import { ContactPublicStoryVideo } from './contact-public-story-video'
import { ContactPublicStoryPhoto } from './contact-public-story-photo'
import { ContactPublicStories } from './contact-public-stories'
import { StoryVideoUpload } from './story-video-upload'
import { StoryPublication } from './story-publication'
import type { StoryComposerPhotoTarget, StoryComposerPhotoWrite, StoryComposerPhotoReference, StoryComposerPhotoRecord } from '../../shared/story-composer-photo'
import type { BackgroundPhotoOwner } from '../platform/background-photos'
import type { StoryComposerDraftRecord, StoryComposerDraftRow, StoryComposerDraftTarget, StoryComposerDraftWrite } from '../../shared/story-composer-drafts'
import { StoryViewRecords } from './story-view-records'
import { StoryHiddenChange } from './story-hidden-change'
import { StoryHiddenAudience } from './story-hidden-audience'
import { StoryPrivacyMove } from './story-privacy-move'
import { StoryRemoval } from './story-removal'
import { StoryCaptionSave } from './story-caption-save'
import type { StoryCaptionDraftStart, StoryCaptionDraftTarget, StoryCaptionDraftRecord, StoryCaptionDraftRow, StoryCaptionDraftWrite } from '../../shared/story-caption-drafts'
import { OwnStories } from './own-stories'
import { NoteRemoval } from './space-note-removal'
import { NoteTextSave } from './space-note-text-save'
import { NoteEditComparison } from './space-note-edit-comparison'
import { randomUUID } from 'node:crypto'
import type { NoteEditDraftStart, NoteEditDraftTarget, NoteEditDraftRecord, NoteEditDraftRow, NoteEditDraftWrite } from '../../shared/space-note-edit-drafts'
import { NoteCreation } from './space-note-creation'
import type { NoteDraftRecord, NoteDraftRow, NoteDraftTarget, NoteDraftWrite } from '../../shared/space-note-drafts'
import { SpaceNotesReader } from './space-notes'
import { ChannelPublicPreview } from './channel-public-preview'
import { ChannelDiscovery } from './channel-discovery'
import { ChannelHome } from './channel-home'
import { ChannelCreation } from './channel-creation'
import { ChannelPostCreation } from './channel-post-creation'
import { ChannelCommentCreation } from './channel-comment-creation'
import type { PostDraftRecord, PostDraftTarget, PostDraftWrite } from '../../shared/channel-post-drafts'
import type { CommentDraftParent, CommentDraftRecord, CommentDraftTarget, CommentDraftWrite } from '../../shared/channel-comment-drafts'
import { ChannelDiscussionJoin } from './channel-discussion-join'
import type { DiscussionLeaveWork, DiscussionLeaveWorkClear, DiscussionLeaveWorkDismiss } from '../../shared/channel-discussion-leave-work'
import type { GroupLeaveRequest } from '../../shared/group-leave'
import { identifier } from '../../shared/validation'
import { ChannelDiscussionHistory } from './channel-discussion-history'
import type { ChannelDiscussionNavigation, ChannelDiscussionDestination } from '../../shared/channel-discussion-navigation'
import { ChannelJoinDecisions } from './channel-join-decisions'
import { ChannelAccessEditor } from './channel-access-edit'
import { ChannelPhotoUpload } from './channel-photo-upload'
import type { ChannelPhotoBinding } from '../../shared/channel-photo-upload'
import type { AccountProfile, ConnectionState, DialogSummary, HistorySnapshot, MessagePosition, ReadStatus } from '../../shared/model'
import { comparePosition, positionMilliseconds } from '../../shared/model'
import type { ChatBackgroundEdit, ChatBackgroundRecord } from '../../shared/chat-background'
import { BackgroundStorage } from './background-storage'
import { GroupPhoto } from './group-photo'
import { DialogAvatars } from './dialog-avatars'
import { GroupPhotoUpload } from './group-photo-upload'
import type { GroupPhotoBinding } from '../../shared/group-photo-upload'
import { GroupPhotoEditor } from './group-photo-editor'
import type { GroupPhotoRequest, GroupPhotoClear, GroupPhotoResult } from '../../shared/group-photo'
import { GroupApi } from '../api/groups'
import { CloseFriendsApi } from '../api/close-friends'
import { ChannelMembershipApi } from '../api/channel-membership'
import { StoryBarApi } from '../api/story-bar'
import type { GroupCreateRequest } from '../../shared/group-create'
import type { GroupMembersRequest } from '../../shared/group-members'
import type { GroupRemovalRequest } from '../../shared/group-removal'
import { GroupNameEditor } from './group-name'
import type { GroupNameEdit, GroupNameResult } from '../../shared/group-name'
import { GroupAnnouncementEditor } from './group-announcement'
import type { GroupAnnouncementEdit, GroupAnnouncementResult } from '../../shared/group-announcement'
import type { TextForwardBatchRequest } from '../../shared/forward-text-batch'
import type { ForwardBatchRequest } from '../../shared/forward-batch'
import { prepareForwardBatch } from '../media/forward-batch'
import type { ParticipantAddRequest, ParticipantAddResult, ParticipantContactRequest, ParticipantsSnapshot } from '../../shared/participants'
import { participantSnapshot } from './participants'
import { ParticipantContactAdd, type ChatContactTarget } from './participant-contact-add'
import { DialogPins } from './dialog-pins'
import type { DialogPinRequest } from '../../shared/dialog-pins'
import { ManualUnread } from './manual-unread'
import { effectiveUnreadCount, type ManualUnreadRequest } from '../../shared/manual-unread'
import type { ContactCreateFields } from '../network/participant-contact-write'
import { FirestoreReader } from '../network/firestore-rpc'
import { boolField, childId, decodeDialog, historyReadable, documents, documentVersion, mapField, numberField, stringField, ReadFailure, type FirestoreDocument, type ReadDialog, type WireObject } from '../network/firestore-values'
import { HistoryReader } from './history-reader'
import { OutboxPump, type AccountAuthorization } from '../messaging/outbox'
import type { OutgoingSnapshot } from '../../shared/delivery'
import { ReadSync } from '../messaging/read-sync'
import { canApplyAction, MessageActions } from '../messaging/message-actions'
import type { MessageActionRequest, MessageActionsSnapshot } from '../../shared/message-actions'
import type { MediaRequest } from '../../shared/media'
import { MediaSession } from '../media/media-session'
import type { AttachmentMode, AttachmentDropMode } from '../../shared/uploads'
import { AccountNotifications, type NotificationHost } from '../messaging/notifications'
import { ChannelInquiries } from './channel-inquiries'
import type { NotificationHint } from '../../shared/notifications'
import { MessageSearch } from './message-search'
import type { SearchSnapshot, SharedMediaFilter } from '../../shared/search'
import { SelfProfileSession } from './self-profile'
import { ContactsSession } from './contacts'
import { ChannelsSession, channelDocumentType } from './channels'
import { ContactDiscovery } from './contact-discovery'
import { ReplyDraft } from './reply-draft'
import { AccountPresence } from './presence'
import { ChannelPeoplePhotos } from './channel-people-photos'
import { PinnedMessages } from './pinned-messages'
import { DeferredMessages, deferredCollections, deferredFields } from './deferred-messages'
import { ChatTyping, DialogTyping, type ListTypingEntry, type TypingSnapshot } from './chat-typing'
import { ChannelPostNotices } from './channel-post-notices'
import { callMorseFunction } from '../network/morse-callable'
// MorseAppConfig MorseOfficialSupport.uid: the customer support account every app opens a chat with.
const morseSupportUid = 'RAk6jfkPEXhydeuUxG9U36UQP9m1'
import { InquiryRows } from './inquiry-rows'
import { ChatFolderWatch } from './chat-folder-watch'
import { DialogPreferenceWatch } from './dialog-preference-watch'
import { ChannelStories } from './channel-stories'
import { DiscussionAvatars } from './discussion-avatars'
import { PhotoPreviews } from '../media/photo-previews'
import { HiddenChats, emptyRevokedDirect, withLocalDeletion } from './hidden-chats'
import { HiddenMessages } from './hidden-messages'
import { ChatFlags } from './chat-flags'
import { StickerPacks } from './sticker-packs'
import { downloadMedia } from '../media/download-media'
import { ContactFlags } from './contact-flags'
import type { PostLiker, PostLikersRequest, PostLikersSnapshot } from '../../shared/post-likers'
import { maxStickerBytes, stickerContentType, type StickerItem, type StickerKind } from '../../shared/stickers'
import type { ContactFlagCommand } from '../storage/contact-flag-table'
import { generalCategoryId, type ForumCategory } from '../../shared/forum'
import { deleteTopicMessages, TopicDeletions, TopicDeletionStop } from './forum-topic-deletion'
import type { ChatFlagCommand } from '../storage/chat-flag-table'
import { maxHiddenMessagesPerCall, type HiddenMessageCommand } from '../storage/hidden-message-table'
import { roundVideoSide, type RoundVideoSendRequest } from '../../shared/round-video'
import { channelDiscussionReference } from './channel-discussion-reference'
import type { HiddenChatCommand } from '../storage/hidden-chat-table'
import { recordDeferredStep } from '../platform/deferred-diagnostics'
import { EventReminders } from './event-reminders'
import type { EventReminderRequest } from '../../shared/chat-event'
import { maxScheduleAheadMs, type DeferredKind, type DeferredMessagesSnapshot, type DeferredSendRequest } from '../../shared/deferred-send'
import { freePinLimit, premiumPinLimit, type PinMessageRequest, type PinnedMessagesSnapshot } from '../../shared/pinned-messages'
import { canReply, type ReplyBinding, type ReplyDraftSnapshot } from '../../shared/reply-draft'
import { canForwardMessage, canForwardMedia, canForwardText, type ForwardProgress, type ForwardRequest, type ForwardSource, type ForwardTarget } from '../../shared/forward'
import { prepareForwardMedia, type ForwardMediaSource } from '../media/forward-media'
import { inquiryOfQueueChatId, inquiryQueueChatId, type InquiryForwardRequest, type InquiryForwardRoom } from '../../shared/channel-inquiries'
import { outgoingText } from '../../shared/validation'
import { tr } from '../../shared/i18n'
import type { VideoEdit } from '../media/attachment-staging'
import { registerUserpicCache, UserpicCache } from './userpic-cache'
import { MediaCache, registerMediaCache } from './media-cache'
import { InquiryNotifications } from './inquiry-notifications'
import { PeerPhotoAlbum } from './peer-photo-album'
import { peerProfilesFor } from './peer-profiles'

export interface AccountEvents {
  storyStealth(): boolean
  canRead(): boolean
  // The banner host, plus the way a 1:1 inquiry room is opened from one (a chat opens by its id).
  notifications: Omit<NotificationHost, 'foreground'> & { openInquiry(channelId: string, inquiryId: string): void }
  changed(): void
  history(chatId: string, snapshot: HistorySnapshot): void
  search(chatId: string, snapshot: SearchSnapshot): void
  outgoing(chatId: string, snapshot: OutgoingSnapshot): void
  reply(chatId: string, snapshot: ReplyDraftSnapshot): void
  actions(chatId: string, snapshot: MessageActionsSnapshot): void
  mediaProgress(requestId: string, loaded: number, total: number | null): void
  forwardProgress(progress: ForwardProgress): void
}

// Authentication alone owns Socket.IO registration. Server history remains
// separate from the durable local send-intent ledger.
export class AccountSession {
  private reader: FirestoreReader | null = null
  private generation = 0
  private revision = 0
  private closed = false
  private connection: ConnectionState = 'offline'
  private status: ReadStatus = 'loading'
  private message = ''
  private chatRows = new Map<string, FirestoreDocument>()
  private pinRows = new Map<string, FirestoreDocument>()
  private chatsCurrent = false
  private pinsCurrent = false
  private index = new Map<string, ReadDialog>()
  private list: DialogSummary[] = []
  // A dialog that is open without being in the list. Telegram keeps a History per peer whether or not it is in the
  // chat list (tdesktop Data::Session::history(peer), History::inChatList), so a chat deleted here, or one with no
  // message left, still opens from the contact as an empty chat and returns to the list with its next message.
  private unlistedOpen: string | null = null
  private selected: HistoryReader | null = null
  private search: MessageSearch | null = null
  private readonly delivery: OutboxPump
  readonly voiceDraftStorage:VoiceDraftStorage
  readonly backgroundStorage: BackgroundStorage
  readonly contactPublicStoryVideo: ContactPublicStoryVideo
  readonly contactPublicStoryPhoto: ContactPublicStoryPhoto
  readonly contactStoryReaction: ContactStoryReaction
  readonly contactStoryPhotoAudio: ContactStoryPhotoAudio
  readonly contactAudienceStoryVideo: ContactAudienceStoryVideo
  readonly contactAudienceStoryPhoto: ContactAudienceStoryPhoto
  readonly contactAudienceStories: ContactAudienceStories
  readonly contactStoryAudience: ContactStoryAudience
  readonly contactPublicStories: ContactPublicStories
  readonly storyViewRecords: StoryViewRecords
  readonly storyHiddenAudience: StoryHiddenAudience
  readonly noteEditComparison: NoteEditComparison
  readonly storyPublication: StoryPublication
  readonly storyVideoUpload: StoryVideoUpload
  readonly storyReplyDraft: StoryReplyDraft
  readonly presence: AccountPresence
  readonly channelPeople: ChannelPeoplePhotos
  readonly userpics: UserpicCache
  readonly mediaFiles: MediaCache
  // A room's new message shows the banner a chat's message shows; this window has no push of its own.
  private readonly inquiryNotifications: InquiryNotifications
  // The profile pictures this device has seen of each person, and the one the viewer is showing now.
  readonly peerPhotos: PeerPhotoAlbum
  private readonly pins: PinnedMessages
  private readonly deferred: DeferredMessages
  private readonly typing: ChatTyping
  private readonly listTyping: DialogTyping
  private eventReminders: EventReminders | null = null
  readonly storyViewReceipt: StoryViewReceipt
  readonly storyReactionChange: StoryReactionChange
  readonly storyHiddenChange: StoryHiddenChange
  readonly storyPrivacyMove: StoryPrivacyMove
  readonly storyRemoval: StoryRemoval
  readonly noteRemoval: NoteRemoval
  readonly storyCaptionSave: StoryCaptionSave
  readonly noteTextSave: NoteTextSave
  readonly noteCreation: NoteCreation
  readonly channelCreation: ChannelCreation
  readonly postCreation: ChannelPostCreation
  readonly commentCreation: ChannelCommentCreation
  readonly discussionJoin: ChannelDiscussionJoin
  readonly groups: GroupApi
  readonly closeFriendsApi: CloseFriendsApi
  readonly channelMembershipApi: ChannelMembershipApi
  readonly storyBarApi: StoryBarApi
  readonly accountTools: AccountToolsApi
  // "나에게만 삭제": the moment each room was deleted on this device (hidden_chats).
  private readonly hiddenChats: HiddenChats
  private readonly hiddenMessages: HiddenMessages
  private readonly chatFlags: ChatFlags
  private readonly contactFlags: ContactFlags
  private stickerList: { id: string; kind: StickerKind; size: number }[] | null = null
  private stickerLoad: Promise<void> | null = null
  private readonly stickerPacks: StickerPacks
  private likers: (Omit<PostLikersSnapshot, 'items'> & { items: (Omit<PostLiker, 'photo'> & { photoURL: string | null })[] }) | null = null
  // markMorseReactionSeen acknowledgements sent (chatId -> messageId:reactionVersion), hidden from the list at once.
  private readonly seenReactions = new Map<string, string>()
  private readonly topicDeletions: TopicDeletions
  readonly channelInquiries: ChannelInquiries
  // The chat list's 1:1 inquiry rooms, watched for the whole session.
  readonly inquiryRows: InquiryRows
  // The account's chat folders, followed for the whole session.
  private readonly folders: ChatFolderWatch
  private readonly dialogPreferences: DialogPreferenceWatch
  // A channel discussion row's picture, read from the channel itself.
  readonly discussionAvatars: DiscussionAvatars
  // Telegram's automatic media download: the pictures of the photo messages on screen.
  readonly photoPreviews: PhotoPreviews
  private readonly draftReply: ReplyDraft
  private readonly reads: ReadSync
  private readonly actions: MessageActions
  private readonly notifications: AccountNotifications
  private readonly channelPosts: ChannelPostNotices
  readonly media: MediaSession
  readonly selfProfile: SelfProfileSession
  readonly contacts: ContactsSession
  private readonly discussionHistory: ChannelDiscussionHistory
  readonly channels: ChannelsSession
  readonly channelPublicPreview: ChannelPublicPreview
  readonly ownStories: OwnStories
  readonly spaceNotes: SpaceNotesReader
  readonly channelDiscovery: ChannelDiscovery
  readonly channelHome: ChannelHome
  readonly channelStories: ChannelStories
  readonly contactDiscovery: ContactDiscovery
  private readonly participantAdd: ParticipantContactAdd
  private readonly groupName: GroupNameEditor
  readonly channelJoinDecisions: ChannelJoinDecisions
  readonly channelAccess: ChannelAccessEditor
  readonly channelPhotoUpload: ChannelPhotoUpload
  readonly groupPhotoUpload: GroupPhotoUpload
  private readonly groupPhoto: GroupPhoto
  readonly dialogAvatars: DialogAvatars
  private readonly groupPhotoEditor: GroupPhotoEditor
  private readonly groupAnnouncement: GroupAnnouncementEditor
  readonly dialogPins: DialogPins
  readonly manualUnread: ManualUnread
  private locked = false
  private forwardPreparation: { request: ForwardRequest | ForwardBatchRequest; validate(): void; abort: AbortController; committing: boolean; task: Promise<void> | null } | null = null
  // A forward into rooms, which is sent rather than queued: one at a time, as the queued ones are.
  private inquiryForward: Promise<void> | null = null
  private participantSelection: { chatId: string; requestId: string } | null = null

  constructor(readonly profile: AccountProfile, private readonly credentials: AccountAuthorization, private readonly events: AccountEvents,
    directory: string, previousClose: Promise<void>) {
    // Every picture loader of this account reaches the account's cache file through its credentials.
    this.userpics = new UserpicCache(command => this.delivery.userpicState(command))
    registerUserpicCache(credentials, this.userpics)
    this.peerPhotos = new PeerPhotoAlbum(credentials, command => this.delivery.peerPhotoState(command), () => { if (!this.closed) events.changed() })
    // Every media loader of this account reaches the account's file cache the same way.
    this.mediaFiles = new MediaCache(command => this.delivery.mediaCacheState(command))
    registerMediaCache(credentials, this.mediaFiles)
    this.topicDeletions = new TopicDeletions((chatId, categoryId, stop) => this.deleteTopic(chatId, categoryId, stop),
      () => !this.closed && !this.locked && this.connection === 'ready' && Boolean(this.reader),
      () => { if (this.closed) return; if (this.chatsCurrent && this.pinsCurrent) this.rebuild(); else this.events.changed() })
    this.discussionHistory = new ChannelDiscussionHistory(profile.uid, credentials.signal, () => { if (!this.closed && this.chatsCurrent && this.pinsCurrent) this.rebuild() })
    this.selfProfile = new SelfProfileSession(profile.uid, credentials, () => { if (!this.closed) events.changed() }, (command, validate) => this.delivery.profilePhotoState(command, validate),
      (peer, raw) => this.peerPhotos.remember(peer, raw))
    this.contacts = new ContactsSession(profile.uid, credentials, () => { if (!this.closed) { this.dialogAvatars?.prune(); this.contactPublicStories?.prune(); this.contactStoryAudience?.prune(); this.contactAudienceStories?.prune(); this.contactAudienceStoryPhoto?.prune(); this.contactAudienceStoryVideo?.prune(); this.contactStoryPhotoAudio?.prune(); this.contactStoryReaction?.prune(); this.storyReactionChange?.prune(); this.storyViewReceipt?.prune(); this.contactPublicStoryPhoto?.prune(); this.contactPublicStoryVideo?.prune(); events.changed() } }, (command, validate) => this.delivery.contactState(command, validate), (peer, raw) => this.peerPhotos.remember(peer, raw))
    this.channels = new ChannelsSession(profile.uid, credentials, () => { this.channelJoinDecisions?.prune(); this.channelAccess?.prune(); this.channelPhotoUpload?.prune(); this.channelHome?.listChanged(); if (!this.closed) events.changed() })
    this.ownStories = new OwnStories(profile.uid, credentials, () => !this.closed && !this.locked && this.connection === 'ready', () => { if (!this.closed) events.changed() })
    this.spaceNotes = new SpaceNotesReader(profile.uid, credentials, () => !this.closed && !this.locked && this.connection === 'ready', () => { if (!this.closed) events.changed() })
    this.channelDiscovery = new ChannelDiscovery(credentials, () => !this.closed && !this.locked && this.connection === 'ready', () => { if (!this.closed) events.changed() })
    this.channelHome = new ChannelHome(profile.uid, credentials, { items: () => this.channels.snapshot.items, status: () => this.channels.listStatus, document: id => this.channels.currentDocument(id) },
      () => !this.closed && !this.locked && this.connection === 'ready', () => { if (!this.closed) events.changed() })
    this.channelStories = new ChannelStories(profile.uid, credentials, () => !this.closed && !this.locked && this.connection === 'ready', () => { if (!this.closed) events.changed() })
    this.channelPublicPreview = new ChannelPublicPreview(profile.uid, credentials, () => !this.closed && !this.locked && this.connection === 'ready', request => this.channelDiscovery.selection(request), () => { if (!this.closed) events.changed() })
    this.contactDiscovery = new ContactDiscovery(profile.uid, credentials, () => !this.closed && !this.locked && this.connection === 'ready',
      () => { if (!this.closed) events.changed() }, () => this.contacts.refresh())
    this.participantAdd = new ParticipantContactAdd(profile.uid, credentials, (target, doc) => this.resolveChatContact(target, doc), () => this.contacts.refresh())
    this.groupName = new GroupNameEditor(credentials, (request, exact) => this.groupNameSource(request, exact))
    this.groupPhoto = new GroupPhoto(profile.uid, credentials, (request, exact) => this.groupPhotoSource(request, exact), () => { if (!this.closed) events.changed() })
    this.presence = new AccountPresence(profile.uid, credentials, () => { if (!this.closed) events.changed() })
    this.channelPeople = new ChannelPeoplePhotos(credentials, () => { if (!this.closed) events.changed() })
    this.pins = new PinnedMessages(credentials.signal, command => this.delivery.bookmarkState(command), () => { if (!this.closed) events.changed() })
    this.deferred = new DeferredMessages(profile.uid, credentials.signal, () => { if (!this.closed) events.changed() })
    this.typing = new ChatTyping(profile.uid, credentials.signal, () => { if (!this.closed) events.changed() })
    this.listTyping = new DialogTyping(profile.uid, credentials.signal, () => { if (!this.closed) events.changed() })
    this.dialogAvatars = new DialogAvatars(profile.uid, credentials, chatId => this.dialogAvatarSource(chatId), () => { if (!this.closed) events.changed() },
      chatId => this.directAvatarSource(chatId), async (raw, request) => {
        const url = new URL(raw), prefix = '/__contact-personal/'
        if (url.protocol !== 'morse:' || url.hostname !== 'app' || !url.pathname.startsWith(prefix) || url.search || url.hash || url.port || url.username || url.password) return new Response(null, { status: 403 })
        return this.contacts.personalPhotos.response(url.pathname.slice(prefix.length), request)
      })
    this.groupPhotoEditor = new GroupPhotoEditor(credentials, (request, exact) => this.groupPhotoSource(request, exact, true))
    this.groupAnnouncement = new GroupAnnouncementEditor(credentials, (request, exact) => this.groupAnnouncementSource(request, exact))
    this.dialogPins = new DialogPins(profile.uid, credentials, (request, exact) => this.pinSource(request, exact), () => { if (!this.closed) events.changed() })
    const newChatAutoDelete = (): { seconds: number; myOnly: boolean } => {
      const preferences = events.notifications.preferences()
      return { seconds: preferences.autoDeleteDefaultSeconds, myOnly: preferences.autoDeleteOnlyMyMessages }
    }
    this.delivery = new OutboxPump(profile.uid, directory, credentials, previousClose,
      () => ({ ready: this.status === 'ready' && !this.closed, reader: this.reader,
        dialogs: new Map([...this.index].map(([id, value]) => [id, value.summary])) }),
      (chatId, snapshot) => { if (!this.closed) events.outgoing(chatId, snapshot) }, () => { if (!this.closed) events.changed() }, newChatAutoDelete)
    void this.userpics.load().then(() => { if (!this.closed) { this.dialogAvatars.prune(); this.contacts.listAvatars.prune(); events.changed() } })
    this.draftReply = new ReplyDraft(credentials.signal, command => this.delivery.replyState(command),
      (chatId, snapshot) => { if (!this.closed) events.reply(chatId, snapshot) })
    this.voiceDraftStorage=new VoiceDraftStorage((command,validate)=>this.delivery.voiceDraftStorageState(command,validate),()=>{
      const generation=this.generation
      const validate=():void=>{if(this.closed || this.locked || this.credentials.signal.aborted || this.connection!=='ready' || this.status!=='ready' || generation!==this.generation)throw new Error(tr('계정 연결과 대화 목록을 확인해 주세요.'))}
      validate();return{validate,title:chatId=>{validate();const dialog=this.index.get(chatId)?.summary;return dialog && dialog.kind!=='secret' && dialog.participantUids.includes(this.profile.uid)?dialog.title:null}}
    })
    this.backgroundStorage = new BackgroundStorage((command, validate) => this.delivery.backgroundState(command, validate), () => {
      const generation = this.generation
      const validate = (): void => {
        if (this.closed || this.locked || this.credentials.signal.aborted || this.connection !== 'ready' || this.status !== 'ready' || generation !== this.generation) throw new Error(tr('계정 연결과 대화 목록을 확인해 주세요.'))
      }
      validate()
      return { validate, title: chatId => {
        validate()
        const dialog = this.index.get(chatId)?.summary
        return dialog && dialog.kind !== 'secret' && dialog.participantUids.includes(this.profile.uid) ? dialog.title : null
      } }
    })
    this.channelJoinDecisions = new ChannelJoinDecisions(profile.uid, credentials, () => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('계정 연결과 화면 잠금을 확인해 주세요.'))
    }, request => this.channels.joinDecisionSource(request), channelId => { this.channels.uploadSource(channelId) }, (command, validate) => this.delivery.channelJoinDecisionState(command, validate), () => { if (!this.closed) events.changed() })
    this.channelAccess = new ChannelAccessEditor(profile.uid, credentials, () => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('계정 연결과 화면 잠금을 확인해 주세요.'))
    }, (channelId, version) => this.channels.uploadSource(channelId, version), (command, validate) => this.delivery.channelAccessState(command, validate), () => { if (!this.closed) events.changed() })
    this.channelPhotoUpload = new ChannelPhotoUpload(profile.uid, credentials, () => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('계정 연결과 화면 잠금을 확인해 주세요.'))
    }, (channelId, version) => this.channels.uploadSource(channelId, version), (command, validate) => this.delivery.channelPhotoUploadState(command, validate), () => { if (!this.closed) events.changed() })
    this.groupPhotoUpload = new GroupPhotoUpload(profile.uid, credentials, () => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('계정 연결과 화면 잠금을 확인해 주세요.'))
    }, (chatId, version) => this.groupPhotoUploadSource(chatId, version), (command, validate) => this.delivery.groupPhotoUploadState(command, validate), () => { if (!this.closed) events.changed() })
    this.contactStoryAudience = new ContactStoryAudience(profile.uid, credentials, request => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      return this.contacts.directPeer(request.profileRequestId).uid
    }, () => { if (!this.closed) { this.contactAudienceStories?.prune(); this.contactAudienceStoryPhoto?.prune(); this.contactAudienceStoryVideo?.prune(); this.contactStoryPhotoAudio?.prune(); this.contactStoryReaction?.prune(); this.storyReactionChange?.prune(); this.storyViewReceipt?.prune(); events.changed() } })
    this.contactAudienceStories = new ContactAudienceStories(profile.uid, credentials, request => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      const current = this.contactStoryAudience.storySource(request.audienceId, request.profileRequestId, request.privacy), peer = this.contacts.directPeer(request.profileRequestId)
      if (current.uid !== peer.uid) throw new Error(tr('현재 청중과 연락처가 변경되었습니다.'))
      return { ...peer, expiresAt: current.expiresAt }
    })
    this.contactAudienceStoryVideo = new ContactAudienceStoryVideo(profile.uid, credentials, request => this.contactAudienceStories.videoSource(request), request => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      return this.contactStoryAudience.storySource(request.audienceId, request.profileRequestId, request.privacy).uid
    }, () => { if (!this.closed) events.changed() })
    this.contactAudienceStoryPhoto = new ContactAudienceStoryPhoto(profile.uid, credentials, request => this.contactAudienceStories.photoSource(request), request => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      return this.contactStoryAudience.storySource(request.audienceId, request.profileRequestId, request.privacy).uid
    }, () => { if (!this.closed) events.changed() })
    this.contactPublicStories = new ContactPublicStories(profile.uid, credentials, request => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      return this.contacts.directPeer(request.profileRequestId)
    })
    this.contactPublicStoryPhoto = new ContactPublicStoryPhoto(profile.uid, credentials, request => this.contactPublicStories.photoSource(request), profileRequestId => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      return this.contacts.directPeer(profileRequestId).uid
    }, () => { if (!this.closed) events.changed() })
    this.contactPublicStoryVideo = new ContactPublicStoryVideo(profile.uid, credentials, request => this.contactPublicStories.videoSource(request), profileRequestId => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      return this.contacts.directPeer(profileRequestId).uid
    }, () => { if (!this.closed) events.changed() })
    this.contactStoryPhotoAudio = new ContactStoryPhotoAudio(profile.uid, credentials, request => {
      const photo = { selectionId: request.selectionId, profileRequestId: request.profileRequestId, requestId: request.requestId, storyId: request.storyId, version: request.version, presentation: 'image' as const }
      return request.privacy === 'everyone' ? this.contactPublicStories.photoSource(photo) : this.contactAudienceStories.photoSource({ ...photo, privacy: request.privacy, audienceId: request.audienceId! })
    }, request => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
      return request.privacy === 'everyone' ? this.contacts.directPeer(request.profileRequestId).uid : this.contactStoryAudience.storySource(request.audienceId!, request.profileRequestId, request.privacy).uid
    }, () => { if (!this.closed) events.changed() })
    this.contactStoryReaction = new ContactStoryReaction(profile.uid, credentials, request => request.privacy === 'everyone' ? this.contactPublicStories.reactionSource(request) : this.contactAudienceStories.reactionSource(request))
    this.storyReplyDraft = new StoryReplyDraft(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, request => {
      const source = request.privacy === 'everyone' ? this.contactPublicStories.reactionSource(request) : this.contactAudienceStories.reactionSource(request)
      const peer = this.contacts.directPeer(request.profileRequestId)
      if (peer.uid !== source.ownerId) throw new Error(tr('현재 스토리 작성자가 변경되었습니다.'))
      return { ownerId: source.ownerId, ownerName: peer.displayName }
    }, pending => { if (!this.contacts.ready || !this.contacts.has(pending.ownerId)) throw new Error(tr('현재 연락처를 확인해 주세요.')) },
    (id, validate) => this.delivery.storyReplySendKnown(id, validate), (pending, validate) => this.delivery.enqueueStoryReply(pending, validate),
    (pending, validate) => this.delivery.detachStoryReply(pending, validate),
    (command, validate) => this.delivery.storyReplyDraftState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyReplyDraft.refresh()).catch(() => {})
    this.storyViewReceipt = new StoryViewReceipt(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 연결과 스토리 숨김 열람 설정을 확인해 주세요.'))
    }, request => {
      if (events.storyStealth()) throw new Error(tr('이 기기의 숨김 열람 설정이 켜져 있습니다.'))
      const source = request.privacy === 'everyone' ? this.contactPublicStories.reactionSource(request) : this.contactAudienceStories.reactionSource(request)
      const peer = this.contacts.directPeer(request.profileRequestId)
      if (peer.uid !== source.ownerId) throw new Error(tr('현재 스토리 작성자가 변경되었습니다.'))
      return { ownerId: source.ownerId, ownerName: peer.displayName }
    }, request => {
      if (!this.contacts.has(request.ownerId)) throw new Error(tr('현재 연락처를 다시 확인해 주세요.'))
    }, request => {
      if (events.storyStealth()) throw new Error(tr('이 기기의 숨김 열람 설정이 켜져 있습니다.'))
      if (!this.contacts.has(request.ownerId)) throw new Error(tr('현재 연락처를 다시 확인해 주세요.'))
    }, () => {
      this.contactStoryPhotoAudio.pause(); this.contactPublicStoryPhoto.pause(); this.contactPublicStoryVideo.pause(); 
      this.contactAudienceStoryPhoto.pause(); this.contactAudienceStoryVideo.pause(); this.contactStoryReaction.pause(); 
      this.contactPublicStories.pause(); this.contactAudienceStories.pause(); this.contactStoryAudience.pause()
    }, (command, validate) => this.delivery.storyViewReceiptState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyViewReceipt.refresh()).catch(() => {})
    this.storyReactionChange = new StoryReactionChange(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, request => {
      const source = request.privacy === 'everyone' ? this.contactPublicStories.reactionSource(request) : this.contactAudienceStories.reactionSource(request)
      const peer = this.contacts.directPeer(request.profileRequestId)
      if (peer.uid !== source.ownerId) throw new Error(tr('현재 스토리 작성자가 변경되었습니다.'))
      return { ownerId: source.ownerId, ownerName: peer.displayName }
    }, request => {
      if (!this.contacts.has(request.ownerId)) throw new Error(tr('현재 연락처를 다시 확인해 주세요.'))
    }, () => {
      this.contactStoryPhotoAudio.pause(); this.contactPublicStoryPhoto.pause(); this.contactPublicStoryVideo.pause(); 
      this.contactAudienceStoryPhoto.pause(); this.contactAudienceStoryVideo.pause(); this.contactStoryReaction.pause(); 
      this.contactPublicStories.pause(); this.contactAudienceStories.pause(); this.contactStoryAudience.pause()
    }, (command, validate) => this.delivery.storyReactionChangeState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyReactionChange.refresh()).catch(() => {})
    this.storyViewRecords = new StoryViewRecords(profile.uid, credentials, request => { this.ownStories.captionDraftSource(request) })
    this.storyHiddenAudience = new StoryHiddenAudience(profile.uid, credentials, request => { this.ownStories.captionDraftSource(request) })
    this.noteEditComparison = new NoteEditComparison(profile.uid, credentials, () => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, (noteId, validate) => this.delivery.noteEditDraftState({ kind: 'note-edit-draft-read', target: { noteId } }, validate),
    (request, validate) => this.delivery.noteEditDraftState({ kind: 'note-edit-draft-rebase', request }, validate))
    this.storyVideoUpload = new StoryVideoUpload(profile.uid,credentials,() => { if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('현재 계정과 연결을 확인해 주세요.')) },(command,validate) => this.delivery.storyVideoPublicationState(command,validate))
    this.storyPublication = new StoryPublication(profile.uid, credentials, () => {
      if (this.closed || this.locked) throw new Error(tr('현재 계정과 잠금을 확인해 주세요.'))
    }, () => { if (this.connection !== 'ready') throw new Error(tr('계정 연결을 확인해 주세요.')) }, (command, validate) => this.delivery.storyPublicationState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyPublication.refresh()).catch(() => {})
    this.storyHiddenChange = new StoryHiddenChange(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, target => {
      this.ownStories.captionDraftSource(target)
      if (target.mode === 'add') { const contact = this.contacts.closeFriendCandidate(target.peerUid); return { displayName: contact.displayName, contactVersion: contact.version } }
      let displayName = target.peerUid
      if (this.contacts.has(target.peerUid)) displayName = this.contacts.closeFriendCandidate(target.peerUid).displayName
      return { displayName, contactVersion: null }
    }, request => { if (this.contacts.closeFriendCandidate(request.peerUid).version !== request.contactVersion) throw new Error(tr('숨김 대상으로 검토한 연락처가 변경되었습니다.')) },
    (command, validate) => this.delivery.storyHiddenChangeState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyHiddenChange.refresh()).catch(() => {})
    this.storyPrivacyMove = new StoryPrivacyMove(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, target => this.ownStories.privacyMoveSource(target), (command, validate) => this.delivery.storyPrivacyMoveState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyPrivacyMove.refresh()).catch(() => {})
    this.storyRemoval = new StoryRemoval(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, target => this.ownStories.removalSource(target), (command, validate) => this.delivery.storyRemovalState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyRemoval.refresh()).catch(() => {})
    this.noteRemoval = new NoteRemoval(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, target => {
      const original = this.spaceNotes.editDraftSource(target)
      return { title: original.title, body: original.body }
    }, (command, validate) => this.delivery.noteRemovalState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.noteRemoval.refresh()).catch(() => {})
    this.storyCaptionSave = new StoryCaptionSave(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, (command, validate) => this.delivery.storyCaptionSaveState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.storyCaptionSave.refresh()).catch(() => {})
    this.noteTextSave = new NoteTextSave(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, (command, validate) => this.delivery.noteTextSaveState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.noteTextSave.refresh()).catch(() => {})
    this.noteCreation = new NoteCreation(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, (command, validate) => this.delivery.noteCreationState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.noteCreation.refresh()).catch(() => {})
    this.channelCreation = new ChannelCreation(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, () => this.selfProfile.channelCreationOwner(), (command, validate) => this.delivery.channelCreationState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.channelCreation.refresh()).catch(() => {})
    this.postCreation = new ChannelPostCreation(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, channelId => this.channels.posts.authoringSource(channelId), (channelId, doc) => this.channels.posts.postObservationScope(channelId, doc), (command, validate) => this.delivery.postCreationState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.postCreation.refresh()).catch(() => {})
    this.commentCreation = new ChannelCommentCreation(profile.uid, credentials, network => {
      if (this.closed || this.locked || (network && this.connection !== 'ready')) throw new Error(tr('현재 계정과 연결을 확인해 주세요.'))
    }, target => target.surface === 'public-preview' ? this.channelPublicPreview.creationSource(target) : this.channels.posts.creationSource(target), () => this.selfProfile.commentAuthor(), (target, parent) => target.surface === 'public-preview' ? this.channelPublicPreview.comments.replySource(target, parent) : this.channels.posts.comments.replySource(target, parent), target => target.surface === 'public-preview' ? this.channelPublicPreview.commentObservationScope(target) : this.channels.posts.commentObservationScope(target),
    (command, validate) => this.delivery.commentCreationState(command, validate), () => { if (!this.closed) events.changed() })
    void Promise.resolve().then(() => this.commentCreation.refresh()).catch(() => {})
    this.discussionJoin = new ChannelDiscussionJoin(profile.uid, credentials, () => {
      if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('계정 연결을 확인해 주세요.'))
    }, request => {
      const doc = this.channels.discussionNavigationSource(request)
      if (stringField(doc.fields, 'name', 512).trim() !== request.title) throw new Error(tr('최신 채널 이름을 확인해 주세요.'))
      this.delivery.requireLeaveReady(request.chatId)
    }, (command, validate) => this.delivery.discussionJoinState(command, validate), () => { if (!this.closed) events.changed() })
    this.notifications = new AccountNotifications(profile.uid, credentials.signal,
      () => ({ ready: this.status === 'ready' && !this.closed, reader: this.reader, dialogs: this.index }),
      { ...events.notifications, foreground: chatId => events.canRead() && this.selected?.dialog.summary.id === chatId },
      command => this.delivery.notificationState<boolean>(command))
    this.channelPosts = new ChannelPostNotices((chatId, id) => this.notifications.receive({ chatId, id }))
    this.reads = new ReadSync(profile.uid, credentials, command => this.delivery.readState(command),
      () => ({ ready: this.status === 'ready' && !this.closed, foreground: events.canRead(), dialogs: this.index }),
      () => { if (!this.closed) events.changed() })
    this.manualUnread = new ManualUnread(profile.uid, credentials, (request, exact) => this.manualUnreadSource(request, exact),
      (chatId, signal, operation) => this.reads.withManualChange(chatId, signal, operation), () => { if (!this.closed) events.changed() })
    this.actions = new MessageActions(profile.uid, credentials, command => this.delivery.actionState(command),
      () => ({ ready: this.status === 'ready' && !this.closed, reader: this.reader, dialogs: this.index }),
      (chatId, snapshot) => { if (!this.closed) events.actions(chatId, snapshot) })
    this.media = new MediaSession(credentials, (chatId, request) => this.mediaResourceFor(chatId, request),
      (requestId, loaded, total) => { if (!this.closed) events.mediaProgress(requestId, loaded, total) })
    this.photoPreviews = new PhotoPreviews(credentials, (chatId, request) => this.mediaResourceFor(chatId, request))
    this.hiddenChats = new HiddenChats(<T,>(command: HiddenChatCommand) => this.delivery.hiddenChatState<T>(command),
      () => { if (!this.closed && this.chatsCurrent && this.pinsCurrent) { this.rebuild(); this.events.changed() } })
    this.contactFlags = new ContactFlags(<T,>(command: ContactFlagCommand) => this.delivery.contactFlagState<T>(command), () => { if (!this.closed) this.events.changed() })
    this.chatFlags = new ChatFlags(<T,>(command: ChatFlagCommand) => this.delivery.chatFlagState<T>(command),
      () => { if (!this.closed && this.chatsCurrent && this.pinsCurrent) { this.rebuild(); this.events.changed() } })
    // The bytes of a sticker message, read again through the message's own attachment so the sheet can
    // hash them (iOS reuses the bubble's loaded bytes; a Desktop media session holds one attachment at a time).
    this.stickerPacks = new StickerPacks(profile.uid, credentials, () => this.reader, () => { if (!this.closed) this.events.changed() },
      async (chatId, messageId, version, signal) => {
        const resource = this.mediaResourceFor(chatId, { requestId: randomUUID(), messageId, version, index: 0 })
        if (!resource || resource.summary.kind !== 'sticker') throw new Error(tr('스티커를 다시 선택해 주세요.'))
        return downloadMedia(credentials, resource, signal, () => { if (this.closed || this.locked) throw new Error('Account changed') }, () => {}, maxStickerBytes)
      })
    this.hiddenMessages = new HiddenMessages(<T,>(command: HiddenMessageCommand) => this.delivery.hiddenMessageState<T>(command),
      () => { if (!this.closed) this.selected?.hiddenChanged() })
    const connected = (): void => { if (this.closed || this.locked || this.connection !== 'ready') throw new Error(tr('계정 연결을 확인해 주세요.')) }
    this.groups = new GroupApi(profile.uid, credentials, connected, {
      create: request => this.groupCreateSource(request), members: request => this.groupMembersSource(request),
      leave: request => this.groupLeaveSource(request), removal: request => this.groupRemovalSource(request)
    }, newChatAutoDelete)
    this.closeFriendsApi = new CloseFriendsApi(profile.uid, credentials, connected, uid => this.contacts.closeFriendCandidate(uid),
      uid => { try { return this.contacts.has(uid) ? this.contacts.closeFriendCandidate(uid).displayName : null } catch { return null } })
    this.channelMembershipApi = new ChannelMembershipApi(profile.uid, credentials, connected)
    this.storyBarApi = new StoryBarApi(profile.uid, credentials, connected, uid => this.contacts.has(uid))
    this.accountTools = new AccountToolsApi(profile.uid, credentials, connected)
    this.channelInquiries = new ChannelInquiries(profile.uid, credentials, connected, () => this.selfProfile.commentAuthor(), () => events.canRead(), () => { if (!this.closed) events.changed() },
      (inquiryId, messageId) => this.hiddenMessages.has(inquiryQueueChatId(inquiryId), messageId))
    this.inquiryNotifications = new InquiryNotifications({ ...events.notifications,
      foreground: inquiryId => events.canRead() && this.channelInquiries.openThreadId === inquiryId,
      open: (channelId, inquiryId) => events.notifications.openInquiry(channelId, inquiryId) })
    this.inquiryRows = new InquiryRows(profile.uid, credentials, connected, () => { if (!this.closed) events.changed() },
      rooms => { if (!this.closed && !this.locked) this.inquiryNotifications.observe(rooms) })
    this.folders = new ChatFolderWatch(profile.uid, credentials, connected, () => { if (!this.closed) events.changed() })
    // A mute or archive chosen on another device of this account replaces what this device holds.
    this.dialogPreferences = new DialogPreferenceWatch(profile.uid, credentials, connected, (chatId, patch) => {
      if (this.closed) return
      const current = this.chatFlags.current(chatId)
      if (current.muted === patch.muted && (patch.archived === undefined || current.archived === patch.archived)) return
      void this.chatFlags.set(chatId, patch).catch(() => {})
    })
    this.discussionAvatars = new DiscussionAvatars(credentials, () => { if (!this.closed) events.changed() })
    // Channel screens show every listed person's photo (Telegram userpics; iOS AvatarView photoURL).
    const people = (uid: string, raw: string | null) => this.channelPeople.image(uid, raw)
    this.channels.admins.people = people; this.channels.subscribers.people = people; this.channels.posts.comments.people = people; this.channels.joinRequests.people = people
    this.channelPublicPreview.comments.people = people; this.channelInquiries.people = people
  }
  get state(): ConnectionState { return this.connection }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) this.channelPeople.clear()
    this.channels.setLocked(locked)
    if (!locked) this.topicDeletions.connectionChanged()
    if (locked) this.channelHome.pause(true); else this.channelHome.resume()
    this.channelStories.setLocked(locked)
    this.channelInquiries.setLocked(locked)
    this.inquiryRows.setLocked(locked)
    if (locked) this.inquiryNotifications.pause()
    this.folders.setLocked(locked)
    this.dialogPreferences.setLocked(locked)
    this.discussionAvatars.setLocked(locked)
    if (locked) this.photoPreviews.clear()
    if (this.chatsCurrent && this.pinsCurrent) this.rebuild()
    if (locked) this.dialogAvatars.clear()
    this.voiceDraftStorage.invalidate();this.backgroundStorage.invalidate()
    if (locked) { this.discussionJoin.pause(); this.commentCreation.pause(); this.postCreation.pause(); this.channelCreation.pause(); this.noteCreation.pause(); this.noteTextSave.pause(); this.storyCaptionSave.pause(); this.noteRemoval.pause(); this.storyRemoval.pause(); this.storyPrivacyMove.pause(); this.storyHiddenChange.pause(); this.storyReactionChange.pause(); this.storyViewReceipt.pause(); this.storyReplyDraft.pause(); this.storyPublication.pause(); this.storyVideoUpload.pause(); this.noteEditComparison.pause(); this.storyHiddenAudience.pause(); this.storyViewRecords.pause(); this.contactPublicStories.pause(); this.contactStoryAudience.pause(); this.contactAudienceStories.pause(); this.contactAudienceStoryPhoto.pause(); this.contactAudienceStoryVideo.pause(); this.contactStoryPhotoAudio.pause(); this.contactStoryReaction.pause(); this.contactPublicStoryPhoto.pause(); this.contactPublicStoryVideo.pause(); this.groupName.pause(); this.groupAnnouncement.pause(); this.groupPhoto.clear(); this.groupPhotoEditor.pause(); this.groupPhotoUpload.pause(); this.channelPhotoUpload.pause(); this.channelAccess.pause(); this.channelJoinDecisions.pause() }
    if (locked) { this.ownStories.pause(); this.spaceNotes.pause(); this.channelPublicPreview.pause(); this.channelDiscovery.pause(); this.contactDiscovery.pause(); this.participantAdd.pause(); this.dialogPins.pause(); this.manualUnread.pause(); this.draftReply.clear(); this.cancelForwardPreparation() }
    else if (this.selected && this.reader) this.draftReply.bind(this.selected.dialog, this.reader)
  }
  pendingDirects() { return this.delivery.pendingDirects() }
  async startContactChat(requestId: string): Promise<string> {
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready') throw new Error(tr('대화 목록과 연결을 확인해 주세요.'))
    const peer = this.contacts.directPeer(requestId)
    // Any dialog with the peer, listed or not: one that is out of the list ("나에게만 삭제", or nothing left after a
    // delete for everyone) opens as the empty chat it is. Looking only through the list sent such a peer to openDirect,
    // which found the same dialog and returned an id the window had no dialog for ("대화를 찾을 수 없습니다.").
    const existing = [...this.index.values()].find(({ summary }) => summary.kind === 'direct' && summary.participantUids.length === 2 &&
      summary.participantUids.includes(this.profile.uid) && summary.participantUids.includes(peer.uid))
    return this.openUnlisted(existing?.summary.id ?? await this.delivery.openDirect(peer))
  }
  private openUnlisted(chatId: string): string {
    const listed = this.list.some(dialog => dialog.id === chatId)
    const next = !listed && this.index.has(chatId) ? chatId : this.unlistedOpen === chatId ? null : this.unlistedOpen
    if (next !== this.unlistedOpen) { this.unlistedOpen = next; this.events.changed() }
    return chatId
  }
  // The open dialogs that are not rows of the list (see unlistedOpen).
  openDialogs(): DialogSummary[] {
    const dialog = this.unlistedOpen ? this.index.get(this.unlistedOpen)?.summary : undefined
    return dialog ? [{ ...dialog, readSync: this.reads.state(dialog.id), avatar: this.dialogAvatars.snapshot(dialog.id) }] : []
  }
  // SupportCenterView.openSupportChatTapped: a 1:1 chat with MorseOfficialSupport (its uid and name as iOS has
  // them), opened like any new chat, created by the first message.
  async openSupportChat(): Promise<string> {
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready') throw new Error(tr('대화 목록과 연결을 확인해 주세요.'))
    return this.openUnlisted(await this.delivery.openDirect({ uid: morseSupportUid, displayName: tr('Morse 고객센터') }))
  }
  discardDirectDraft(chatId: string) { return this.delivery.discardDirect(chatId) }
  private groupCreateSource(request: GroupCreateRequest): void {
    if (!this.contacts.ready || this.status !== 'ready' || this.index.has(request.chatId) || request.participantUids.some(uid => uid === this.profile.uid || !this.contacts.has(uid))) throw new Error(tr('현재 연락처와 대화 목록에서 참여자를 다시 확인해 주세요.'))
  }
  private groupMembersSource(request: GroupMembersRequest): void {
    const doc = this.chatRows.get(`${documents}/chats/${request.chatId}`), group = this.index.get(request.chatId)?.summary
    if (!this.contacts.ready || this.status !== 'ready' || !doc || !group || group.kind !== 'group' || group.version !== request.version || group.title !== request.title ||
      boolField(doc.fields, 'isChannelDiscussion') || stringField(doc.fields, 'channelId', 160) || group.id.startsWith('channel_discuss_') ||
      !group.participantUids.includes(this.profile.uid) || group.participantUids.length + request.addUids.length > 100 ||
      request.addUids.some(uid => uid === this.profile.uid || group.participantUids.includes(uid) || !this.contacts.has(uid))) throw new Error(tr('그룹 정보와 연락처가 변경되었습니다. 최신 그룹에서 다시 선택해 주세요.'))
  }
  private groupLeaveSource(request: GroupLeaveRequest): void {
    const doc = this.chatRows.get(`${documents}/chats/${request.chatId}`), dialog = this.index.get(request.chatId)
    if (this.status !== 'ready' || !doc || !dialog || dialog.summary.kind !== 'group' || dialog.summary.version !== request.version || dialog.summary.title !== request.title ||
      !dialog.summary.participantUids.includes(this.profile.uid) || dialog.summary.participantUids.length !== request.participantCount ||
      (stringField(doc.fields, 'createdBy', 160) === this.profile.uid) !== request.owner) throw new Error(tr('현재 참여 중인 그룹 정보를 다시 확인해 주세요.'))
    if (request.discussion) {
      const current = this.resolveDiscussionDeparture({ channelId: request.discussion.channelId, version: request.discussion.version, chatId: request.chatId })
      if (current.version !== request.version || current.title !== request.title || current.discussion?.title !== request.discussion.title || current.owner !== request.owner || current.participantCount !== request.participantCount) throw new Error(tr('토론방 정보가 변경되었습니다.'))
    } else {
      const info = participantSnapshot('group-leave', doc, dialog, () => false)
      if (info.discussion || !info.members.some(member => member.self && !member.withdrawn)) throw new Error(tr('그룹 참여 상태가 변경되었습니다.'))
    }
  }
  private groupRemovalSource(request: GroupRemovalRequest): void {
    const doc = this.chatRows.get(`${documents}/chats/${request.chatId}`), dialog = this.index.get(request.chatId)
    if (this.status !== 'ready' || !doc || !dialog || dialog.summary.kind !== 'group' || dialog.summary.version !== request.version || dialog.summary.title !== request.title ||
      request.removeUid === this.profile.uid || !dialog.summary.participantUids.includes(this.profile.uid) || stringField(doc.fields, 'createdBy', 160) !== this.profile.uid) throw new Error(tr('현재 방장인 그룹에서 참여자를 다시 선택해 주세요.'))
    const info = participantSnapshot('group-removal', doc, dialog, () => false)
    if (info.discussion || !info.members.some(member => member.self && member.owner && !member.withdrawn) ||
      !info.members.some(member => member.uid === request.removeUid && !member.self && member.displayName === request.displayName)) throw new Error(tr('참여자 정보가 변경되었습니다. 다시 선택해 주세요.'))
  }
  get readStatus(): ReadStatus { return this.status }
  get readMessage(): string { return this.message }
  get participants(): ParticipantsSnapshot | null {
    const selection = this.participantSelection
    if (!selection) return null
    const empty = (status: ParticipantsSnapshot['status'], message: string): ParticipantsSnapshot => ({ ...selection, status, message, version: '', discussion: false, groupName: null, groupPhoto: null, groupAnnouncement: null, canEditGroupAnnouncement: false, members: [] })
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready') return empty(this.status === 'error' ? 'error' : 'loading', tr('대화와 연결이 준비되면 참여자를 다시 표시합니다.'))
    if (this.selected?.dialog.summary.id !== selection.chatId) return empty('unavailable', tr('선택한 대화의 참여자를 다시 열어 주세요.'))
    const dialog = this.index.get(selection.chatId), doc = this.chatRows.get(`${documents}/chats/${selection.chatId}`)
    if (!dialog || !doc || !dialog.summary.participantUids.includes(this.profile.uid)) return empty('unavailable', tr('현재 참여 중인 대화를 확인할 수 없습니다.'))
    if (dialog.summary.kind === 'secret') return empty('unsupported', tr('비밀 대화의 참여자 프로필은 아직 지원하지 않습니다.'))
    try {
      const value = participantSnapshot(selection.requestId, doc, dialog, uid => this.contacts.has(uid), this.contacts.ready)
      if (value.groupPhoto) value.groupPhoto = { ...value.groupPhoto, ...this.groupPhoto.snapshot }
      return value
    }
    catch { return empty('error', tr('참여자 정보를 확인하지 못했습니다. 대화를 다시 불러와 주세요.')) }
  }
  openParticipants(chatId: string, requestId: string): void {
    if (this.closed || this.locked || !this.contextDialog(chatId) || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화가 준비된 뒤 참여자를 열어 주세요.'))
    this.groupName.open(requestId)
    this.groupPhoto.clear(); this.groupPhotoEditor.open(requestId)
    this.groupAnnouncement.open(requestId)
    this.participantSelection = { chatId, requestId }; this.events.changed()
  }
  closeParticipants(requestId: string): void {
    if (this.participantSelection?.requestId !== requestId) return
    this.groupName.dismiss(requestId)
    this.groupPhoto.clear(); this.groupPhotoEditor.dismiss(requestId)
    this.groupAnnouncement.dismiss(requestId)
    this.participantSelection = null
    if (!this.closed) this.events.changed()
  }
  private groupPhotoUploadSource(chatId: string, version?: string): FirestoreDocument {
    const doc = this.chatRows.get(`${documents}/chats/${chatId}`), dialog = this.index.get(chatId)
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready' || !doc || !doc.updateTime || !dialog || dialog.summary.kind !== 'group' ||
      !dialog.summary.participantUids.includes(this.profile.uid) || (version !== undefined && documentVersion(doc) !== version)) throw new Error(tr('최신 그룹과 방장 권한을 확인해 주세요.'))
    const info = participantSnapshot('group-photo-upload', doc, dialog, () => false)
    if (info.discussion || !info.members.some(member => member.self && member.owner && !member.withdrawn)) throw new Error(tr('현재 방장인 일반 그룹에서 사진을 준비해 주세요.'))
    return doc
  }
  channelPhotoPreparation(binding: ChannelPhotoBinding) {
    const generation = this.generation, channelLifetime = this.channels.uploadLifetime
    const validate = (): void => {
      const doc = this.channels.uploadSource(binding.channelId, binding.version)
      if (this.channelPhotoUpload.blocked || generation !== this.generation || channelLifetime !== this.channels.uploadLifetime || stringField(doc.fields, 'name', 512) !== binding.title) throw new Error(tr('사진 기록을 확인한 뒤 최신 채널에서 다시 선택해 주세요.'))
    }
    validate()
    return { key: JSON.stringify(['channel-photo', this.profile.uid, generation, channelLifetime, binding.channelId, binding.version, binding.kind]), validate, load: async () => null }
  }
  groupPhotoPreparation(binding: GroupPhotoBinding) {
    const generation = this.generation
    const validate = (): void => {
      const doc = this.groupPhotoUploadSource(binding.chatId, binding.version)
      if (this.groupPhotoUpload.blocked || generation !== this.generation || decodeDialog(doc, this.profile.uid).summary.title !== binding.title) throw new Error(tr('사진 기록을 확인한 뒤 최신 그룹에서 다시 선택해 주세요.'))
    }
    validate()
    return { key: JSON.stringify(['group-photo', this.profile.uid, generation, binding.chatId, binding.version]), validate, load: async () => null }
  }
  loadGroupPhoto(request: GroupPhotoRequest): Promise<void> { return this.groupPhoto.load(request) }
  private directAvatarSource(chatId: string) {
    const doc = this.chatRows.get(`${documents}/chats/${chatId}`), dialog = this.index.get(chatId), reader = this.reader
    if (!dialog) {
      // A new 1:1 chat has no chat document until its first message; its row, header and info
      // follow the peer's live profile like Telegram's UserData instead of the name saved when it was opened.
      const pending = this.delivery.pendingDirects().find(item => item.chatId === chatId)
      if (this.closed || this.locked || this.connection !== 'ready' || !reader || !pending || pending.peerUid === this.profile.uid || !this.contacts.has(pending.peerUid)) throw new Error(tr('현재 새 대화를 확인해 주세요.'))
      return { uid: pending.peerUid, reader, personalURL: this.contacts.personalPhotos.url(pending.peerUid) }
    }
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready' || !doc?.updateTime || !dialog || !reader ||
      dialog.summary.kind !== 'direct' || chatId === `memo_${this.profile.uid}` || dialog.summary.participantUids.length !== 2 ||
      !dialog.summary.participantUids.includes(this.profile.uid)) throw new Error(tr('현재 개인 대화를 확인해 주세요.'))
    const uid = dialog.summary.participantUids.find(uid => uid !== this.profile.uid)
    if (!uid || !this.contacts.has(uid)) throw new Error(tr('현재 연락처를 확인해 주세요.'))
    const info = participantSnapshot('direct-avatar', doc, dialog, () => false)
    if (info.discussion || !info.members.some(member => member.self && !member.withdrawn) || !info.members.some(member => member.uid === uid && !member.withdrawn)) throw new Error(tr('현재 참여자를 확인해 주세요.'))
    return { uid, reader, personalURL: this.contacts.personalPhotos.url(uid) }
  }
  private dialogAvatarSource(chatId: string): FirestoreDocument {
    const doc = this.chatRows.get(`${documents}/chats/${chatId}`), dialog = this.index.get(chatId)
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready' || !doc?.updateTime || !dialog || dialog.summary.kind !== 'group' ||
      !dialog.summary.participantUids.includes(this.profile.uid)) throw new Error(tr('현재 그룹을 확인해 주세요.'))
    const info = participantSnapshot('dialog-avatar', doc, dialog, () => false)
    if (!info.groupPhoto || !info.members.some(member => member.self && !member.withdrawn)) throw new Error(tr('현재 그룹 사진을 확인해 주세요.'))
    return doc
  }
  clearGroupPhoto(request: GroupPhotoClear): Promise<GroupPhotoResult> { return this.groupPhotoEditor.save(request) }
  groupPhotoResponse(token: string, request: Request): Response { return this.groupPhoto.response(token, request) }
  private groupPhotoSource(request: GroupPhotoRequest, exact: boolean, owner = false): FirestoreDocument {
    const selection = this.participantSelection, dialog = this.index.get(request.chatId), doc = this.chatRows.get(`${documents}/chats/${request.chatId}`)
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready' || !selection || selection.requestId !== request.requestId || selection.chatId !== request.chatId ||
      this.selected?.dialog.summary.id !== request.chatId || !dialog || !doc || !doc.updateTime || dialog.summary.kind !== 'group' || !dialog.summary.participantUids.includes(this.profile.uid) ||
      (exact && documentVersion(doc) !== request.version)) throw new Error(tr('최신 그룹과 참여 상태를 다시 확인해 주세요.'))
    const info = participantSnapshot(request.requestId, doc, dialog, () => false)
    if (!info.groupPhoto || !info.members.some(member => member.self && !member.withdrawn) || (owner && (!info.members.some(member => member.self && member.owner && !member.withdrawn) || (exact && !info.groupPhoto.hasPhoto)))) throw new Error(tr('현재 그룹 사진과 변경 권한을 확인해 주세요.'))
    return doc
  }
  saveGroupAnnouncement(request: GroupAnnouncementEdit): Promise<GroupAnnouncementResult> { return this.groupAnnouncement.save(request) }
  private groupAnnouncementSource(request: GroupAnnouncementEdit, exact: boolean): FirestoreDocument {
    const current = this.participants
    if (!current || current.status !== 'ready' || current.requestId !== request.requestId || current.chatId !== request.chatId ||
      !current.canEditGroupAnnouncement || current.groupAnnouncement === null) throw new Error(tr('현재 방장인 일반 그룹 정보를 확인해 주세요.'))
    const doc = this.chatRows.get(`${documents}/chats/${request.chatId}`)
    if (!doc || !doc.updateTime || (exact && (documentVersion(doc) !== request.version || current.groupAnnouncement === request.text))) throw new Error(tr('그룹 정보가 변경되었습니다. 최신 정보에서 다시 편집해 주세요.'))
    return doc
  }
  saveGroupName(request: GroupNameEdit): Promise<GroupNameResult> { return this.groupName.save(request) }
  private groupNameSource(request: GroupNameEdit, exact: boolean): FirestoreDocument {
    const current = this.participants
    if (!current || current.status !== 'ready' || current.requestId !== request.requestId || current.chatId !== request.chatId ||
      current.discussion || current.groupName === null || !current.members.some(member => member.self && !member.withdrawn)) throw new Error(tr('현재 참여 중인 일반 그룹 정보를 확인해 주세요.'))
    const doc = this.chatRows.get(`${documents}/chats/${request.chatId}`)
    if (!doc || !doc.updateTime || (exact && (documentVersion(doc) !== request.version || current.groupName === request.name))) throw new Error(tr('그룹 정보가 변경되었습니다. 최신 정보에서 다시 편집해 주세요.'))
    return doc
  }
  participantContact(request: ParticipantContactRequest): string {
    const current = this.participants
    if (!current || current.status !== 'ready' || current.requestId !== request.requestId || current.chatId !== request.chatId || current.version !== request.version ||
      current.discussion || !current.members.some(member => member.uid === request.uid && member.canOpenContact)) throw new Error(tr('참여자 또는 연락처 정보가 변경되었습니다. 최신 목록에서 다시 선택해 주세요.'))
    return request.uid
  }
  addParticipantContact(request: ParticipantAddRequest): Promise<ParticipantAddResult> {
    return this.addChatContact({ id: request.id, chatId: request.chatId, uid: request.uid })
  }
  addChatContact(target: ChatContactTarget): Promise<ParticipantAddResult> {
    if (!this.contacts.ready) throw new Error(tr('연락처 목록을 불러온 뒤 다시 선택해 주세요.'))
    return this.participantAdd.add(target)
  }
  // The person must still be a member of this chat (not a discussion, not secret) with a name in
  // its participant info. The chat's version is not compared: read receipts and new messages
  // change the chat document all the time and do not change who can be added.
  private resolveChatContact(target: ChatContactTarget, fresh?: FirestoreDocument): ContactCreateFields {
    const path = `${documents}/chats/${target.chatId}`, doc = fresh ?? this.chatRows.get(path)
    if (this.closed || this.locked || !doc || doc.name !== path) throw new Error(tr('대화 정보를 확인할 수 없습니다.'))
    const dialog = decodeDialog(doc, this.profile.uid)
    if (dialog.summary.kind === 'secret' || target.uid === this.profile.uid || !dialog.summary.participantUids.includes(this.profile.uid) || !dialog.summary.participantUids.includes(target.uid)) throw new Error(tr('현재 참여자를 확인할 수 없습니다.'))
    const info = participantSnapshot('contact-add', doc, dialog, () => false)
    if (info.discussion || !info.members.some(member => member.uid === target.uid && !member.withdrawn)) throw new Error(tr('현재 참여자를 확인할 수 없습니다.'))
    const data = mapField(mapField(doc.fields, 'participantInfo'), target.uid), displayName = stringField(data, 'displayName', 512).trim()
    if (!displayName) throw new Error(tr('추가할 참여자 이름을 확인할 수 없습니다.'))
    return { uid: target.uid, userId: stringField(data, 'userId', 160), displayName, photoURL: stringField(data, 'photoURL', 10000) }
  }
  private discussionDestination(request: ChannelDiscussionNavigation) {
    this.credentials.signal.throwIfAborted()
    if (this.closed || this.locked || this.connection !== 'ready' || this.status !== 'ready' || !this.reader) throw new Error(tr('최신 대화 목록과 연결 상태를 확인해 주세요.'))
    const channel = this.discussionChannelSource(request), owner = identifier(stringField(channel.fields, 'ownerId', 160))
    const path = `${documents}/chats/${request.chatId}`, doc = this.chatRows.get(path), dialog = this.index.get(request.chatId)
    if (!doc || doc.name !== path || !doc.updateTime || !dialog || !dialog.summary.version || dialog.summary.kind !== 'group' ||
      stringField(doc.fields, 'type', 32) !== 'group' || doc.fields.isChannelDiscussion?.booleanValue !== true ||
      stringField(doc.fields, 'channelId', 160) !== request.channelId || stringField(doc.fields, 'createdBy', 160) !== owner ||
      !dialog.summary.participantUids.includes(this.profile.uid) || boolField(mapField(mapField(doc.fields, 'participantInfo'), this.profile.uid), 'accountDeleted') ||
      documentVersion(doc) !== dialog.summary.version) throw new Error(tr('현재 참여 중인 이 채널의 토론방을 확인할 수 없습니다.'))
    return { channel, owner, dialog }
  }
  // The channel behind a discussion room: the channel list's copy when that list is open, otherwise
  // the one the chat list reads for the room's picture - so the room can be left from the chat list,
  // as iOS commitPendingLocalChatDeletion leaves a discussion room deleted for me.
  private discussionChannelSource(request: ChannelDiscussionNavigation): FirestoreDocument {
    try { return this.channels.discussionNavigationSource(request) }
    catch (error) {
      const doc = this.discussionAvatars.document(request.channelId)
      if (!doc) throw error
      const reference = channelDiscussionReference(doc)
      if (!doc.updateTime || documentVersion(doc) !== request.version || reference.status !== 'known' || reference.chatId !== request.chatId) throw new Error(tr('채널 토론방 연결 정보가 변경되었습니다.'))
      return doc
    }
  }
  discussionRowDeparture(chatId: string): ChannelDiscussionNavigation {
    const dialog = this.index.get(chatId)?.summary
    if (this.closed || this.locked || !dialog?.discussion || !dialog.channelId) throw new Error(tr('토론방을 다시 선택해 주세요.'))
    const doc = this.channels.currentDocument(dialog.channelId) ?? this.discussionAvatars.document(dialog.channelId)
    if (!doc?.updateTime) throw new Error(tr('채널 정보를 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'))
    const selection = { channelId: dialog.channelId, version: documentVersion(doc), chatId }
    this.resolveDiscussionDeparture(selection)
    return selection
  }
  resolveChannelDiscussion(request: ChannelDiscussionNavigation): ChannelDiscussionDestination {
    const { dialog } = this.discussionDestination(request)
    if (dialog.summary.historyAccess !== 'ready') throw new Error(tr('토론방 기록 공개 범위를 먼저 확인해 주세요.'))
    return { chatId: request.chatId, version: dialog.summary.version }
  }
  resolveDiscussionDeparture(request: ChannelDiscussionNavigation): Omit<GroupLeaveRequest, 'id'> {
    const { channel, owner, dialog } = this.discussionDestination(request), group = dialog.summary
    if (group.participantUids.length > 101) throw new Error(tr('현재 참여 인원은 서버의 나가기 처리 범위를 넘습니다.'))
    return { chatId: request.chatId, version: group.version, title: group.title, owner: owner === this.profile.uid, participantCount: group.participantUids.length,
      discussion: { channelId: request.channelId, version: request.version, title: stringField(channel.fields, 'name', 512).trim() } }
  }
  async discussionLeaveWork(target: ChannelDiscussionNavigation, clear?: DiscussionLeaveWorkClear): Promise<DiscussionLeaveWork> {
    const validate = (): void => { this.resolveDiscussionDeparture(target) }
    validate()
    const work = await this.delivery.discussionLeaveWorkState<Omit<DiscussionLeaveWork, 'selectedAttachment'>>(clear ? { kind: 'discussion-leave-clear-drafts', request: clear } : { kind: 'discussion-leave-work', chatId: target.chatId }, validate)
    validate()
    return { ...work, selectedAttachment: this.delivery.hasLeaveAttachment(target.chatId) }
  }
  async dismissDiscussionLeaveWork(request: DiscussionLeaveWorkDismiss): Promise<DiscussionLeaveWork> {
    const validate = (): void => { this.resolveDiscussionDeparture(request.target) }
    validate()
    if (request.kind === 'outgoing') await this.delivery.discard(request.target.chatId, request.id, request, validate)
    else await this.delivery.discussionLeaveWorkState({ kind: 'discussion-leave-dismiss-record', request }, validate)
    validate()
    return this.discussionLeaveWork(request.target)
  }
  dialogs(): DialogSummary[] {
    return this.list.map(dialog => {
      // A discussion group whose copied address is missing falls back to the channel's own picture.
      const own = this.dialogAvatars.snapshot(dialog.id)
      const avatar = own ?? (dialog.discussion && dialog.channelId ? this.discussionAvatars.snapshot(dialog.channelId) : null)
      const sends = this.delivery.chatSendState(dialog.id, dialog.top ? positionMilliseconds(dialog.top) : null)
      if (!dialog.discussion || !dialog.channelId) return { ...dialog, readSync: this.reads.state(dialog.id), avatar, sends }
      const channel = this.channels.currentDocument(dialog.channelId) ?? this.discussionAvatars.document(dialog.channelId)
      let contentProtected = true
      try { contentProtected = !channel || channelDocumentType(channel.fields) !== 'public' } catch { /* An unreadable type protects, as a failed read does on iOS. */ }
      return { ...dialog, readSync: this.reads.state(dialog.id), avatar, contentProtected, sends }
    })
  }
  private pinSource(request: DialogPinRequest, exact: boolean): FirestoreDocument | undefined {
    const current = this.contextDialog(request.chatId)
    if (this.locked || !current || current.kind === 'secret' || current.id === `memo_${this.profile.uid}` || !current.participantUids.includes(this.profile.uid)) throw new Error(tr('현재 대화와 연결 상태를 확인해 주세요.'))
    const doc = this.pinRows.get(`${documents}/users/${this.profile.uid}/dialogStates/${request.chatId}`)
    if (exact && ((doc && !documentVersion(doc)) || (doc ? documentVersion(doc) : '') !== request.version || current.pinned === request.pinned)) throw new Error(tr('고정 상태가 변경되었습니다. 최신 목록에서 다시 선택해 주세요.'))
    return doc
  }
  private manualUnreadSource(request: ManualUnreadRequest, exact: boolean): void {
    const current = this.contextDialog(request.chatId)
    if (this.locked || !current || current.kind === 'secret' || current.id === `memo_${this.profile.uid}` || !current.participantUids.includes(this.profile.uid)) throw new Error(tr('현재 대화와 연결 상태를 확인해 주세요.'))
    if (exact && (current.version !== request.version || !current.version || this.selected?.dialog.summary.id === request.chatId ||
      request.markedUnread === (effectiveUnreadCount(current) > 0))) throw new Error(tr('최신 목록에서 읽음 표시를 다시 선택해 주세요.'))
  }
  private empty(status: HistorySnapshot['status'], message = ''): HistorySnapshot {
    return { revision: ++this.revision, messages: [], before: null, hasMore: false, newerAvailable: false, status, message }
  }
  private clearHistory(status: ReadStatus = 'loading', message = ''): void {
    this.presence?.setPeers('chat', [])
    this.pins?.clear()
    this.deferred?.clear()
    this.stopTyping(); this.typing?.clear()
    this.groupAnnouncement.pause(); this.groupPhoto.clear(); this.groupPhotoEditor.pause(); this.groupPhotoUpload.pause(); this.channelPhotoUpload.pause(); this.channelAccess.pause(); this.channelJoinDecisions.pause()
    this.groupName.pause()
    this.participantAdd.pause()
    this.cancelForwardPreparation()
    this.draftReply.clear()
    this.cancelSearch()
    this.delivery.discardAttachment()
    this.media.clear()
    const old = this.selected
    this.selected = null
    old?.close()
    if (old) this.events.history(old.dialog.summary.id, this.empty(status, message))
  }
  private clearVisible(status: ReadStatus, message = ''): void {
    this.dialogAvatars.clear()
    this.voiceDraftStorage.invalidate();this.backgroundStorage.invalidate()
    this.dialogPins.pause()
    this.manualUnread.pause()
    this.status = status; this.message = message; this.list = []; this.index.clear()
    this.delivery.pause()
    this.reads.pause()
    this.actions.pause()
    this.notifications.pause()
    this.clearHistory(status, message); this.events.changed()
  }
  private stop(): void {
    this.discussionHistory.clear()
    this.dialogAvatars.clear()
    this.groupAnnouncement.pause(); this.groupPhoto.clear(); this.groupPhotoEditor.pause(); this.groupPhotoUpload.pause(); this.channelPhotoUpload.pause(); this.channelAccess.pause(); this.channelJoinDecisions.pause()
    this.groupName.pause()
    this.voiceDraftStorage.invalidate();this.backgroundStorage.invalidate()
    this.participantAdd.pause()
    this.dialogPins.pause()
    this.manualUnread.pause()
    this.inquiryRows.pause()
    this.folders.pause()
    this.dialogPreferences.pause()
    this.discussionAvatars.pause()
    this.photoPreviews.clear()
    this.listTyping.clear()
    this.generation++; this.reader?.close(); this.reader = null
    this.chatsCurrent = false; this.pinsCurrent = false; this.chatRows.clear(); this.pinRows.clear()
  }
  setConnection(state: ConnectionState): void {
    if (this.closed) return
    this.connection = state
    if (state !== 'ready') { this.groupPhotoUpload.pause(); this.channelPhotoUpload.pause(); this.channelAccess.pause(); this.channelJoinDecisions.pause(); this.discussionJoin.pause(); this.commentCreation.pause(); this.postCreation.pause(); this.channelCreation.pause(); this.noteCreation.pause(); this.noteTextSave.pause(); this.storyCaptionSave.pause(); this.noteRemoval.pause(); this.storyRemoval.pause(); this.storyPrivacyMove.pause(); this.storyHiddenChange.pause(); this.storyReactionChange.pause(); this.storyViewReceipt.pause(); this.storyReplyDraft.pause(); this.storyPublication.pause(); this.storyVideoUpload.pause(); this.noteEditComparison.pause(); this.storyHiddenAudience.pause(); this.storyViewRecords.pause(); this.contactPublicStories.pause(); this.contactStoryAudience.pause(); this.contactAudienceStories.pause(); this.contactAudienceStoryPhoto.pause(); this.contactAudienceStoryVideo.pause(); this.contactStoryPhotoAudio.pause(); this.contactStoryReaction.pause(); this.contactPublicStoryPhoto.pause(); this.contactPublicStoryVideo.pause(); }
    else { void this.channelJoinDecisions.refresh().catch(() => {}); void this.channelAccess.refresh().catch(() => {}); void this.channelPhotoUpload.refresh().catch(() => {}); void this.groupPhotoUpload.refresh().catch(() => {}); void this.discussionJoin.refresh().catch(() => {}) }
    this.selfProfile.connection(state === 'ready')
    this.contacts.connection(state === 'ready')
    this.channels.connection(state === 'ready')
    if (state === 'ready') this.channelHome.resume(); else this.channelHome.pause(false)
    if (state !== 'ready') { this.ownStories.pause(); this.spaceNotes.pause(); this.channelPublicPreview.pause(); this.channelDiscovery.pause(); this.contactDiscovery.pause() }
    // Telegram keeps the chats list, the open history and every topic while it reconnects (the title only says
    // «Connecting...»); nothing is thrown away because a socket went down. The server drops this socket when the
    // login token expires and on every network blip, so what was read stays: the reads retry on their own and keep
    // their last snapshot meanwhile, and only what sends waits for the connection.
    if (state === 'ready') {
      if (!this.reader) this.refresh()
      else if (this.chatsCurrent && this.pinsCurrent) this.rebuild()
      this.topicDeletions.connectionChanged()
    } else {
      this.dialogPins.pause(); this.manualUnread.pause(); this.delivery.pause(); this.reads.pause(); this.actions.pause(); this.notifications.pause()
    }
    this.events.changed()
  }
  refresh(): void {
    if (this.closed) return
    this.stop(); this.clearVisible('loading')
    if (this.connection !== 'ready' || this.credentials.signal.aborted) return
    const generation = this.generation
    const active = (): boolean => !this.closed && generation === this.generation
    const failed = (error: ReadFailure): void => {
      if (!active()) return
      this.stop(); this.clearVisible('error', error.message)
    }
    try {
      const reader = new FirestoreReader(this.credentials)
      this.reader = reader
      const observe = (kind: 'chats' | 'pins'): void => {
        const query = kind === 'chats' ? {
          parent: documents,
          structuredQuery: { from: [{ collectionId: 'chats' }],
            where: { fieldFilter: { field: { fieldPath: 'participantUids' }, op: 'ARRAY_CONTAINS', value: { stringValue: this.profile.uid } } },
            orderBy: [{ field: { fieldPath: 'lastMessageAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }] }
        } : { parent: `${documents}/users/${this.profile.uid}`, structuredQuery: { from: [{ collectionId: 'dialogStates' }] } }
        reader.watch({ query }, this.credentials.signal, {
          snapshot: rows => {
            if (!active()) return
            if (kind === 'chats') { this.chatRows = rows; this.chatsCurrent = true }
            else { this.pinRows = rows; this.pinsCurrent = true }
            try { this.rebuild() } catch (error) { failed(error instanceof ReadFailure ? error : new ReadFailure('data')) }
          },
          // Telegram keeps the dialogs list while it reconnects; the next consistent snapshot replaces it.
          reconnecting: () => {
            if (!active()) return
            if (kind === 'chats') this.chatsCurrent = false
            else this.pinsCurrent = false
            this.dialogPins.pause(); this.manualUnread.pause(); this.delivery.pause(); this.reads.pause(); this.actions.pause(); this.notifications.pause()
            this.events.changed()
          },
          state: (state, error) => {
            if (!active()) return
            if (state === 'error') failed(error ?? new ReadFailure('network'))
            else if (state === 'loading') {
              if (kind === 'chats') this.chatsCurrent = false
              else this.pinsCurrent = false
              this.clearVisible('loading', error?.message ?? '')
            }
          },
        }, 10000)
      }
      observe('chats'); observe('pins')
    } catch (error) { failed(error instanceof ReadFailure ? error : new ReadFailure('data')) }
  }
  private rebuild(): void {
    if (!this.chatsCurrent || !this.pinsCurrent) return
    const pins = new Map<string, { pinned: boolean; rank: number; version: string }>()
    for (const doc of this.pinRows.values()) {
      const id = childId(doc.name, `${documents}/users/${this.profile.uid}/dialogStates`)
      const rank = numberField(doc.fields, 'rank')
      if (rank < 0 || rank > 1e12) throw new ReadFailure('data')
      pins.set(id, { pinned: boolField(doc.fields, 'isPinned'), rank, version: documentVersion(doc) })
    }
    this.discussionHistory.setSource(this.locked ? null : this.reader, this.chatRows)
    const index = new Map<string, ReadDialog>(), unlisted = new Set<string>()
    for (const doc of this.chatRows.values()) {
      const value = decodeDialog(doc, this.profile.uid)
      this.discussionHistory.apply(doc, value)
      // The server's boundary, before this device's own deletion moment replaces it.
      if (emptyRevokedDirect(value.summary, value.cutoff) && value.cutoff && !this.hiddenChats.keepsCleared(value.summary.id, value.cutoff)) unlisted.add(value.summary.id)
      withLocalDeletion(value, this.hiddenChats.cutoff(value.summary.id))
      this.topicDeletions.apply(value.summary)
      this.chatFlags.apply(value.summary)
      const unseen = value.summary.unseenReaction
      if (unseen && this.seenReactions.get(value.summary.id) === `${unseen.messageId}:${unseen.reactionVersion}`) delete value.summary.unseenReaction
      value.summary.pinned = pins.get(value.summary.id)?.pinned ?? false
      value.summary.pinVersion = pins.get(value.summary.id)?.version ?? ''
      index.set(value.summary.id, value)
    }
    this.index = index
    // A discussion row shows its channel's picture, so the channel documents follow the list.
    this.discussionAvatars.setVisible([...index.values()].flatMap(value =>
      value.summary.discussion && value.summary.channelId ? [value.summary.channelId] : []))
    this.list = [...index.values()].map(value => value.summary).filter(summary => !this.hiddenChats.hides(summary) && !unlisted.has(summary.id)).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.pinned) {
        const rank = (pins.get(b.id)?.rank ?? 0) - (pins.get(a.id)?.rank ?? 0)
        if (rank) return rank
      }
      if (a.top && b.top) return comparePosition(b.top, a.top)
      if (a.top || b.top) return a.top ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    // The open room stays open when it leaves the list (the other side deleted it for everyone): tdesktop keeps the
    // chat on screen, empty. A room that is listed again, or gone, needs no entry.
    const openId = this.selected?.dialog.summary.id
    if (openId && index.has(openId) && !this.list.some(dialog => dialog.id === openId)) this.unlistedOpen = openId
    if (this.unlistedOpen && (!index.has(this.unlistedOpen) || this.list.some(dialog => dialog.id === this.unlistedOpen))) this.unlistedOpen = null
    this.status = 'ready'; this.message = ''
    this.reminders()
    this.delivery.resume()
    this.reads.resume()
    this.actions.resume()
    this.inquiryRows.resume()
    this.folders.resume()
    this.dialogPreferences.resume()
    this.hiddenChats.load()
    this.hiddenMessages.load()
    this.chatFlags.load()
    this.contactFlags.load()
    this.acknowledgeReaction()
    const selected = this.selected
    const search = this.search
    if (search) {
      const fresh = index.get(search.dialog.summary.id)
      if (!fresh || fresh.summary.kind !== search.dialog.summary.kind || fresh.summary.historyAccess !== search.dialog.summary.historyAccess || JSON.stringify(fresh.cutoff) !== JSON.stringify(search.dialog.cutoff)) this.cancelSearch()
      else search.updateNames(fresh.participantNames)
    }
    if (selected) {
      const fresh = index.get(selected.dialog.summary.id)
      if (!fresh) this.clearHistory('error', new ReadFailure('permission').message)
      else if (fresh.summary.kind !== selected.dialog.summary.kind || fresh.summary.historyAccess !== selected.dialog.summary.historyAccess || JSON.stringify(fresh.cutoff) !== JSON.stringify(selected.dialog.cutoff)) this.openHistory(fresh)
      else { selected.updateNames(fresh.participantNames); this.draftReply.updateDialog(fresh); this.pins.updateDialog(fresh) }
    }
    this.pruneForwardPreparation()
    this.participantAdd.prune()
    this.groupName.prune()
    this.groupAnnouncement.prune()
    this.groupPhoto.prune(); this.groupPhotoEditor.prune(); this.groupPhotoUpload.prune(); this.dialogAvatars.prune()
    this.dialogPins.prune(); this.dialogPins.observe(this.pinRows)
    this.manualUnread.prune()
    this.channelPosts.observe(this.chatRows.values(), index, this.reader, this.credentials.signal)
    this.listTyping.bind(this.locked ? [] : this.list, this.locked ? null : this.reader)
    this.notifications.resume()
    this.events.changed()
  }
  private openHistory(dialog: ReadDialog): HistoryReader {
    this.clearHistory()
    this.presence.setPeers('chat', this.directPeers([dialog.summary.id]))
    if (!this.reader) throw new ReadFailure('network')
    this.pins.bind(dialog, this.reader)
    if (dialog.summary.kind !== 'secret') this.deferred.bind(dialog.summary.id, this.reader)
    // The header's «입력 중...»: iOS shows it in every room but a secret one and the memo space.
    if (dialog.summary.kind !== 'secret' && !dialog.summary.id.startsWith('memo_'))
      this.typing.bind(dialog.summary.id, dialog.summary.kind === 'direct' ? this.directPeers([dialog.summary.id])[0] ?? null : null, this.reader)
    const history = new HistoryReader(dialog, this.reader, snapshot => {
      if (this.selected === history && !this.closed) {
        this.media.prune(); this.pruneForwardPreparation()
        // The history reaches the window before the sent items it replaces leave it.
        this.events.history(dialog.summary.id, snapshot)
        this.delivery.shown(dialog.summary.id, new Set(snapshot.messages.map(message => message.id)))
      }
    }, () => ++this.revision, messageId => this.hiddenMessages.has(dialog.summary.id, messageId), () => !this.closed && !this.locked && this.selected === history)
    this.selected = history
    if (!this.locked) this.draftReply.bind(dialog, this.reader)
    queueMicrotask(() => { if (this.selected === history) this.acknowledgeReaction() })
    history.start(); this.notifications.resume(); return history
  }
  async history(chatId: string, before?: MessagePosition): Promise<HistorySnapshot> {
    if (this.closed || this.status !== 'ready' || !this.reader) return this.empty(this.status, this.message)
    const dialog = this.index.get(chatId)
    if (!dialog) return this.empty('error', new ReadFailure('permission').message)
    const history = this.selected?.dialog.summary.id === chatId ? this.selected : this.openHistory(dialog)
    const result = before ? await history.older(before) : history.snapshot
    // Superseded requests retain their old revision. The clear/new-owner event
    // already has a newer revision and must never be overwritten by this reply.
    return result
  }
  latestHistory(chatId: string): HistorySnapshot {
    const dialog = this.index.get(chatId)
    if (this.closed || this.status !== 'ready' || !dialog || !this.reader) return this.empty(this.status === 'ready' ? 'error' : this.status, this.message || new ReadFailure('permission').message)
    if (this.selected?.dialog.summary.id !== chatId || this.selected.snapshot.status === 'error') return this.openHistory(dialog).snapshot
    return this.selected.latest()
  }
  closeHistory(chatId: string): void { if (this.selected?.dialog.summary.id === chatId) this.clearHistory(); this.delivery.forget(chatId); this.actions.forget(chatId) }
  private backgroundSource(chatId: string): HistoryReader {
    const dialog = this.index.get(chatId)
    if (this.closed || this.locked || this.credentials.signal.aborted || this.status !== 'ready' || !dialog ||
      dialog.summary.kind === 'secret' || !dialog.summary.participantUids.includes(this.profile.uid) ||
      this.selected?.dialog.summary.id !== chatId || this.selected.snapshot.status !== 'ready') throw new Error(tr('일반 대화를 다시 선택해 주세요.'))
    return this.selected
  }
  backgroundPhotoLifetime(chatId: string): () => void {
    const source = this.backgroundSource(chatId)
    return () => { if (this.backgroundSource(chatId) !== source) throw new Error(tr('대화가 변경되었습니다.')) }
  }
  async backgroundPhoto(chatId: string, photoId: string): Promise<Uint8Array | null> {
    const validate = this.backgroundPhotoLifetime(chatId)
    const result = await this.delivery.backgroundState<Uint8Array | null>({ kind: 'chat-background-photo', chatId, photoId }, validate)
    try { validate(); return result }
    catch (error) { result?.fill(0); throw error }
  }
  async chatBackground(chatId: string, edit?: ChatBackgroundEdit, photo?: Uint8Array): Promise<ChatBackgroundRecord> {
    const source = this.backgroundSource(chatId)
    const validate = (): void => { if (this.backgroundSource(chatId) !== source) throw new Error(tr('대화가 변경되었습니다.')) }
    const operation = async (): Promise<ChatBackgroundRecord> => {
      const result = await this.delivery.backgroundState<ChatBackgroundRecord>(edit ? { kind: 'chat-background-save', chatId, edit, photo } : { kind: 'chat-background', chatId }, validate)
      validate()
      return result
    }
    return edit ? this.backgroundStorage.write(operation) : operation()
  }
  searchMessages(chatId: string, id: string, query: string): Promise<SearchSnapshot> {
    const dialog = this.index.get(chatId)
    if (this.closed || this.status !== 'ready' || !this.reader || this.selected?.dialog.summary.id !== chatId || !dialog || !historyReadable(dialog) || dialog.summary.kind === 'secret') throw new Error(tr('일반 대화가 준비된 뒤 검색해 주세요.'))
    this.cancelSearch()
    const search = new MessageSearch(id, { ...dialog }, query, this.reader, snapshot => this.events.search(chatId, snapshot), () => ++this.revision)
    this.search = search
    return search.more()
  }
  // The info panel's shared media (Telegram's Shared Media, iOS 미디어·파일·링크): the same bounded scan as a search,
  // keeping whole messages so the panel can draw and open them.
  sharedMedia(chatId: string, id: string, filter: SharedMediaFilter): Promise<SearchSnapshot> {
    const dialog = this.index.get(chatId)
    if (this.closed || this.status !== 'ready' || !this.reader || this.selected?.dialog.summary.id !== chatId || !dialog || !historyReadable(dialog) || dialog.summary.kind === 'secret') throw new Error(tr('일반 대화가 준비된 뒤 열어 주세요.'))
    this.cancelSearch()
    const search = new MessageSearch(id, { ...dialog }, filter, this.reader, snapshot => this.events.search(chatId, snapshot), () => ++this.revision, filter)
    this.search = search
    return search.more()
  }
  private requireSearch(chatId: string, id: string): MessageSearch {
    if (this.closed || this.status !== 'ready' || this.selected?.dialog.summary.id !== chatId || this.search?.id !== id || this.search.dialog.summary.id !== chatId) throw new Error(tr('검색이 변경되었습니다. 다시 검색해 주세요.'))
    return this.search
  }
  moreSearch(chatId: string, id: string): Promise<SearchSnapshot> { return this.requireSearch(chatId, id).more() }
  closeSearch(chatId: string, id: string): void { if (this.search?.id === id && this.search.dialog.summary.id === chatId) this.cancelSearch() }
  cancelSearch(): void { const old = this.search; this.search = null; old?.close() }
  jumpSearch(chatId: string, id: string, messageId: string): Promise<HistorySnapshot> {
    const target = this.requireSearch(chatId, id).target(messageId)
    if (!target || !this.selected) throw new Error(tr('검색 결과가 변경되었거나 만료되었습니다. 다시 검색해 주세요.'))
    return this.selected.jump(target)
  }
  async jumpDate(chatId: string, at: number): Promise<HistorySnapshot> {
    const history = this.selected
    if (this.closed || this.connection !== 'ready' || this.status !== 'ready' || !this.index.has(chatId) || history?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    const target = await history.dateTarget(at)
    if (this.selected !== history) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return target ? history.jump(target) : history.latest()
  }
  jumpReply(chatId: string, messageId: string, version: string): Promise<HistorySnapshot> {
    if (this.closed || this.connection !== 'ready' || this.status !== 'ready' || !this.index.has(chatId) || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    // The renderer identifies the current reply row, not an arbitrary original
    // document or timestamp. Resolve the target from this history owner only.
    const target = this.selected.replyTarget(messageId, version)
    if (!target) throw new Error(tr('원본 메시지를 확인할 수 없습니다. 다른 대화를 열었다 돌아와 주세요.'))
    return this.selected.jump(target)
  }
  messageActions(chatId: string) { return this.actions.snapshot(chatId) }
  contextLifetime(chatId: string, message: boolean): () => boolean {
    const generation = this.generation, history = this.selected
    return () => !this.closed && generation === this.generation && this.connection === 'ready' && this.status === 'ready' && this.index.has(chatId) &&
      (!message || Boolean(history && this.selected === history && history.dialog.summary.id === chatId))
  }
  contextDialog(chatId: string): DialogSummary | null {
    return !this.closed && this.connection === 'ready' && this.status === 'ready' ? this.index.get(chatId)?.summary ?? null : null
  }
  contextMessage(chatId: string, messageId: string, version: string) {
    const dialog = this.index.get(chatId)
    if (!this.contextDialog(chatId) || !dialog || dialog.summary.kind === 'secret' || this.selected?.dialog.summary.id !== chatId) return null
    const message = this.selected.actionMessage(messageId, version)
    if (!message || message.encrypted || !message.serverConfirmed) return null
    return { message, forward: !this.locked && canForwardMessage(message), reply: !this.locked && dialog.summary.composeAccess !== false && canReply(message), edit: canApplyAction({ kind: 'edit' }, message, dialog),
      delete: canApplyAction({ kind: 'delete' }, message, dialog), reaction: canApplyAction({ kind: 'reaction' }, message, dialog) }
  }
  private forwardDestination(chatId: string, sourceChatId: string): ForwardTarget | null {
    const dialog = this.contextDialog(chatId), row = this.chatRows.get(`${documents}/chats/${chatId}`)
    if (!dialog || dialog.composeAccess === false || !row || chatId === sourceChatId || chatId.startsWith('memo_') || dialog.kind === 'secret' || !dialog.participantUids.includes(this.profile.uid)) return null
    if (dialog.kind === 'direct') {
      const peers = [...new Set(dialog.participantUids)].filter(uid => uid !== this.profile.uid)
      if (dialog.participantUids.length !== 2 || peers.length !== 1 || boolField(mapField(mapField(row.fields, 'participantInfo'), peers[0]!), 'accountDeleted')) return null
    }
    return { chatId, title: dialog.title, kind: dialog.kind, preview: dialog.preview }
  }
  forwardTargets(source: ForwardSource): ForwardTarget[] {
    if (!this.contextMessage(source.chatId, source.messageId, source.version)?.forward) throw new Error(tr('전달할 최신 메시지를 다시 선택해 주세요.'))
    return this.list.flatMap(dialog => { const target = this.forwardDestination(dialog.id, source.chatId); return target ? [target] : [] })
  }
  // A message of an open inquiry room forwarded into chats. The room is named by its client id (sub_inq_<id>), so
  // the queue keeps it apart from any chat, and the content is re-sent exactly as a chat's forward is.
  private inquiryForwardSource(request: ForwardSource): ForwardMediaSource {
    const inquiryId = inquiryOfQueueChatId(request.chatId)
    if (!inquiryId) throw new Error(tr('전달할 문의 메시지를 다시 선택해 주세요.'))
    return this.channelInquiries.forwardSource(inquiryId, request.messageId, request.version)
  }
  inquiryForwardTargets(source: ForwardSource): ForwardTarget[] {
    const message = this.inquiryForwardSource(source).message
    if (this.locked || !canForwardMessage(message)) throw new Error(tr('전달할 최신 메시지를 다시 선택해 주세요.'))
    return this.list.flatMap(dialog => { const target = this.forwardDestination(dialog.id, source.chatId); return target ? [target] : [] })
  }
  forwardInquiryText(request: ForwardRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    return this.delivery.enqueueForward(request, () => {
      const message = this.inquiryForwardSource(request.source).message
      if (!canForwardText(message)) throw new Error(tr('원본이 변경되었거나 만료되었습니다. 최신 텍스트를 다시 선택해 주세요.'))
      if (request.targets.some(target => !this.forwardDestination(target.chatId, request.source.chatId))) throw new Error(tr('전달할 수 없는 대화가 있습니다. 대상을 다시 선택해 주세요.'))
      return { text: message.text, isSilent: false }
    })
  }
  forwardInquiryMedia(request: ForwardRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    const previous = this.forwardPreparation
    if (previous) {
      if (JSON.stringify(previous.request) === JSON.stringify(request)) return previous.task!
      throw new Error(tr('이전 첨부 전달 준비가 끝난 뒤 다시 시도해 주세요.'))
    }
    const resolve = (): ForwardMediaSource => {
      const source = this.inquiryForwardSource(request.source)
      if (!canForwardMedia(source.message)) throw new Error(tr('원본이 변경되었거나 만료되었습니다. 최신 첨부를 다시 선택해 주세요.'))
      if (request.targets.some(target => !this.forwardDestination(target.chatId, request.source.chatId))) throw new Error(tr('전달 대상이 변경되었습니다. 대화를 다시 확인해 주세요.'))
      return source
    }
    const owner = { request, validate: () => { resolve() }, abort: new AbortController(), committing: false, task: null as Promise<void> | null }
    this.forwardPreparation = owner
    const signal = AbortSignal.any([owner.abort.signal, this.credentials.signal])
    const validate = (): void => { signal.throwIfAborted(); resolve() }
    const progress = (value: Omit<ForwardProgress, 'operationId'>): void => {
      if (!this.closed && !this.locked && this.forwardPreparation === owner) this.events.forwardProgress({ operationId: request.id, ...value })
    }
    owner.task = this.delivery.enqueueForwardMedia(request,
      () => prepareForwardMedia(this.credentials, resolve, request.targets.length, signal, progress), validate,
      () => { owner.committing = true; progress({ phase: 'saving', current: 0, count: 0, loaded: 0, total: null }) })
      .finally(() => { if (this.forwardPreparation === owner) this.forwardPreparation = null })
    return owner.task
  }
  forwardText(request: ForwardRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    return this.delivery.enqueueForward(request, () => {
      const source = this.contextMessage(request.source.chatId, request.source.messageId, request.source.version)
      if (!source?.forward || !canForwardText(source.message)) throw new Error(tr('원본이 변경되었거나 만료되었습니다. 최신 텍스트를 다시 선택해 주세요.'))
      if (request.targets.some(target => !this.forwardDestination(target.chatId, request.source.chatId))) throw new Error(tr('전달할 수 없는 대화가 있습니다. 대상을 다시 선택해 주세요.'))
      return { text: source.message.text, isSilent: Boolean(source.message.silent) }
    })
  }
  forwardTexts(request: TextForwardBatchRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    return this.delivery.enqueueForwardTexts(request, () => {
      const messages = request.sources.map(source => {
        const current = this.contextMessage(source.chatId, source.messageId, source.version)
        if (!current?.forward || !canForwardText(current.message)) throw new Error(tr('선택한 텍스트가 변경되거나 만료되었습니다. 일부만 전달하지 않았습니다. 선택을 다시 확인해 주세요.'))
        return current.message
      })
      if (messages.some((message, index) => index > 0 && comparePosition(messages[index - 1]!.position, message.position) >= 0)) throw new Error(tr('메시지 순서가 변경되었습니다. 원래 대화 순서로 다시 선택해 주세요.'))
      if (request.targets.some(target => !this.forwardDestination(target.chatId, request.sources[0]!.chatId))) throw new Error(tr('전달 대상이 변경되었습니다.'))
      return messages.map(message => ({ text: message.text, isSilent: Boolean(message.silent) }))
    })
  }
  private forwardMediaSource(request: ForwardRequest): ForwardMediaSource {
    const source = this.contextMessage(request.source.chatId, request.source.messageId, request.source.version)
    if (!source?.forward || !canForwardMedia(source.message) || !this.selected) throw new Error(tr('원본이 변경되었거나 만료되었습니다. 최신 첨부를 다시 선택해 주세요.'))
    if (request.targets.some(target => !this.forwardDestination(target.chatId, request.source.chatId))) throw new Error(tr('전달 대상이 변경되었습니다. 대화를 다시 확인해 주세요.'))
    const resources = source.message.attachments!.map(part => {
      const resource = this.selected!.mediaResource({ requestId: request.id, messageId: source.message.id, version: source.message.version, index: part.index })
      if (!resource?.path || !resource.summary.available) throw new Error(tr('첨부 원본을 확인하지 못했습니다.'))
      return resource
    })
    return { message: source.message, resources }
  }
  private cancelForwardPreparation(): void {
    if (this.forwardPreparation && !this.forwardPreparation.committing) this.forwardPreparation.abort.abort()
  }
  private pruneForwardPreparation(): void {
    const owner = this.forwardPreparation
    if (owner && !owner.committing) {
      try { owner.validate() } catch { owner.abort.abort() }
    }
  }
  cancelForward(operationId: string): boolean {
    const owner = this.forwardPreparation
    if (!owner || owner.request.id !== operationId || owner.committing) return false
    owner.abort.abort(); return true
  }
  forwardMedia(request: ForwardRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    const previous = this.forwardPreparation
    if (previous) {
      if (JSON.stringify(previous.request) === JSON.stringify(request)) return previous.task!
      throw new Error(tr('이전 첨부 전달 준비가 끝난 뒤 다시 시도해 주세요.'))
    }
    const owner = { request, validate: () => { this.forwardMediaSource(request) }, abort: new AbortController(), committing: false, task: null as Promise<void> | null }
    this.forwardPreparation = owner
    const signal = AbortSignal.any([owner.abort.signal, this.credentials.signal])
    const validate = (): void => { signal.throwIfAborted(); this.forwardMediaSource(request) }
    const progress = (value: Omit<ForwardProgress, 'operationId'>): void => {
      if (!this.closed && !this.locked && this.forwardPreparation === owner) this.events.forwardProgress({ operationId: request.id, ...value })
    }
    owner.task = this.delivery.enqueueForwardMedia(request,
      () => prepareForwardMedia(this.credentials, () => this.forwardMediaSource(request), request.targets.length, signal, progress), validate,
      () => { owner.committing = true; progress({ phase: 'saving', current: 0, count: 0, loaded: 0, total: null }) })
      .finally(() => { if (this.forwardPreparation === owner) this.forwardPreparation = null })
    return owner.task
  }
  private forwardBatchSources(request: ForwardBatchRequest): ForwardMediaSource[] {
    const sources = request.sources.map((source, index) => {
      const current = this.contextMessage(source.chatId, source.messageId, source.version)
      if (!current?.forward) throw new Error(tr('선택한 원본이 변경되거나 만료되었습니다. 일부만 전달하지 않았습니다. 선택을 다시 확인해 주세요.'))
      if (canForwardText(current.message)) return { message: current.message, resources: [] }
      return this.forwardMediaSource({ id: request.id, source, targets: request.targets.map(target => ({ chatId: target.chatId, messageId: target.messageIds[index]! })) })
    })
    if (sources.some((source, index) => index > 0 && comparePosition(sources[index - 1]!.message.position, source.message.position) >= 0)) throw new Error(tr('메시지 순서가 변경되었습니다. 원래 대화 순서로 다시 선택해 주세요.'))
    if (request.targets.some(target => !this.forwardDestination(target.chatId, request.sources[0]!.chatId))) throw new Error(tr('전달 대상이 변경되었습니다.'))
    return sources
  }
  forwardBatch(request: ForwardBatchRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    const previous = this.forwardPreparation
    if (previous) {
      if (JSON.stringify(previous.request) === JSON.stringify(request)) return previous.task!
      throw new Error(tr('이전 전달 준비가 끝난 뒤 다시 시도해 주세요.'))
    }
    const owner = { request, validate: () => { this.forwardBatchSources(request) }, abort: new AbortController(), committing: false, task: null as Promise<void> | null }
    this.forwardPreparation = owner
    const signal = AbortSignal.any([owner.abort.signal, this.credentials.signal])
    const validate = (): void => { signal.throwIfAborted(); owner.validate() }
    const progress = (value: Omit<ForwardProgress, 'operationId'>): void => {
      if (!this.closed && !this.locked && this.forwardPreparation === owner) this.events.forwardProgress({ operationId: request.id, ...value })
    }
    owner.task = this.delivery.enqueueForwardBatch(request,
      () => prepareForwardBatch(this.credentials, () => this.forwardBatchSources(request), request.targets.length, signal, progress), validate,
      () => { owner.committing = true; progress({ phase: 'saving', current: 0, count: 0, loaded: 0, total: null }) })
      .finally(() => { if (this.forwardPreparation === owner) this.forwardPreparation = null })
    return owner.task
  }
  // A message forwarded into rooms, from a chat or from another room. A room is not a queue: its messages are sent
  // as they are composed (sendMorseInquiryMessage), so a forward into one is sent the same way, once its content
  // has been prepared exactly as a forward into a chat prepares it.
  private forwardContentSource(id: string, source: ForwardSource): ForwardMediaSource {
    if (inquiryOfQueueChatId(source.chatId)) return this.inquiryForwardSource(source)
    const current = this.contextMessage(source.chatId, source.messageId, source.version)
    if (!current?.forward || !this.selected) throw new Error(tr('원본이 변경되었거나 만료되었습니다. 최신 메시지를 다시 선택해 주세요.'))
    if (canForwardText(current.message)) return { message: current.message, resources: [] }
    if (!canForwardMedia(current.message)) throw new Error(tr('전달할 수 있는 첨부를 다시 선택해 주세요.'))
    const resources = current.message.attachments!.map(part => {
      const resource = this.selected!.mediaResource({ requestId: id, messageId: current.message.id, version: current.message.version, index: part.index })
      if (!resource?.path || !resource.summary.available) throw new Error(tr('첨부 원본을 확인하지 못했습니다.'))
      return resource
    })
    return { message: current.message, resources }
  }
  inquiryForwardRooms(source: ForwardSource): InquiryForwardRoom[] {
    if (this.locked || !canForwardMessage(this.forwardContentSource(source.messageId, source).message)) throw new Error(tr('전달할 최신 메시지를 다시 선택해 주세요.'))
    const room = inquiryOfQueueChatId(source.chatId)
    return this.inquiryRows.forwardRooms().filter(item => item.inquiryId !== room)
  }
  async forwardToInquiries(request: InquiryForwardRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    if (this.inquiryForward) throw new Error(tr('이전 전달이 끝난 뒤 다시 시도해 주세요.'))
    const abort = new AbortController()
    const signal = AbortSignal.any([abort.signal, this.credentials.signal])
    const resolve = (): ForwardMediaSource => this.forwardContentSource(request.id, request.source)
    const validate = (): void => {
      signal.throwIfAborted()
      if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
      resolve()
    }
    const progress = (value: Omit<ForwardProgress, 'operationId'>): void => {
      if (!this.closed && !this.locked) this.events.forwardProgress({ operationId: request.id, ...value })
    }
    const task = (async () => {
      const source = resolve()
      if (canForwardText(source.message)) {
        for (const inquiryId of request.inquiryIds) await this.channelInquiries.deliverForward(inquiryId, { kind: 'text', text: source.message.text }, validate)
        return
      }
      const media = await prepareForwardMedia(this.credentials, resolve, request.inquiryIds.length, signal, progress)
      try {
        progress({ phase: 'saving', current: 0, count: 0, loaded: 0, total: null })
        for (const inquiryId of request.inquiryIds) await this.channelInquiries.deliverForward(inquiryId, { kind: 'media', media }, validate)
      } finally { for (const part of media.parts) part.bytes.fill(0) }
    })()
    this.inquiryForward = task
    try { await task } finally { if (this.inquiryForward === task) this.inquiryForward = null }
  }

  // Several messages of one open room, forwarded in their own order, as a chat's selection is.
  private inquiryForwardBatchSources(request: ForwardBatchRequest): ForwardMediaSource[] {
    const sources = request.sources.map(source => {
      const current = this.inquiryForwardSource(source)
      if (!canForwardMessage(current.message)) throw new Error(tr('선택한 원본이 변경되거나 만료되었습니다. 일부만 전달하지 않았습니다. 선택을 다시 확인해 주세요.'))
      return canForwardText(current.message) ? { message: current.message, resources: [] } : current
    })
    if (sources.some((source, index) => index > 0 && comparePosition(sources[index - 1]!.message.position, source.message.position) >= 0)) throw new Error(tr('메시지 순서가 변경되었습니다. 원래 대화 순서로 다시 선택해 주세요.'))
    if (request.targets.some(target => !this.forwardDestination(target.chatId, request.sources[0]!.chatId))) throw new Error(tr('전달 대상이 변경되었습니다.'))
    return sources
  }
  forwardInquiryBatch(request: ForwardBatchRequest): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    const previous = this.forwardPreparation
    if (previous) {
      if (JSON.stringify(previous.request) === JSON.stringify(request)) return previous.task!
      throw new Error(tr('이전 전달 준비가 끝난 뒤 다시 시도해 주세요.'))
    }
    const owner = { request, validate: () => { this.inquiryForwardBatchSources(request) }, abort: new AbortController(), committing: false, task: null as Promise<void> | null }
    this.forwardPreparation = owner
    const signal = AbortSignal.any([owner.abort.signal, this.credentials.signal])
    const validate = (): void => { signal.throwIfAborted(); owner.validate() }
    const progress = (value: Omit<ForwardProgress, 'operationId'>): void => {
      if (!this.closed && !this.locked && this.forwardPreparation === owner) this.events.forwardProgress({ operationId: request.id, ...value })
    }
    owner.task = this.delivery.enqueueForwardBatch(request,
      () => prepareForwardBatch(this.credentials, () => this.inquiryForwardBatchSources(request), request.targets.length, signal, progress), validate,
      () => { owner.committing = true; progress({ phase: 'saving', current: 0, count: 0, loaded: 0, total: null }) })
      .finally(() => { if (this.forwardPreparation === owner) this.forwardPreparation = null })
    return owner.task
  }
  openMedia(chatId: string, request: MediaRequest) { return this.media.open(chatId, request) }
  sendInquiryPhoto(request: import('../../shared/channel-inquiries').InquiryPhotoRequest, bytes: Uint8Array) {
    return this.channelInquiries.sendPhoto(request, bytes)
  }
  // The attachment of one message of the open room, for an explicit viewing or a preview.
  private mediaResourceFor(chatId: string, request: MediaRequest) {
    if (this.closed || this.status !== 'ready') return null
    // A channel inquiry room answers for its own id; its photos live under the inquiry_* prefixes.
    const inquiry = this.channelInquiries.mediaResource(chatId, request)
    if (inquiry) return inquiry
    if (this.selected?.dialog.summary.id !== chatId || !this.index.has(chatId)) return null
    return this.selected.mediaResource(request) ?? (this.search?.dialog.summary.id === chatId ? this.search.mediaResource(request) : null)
  }
  photoPreview(chatId: string, request: MediaRequest): Promise<string | null> {
    if (this.closed || this.locked) return Promise.resolve(null)
    return this.photoPreviews.load(chatId, request)
  }
  // A message that carried no placeholder of its own still gets one, whatever the automatic
  // download preference says - Telegram asks the server for the small size in exactly that case.
  photoThumb(chatId: string, request: MediaRequest): Promise<string | null> {
    if (this.closed || this.locked) return Promise.resolve(null)
    return this.photoPreviews.loadThumb(chatId, request)
  }
  photoPreviewResponse(token: string, request: Request): Response { return this.photoPreviews.response(token, request) }
  // Telegram's row menu keeps these apart: "Clear history" leaves the room in the list, "Delete
  // chat" removes it. For me only is this device's hide; for everyone follows iOS performDelete -
  // a private room's history is revoked through the callable and then the room document goes, and a
  // group may only be deleted by the person who created it (firestore.rules), others leave it.
  async deleteChat(chatId: string, forEveryone: boolean): Promise<'done' | 'unconfirmed'> {
    const dialog = this.index.get(chatId)?.summary
    if (this.closed || this.locked || !dialog) throw new Error(tr('대화를 다시 선택해 주세요.'))
    if (!forEveryone) {
      await this.hiddenChats.hide(chatId, dialog.top)
      if (this.chatsCurrent && this.pinsCurrent) this.rebuild()
      this.events.changed()
      return 'done'
    }
    if (this.connection !== 'ready' || !this.reader) throw new Error(tr('계정 연결을 확인해 주세요.'))
    if (dialog.kind === 'group' && dialog.createdBy !== this.profile.uid) throw new Error(tr('그룹은 만든 사람만 삭제할 수 있어요. 그룹 나가기를 사용해 주세요.'))
    // Telegram deletes a private chat as messages.deleteHistory(peer, max_id, revoke): the peer and its dialog stay,
    // the history up to the boundary goes, and the chat leaves the list because it has no last message
    // (ApiWrap::deleteHistory → Data::Session::deleteConversationLocally → History::clear(DeleteChat)). iOS does the
    // same (AppState.deleteDirectChatHistory). The 1:1 document is the dialog - its id is the pair's - so it is kept:
    // deleting it threw the boundary away, and the room came back under the same id without one.
    if (dialog.kind === 'direct') return await this.accountTools.revokeDirectHistory(chatId) === 'unconfirmed' ? 'unconfirmed' : 'done'
    try { await this.reader.deleteChatDocument(chatId, this.credentials.signal) }
    catch (error) {
      throw new Error((error as { uncertain?: boolean }).uncertain
        ? tr('삭제 결과를 확인하지 못했습니다. 잠시 후 대화 목록을 확인해 주세요.') : tr('대화를 삭제하지 못했습니다.'))
    }
    return 'done'
  }
  // Telegram's "Clear history" for both sides (ApiWrap::clearHistory → just_clear): the chat stays in the list. The
  // boundary the server wrote is kept so that the emptied room is not taken for a deleted one (HiddenChats.keepsCleared).
  async clearChatHistory(chatId: string): Promise<'done' | 'unconfirmed'> {
    if (this.closed || this.locked) throw new Error(tr('대화를 다시 선택해 주세요.'))
    this.hiddenChats.beginClear(chatId)
    try {
      const result = await this.accountTools.clearChatHistory(chatId)
      if (result.cutoff !== null) await this.hiddenChats.noteCleared(chatId, result.cutoff)
      return result.state
    } finally {
      this.hiddenChats.endClear(chatId)
      if (!this.closed && this.chatsCurrent && this.pinsCurrent) { this.rebuild(); this.events.changed() }
    }
  }
  // AppState.markReactionSeen: the open chat's unseen reaction is cleared here at once and acknowledged with its
  // version, so a newer reaction that arrives meanwhile is not cleared by it.
  private acknowledgeReaction(): void {
    const chatId = this.selected?.dialog.summary.id
    const current = chatId ? this.index.get(chatId)?.summary : undefined
    const raw = current && this.chatRows.get(`${documents}/chats/${current.id}`)
    const unseen = raw ? decodeDialog(raw, this.profile.uid).summary.unseenReaction : undefined
    if (this.closed || this.locked || !chatId || !unseen) return
    const token = `${unseen.messageId}:${unseen.reactionVersion}`
    if (this.seenReactions.get(chatId) === token) return
    this.seenReactions.set(chatId, token)
    if (current) delete current.unseenReaction
    this.events.changed()
    void callMorseFunction(this.credentials, 'markMorseReactionSeen', { chatId, messageId: unseen.messageId, reactionVersion: unseen.reactionVersion, expectedUid: this.profile.uid },
      this.credentials.signal).catch(() => {
      if (this.seenReactions.get(chatId) !== token) return
      this.seenReactions.delete(chatId)
      if (!this.closed && this.chatsCurrent && this.pinsCurrent) { this.rebuild(); this.events.changed() }
    })
  }
  // ChannelService.loadLikers: my contacts are named from the list here; everyone else through resolveUsersByUids.
  async openPostLikers(request: PostLikersRequest): Promise<'done'> {
    const uids = this.channels.posts.likerUids(request.channelId, request.postId)
    if (this.closed || this.locked || !uids) throw new Error(tr('게시물을 다시 선택해 주세요.'))
    const contacts = new Map((this.contacts.snapshot.items ?? []).map(item => [item.uid, item]))
    const state: NonNullable<typeof this.likers> = { ...request, status: 'loading', partial: false, message: '', items: [] }
    this.likers = state; this.events.changed()
    const known = new Map<string, { name: string; handle: string; private: boolean; photoURL: string | null }>()
    for (const uid of uids) {
      if (uid === this.profile.uid) known.set(uid, { name: tr('나'), handle: '', private: false, photoURL: null })
      else if (contacts.has(uid)) known.set(uid, { name: contacts.get(uid)!.displayName, handle: '', private: false, photoURL: null })
    }
    const unknown = uids.filter(uid => !known.has(uid) || uid !== this.profile.uid)
    for (let start = 0; start < unknown.length; start += 100) {
      try {
        const result = await callMorseFunction(this.credentials, 'resolveUsersByUids', { uids: unknown.slice(start, start + 100) }, this.credentials.signal)
        for (const raw of Array.isArray(result.users) ? result.users : []) {
          const user = raw as Record<string, unknown>, uid = typeof user.uid === 'string' ? user.uid : ''
          if (!uid) continue
          const contact = contacts.has(uid), userId = typeof user.userId === 'string' ? user.userId : ''
          const name = contact ? known.get(uid)!.name : (typeof user.displayName === 'string' && user.displayName.trim()) || userId || 'Morse'
          const hidden = user.isPrivate === true && !contact && uid !== this.profile.uid
          known.set(uid, { name: hidden ? tr('비공개 사용자') : name.slice(0, 50), handle: contact || uid === this.profile.uid ? userId : '••••••', private: hidden,
            photoURL: hidden ? null : typeof user.photoURL === 'string' && user.photoURL ? user.photoURL.slice(0, 2000) : null })
        }
      } catch { state.partial = true }
    }
    if (this.likers !== state) return 'done'
    state.items = uids.flatMap(uid => { const item = known.get(uid); return item ? [{ uid, name: item.name, handle: item.handle, private: item.private, photoURL: item.photoURL }] : [] })
    state.partial ||= state.items.length < uids.length
    state.status = 'ready'; this.events.changed()
    return 'done'
  }
  closePostLikers(requestId: string): void { if (this.likers?.requestId === requestId) { this.likers = null; this.events.changed() } }
  postLikers(): PostLikersSnapshot | null {
    const value = this.likers
    return this.closed || this.locked || !value ? null : { ...value, items: value.items.map(({ photoURL, ...item }) => ({ ...item, photo: this.channelPeople.image(item.uid, photoURL) })) }
  }
  // MorseStickerLibrary for this account: listed once and after each change; bytes are served on __sticker.
  stickers(): StickerItem[] | null {
    if (this.closed || this.locked) return null
    if (!this.stickerList && !this.stickerLoad) {
      this.stickerLoad = this.delivery.stickerState<{ id: string; kind: StickerKind; size: number }[]>({ kind: 'stickers-list' })
        .then(rows => { this.stickerList = rows; if (!this.closed) this.events.changed() }).catch(() => {}).finally(() => { this.stickerLoad = null })
    }
    return this.stickerList?.map(item => ({ ...item, url: `morse://app/__sticker/${item.id}` })) ?? null
  }
  async addSticker(bytes: Uint8Array): Promise<string> {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    try {
      const saved = await this.delivery.stickerState<{ id: string }>({ kind: 'sticker-add', data: bytes })
      this.stickerList = null; this.events.changed()
      return saved.id
    } catch (error) {
      const code = (error as { code?: string }).code
      throw new Error(code === 'capacity' ? tr('스티커는 200개까지 보관할 수 있어요.') : tr('스티커로 저장할 수 없는 파일이에요. PNG, GIF 또는 MP4를 사용해 주세요.'))
    }
  }
  async removeSticker(id: string): Promise<'done'> {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    await this.delivery.stickerState({ kind: 'sticker-remove', id })
    this.stickerList = null; this.events.changed()
    return 'done'
  }
  // Telegram StickerPackScreen: the set of a tapped sticker, the installed sets, and their stickers.
  stickerPackSnapshot() { return this.closed ? null : this.stickerPacks.snapshot() }
  installedStickerPacks() { return this.closed ? null : this.stickerPacks.installedPacks() }
  async openStickerPack(chatId: string, messageId: string, version: string): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    await this.stickerPacks.open(chatId, messageId, version)
  }
  closeStickerPack(): void { if (!this.closed) this.stickerPacks.closeSheet() }
  async installStickerPack(setId: string): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    await this.stickerPacks.install(setId)
  }
  async uninstallStickerPack(setId: string): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    await this.stickerPacks.uninstall(setId)
  }
  // MediaEditorScreen StickerAction: a new set, or a sticker added to a set this account made.
  async ownedStickerPacks() {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    return this.stickerPacks.ownedPacks()
  }
  async createStickerPack(title: string) {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    return this.stickerPacks.createPack(title, this.selfProfile.snapshot.profile?.displayName ?? '')
  }
  async addStickerToPack(setId: string, bytes: Uint8Array) {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    return this.stickerPacks.addToPack(setId, bytes)
  }
  // A sticker chosen from a set is kept in this device's library first (Telegram's recent stickers), then sent
  // through the same queue as a library sticker; the receiver finds the set again by the bytes' hash.
  async sendPackSticker(chatId: string, id: string, setId: string, itemId: string, reply: ReplyBinding | null): Promise<void> {
    if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    const bytes = await this.stickerPacks.itemBytes(setId, itemId)
    const stickerId = await this.addSticker(new Uint8Array(bytes))
    await this.sendSticker(chatId, id, stickerId, reply)
  }
  // The same sticker sent into a 1:1 inquiry room, from this device's library or from an installed set.
  async sendInquirySticker(request: import('../../shared/channel-inquiries').InquiryTargetRequest, stickerId: string): Promise<'sent' | 'unconfirmed'> {
    if (this.closed || this.locked) throw new Error(tr('문의를 다시 열어 주세요.'))
    const stored = await this.delivery.stickerState<{ kind: StickerKind; data: Uint8Array } | null>({ kind: 'sticker-read', id: stickerId })
    if (!stored) throw new Error(tr('스티커를 찾지 못했습니다. 보관함을 확인해 주세요.'))
    return this.channelInquiries.sendSticker(request, { extension: stored.kind, bytes: Buffer.from(stored.data) })
  }
  async sendInquiryPackSticker(request: import('../../shared/channel-inquiries').InquiryTargetRequest, setId: string, itemId: string): Promise<'sent' | 'unconfirmed'> {
    if (this.closed || this.locked) throw new Error(tr('문의를 다시 열어 주세요.'))
    const bytes = await this.stickerPacks.itemBytes(setId, itemId)
    const stickerId = await this.addSticker(new Uint8Array(bytes))
    return this.sendInquirySticker(request, stickerId)
  }
  stickerPackResponse(setId: string, itemId: string, request: Request): Promise<Response> { return this.stickerPacks.response(setId, itemId, request) }
  async stickerResponse(id: string, request: Request): Promise<Response> {
    if (this.closed || this.locked || request.method !== 'GET' || !/^[a-f0-9]{64}$/.test(id)) return new Response(null, { status: 403 })
    const stored = await this.delivery.stickerState<{ kind: StickerKind; data: Uint8Array } | null>({ kind: 'sticker-read', id }).catch(() => null)
    if (!stored) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(stored.data), { headers: { 'Content-Type': stickerContentType[stored.kind], 'Content-Length': String(stored.data.byteLength), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
  async sendSticker(chatId: string, id: string, stickerId: string, reply: ReplyBinding | null): Promise<void> {
    if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    await this.delivery.enqueueSticker(chatId, id, stickerId, reply, () => {
      if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
      if (reply) this.draftReply.validate(chatId, reply)
    })
    await this.draftReply.refresh(chatId)
  }
  contactsSnapshot() {
    const value = this.contacts.snapshot
    return { ...value, items: value.items.map(item => ({ ...item, ...this.contactFlags.get(item.uid) })) }
  }
  async setContactFlags(uid: string, patch: { favorite?: boolean; archived?: boolean }): Promise<'done'> {
    if (this.closed || this.locked || !this.contacts.has(uid)) throw new Error(tr('연락처를 다시 선택해 주세요.'))
    await this.contactFlags.set(uid, patch)
    return 'done'
  }
  async setChatFlags(chatId: string, patch: { muted?: boolean; archived?: boolean; category?: string | null }): Promise<'done'> {
    if (this.closed || this.locked || !this.index.has(chatId)) throw new Error(tr('대화를 다시 선택해 주세요.'))
    const forum = this.index.get(chatId)!.summary.forum
    if (patch.category && !forum?.categories.some(category => category.id === patch.category)) throw new Error(tr('카테고리를 다시 선택해 주세요.'))
    await this.chatFlags.set(chatId, patch)
    if (patch.muted !== undefined || patch.archived !== undefined) this.syncDialogPreference(chatId)
    return 'done'
  }
  // Only the channel's owner posts or removes its stories (firestore.rules isChannelOwner).
  ownsChannel(channelId: string): boolean {
    return !this.closed && this.channels.currentDocument(channelId)?.fields.ownerId?.stringValue === this.profile.uid
  }
  // The mute this device chose also goes to the account's own dialog preference document
  // (users/{uid}/settings/dialog_{chatId}, the one iOS and Android write), so the push functions stop
  // notifying this account on every device. The local choice stays the list's truth; a failed write is
  // retried by the next change, never by itself, and the shared room document is never written.
  private syncDialogPreference(chatId: string): void {
    const reader = this.reader
    if (!reader || this.closed || this.locked) return
    const flags = this.chatFlags.current(chatId), operationId = randomUUID()
    this.dialogPreferences.wrote(chatId, operationId)
    void reader.writeDialogPreference(this.profile.uid, { chatId, muted: flags.muted, archived: flags.archived, operationId }, this.credentials.signal,
      () => { if (this.closed || this.locked) throw new Error('Account changed before the preference write') }).catch(() => { this.dialogPreferences.writeFailed(chatId, operationId) })
  }
  // AppState.setGroupForumEnabled / createGroupCategory: only the group's creator changes its topics, and the
  // room document carries isForumEnabled, forumCategories and generalForumCategoryId.
  async setGroupForum(chatId: string, enabled: boolean): Promise<'done'> {
    const reader = this.forumOwner(chatId)
    const fields: Record<string, WireObject> = enabled
      ? { isForumEnabled: { booleanValue: true }, forumCategories: forumCategoriesValue([{ id: generalCategoryId, name: tr('일반', [], 'category'), icon: 'number', sortOrder: 0, isGeneral: true }]), generalForumCategoryId: { stringValue: generalCategoryId } }
      : { isForumEnabled: { booleanValue: false } }
    await reader.updateChatFields(chatId, fields, ['isForumEnabled', 'forumCategories', 'generalForumCategoryId'], this.credentials.signal)
    if (!enabled) await this.chatFlags.set(chatId, { category: null }).catch(() => {})
    return 'done'
  }
  async addForumCategory(chatId: string, name: string): Promise<'done'> {
    const reader = this.forumOwner(chatId), forum = this.index.get(chatId)!.summary.forum
    if (!forum) throw new Error(tr('카테고리를 먼저 켜 주세요.'))
    const categories = [...forum.categories, { id: crypto.randomUUID().toUpperCase(), name, icon: 'number', sortOrder: forum.categories.length, isGeneral: false }]
    await reader.updateChatFields(chatId, { forumCategories: forumCategoriesValue(categories) }, ['forumCategories'], this.credentials.signal)
    return 'done'
  }
  // EditForumTopicBox → messages.editForumTopic with the title: the room's topic list is written again with the one
  // topic renamed. The general topic keeps its place and its flag; only its name changes, as in Telegram.
  async renameForumCategory(chatId: string, categoryId: string, name: string): Promise<'done'> {
    const reader = this.forumOwner(chatId), forum = this.index.get(chatId)!.summary.forum
    if (!forum?.categories.some(value => value.id === categoryId)) throw new Error(tr('이미 삭제된 카테고리입니다.'))
    if (forum.categories.find(value => value.id === categoryId)!.name === name) return 'done'
    const categories = forum.categories.map(value => value.id === categoryId ? { ...value, name } : value)
    await reader.updateChatFields(chatId, { forumCategories: forumCategoriesValue(categories) }, ['forumCategories'], this.credentials.signal)
    return 'done'
  }
  // Telegram's «Delete topic» (Window::PeerMenuDeleteTopicWithConfirmation): the box closes at once and the deletion
  // goes on by itself (TopicDeletions); the general topic cannot be deleted.
  async deleteForumCategory(chatId: string, categoryId: string): Promise<'done'> {
    const forum = (this.forumOwner(chatId), this.index.get(chatId)!.summary.forum)
    const category = forum?.categories.find(value => value.id === categoryId)
    if (!forum || !category) throw new Error(tr('이미 삭제된 카테고리입니다.'))
    if (category.isGeneral || category.id === forum.generalId) throw new Error(tr('일반 카테고리는 삭제할 수 없어요.'))
    this.topicDeletions.start(chatId, categoryId)
    return 'done'
  }
  // One attempt: the messages go first, so an attempt cut short leaves the topic to be deleted by the next one, then
  // the topic leaves the list, and what was sent to it meanwhile goes after it.
  private async deleteTopic(chatId: string, categoryId: string, stop: AbortSignal): Promise<void> {
    const reader = this.reader, summary = this.index.get(chatId)?.summary
    if (this.closed || this.locked || this.connection !== 'ready' || !reader || !summary) throw new Error(tr('계정 연결을 확인해 주세요.'))
    if (summary.kind !== 'group' || summary.createdBy !== this.profile.uid || summary.discussion) throw new TopicDeletionStop(tr('그룹을 만든 사람만 카테고리를 바꿀 수 있어요.'))
    const signal = AbortSignal.any([this.credentials.signal, stop])
    const alive = (): void => { if (this.closed || this.locked || signal.aborted || this.reader !== reader) throw new Error(tr('계정 연결을 확인해 주세요.')) }
    const messages = {
      page: (limit: number) => reader.query(`${documents}/chats/${chatId}`, { from: [{ collectionId: 'messages' }],
        where: { fieldFilter: { field: { fieldPath: 'categoryId' }, op: 'EQUAL', value: { stringValue: categoryId } } }, limit: { value: limit } }, signal),
      remove: (docs: FirestoreDocument[], tombstone: boolean) => reader.deleteMessages(chatId, docs, this.profile.uid, tombstone, signal),
    }
    await deleteTopicMessages(messages, alive)
    alive()
    const current = this.index.get(chatId)?.summary.forum
    if (current?.categories.some(value => value.id === categoryId)) {
      // MorseGroupCategory.sortOrder counts the topics before it, as createGroupCategory numbers a new one.
      const categories = current.categories.filter(value => value.id !== categoryId).sort((a, b) => a.sortOrder - b.sortOrder).map((value, index) => ({ ...value, sortOrder: index }))
      await reader.updateChatFields(chatId, { forumCategories: forumCategoriesValue(categories) }, ['forumCategories'], signal)
    }
    await deleteTopicMessages(messages, alive)
    if (this.chatFlags.current(chatId).category === categoryId) await this.chatFlags.set(chatId, { category: null }).catch(() => {})
  }
  private forumOwner(chatId: string): FirestoreReader {
    const summary = this.index.get(chatId)?.summary
    if (this.closed || this.locked || this.connection !== 'ready' || !this.reader || !summary) throw new Error(tr('대화를 다시 선택해 주세요.'))
    if (summary.kind !== 'group' || summary.createdBy !== this.profile.uid || summary.discussion) throw new Error(tr('그룹을 만든 사람만 카테고리를 바꿀 수 있어요.'))
    return this.reader
  }
  // A message's «나에게만 삭제» (iOS deleteMessage hideForMe): gone from this device's history, kept on the server.
  async hideMessages(chatId: string, messageIds: string[]): Promise<'done'> {
    if (this.closed || this.locked || !this.index.has(chatId)) throw new Error(tr('대화를 다시 선택해 주세요.'))
    if (!messageIds.length || messageIds.length > maxHiddenMessagesPerCall) throw new Error(tr('삭제할 메시지를 다시 선택해 주세요.'))
    await this.hiddenMessages.hide(chatId, messageIds)
    return 'done'
  }
  // «나에게만 삭제» in a 1:1 inquiry room: the same store a chat's hidden messages use, under the room's client id.
  async hideInquiryMessages(inquiryId: string, messageIds: string[]): Promise<'done'> {
    if (this.closed || this.locked) throw new Error(tr('문의를 다시 열어 주세요.'))
    if (!messageIds.length || messageIds.length > maxHiddenMessagesPerCall) throw new Error(tr('삭제할 메시지를 다시 선택해 주세요.'))
    await this.hiddenMessages.hide(inquiryQueueChatId(inquiryId), messageIds)
    this.channelInquiries.refreshHidden()
    this.events.changed()
    return 'done'
  }
  async restoreChat(chatId: string): Promise<'done'> {
    if (this.closed || this.locked) throw new Error(tr('계정이 변경되었습니다.'))
    await this.hiddenChats.restore(chatId)
    if (this.chatsCurrent && this.pinsCurrent) this.rebuild()
    this.events.changed()
    return 'done'
  }
  inquiryRowList() { return this.closed ? [] : this.inquiryRows.snapshot() }
  chatFolderList() { return this.closed ? null : this.folders.snapshot() }
  inquiryRowImages(token: string, request: Request): Response { return this.inquiryRows.response(token, request) }
  async resolveVoiceDraftNavigation(request:import('../../shared/voice-draft-storage').VoiceDraftStorageNavigation):Promise<import('../../shared/voice-draft-storage').VoiceDraftNavigationResult>{
    const generation=this.generation
    const current=()=>{
      const dialog=this.index.get(request.chatId)?.summary
      if(this.closed || this.locked || this.credentials.signal.aborted || this.connection!=='ready' || this.status!=='ready' || generation!==this.generation || !dialog || dialog.kind==='secret' || dialog.historyAccess!=='ready' || !dialog.participantUids.includes(this.profile.uid))throw new Error(tr('현재 접근 가능한 일반 대화인지 확인해 주세요.'))
      return dialog
    }
    const before=current(),record=await this.voiceDraftStorage.resolve(request),after=current()
    if(before.version!==after.version || before.title!==after.title || before.kind!==after.kind || record.chatId!==request.chatId || record.revision!==request.revision || record.voice?.id!==request.id)throw new Error(tr('보관한 음성 또는 대화가 변경되었습니다.'))
    return{chatId:request.chatId,revision:request.revision,id:request.id,version:after.version}
  }
  voiceDraftState<T>(command:import('../storage/voice-draft-table').VoiceDraftCommand):Promise<T>{
    const chatId=command.kind==='voice-draft-read'?command.chatId:command.kind==='voice-draft-source'?command.reference.chatId:command.request.chatId
    const result=this.delivery.voiceDraftState<T>(command,()=>this.voiceQueueAccess(chatId))
    return command.kind==='voice-draft-write'?result.finally(()=>this.voiceDraftStorage.invalidate()):result
  }
  voiceQueueAccess(chatId:string):void{if(this.closed || this.locked || this.selected?.dialog.summary.id!==chatId)throw new Error(tr('현재 대화를 확인해 주세요.'));this.delivery.voiceQueueAccess(chatId)}
  voiceQueueSource(reference:import('../../shared/voice-queue-preview').VoiceQueueReference){return this.delivery.voiceQueueSource(reference,()=>this.voiceQueueAccess(reference.chatId))}
  voiceCaptureAccess(chatId:string):void{if(this.closed || this.locked || this.selected?.dialog.summary.id!==chatId)throw new Error(tr('현재 대화를 확인해 주세요.'));this.delivery.voiceCaptureAccess(chatId)}
  pickAttachment(chatId: string, mode: AttachmentMode, choose: () => Promise<string[] | null>) {
    if (this.closed || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return this.delivery.pickAttachment(chatId, mode, choose)
  }
  discardAttachment(id: string) { this.delivery.discardAttachment(id) }
  // «캐시 정리»: pictures kept in memory for bubbles go; they are fetched again when shown.
  // The pictures of one person, newest first: the one on screen now, then the ones this device remembers.
  openProfilePhotos(peerUid: string): Promise<{ count: number }> {
    if (this.closed || this.locked) throw new Error(tr('계정과 화면 잠금 상태를 확인해 주세요.'))
    const current = peerUid === this.profile.uid ? this.selfProfile.photoAddress
      : peerProfilesFor(this.credentials)?.photo(peerUid) || this.userpics.known(`user:${peerUid}`)
    return this.peerPhotos.open(peerUid, current)
  }
  clearMediaCaches(): void { if (!this.closed) this.photoPreviews.clear() }
  replaceAttachmentImage(chatId: string, id: string, itemId: string, bytes: Uint8Array) {
    if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return this.delivery.replaceAttachmentImage(chatId, id, itemId, bytes)
  }
  editAttachmentVideo(chatId: string, id: string, itemId: string, edit: VideoEdit) {
    if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return this.delivery.editAttachmentVideo(chatId, id, itemId, edit)
  }
  dropAttachments(chatId: string, paths: string[], mode: AttachmentDropMode) {
    if (this.closed || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return this.delivery.dropAttachments(chatId, paths, mode)
  }
  pasteAttachments(chatId: string, items: { name: string; bytes: Uint8Array }[]) {
    if (this.closed || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return this.delivery.pasteAttachments(chatId, items)
  }
  inquiryAttachmentPreview(path: string, request: Request): Response {
    return this.closed ? new Response(null, { status: 403 }) : this.channelInquiries.attachmentPreview(path, request)
  }
  attachmentPreview(path: string, request: Request): Response {
    if (this.closed || !this.selected) return new Response(null, { status: 403 })
    return this.delivery.attachmentPreview(this.selected.dialog.summary.id, path, request)
  }
  async sendVoice(request:import('../../shared/voice-send').VoiceSendRequest,source:()=>Uint8Array):Promise<void>{
    this.voiceCaptureAccess(request.chatId)
    try{await this.delivery.enqueueVoice(request,source,()=>{this.voiceCaptureAccess(request.chatId);if(request.reply)this.draftReply.validate(request.chatId,request.reply)})}finally{this.voiceDraftStorage.invalidate()}
    await this.draftReply.refresh(request.chatId)
  }
  async sendRoundVideo(request: RoundVideoSendRequest, bytes: Uint8Array): Promise<void> {
    const { chatId, reply } = request
    if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    await this.delivery.enqueueRoundVideo(chatId, bytes, { duration: request.duration, width: roundVideoSide, height: roundVideoSide, thumb: request.thumb }, reply, () => {
      if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
      if (reply) this.draftReply.validate(chatId, reply)
    })
    await this.draftReply.refresh(chatId)
  }
  async sendAttachment(chatId: string, id: string, caption: string, itemIds: string[], reply: ReplyBinding | null, video: import('../../shared/uploads').VideoFacts | null = null): Promise<void> {
    if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId || caption.length > 3000) throw new Error(tr('대화와 첨부 내용을 확인해 주세요.'))
    await this.delivery.enqueueAttachment(chatId, id, caption.trim(), itemIds, reply, () => {
      if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
      if (reply) this.draftReply.validate(chatId, reply)
    }, video)
    await this.draftReply.refresh(chatId)
  }
  mutateMessage(chatId: string, request: MessageActionRequest): Promise<void> {
    if (this.closed || this.status !== 'ready' || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    const message = this.selected.actionMessage(request.messageId, request.version)
    if (!message) throw new Error(tr('메시지가 변경되었습니다. 최신 메시지를 다시 선택해 주세요.'))
    return this.actions.enqueue(chatId, request, message)
  }
  checkMessageAction(chatId: string, id: string) { return this.actions.inspect(chatId, id) }
  dismissMessageAction(chatId: string, id: string) { return this.actions.dismiss(chatId, id) }
  markVisibleRead(chatId: string, revision: number, messageId: string): Promise<boolean> {
    if (this.closed || !this.events.canRead() || this.status !== 'ready' || this.selected?.dialog.summary.id !== chatId) return Promise.resolve(false)
    const target = this.selected.visibleReadTarget(revision, messageId, this.profile.uid)
    if (target) this.notifications.observed(chatId, target)
    return target ? this.reads.observe(chatId, target) : Promise.resolve(false)
  }
  readingActivityChanged(): void {
    if (this.events.canRead()) this.reads.resume(); else this.reads.pause()
    this.notifications.resume()
    this.channelInquiries.activity()
  }
  notificationHint(hint: NotificationHint): void { this.notifications.receive(hint) }
  notificationPreferencesChanged(): void { this.notifications.pause(); this.notifications.resume() }
  outgoing(chatId: string) { return this.delivery.snapshot(chatId) }
  async startStoryCaptionDraft(target: StoryCaptionDraftStart): Promise<StoryCaptionDraftRecord> {
    const draft = this.ownStories.captionDraftSource(target)
    const validate = (): void => { this.ownStories.captionDraftSource(target) }
    const value = await this.delivery.storyCaptionDraftState<StoryCaptionDraftRecord>({ kind: 'story-caption-draft-seed', target: { storyId: target.storyId, privacy: target.privacy }, draft, revision: randomUUID() }, validate)
    validate(); return value
  }
  readStoryCaptionDraft(target: StoryCaptionDraftTarget): Promise<StoryCaptionDraftRecord> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.storyCaptionDraftState({ kind: 'story-caption-draft-read', target })
  }
  listStoryCaptionDrafts(): Promise<StoryCaptionDraftRow[]> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.storyCaptionDraftState({ kind: 'story-caption-draft-list' })
  }
  saveStoryCaptionDraft(request: StoryCaptionDraftWrite): Promise<StoryCaptionDraftRecord> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    // Previously opened input may flush while the view is locking.
    return this.delivery.storyCaptionDraftState({ kind: 'story-caption-draft-write', request })
  }
  async startNoteEditDraft(target: NoteEditDraftStart): Promise<NoteEditDraftRecord> {
    const draft = this.spaceNotes.editDraftSource(target)
    const validate = (): void => { this.spaceNotes.editDraftSource(target) }
    const value = await this.delivery.noteEditDraftState<NoteEditDraftRecord>({ kind: 'note-edit-draft-seed', target: { noteId: target.noteId }, draft, revision: randomUUID() }, validate)
    validate(); return value
  }
  readNoteEditDraft(target: NoteEditDraftTarget): Promise<NoteEditDraftRecord> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.noteEditDraftState({ kind: 'note-edit-draft-read', target })
  }
  listNoteEditDrafts(): Promise<NoteEditDraftRow[]> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.noteEditDraftState({ kind: 'note-edit-draft-list' })
  }
  saveNoteEditDraft(request: NoteEditDraftWrite): Promise<NoteEditDraftRecord> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    // Previously opened input may flush while the view is locking.
    return this.delivery.noteEditDraftState({ kind: 'note-edit-draft-write', request })
  }
  private requireStoryComposerPhotoAccess(): void {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
  }
  async storyVideoPublicationState(command: import('../storage/story-video-publication-table').StoryVideoPublicationCommand): Promise<import('../../shared/story-video-publication').PendingStoryVideoPublication | null> {
    this.requireStoryComposerPhotoAccess()
    if (command.kind !== 'story-video-publication-read' && this.storyVideoUpload.busy) throw new Error(tr('영상 업로드가 끝난 뒤 준비 기록을 변경해 주세요.'))
    const value = await this.delivery.storyVideoPublicationState<import('../../shared/story-video-publication').PendingStoryVideoPublication | null>(command, () => this.requireStoryComposerPhotoAccess())
    this.requireStoryComposerPhotoAccess(); return value
  }
  async preparedStoryAudioSource(request:import('../../shared/story-prepared-audio').StoryPreparedAudioRequest):Promise<import('../../shared/story-composer-audio-storage').StoryComposerAudioStoredSource>{
    const validate=():void=>{this.requireStoryComposerPhotoAccess();if(this.storyVideoUpload.busy || this.storyPublication.snapshot.busy)throw new Error(tr('현재 게시 작업이 끝난 뒤 오디오를 열어 주세요.'))}
    validate()
    const value=request.kind==='photo'?await this.delivery.storyPublicationState<import('../../shared/story-composer-audio-storage').StoryComposerAudioStoredSource>({kind:'story-publication-audio-source',request},validate):await this.delivery.storyVideoPublicationState<import('../../shared/story-composer-audio-storage').StoryComposerAudioStoredSource>({kind:'story-video-publication-audio-source',request},validate)
    try{validate();return value}catch(error){value.bytes.fill(0);throw error}
  }
  storyComposerVideoViewAccess(): void { this.requireStoryComposerPhotoAccess() }
  async storyComposerVideoSource(reference: import('../../shared/story-composer-video-storage').StoryComposerVideoReference): Promise<import('../../shared/story-composer-video-storage').StoryComposerVideoStoredSource> {
    this.requireStoryComposerPhotoAccess()
    const value = await this.delivery.storyComposerVideoState<import('../../shared/story-composer-video-storage').StoryComposerVideoStoredSource>({ kind: 'story-composer-video-source', reference }, () => this.requireStoryComposerPhotoAccess())
    try { this.requireStoryComposerPhotoAccess(); return value }
    catch (error) { value.pair.video.fill(0); value.pair.poster.fill(0); throw error }
  }
  async storyComposerAudioSource(reference:import('../../shared/story-composer-audio-storage').StoryComposerAudioReference):Promise<import('../../shared/story-composer-audio-storage').StoryComposerAudioStoredSource>{
    this.requireStoryComposerPhotoAccess();const value=await this.delivery.storyComposerAudioState<import('../../shared/story-composer-audio-storage').StoryComposerAudioStoredSource>({kind:'story-composer-audio-source',reference},()=>this.requireStoryComposerPhotoAccess())
    try{this.requireStoryComposerPhotoAccess();return value}catch(error){value.bytes.fill(0);throw error}
  }
  async readStoryComposerAudio(target:StoryComposerDraftTarget):Promise<import('../../shared/story-composer-audio-storage').StoryComposerAudioRecord>{
    this.requireStoryComposerPhotoAccess();const value=await this.delivery.storyComposerAudioState<import('../../shared/story-composer-audio-storage').StoryComposerAudioRecord>({kind:'story-composer-audio-read',target},()=>this.requireStoryComposerPhotoAccess());this.requireStoryComposerPhotoAccess();return value
  }
  async saveStoryComposerAudio(request:import('../../shared/story-composer-audio-storage').StoryComposerAudioWrite,bytes?:Uint8Array):Promise<import('../../shared/story-composer-audio-storage').StoryComposerAudioRecord>{
    this.requireStoryComposerPhotoAccess();const value=await this.delivery.storyComposerAudioState<import('../../shared/story-composer-audio-storage').StoryComposerAudioRecord>({kind:'story-composer-audio-write',request,...(bytes?{bytes}:{})},()=>this.requireStoryComposerPhotoAccess());this.requireStoryComposerPhotoAccess();return value
  }
  async readStoryComposerVideo(target: StoryComposerDraftTarget): Promise<import('../../shared/story-composer-video-storage').StoryComposerVideoRecord> {
    this.requireStoryComposerPhotoAccess()
    const value = await this.delivery.storyComposerVideoState<import('../../shared/story-composer-video-storage').StoryComposerVideoRecord>({ kind: 'story-composer-video-read', target }, () => this.requireStoryComposerPhotoAccess())
    this.requireStoryComposerPhotoAccess(); return value
  }
  async saveStoryComposerVideo(request: import('../../shared/story-composer-video-storage').StoryComposerVideoWrite, pair?: import('../../shared/story-composer-video-storage').StoryComposerVideoPair): Promise<import('../../shared/story-composer-video-storage').StoryComposerVideoRecord> {
    this.requireStoryComposerPhotoAccess()
    const value = await this.delivery.storyComposerVideoState<import('../../shared/story-composer-video-storage').StoryComposerVideoRecord>({ kind: 'story-composer-video-write', request, ...(pair ? { pair } : {}) }, () => this.requireStoryComposerPhotoAccess())
    this.requireStoryComposerPhotoAccess(); return value
  }
  readStoryComposerPhoto(target: StoryComposerDraftTarget): Promise<StoryComposerPhotoRecord> {
    this.requireStoryComposerPhotoAccess()
    return this.delivery.storyComposerPhotoState({ kind: 'story-composer-photo-read', target }, () => this.requireStoryComposerPhotoAccess())
  }
  async storyComposerPhotoPreparation(target: StoryComposerPhotoTarget): Promise<BackgroundPhotoOwner> {
    if (this.storyPublication.snapshot.status !== 'ready' || this.storyPublication.snapshot.pending?.draftId === target.id) throw new Error(tr('게시 준비 기록을 확인한 뒤 초안 사진을 편집해 주세요.'))
    this.requireStoryComposerPhotoAccess()
    const videoPublication = await this.storyVideoPublicationState({ kind: 'story-video-publication-read' })
    if (videoPublication?.draftId === target.id) throw new Error(tr('영상 게시 준비 기록을 닫은 뒤 초안을 편집해 주세요.'))
    const record = await this.readStoryComposerDraft({ id: target.id })
    this.requireStoryComposerPhotoAccess()
    if (!record.draft || record.revision !== target.draftRevision) throw new Error(tr('현재 초안을 저장한 뒤 사진을 선택해 주세요.'))
    return { key: JSON.stringify([this.profile.uid, 'story-composer-pick', target.id, target.draftRevision]), validate: () => this.requireStoryComposerPhotoAccess(), load: async () => null }
  }
  saveStoryComposerPhoto(request: StoryComposerPhotoWrite, full?: Uint8Array, thumbnail?: Uint8Array): Promise<StoryComposerPhotoRecord> {
    this.requireStoryComposerPhotoAccess()
    return this.delivery.storyComposerPhotoState({ kind: 'story-composer-photo-write', request, ...(full ? { full } : {}), ...(thumbnail ? { thumbnail } : {}) }, () => this.requireStoryComposerPhotoAccess())
  }
  async storyComposerPhotoView(reference: StoryComposerPhotoReference): Promise<BackgroundPhotoOwner> {
    const record = await this.readStoryComposerPhoto({ id: reference.id })
    if (!record.photo || record.revision !== reference.revision || record.photo.id !== reference.photoId) throw new Error(tr('현재 기기 사진을 다시 확인해 주세요.'))
    return { key: JSON.stringify([this.profile.uid, 'story-composer-view', reference.id, reference.photoId, reference.revision]), validate: () => this.requireStoryComposerPhotoAccess(), load: async () => {
      const value = await this.delivery.storyComposerPhotoState<{ bytes: Uint8Array; sha256: string }>({ kind: 'story-composer-photo-source', reference }, () => this.requireStoryComposerPhotoAccess())
      return value.bytes
    } }
  }
  readStoryComposerDraft(target: StoryComposerDraftTarget): Promise<StoryComposerDraftRecord> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.storyComposerDraftState({ kind: 'story-composer-draft-read', target })
  }
  listStoryComposerDrafts(): Promise<StoryComposerDraftRow[]> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.storyComposerDraftState({ kind: 'story-composer-draft-list' })
  }
  saveStoryComposerDraft(request: StoryComposerDraftWrite): Promise<StoryComposerDraftRecord> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    // Only previously opened input may flush while locking or closing the view.
    return this.delivery.storyComposerDraftState({ kind: 'story-composer-draft-write', request })
  }
  readNoteDraft(target: NoteDraftTarget): Promise<NoteDraftRecord> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.noteDraftState({ kind: 'note-draft-read', target })
  }
  listNoteDrafts(): Promise<NoteDraftRow[]> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.noteDraftState({ kind: 'note-draft-list' })
  }
  saveNoteDraft(request: NoteDraftWrite): Promise<NoteDraftRecord> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    // Only previously opened input may flush while locking or closing the view.
    return this.delivery.noteDraftState({ kind: 'note-draft-write', request })
  }
  readPostDraft(target: PostDraftTarget): Promise<PostDraftRecord> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.postDraftState({ kind: 'post-draft-read', target })
  }
  listPostDrafts(): Promise<PostDraftRecord[]> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.postDraftState({ kind: 'post-draft-list' })
  }
  savePostDraft(request: PostDraftWrite): Promise<PostDraftRecord> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    // Already opened local input may flush when the view locks or closes.
    return this.delivery.postDraftState({ kind: 'post-draft-write', request })
  }
  selectCommentDraftParent(request: CommentDraftParent): Promise<CommentDraftRecord> {
    const validate = (): void => {
      if (this.closed || this.locked) throw new Error(tr('현재 계정과 잠금을 확인해 주세요.'))
      if (request.parent) { if (request.surface === 'public-preview') this.channelPublicPreview.comments.replySource(request, request.parent); else this.channels.posts.comments.replySource(request, request.parent) }
    }
    validate(); return this.delivery.commentDraftState({ kind: 'comment-draft-parent', request }, validate)
  }
  readCommentDraft(target: CommentDraftTarget): Promise<CommentDraftRecord> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.commentDraftState({ kind: 'comment-draft-read', target })
  }
  listCommentDrafts(): Promise<CommentDraftRecord[]> {
    if (this.closed || this.locked) throw new Error(tr('잠금을 해제하고 현재 계정을 확인해 주세요.'))
    return this.delivery.commentDraftState({ kind: 'comment-draft-list' })
  }
  saveCommentDraft(request: CommentDraftWrite): Promise<CommentDraftRecord> {
    // Like chat drafts, an already opened own draft may flush while its view is locking/closing.
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    return this.delivery.commentDraftState({ kind: 'comment-draft-write', request })
  }
  draft(chatId: string) { return this.delivery.draft(chatId) }
  saveDraft(chatId: string, text: string) { return this.delivery.saveDraft(chatId, text) }
  // The other person of each 1:1 chat among these (memo and secret chats have none).
  directPeers(chatIds: string[]): string[] {
    return chatIds.flatMap(id => {
      const summary = this.index.get(id)?.summary
      const peer = summary?.kind === 'direct' && summary.participantUids.length === 2 && id !== `memo_${this.profile.uid}` ? summary.participantUids.find(uid => uid !== this.profile.uid) : undefined
      return peer ? [peer] : []
    })
  }
  replyDraft(chatId: string) { return this.draftReply.snapshot(chatId) }
  // Reminders start with the first request or the first ready list, after the delivery store exists.
  private reminders(): EventReminders {
    this.eventReminders ??= new EventReminders(command => this.delivery.reminderState(command), {
      locked: () => this.locked || this.closed || this.events.notifications.locked(), show: (content, click, dismiss) => this.events.notifications.show(content, click, dismiss), open: chatId => this.events.notifications.open(chatId)
    })
    return this.eventReminders
  }
  scheduleEventReminder(request: EventReminderRequest): Promise<'done'> {
    if (this.closed || this.locked || !this.index.has(request.chatId)) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return this.reminders().add(request)
  }
  // The chat list's «입력 중...»: who is typing in each of the first chats, named as the chat knows them.
  listTypingState(): Record<string, { until: number; names: string[] }> {
    if (this.closed || this.locked) return {}
    const result: Record<string, { until: number; names: string[] }> = {}
    for (const [chatId, entry] of Object.entries(this.listTyping.snapshot()) as [string, ListTypingEntry][]) {
      const dialog = this.index.get(chatId)
      if (dialog) result[chatId] = { until: entry.until, names: entry.uids.map(uid => dialog.participantNames[uid] || tr('참여자')) }
    }
    return result
  }
  typingState(): TypingSnapshot | null {
    return this.closed || this.locked || !this.selected ? null : this.typing.snapshot()
  }
  // The composer's typing state for the open chat, written like iOS updateTypingStateIfNeeded.
  reportTyping(chatId: string, typing: boolean): void {
    const selected = this.selected?.dialog.summary, reader = this.reader
    if (this.closed || this.locked || !reader || !selected || selected.id !== chatId || selected.kind === 'secret' || chatId.startsWith('memo_') ||
      !selected.participantUids.includes(this.profile.uid) || !this.typing.shouldWrite(chatId, typing)) return
    void reader.setChatWatcherTyping(chatId, this.profile.uid, typing, this.credentials.signal).catch(() => {})
  }
  private stopTyping(): void {
    const chatId = this.typing?.pendingStop(), reader = this.reader
    if (!chatId || !reader || !this.typing.shouldWrite(chatId, false)) return
    void reader.setChatWatcherTyping(chatId, this.profile.uid, false, this.credentials.signal).catch(() => {})
  }
  deferredMessages(): DeferredMessagesSnapshot | null {
    const history = this.selected
    return this.closed || this.locked || !history ? null : this.deferred.snapshot(history.dialog.summary.id)
  }
  // Send menu «예약 전송» / «온라인시 보내기» (MorseDeferredOutgoingCoordinator.submit, text only).
  async sendDeferred(request: DeferredSendRequest): Promise<'done'> {
    const history = this.selected, reader = this.reader, dialog = history?.dialog.summary
    if (this.closed || this.locked || this.connection !== 'ready' || !reader || !dialog || dialog.id !== request.chatId || dialog.kind === 'secret' || !dialog.participantUids.includes(this.profile.uid)) {
      recordDeferredStep('chat-unavailable', `${request.kind} ${this.connection} reader=${reader ? 1 : 0} dialog=${dialog ? 1 : 0} same=${dialog?.id === request.chatId ? 1 : 0}`)
      throw new Error(tr('대화를 다시 선택해 주세요.'))
    }
    const text = outgoingText(request.text)
    let recipientId = ''
    if (request.kind === 'scheduled') {
      const at = request.scheduledAt ?? 0
      if (at <= Date.now() || at > Date.now() + maxScheduleAheadMs) throw new Error(tr('예약 시간은 지금 이후 1년 안으로 골라 주세요.'))
    } else {
      // The server drains a recipient's queue when that person comes online: 1:1 chats only.
      // iOS answers toast.sendWhenOnlineRequiresDirect here; this device cannot send in secret chats at all.
      recipientId = this.directPeers([dialog.id])[0] ?? ''
      if (!recipientId) {
        recordDeferredStep('online-not-direct', dialog.kind)
        throw new Error(tr('온라인 시 보내기는 1:1 채팅에서만 할 수 있어요'))
      }
    }
    if (request.reply) this.draftReply.validate(dialog.id, request.reply)
    const fields = deferredFields(request, this.profile.uid, text, recipientId)
    try { await reader.createDeferredMessage(deferredCollections[request.kind], request.messageId, fields, this.credentials.signal) }
    catch (error) {
      const failure = error as { uncertain?: boolean; code?: number; detail?: string }
      recordDeferredStep('create-failed', `${request.kind} grpc-${failure.code ?? 0} ${failure.detail ?? ''}`.trim())
      throw new Error(failure.uncertain ? tr('예약 결과를 확인하지 못했습니다. 예약된 메시지 목록을 확인해 주세요.') : tr('메시지를 보내지 못했어요.'))
    }
    if (request.reply) await this.draftReply.cancel(dialog.id, request.reply.selectionId).catch(() => {})
    return 'done'
  }
  async cancelDeferred(chatId: string, kind: DeferredKind, messageId: string): Promise<'done'> {
    const reader = this.reader
    if (this.closed || this.locked || !reader || this.selected?.dialog.summary.id !== chatId || !this.deferred.has(chatId, kind, messageId)) throw new Error(tr('예약된 메시지를 다시 확인해 주세요.'))
    try { await reader.deleteDeferredMessage(deferredCollections[kind], messageId, this.credentials.signal) }
    catch { throw new Error(tr('예약 취소에 실패했어요')) }
    return 'done'
  }
  private pinLimit(): number { return this.selfProfile.snapshot.profile?.premium ? premiumPinLimit : freePinLimit }
  pinnedMessages(): PinnedMessagesSnapshot | null {
    const history = this.selected
    return this.closed || this.locked || !history ? null : this.pins.snapshot(history.dialog.summary.id, this.pinLimit())
  }
  // Message menu «고정»/«고정 해제» (ChatRoomView togglePinForMe / togglePinForAll).
  async pinMessage(request: PinMessageRequest): Promise<'done'> {
    const history = this.selected, reader = this.reader, chatId = request.chatId
    if (this.closed || this.locked || this.connection !== 'ready' || !history || !reader || history.dialog.summary.id !== chatId || history.dialog.summary.kind === 'secret') throw new Error(tr('대화를 다시 선택해 주세요.'))
    const current = this.pins.pinned(chatId, request.messageId)
    if (request.pin) {
      const message = history.snapshot.messages.find(item => item.id === request.messageId)
      if (!message || !message.version || !message.serverConfirmed || message.system || message.encrypted) throw new Error(tr('고정할 수 있는 메시지가 아닙니다.'))
      if (!current && this.pins.count(chatId) >= this.pinLimit()) throw new Error(tr('메시지는 최대 {0}개까지 고정할 수 있어요.', [this.pinLimit()]))
    }
    if (request.scope === 'me') { await this.pins.setForMe(chatId, request.messageId, request.pin); return 'done' }
    this.pins.expectForAll(chatId, request.messageId, request.pin)
    try { await reader.setPinnedForAll(chatId, request.messageId, request.pin, this.credentials.signal) }
    catch (error) {
      this.pins.forgetExpected(request.messageId)
      throw new Error((error as { uncertain?: boolean }).uncertain ? tr('고정 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.') : request.pin ? tr('메시지를 모두에게 고정하지 못했습니다.') : tr('고정을 해제하지 못했습니다.'))
    }
    return 'done'
  }
  jumpPinned(chatId: string, messageId: string): Promise<HistorySnapshot> {
    if (this.closed || this.connection !== 'ready' || this.status !== 'ready' || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    const target = this.pins.position(chatId, messageId)
    if (!target) throw new Error(tr('고정된 메시지를 확인할 수 없습니다.'))
    return this.selected.jump(target)
  }
  // A received text message in the open chat, for on-device translation (message menu «번역», "전체번역").
  translationSource(chatId: string, messageId: string): string {
    const history = this.selected
    if (this.closed || this.locked || !history || history.dialog.summary.id !== chatId || history.dialog.summary.kind === 'secret') throw new Error(tr('대화를 다시 선택해 주세요.'))
    const message = history.snapshot.messages.find(item => item.id === messageId)
    if (!message || message.senderId === this.profile.uid || message.system || message.encrypted || message.kind !== 'text' || !message.text.trim()) throw new Error(tr('번역할 수 있는 메시지가 아닙니다.'))
    return message.text
  }
  selectReply(chatId: string, messageId: string, version: string): Promise<void> {
    if (!this.contextMessage(chatId, messageId, version)?.reply) throw new Error(tr('답장할 최신 메시지를 다시 선택해 주세요.'))
    return this.draftReply.select(chatId, messageId)
  }
  cancelReply(chatId: string, selectionId: string): Promise<void> {
    if (this.closed || this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
    return this.draftReply.cancel(chatId, selectionId)
  }
  async sendText(chatId: string, text: string, id: string, reply: ReplyBinding | null = null, silent = false): Promise<void> {
    if (this.locked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    await this.delivery.enqueue(chatId, text, id, reply, () => {
      if (this.locked || this.selected?.dialog.summary.id !== chatId) throw new Error(tr('대화를 다시 선택해 주세요.'))
      this.draftReply.validate(chatId, reply!)
    }, silent)
    await this.draftReply.refresh(chatId)
  }
  retry(chatId: string, id: string) { return this.delivery.retry(chatId, id) }
  discard(chatId: string, id: string) { return this.delivery.discard(chatId, id) }
  async close(purge: boolean): Promise<void> {
    if (this.closed) return
    this.closed = true; this.userpics.close(); this.mediaFiles.close(); this.eventReminders?.close(); const presenceClose = this.presence.close(); const peopleClose = this.channelPeople.close(); const storyClose = this.ownStories.close(), noteClose = this.spaceNotes.close(); this.channels.close(); this.channelHome.closeAll(); this.channelStories.close(); this.channelInquiries.close(); this.inquiryRows.close(); this.inquiryNotifications.close(); this.peerPhotos.dispose(); this.folders.close(); this.dialogPreferences.close(); this.discussionAvatars.close(); this.photoPreviews.close(); this.hiddenChats.close(); this.hiddenMessages.close(); this.chatFlags.close(); this.topicDeletions.close(); this.contactFlags.close(); this.stickerPacks.close(); this.stop(); this.selfProfile.connection(false); this.contacts.connection(false); this.clearVisible('loading')
    this.discussionJoin.pause(); this.commentCreation.pause(); this.postCreation.pause(); this.channelCreation.pause(); this.noteCreation.pause(); this.noteTextSave.pause(); this.storyCaptionSave.pause(); this.noteRemoval.pause(); this.storyRemoval.pause(); this.storyPrivacyMove.pause(); this.storyHiddenChange.pause(); this.storyReactionChange.pause(); this.storyViewReceipt.pause(); this.storyReplyDraft.pause(); this.storyPublication.pause(); this.storyVideoUpload.pause(); this.noteEditComparison.pause(); this.storyHiddenAudience.pause(); this.storyViewRecords.pause(); this.contactPublicStories.pause(); this.contactStoryAudience.pause(); this.contactAudienceStories.pause(); this.contactAudienceStoryPhoto.pause(); this.contactAudienceStoryVideo.pause(); this.contactStoryPhotoAudio.pause(); this.contactStoryReaction.pause(); this.contactPublicStoryPhoto.pause(); this.contactPublicStoryVideo.pause(); 
    await storyClose
    await noteClose
    await presenceClose
    await peopleClose
    await this.voiceDraftStorage.close();await this.backgroundStorage.close()
    await this.postCreation.close()
    await this.contactPublicStoryVideo.close()
    await this.contactPublicStoryPhoto.close()
    await this.contactStoryReaction.close()
    await this.contactStoryPhotoAudio.close()
    await this.contactAudienceStoryVideo.close()
    await this.contactAudienceStoryPhoto.close()
    await this.contactAudienceStories.close()
    await this.contactStoryAudience.close()
    await this.contactPublicStories.close()
    await this.storyViewRecords.close()
    await this.storyHiddenAudience.close()
    this.noteEditComparison.close()
    await this.storyVideoUpload.close()
    await this.storyPublication.close()
    await this.storyHiddenChange.close()
    await this.storyReactionChange.close()
    await this.storyViewReceipt.close()
    await this.storyReplyDraft.close()
    await this.storyPrivacyMove.close()
    await this.storyRemoval.close()
    await this.noteRemoval.close()
    await this.storyCaptionSave.close()
    await this.noteTextSave.close()
    await this.noteCreation.close()
    await this.channelCreation.close()
    await this.commentCreation.close()
    await this.discussionJoin.close()
    await this.channelJoinDecisions.close()
    await this.channelAccess.close()
    await this.channelPhotoUpload.close()
    await this.groupPhotoUpload.close()
    await this.forwardPreparation?.task?.catch(() => {})
    await this.participantAdd.close()
    await this.groupName.close()
    await this.groupAnnouncement.close()
    await this.dialogAvatars.close(); await this.groupPhoto.close(); await this.groupPhotoEditor.close()
    await this.dialogPins.close()
    await this.manualUnread.close()
    await this.contacts.close()
    await this.channelPublicPreview.close()
    this.channelDiscovery.close()
    await this.contactDiscovery.close()
    await this.selfProfile.close()
    await this.notifications.close()
    await this.media.close()
    await this.reads.close()
    await this.actions.close()
    await this.delivery.close(purge)
  }
}

// MorseChatForumFirestore.categoriesToFirestore: sorted, icon and isGeneral only when set.
function forumCategoriesValue(categories: ForumCategory[]): WireObject {
  return { arrayValue: { values: [...categories].sort((a, b) => a.sortOrder - b.sortOrder).map(category => ({ mapValue: { fields: {
    id: { stringValue: category.id }, name: { stringValue: category.name }, sortOrder: { integerValue: String(category.sortOrder) },
    ...(category.icon ? { icon: { stringValue: category.icon } } : {}), ...(category.isGeneral ? { isGeneral: { booleanValue: true } } : {}) } } })) } }
}
