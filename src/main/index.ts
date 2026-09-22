import { autoDeleteMonthOptions, blockTarget, inviteToken, lastSeenPrivacy, signInSessionId } from '../shared/account-tools'
import { roundVideoFacts, roundVideoSendRequest, roundVideoSide } from '../shared/round-video'
import type { CaptureMedia } from './platform/voice-captures'
import { recordRendererVoiceStep, recordVoiceStep, voiceErrorCode } from './platform/voice-diagnostics'
import { chatFolderInput, chatFolderOrder } from '../shared/chat-folders'
import { autoDeleteSecondsValue, canChangeAutoDelete } from '../shared/chat-auto-delete'
import { inquiryAttachmentRequest, inquiryAutoDeleteRequest, inquiryForwardRequest, inquiryIdentifier, inquiryReplyTo, inquiryScheduleRequest, inquiryVoiceRequest, inquiryVoiceTarget, inquiryEditRequest, inquiryListRequest, inquiryPhotoRequest, inquiryPinRequest, inquiryReactionRequest, inquirySendRequest, inquiryTargetRequest, inquiryThreadRequest } from '../shared/channel-inquiries'
import { voiceDraftStorageNavigation, voiceDraftStorageRemoval } from '../shared/voice-draft-storage'
import { ownStoriesPageRequest } from '../shared/own-stories'
import { contactPublicStoriesPageRequest } from '../shared/contact-public-stories'
import { contactAudienceStoriesPageRequest } from '../shared/contact-audience-stories'
import { voiceDraftWrite, voiceDraftReference, type VoiceDraftRecord, type VoiceDraftSource } from '../shared/voice-draft'
import { voiceQueueOpen } from '../shared/voice-queue-preview'
import { VoiceQueuePreviews } from './platform/voice-queue-previews'
import { voiceSendRequest } from '../shared/voice-send'
import { VoiceCaptures } from './platform/voice-captures'
import { voiceCaptureTarget } from '../shared/voice-capture'
import { storyVideoSource, storyVideoPosterRequest } from '../shared/story-composer-video'
import { StoryVideoInputs } from './platform/story-video-inputs'
import { storyReplySendRequest } from '../shared/story-reply-send'
import { storyReplyTextWrite } from '../shared/story-reply-text'
import { storyReplyDraftPrepare, storyReplyDraftAction } from '../shared/story-reply-draft'
import { storyViewReceiptPrepare, storyViewReceiptAction } from '../shared/story-view-receipt'
import { storyReactionChangePrepare, storyReactionChangeAction } from '../shared/story-reaction-change'
import { contactStoryReactionRequest } from '../shared/contact-story-reaction'
import { contactStoryPhotoAudioRequest } from '../shared/contact-story-photo-audio'
import { contactAudienceStoryLinkRequest } from '../shared/contact-audience-story-link'
import { contactAudienceStoryVideoRequest } from '../shared/contact-audience-story-video'
import { contactAudienceStoryPhotoRequest } from '../shared/contact-audience-story-photo'
import { contactAudienceStoriesRequest } from '../shared/contact-audience-stories'
import { contactStoryAudienceRequest } from '../shared/contact-story-audience'
import { contactPublicStoryLinkRequest } from '../shared/contact-public-story-link'
import { contactPublicStoryVideoRequest } from '../shared/contact-public-story-video'
import { contactPublicStoryPhotoRequest } from '../shared/contact-public-story-photo'
import { contactPublicStoriesRequest } from '../shared/contact-public-stories'
import { storyPublicationPrepare, storyPublicationAction } from '../shared/story-publication'
import { storyVideoObservationRequest } from '../shared/story-video-observation'
import { storyVideoPublishRequest } from '../shared/story-video-publication-commit'
import { storyVideoUploadRequest, storyVideoPublicationPrepare } from '../shared/story-video-publication'
import { StorySavedAudio } from './platform/story-saved-audio'
import { storyComposerAudioWrite } from '../shared/story-composer-audio-storage'
import { storyAudioSource, storyAudioConfirm } from '../shared/story-composer-audio'
import { StoryAudioInputs } from './platform/story-audio-inputs'
import { StorySavedVideos } from './platform/story-saved-videos'
import { storyComposerVideoWrite } from '../shared/story-composer-video-storage'
import { storyComposerPhotoTarget, storyComposerPhotoWrite, storyComposerPhotoPair } from '../shared/story-composer-photo'
import { storyComposerDraftTarget, storyComposerDraftWrite } from '../shared/story-composer-drafts'
import { storyCaptionLinkRequest } from '../shared/story-caption-link'
import { storyViewRecordsRequest } from '../shared/story-view-records'
import { storyHiddenChangePrepare, storyHiddenChangeAction } from '../shared/story-hidden-change'
import { storyHiddenAudienceRequest } from '../shared/story-hidden-audience'
import { storyPrivacyMovePrepare, storyPrivacyMoveAction } from '../shared/story-privacy-move'
import { storyRemovalPrepare, storyRemovalAction } from '../shared/story-removal'
import { storyCaptionSavePrepare, storyCaptionSaveAction } from '../shared/story-caption-save'
import { storyCaptionDraftStart, storyCaptionDraftTarget, storyCaptionDraftWrite } from '../shared/story-caption-drafts'
import { ownStoryAudioRequest } from '../shared/own-story-audio'
import { ownStoryVideoRequest } from '../shared/own-story-video'
import { ownStoryPhotoRequest } from '../shared/own-story-photo'
import { ownStoriesRequest, ownStorySelection } from '../shared/own-stories'
import { notePageSearch } from '../shared/space-note-search'
import { spaceNotesPageRequest } from '../shared/space-notes'
import { noteRemovalPrepare, noteRemovalAction } from '../shared/space-note-removal'
import { noteEditRebaseRequest } from '../shared/space-note-edit-rebase'
import { noteTextSavePrepare, noteTextSaveAction } from '../shared/space-note-text-save'
import { noteEditComparisonRequest } from '../shared/space-note-edit-comparison'
import { noteEditDraftStart, noteEditDraftTarget, noteEditDraftWrite } from '../shared/space-note-edit-drafts'
import { notePinRequest } from '../shared/space-note-pin'
import { noteCreationPrepare, noteCreationAction } from '../shared/space-note-creation'
import { noteDraftWrite } from '../shared/space-note-drafts'
import { spaceNoteSelection } from '../shared/space-notes'
import { publicChannelPhotosRequest, publicChannelPreviewRequest } from '../shared/channel-public-preview'
import { channelDiscoveryRequest } from '../shared/channel-discovery'
import { channelCreationPrepare, channelCreationAction } from '../shared/channel-creation'
import { channelPostPinResolution } from '../shared/channel-post-pin-resolution'
import { channelPostExtraPin } from '../shared/channel-post-extra-pin'
import { channelPostPinEdit } from '../shared/channel-post-pin-edit'
import { channelPostTextEdit } from '../shared/channel-post-text-edit'
import { postVisibilityRequest } from '../shared/channel-post-visibility'
import { postRemovalTarget } from '../shared/channel-post-removal'
import { postCreationPrepare, postCreationAction } from '../shared/channel-post-creation'
import { maxPostPhotos, postPhotoBytes } from '../shared/channel-post-photo'
import { backgroundImageInfo, maxBackgroundInputBytes } from '../shared/background-photo-bytes'
import { channelShareRequest, publicChannelLinkRequest } from '../shared/channel-share'
import { commentCreationPrepare, commentCreationAction } from '../shared/channel-comment-creation'
import { postDraftTarget, postDraftWrite } from '../shared/channel-post-drafts'
import { commentDraftParent, commentDraftTarget, commentDraftWrite } from '../shared/channel-comment-drafts'
import { channelCommentRemoval } from '../shared/channel-comment-removal'
import { channelCommentsRequest } from '../shared/channel-comments'
import { channelPostLikeRequest } from '../shared/channel-post-like'
import { discussionJoinRequest, discussionJoinAction } from '../shared/channel-discussion-join'
import { channelDiscussionNavigation } from '../shared/channel-discussion-navigation'
import { channelAdminAppointment } from '../shared/channel-admin-appointment'
import { channelJoinDecisionRequest, channelJoinDecisionAction } from '../shared/channel-join-decisions'
import { channelAccessRequest, channelAccessAction } from '../shared/channel-access-edit'
import { channelTagsEdit } from '../shared/channel-tags'
import { channelPhotoBytes } from '../shared/channel-photo-bytes'
import { channelPhotoBinding, channelPhotoUploadRequest, channelPhotoUploadAction } from '../shared/channel-photo-upload'
import { channelAdminRemoval } from '../shared/channel-admin-removal'
import { channelAdminPermissionsEdit } from '../shared/channel-admin-permissions'
import { channelAdminsSelection } from '../shared/channel-admins'
import { channelSubscribersSelection } from '../shared/channel-subscribers'
import { channelJoinRequestsSelection } from '../shared/channel-join-requests'
import { channelMembershipRequest } from '../shared/channel-membership-info'
import { channelIntroductionEdit } from '../shared/channel-introduction'
import { channelNameEdit } from '../shared/channel-name'
import { channelPhotoClear } from '../shared/channel-photo-clear'
import { channelCoverRequest, visibleChannelPhotos } from '../shared/channels'
import { channelPostMediaRequest } from '../shared/channel-post-media'
import { backgroundPhotoId, backgroundPhotoScope, chatBackgroundEdit, type BackgroundPhotoScope } from '../shared/chat-background'
import { backgroundStorageRemoval } from '../shared/background-storage'
import { groupCreateRequest } from '../shared/group-create'
import { groupMembersRequest } from '../shared/group-members'
import { groupLeaveRequest } from '../shared/group-leave'
import { groupRemovalRequest } from '../shared/group-removal'
import { groupNameEdit } from '../shared/group-name'
import { groupPhotoBinding, groupPhotoUploadRequest, groupPhotoUploadAction } from '../shared/group-photo-upload'
import { groupPhotoRequest, groupPhotoClear } from '../shared/group-photo'
import { visibleDialogPhotos } from '../shared/dialog-avatars'
import { channelPostsRequest } from '../shared/channel-posts'
import { groupAnnouncementEdit } from '../shared/group-announcement'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, protocol, session, shell, systemPreferences } from 'electron'
import { mkdir, readFile, rm, stat as fileStat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import { SettingsStore } from './platform/settings'
import { AccountRegistry } from './accounts/registry'
import { AuthenticationDomain } from './auth/domain'
import { CredentialVault } from './auth/credential-vault'
import { productionAuthentication } from './auth/production'
import type { DesktopEvent, DesktopSnapshot } from '../shared/model'
import { draftText, historyPosition, identifier, preferencePatch } from '../shared/validation'
import { actionRequest } from '../shared/message-actions'
import { forwardRequest, forwardSource } from '../shared/forward'
import { forwardBatchRequest } from '../shared/forward-batch'
import { participantAddRequest, participantContactRequest, chatContactRequest } from '../shared/participants'
import { dialogPinRequest } from '../shared/dialog-pins'
import { manualUnreadRequest } from '../shared/manual-unread'
import { mediaRequest } from '../shared/media'
import { maxAlbumPhotos, videoFacts } from '../shared/uploads'
import { NativeNotifications } from './platform/notifications'
import { searchQuery, sharedMediaFilter } from '../shared/search'
import { maxForumCategoryName } from '../shared/forum'
import { postLikersRequest } from '../shared/post-likers'
import { reportRequest } from '../shared/reports'
import { maxStickerBytes, stickerSidePx } from '../shared/stickers'
import { bioEdit } from '../shared/profile'
import { profileNameEdit } from '../shared/profile-name'
import { profilePhotoClear } from '../shared/profile-photo-clear'
import { profilePhotoBytes, profilePhotoHistoryAction, profilePhotoUploadAction } from '../shared/profile-photo-upload'
import { publicMorseId } from '../shared/contacts'
import { contactDetailsEdit } from '../shared/contact-details'
import { contactPhotoBinding, contactPhotoEdit, contactPhotoRemoval } from '../shared/contact-photo'
import { replyBinding } from '../shared/reply-draft'
import { composingKey, shortcutAccelerator, shortcutFor, shortcuts, type ShortcutCommand } from '../shared/shortcuts'
import { NativeContextMenus, type ContextMenuItem } from './platform/context-menus'
import { WindowState } from './platform/window-state'
import { DesktopShell } from './platform/desktop-shell'
import { AppUpdates } from './platform/app-updates'
import { BackgroundPhotos, type BackgroundPhotoOwner } from './platform/background-photos'
import { DataPublisher } from './data/publisher'
import { AppLock } from './platform/app-lock'
import { LocalDataKey } from './platform/local-data-key'
import { setLocalDataKey } from './storage/delivery-client'
import { recordAvatarStep } from './platform/avatar-diagnostics'
import { ChatTranslator } from './platform/translation'
import { MediaHelper } from './platform/media-helper'
import { schemeLinkTarget } from '../shared/text-links'
import { setVideoCompressor } from './media/attachment-staging'
import { maxVideoSourceSeconds, videoSendPreset } from '../shared/photo-quality'
import { maxChannelStoryCaption } from '../shared/channel-stories'
import { clearProfilePhotoCache } from './accounts/profile-photo'
import { userpicRoute } from './accounts/userpic-cache'
import { pinMessageRequest } from '../shared/pinned-messages'
import { deferredKind, deferredSendRequest } from '../shared/deferred-send'
import { eventReminderRequest } from '../shared/chat-event'
import type { AccountAuthState } from '../shared/auth'
import { effectiveUnreadCount as accountUnreadCount } from '../shared/manual-unread'
import { autoLockValue, passcodeInput, type AppLockSnapshot } from '../shared/app-lock'
import { language, locale, tr } from '../shared/i18n'

protocol.registerSchemesAsPrivileged([{ scheme: 'morse', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true
} }])

const accounts = new AccountRegistry(uid => ({
  storyStealth: () => settings.preferences.storyStealth,
  canRead: () => canReadWindow() && accounts.active?.profile.uid === uid,
  notifications: {
    preferences: () => settings.preferences,
    locked: () => screenLocked || shutdown !== 'running',
    appActive: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()),
    show: (content, click, dismiss) => notifications.show(uid, content, click, dismiss),
    open: chatId => openNotificationChat(uid, chatId),
    openInquiry: (channelId, inquiryId) => openNotificationInquiry(uid, channelId, inquiryId),
    report: message => notifications.report(message)
  },
  mediaProgress: (requestId, loaded, total) => emit({ type: 'media-progress', accountUid: uid, requestId, loaded, total }),
  forwardProgress: progress => emit({ type: 'forward-progress', accountUid: uid, progress }),
  actions: (chatId, actions) => emit({ type: 'actions-changed', accountUid: uid, chatId, actions }),
  changed: () => { contextMenus.prune(); void publish() },
  history: (chatId, history) => { contextMenus.prune(); emit({ type: 'history-changed', accountUid: uid, chatId, history }) },
  search: (chatId, search) => emit({ type: 'search-changed', accountUid: uid, chatId, search }),
  outgoing: (chatId, outgoing) => {voiceQueuePreviews.observe(uid,chatId,outgoing);emit({ type: 'outgoing-changed', accountUid: uid, chatId, outgoing })},
  reply: (chatId, reply) => emit({ type: 'reply-draft-changed', accountUid: uid, chatId, reply })
}))
let settings: SettingsStore
let authentication: AuthenticationDomain
let credentialVault: CredentialVault
let mainWindow: BrowserWindow | null = null
let snapshotRevision = 0
let shutdown: 'running' | 'closing' | 'done' = 'running'
let windowState: WindowState
let pendingClose: { id: string; finish(success: boolean): void } | null = null
let screenLocked = false
let screenIsLocked = false
let systemSuspended = false
let userInactive = false
let appLock: AppLock | null = null
let localKey: LocalDataKey | null = null
let accountsStarted = false
// Storage::Domain::start: accounts open their local data only once the local key can be read — at once when it is in
// the keychain, after the passcode when a local passcode wraps it.
function startAccounts(): void {
  if (accountsStarted || !localKey?.ready || shutdown !== 'running') return
  accountsStarted = true
  void authentication.start()
}
// Data sealed by a key that cannot be opened any more (a forgotten passcode, an unreadable key record) is moved to the
// Trash, not read, and a new key starts an empty local store.
async function replaceLocalData(): Promise<void> {
  const directory = join(app.getPath('userData'), 'accounts')
  if (existsSync(directory)) await shell.trashItem(directory)
  await localKey!.reset()
}
let touchIdAvailable = false
let autoLockTimer: ReturnType<typeof setTimeout> | null = null
let shouldLockAt = 0
const desktopShell = new DesktopShell(showWindow, () => app.quit())
const appUpdates = new AppUpdates(() => { void publish() })
const notifications = new NativeNotifications(() => { void publish() })
const translator = new ChatTranslator()
const mediaHelper = new MediaHelper()
// A link in Morse's own schemes waits here until the window takes it (at start the window may not be listening yet).
let pendingSchemeLink: string | null = null
function receiveSchemeLink(raw: string): void {
  const url = schemeLinkTarget(raw)
  if (!url) return
  pendingSchemeLink = url
  if (app.isReady() && settings) { showWindow(); emit({ type: 'open-link' }) }
}
// A picked video is compressed before it is staged, as iOS does before sending. The window reports whether power
// saving's «업로드 자동 압축» applies, because only it sees the battery.
let compressUploads = false
// The renderer reports it again after a reload; a new window starts from the last report.
let contentProtected = false
if (process.platform === 'darwin') setVideoCompressor(async (path, edit) => {
  const preferences = settings.preferences
  const directory = join(app.getPath('userData'), 'video-prepare'), output = join(directory, `${randomUUID()}.mp4`), drawing = join(directory, `${randomUUID()}.png`)
  emit({ type: 'attachment-preparing', active: true })
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const preset = edit?.preset ?? videoSendPreset(preferences.videoSendQuality, compressUploads || preferences.compressMediaUploads)
    if (edit?.overlay) await writeFile(drawing, edit.overlay, { mode: 0o600 })
    const result = await mediaHelper.compressVideo(path, output, preset, maxVideoSourceSeconds, edit ? { start: edit.start, end: edit.end } : undefined, edit?.overlay ? drawing : undefined)
    return result.status === 'ok' ? { status: 'ok', bytes: await readFile(output) } : { status: result.status }
  } catch { return { status: 'failed' } }
  finally {
    emit({ type: 'attachment-preparing', active: false })
    await rm(output, { force: true }).catch(() => {})
    await rm(drawing, { force: true }).catch(() => {})
  }
})
const storyVideoInputs = new StoryVideoInputs()
const storySavedVideos = new StorySavedVideos()
const storyAudioInputs = new StoryAudioInputs()
const storySavedAudio = new StorySavedAudio()
const voiceQueuePreviews=new VoiceQueuePreviews(requestId=>emit({type:'queued-voice-revoked',requestId}))
const voiceCaptures=new VoiceCaptures(id=>emit({type:'voice-capture-revoked',id}),error=>recordVoiceStep('grant-ended',error instanceof Error && error.message==='expired'?'expired':voiceErrorCode(error)))
const backgroundPhotos = new BackgroundPhotos()
const publisher = new DataPublisher()
const contextMenus = new NativeContextMenus(() => accounts.active?.readingActivityChanged())
const developmentURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const entryURL = developmentURL || 'morse://app/index.html'

function trustedURL(value: string): boolean {
  try {
    const url = new URL(value)
    if (developmentURL) return url.origin === new URL(developmentURL).origin
    return url.protocol === 'morse:' && url.hostname === 'app' && url.pathname === '/index.html'
  } catch { return false }
}
function windowBackground(): string {
  return settings.preferences.theme === 'black' ? '#000000' : nativeTheme.shouldUseDarkColors ? '#191B1F' : '#F5F6F8'
}
function applyTheme(): void {
  const theme = settings.preferences.theme
  nativeTheme.themeSource = theme === 'black' ? 'dark' : theme
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground())
}
function guard(event: IpcMainInvokeEvent, duringClose = false): void {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || !trustedURL(event.senderFrame.url) ||
      (shutdown !== 'running' && !(duringClose && shutdown === 'closing'))) {
    throw new Error(tr('허용되지 않은 요청입니다.'))
  }
}
function canReadWindow(): boolean {
  return shutdown === 'running' && !screenLocked && !contextMenus.open && Boolean(mainWindow && !mainWindow.isDestroyed() &&
    mainWindow.isVisible() && mainWindow.isFocused() && !mainWindow.isMinimized() && !mainWindow.webContents.isCrashed())
}
function emit(event: DesktopEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('morse:event', event)
}
async function snapshot(): Promise<DesktopSnapshot> {
  updateDesktopShell()
  const active = accounts.active
  const dialogs = active?.dialogs() ?? []
  const selfProfile = active?.selfProfile.snapshot ?? null
  const profile = selfProfile?.status === 'ready' ? selfProfile.profile : null
  const profiles = accounts.profiles.map(account => profile?.uid === account.uid ? { ...account, userId: profile.userId, displayName: profile.displayName } : account)
  // While the passcode lock is shown the renderer receives no chats, contacts or profile.
  const appLocked = Boolean(appLock?.locked)
  return {
    revision: ++snapshotRevision, appVersion: app.getVersion(),
    platform: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'unsupported',
    preferences: settings.preferences, systemDark: nativeTheme.shouldUseDarkColors, notifications: notifications.status(),
    platformIntegration: desktopShell.status(),
    accounts: profiles, activeAccountUid: active?.profile.uid ?? null, selfProfile: appLocked ? null : selfProfile, contacts: appLocked ? null : active?.contactsSnapshot() ?? null,
    channels: screenLocked ? null : active?.channels.snapshot ?? null,
    contactSearch: appLocked ? null : active?.contactDiscovery.snapshot ?? null, pendingDirects: appLocked || !active ? [] : active.pendingDirects().map(item => ({ ...item, displayName: active.dialogAvatars.peerName(item.chatId) || item.displayName, avatar: active.dialogAvatars.snapshot(item.chatId) })), participants: appLocked ? null : active?.participants ?? null,
    channelJoinDecisions: screenLocked ? null : active?.channelJoinDecisions.snapshot ?? null,
    channelAccess: screenLocked ? null : active?.channelAccess.snapshot ?? null,
    channelPhotoUpload: screenLocked ? null : active?.channelPhotoUpload.snapshot ?? null,
    groupPhotoUpload: screenLocked ? null : active?.groupPhotoUpload.snapshot ?? null,
    channelPublicPreview: screenLocked ? null : active?.channelPublicPreview.snapshot ?? null,
    ownStories: screenLocked ? null : active?.ownStories.snapshot ?? null,
    spaceNotes: screenLocked ? null : active?.spaceNotes.snapshot ?? null,
    channelDiscovery: screenLocked ? null : active?.channelDiscovery.snapshot ?? null,
    channelHome: screenLocked ? null : active?.channelHome.snapshot ?? null,
    channelStories: screenLocked ? null : active?.channelStories.snapshot() ?? null,
    appUpdate: appUpdates.snapshot,
    contactStoryPhotoAudio: screenLocked ? null : active?.contactStoryPhotoAudio.snapshot ?? null,
    contactAudienceStoryVideo: screenLocked ? null : active?.contactAudienceStoryVideo.snapshot ?? null,
    contactAudienceStoryPhoto: screenLocked ? null : active?.contactAudienceStoryPhoto.snapshot ?? null,
    contactStoryAudience: screenLocked ? null : active?.contactStoryAudience.snapshot ?? null,
    contactPublicStoryVideo: screenLocked ? null : active?.contactPublicStoryVideo.snapshot ?? null,
    contactPublicStoryPhoto: screenLocked ? null : active?.contactPublicStoryPhoto.snapshot ?? null,
    storyPublication: screenLocked ? null : active?.storyPublication.snapshot ?? null,
    storyReplyDraft: screenLocked ? null : active?.storyReplyDraft.snapshot ?? null,
    storyViewReceipt: screenLocked ? null : active?.storyViewReceipt.snapshot ?? null,
    storyReactionChange: screenLocked ? null : active?.storyReactionChange.snapshot ?? null,
    storyHiddenChange: screenLocked ? null : active?.storyHiddenChange.snapshot ?? null,
    storyPrivacyMove: screenLocked ? null : active?.storyPrivacyMove.snapshot ?? null,
    storyRemoval: screenLocked ? null : active?.storyRemoval.snapshot ?? null,
    noteRemoval: screenLocked ? null : active?.noteRemoval.snapshot ?? null,
    storyCaptionSave: screenLocked ? null : active?.storyCaptionSave.snapshot ?? null,
    noteTextSave: screenLocked ? null : active?.noteTextSave.snapshot ?? null,
    noteCreation: screenLocked ? null : active?.noteCreation.snapshot ?? null,
    channelCreation: screenLocked ? null : active?.channelCreation.snapshot ?? null,
    postCreation: screenLocked ? null : active?.postCreation.snapshot ?? null,
    commentCreation: screenLocked ? null : active?.commentCreation.snapshot ?? null,
    canReadCommentDrafts: !screenLocked && Boolean(active),
    discussionJoin: screenLocked ? null : active?.discussionJoin.snapshot ?? null,
    channelInquiries: screenLocked ? null : active?.channelInquiries.snapshot ?? null,
    inquiryRows: appLocked || !active ? [] : active.inquiryRowList(),
    chatFolders: appLocked || !active ? null : active.chatFolderList(),
    connection: active?.state ?? 'offline', dialogs: appLocked ? [] : dialogs, openDialogs: appLocked || !active ? [] : active.openDialogs(),
    dialogStatus: active?.readStatus ?? 'ready', dialogMessage: active?.readMessage ?? '',
    dialogPin: screenLocked ? null : active?.dialogPins.snapshot ?? null,
    manualUnread: screenLocked ? null : active?.manualUnread.snapshot ?? null,
    dialogActionsAvailable: !screenLocked && active?.state === 'ready' && active.readStatus === 'ready',
    signInAvailable: authentication.available, authentication: authentication.entrySnapshot, appLock: appLockSnapshot(),
    presence: appLocked || !active ? {} : active.presence.snapshot(), pinnedMessages: appLocked || !active ? null : active.pinnedMessages(), deferredMessages: appLocked || !active ? null : active.deferredMessages(), typing: appLocked || !active ? null : active.typingState(), listTyping: appLocked || !active ? {} : active.listTypingState(), postLikers: appLocked || !active ? null : active.postLikers(), stickers: appLocked || !active ? null : active.stickers(), stickerPack: appLocked || !active ? null : active.stickerPackSnapshot(), stickerPacks: appLocked || !active ? null : active.installedStickerPacks(), accountStates: appLocked ? [] : accountStates(), addingAccount: authentication.addingRequested, maxAccounts: maxAccounts()
  }
}
// The renderer's full read establishes the baseline for later change batches.
async function rendererSnapshot(): Promise<DesktopSnapshot> {
  const next = await snapshot()
  publisher.reset(next)
  return next
}
async function publish(): Promise<void> {
  voiceQueuePreviews.prune();voiceCaptures.prune()
  storySavedAudio.prune()
  storyAudioInputs.prune()
  storySavedVideos.prune()
  storyVideoInputs.prune()
  backgroundPhotos.prune()
  contextMenus.prune()
  try { const batch = publisher.diff(await snapshot()); if (batch) emit({ type: 'data', batch }) }
  catch { emit({ type: 'error', message: tr('대화 목록을 읽지 못했습니다.') }) }
}
function backgroundPhotoOwner(scope: BackgroundPhotoScope): BackgroundPhotoOwner {
  const available = (): void => { if (screenLocked || shutdown !== 'running') throw new Error(tr('화면 잠금을 해제한 뒤 사진을 선택해 주세요.')) }
  available()
  if (scope.kind === 'device') return { key: 'device', validate: available, load: async id => settings.photo(id) }
  const account = accounts.requireActive(scope.accountUid), lifetime = account.backgroundPhotoLifetime(scope.chatId)
  return {
    key: JSON.stringify([scope.accountUid, scope.chatId]),
    validate: () => { available(); if (accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')); lifetime() },
    load: id => account.backgroundPhoto(scope.chatId, id)
  }
}
function registerIPC(): void {
  const handle = (channel: string, action: (...args: unknown[]) => unknown, duringClose = false): void => {
    ipcMain.handle(`morse:${channel}`, (event, ...args: unknown[]) => { guard(event, duringClose); return action(...args) })
  }
  handle('snapshot', rendererSnapshot)
  handle('take-open-link', () => { const url = pendingSchemeLink; pendingSchemeLink = null; return url })
  handle('power-saving-state', value => { if (typeof value === 'boolean') compressUploads = value })
  // tdesktop Core::ScreenshotProtection → Platform::SetWindowScreenshotProtection (NSWindowSharingNone,
  // WDA_EXCLUDEFROMCAPTURE): while protected content is shown the window stays out of captures.
  handle('content-protection', value => {
    if (typeof value !== 'boolean') return
    contentProtected = value
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setContentProtection(value)
  })
  // The window's words and main's labels were read at start, so a new language takes a relaunch.
  handle('relaunch-app', () => { app.relaunch(); app.quit() })
  handle('check-app-update', () => appUpdates.check())
  handle('install-app-update', () => { if (appUpdates.request()) app.quit() })
  handle('create-group', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).groups.create(groupCreateRequest(raw))
  })
  handle('add-group-members', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).groups.addMembers(groupMembersRequest(raw))
  })
  handle('leave-group', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).groups.leave(groupLeaveRequest(raw))
  })
  handle('remove-group-member', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).groups.removeMember(groupRemovalRequest(raw))
  })
  handle('close-friend-list', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).closeFriendsApi.list()
  })
  handle('set-close-friend', (uid, peerUid, add) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof add !== 'boolean') throw new Error(tr('친한 친구 변경을 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).closeFriendsApi.set(identifier(peerUid), add)
  })
  handle('join-channel', (uid, channelId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelMembershipApi.join(identifier(channelId))
  })
  handle('leave-channel', (uid, channelId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelMembershipApi.leave(identifier(channelId))
  })
  handle('story-bar', (uid, peers, force) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyBarApi.list(peers, force === true)
  })
  // Telegram's row menu: "Delete chat" apart from "Clear history". For me only hides the room on
  // this device; for everyone revokes a private history and removes the room document.
  handle('delete-chat', (uid, chatId, forEveryone) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof forEveryone !== 'boolean') throw new Error(tr('삭제 범위를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).deleteChat(identifier(chatId), forEveryone)
  })
  handle('set-contact-flags', (uid, peer, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const patch = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    if (!Object.keys(patch).length || Object.entries(patch).some(([key, value]) => (key !== 'favorite' && key !== 'archived') || typeof value !== 'boolean')) throw new Error(tr('설정을 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).setContactFlags(identifier(peer), patch as { favorite?: boolean; archived?: boolean })
  })
  handle('set-chat-flags', (uid, chatId, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const patch = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    if (!Object.keys(patch).length || Object.entries(patch).some(([key, value]) => key === 'category' ? value !== null && (typeof value !== 'string' || !value)
      : (key !== 'muted' && key !== 'archived') || typeof value !== 'boolean')) throw new Error(tr('설정을 다시 선택해 주세요.'))
    if (typeof patch.category === 'string') identifier(patch.category)
    return accounts.requireActive(identifier(uid)).setChatFlags(identifier(chatId), patch as { muted?: boolean; archived?: boolean; category?: string | null })
  })
  handle('set-group-forum', (uid, chatId, enabled) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof enabled !== 'boolean') throw new Error(tr('설정을 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).setGroupForum(identifier(chatId), enabled)
  })
  handle('add-forum-category', (uid, chatId, name) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof name !== 'string' || !name.trim() || name.trim().length > maxForumCategoryName) throw new Error(tr('카테고리 이름은 1~{0}자로 입력해 주세요.', [maxForumCategoryName]))
    return accounts.requireActive(identifier(uid)).addForumCategory(identifier(chatId), name.trim())
  })
  handle('rename-forum-category', (uid, chatId, categoryId, name) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof name !== 'string' || !name.trim() || name.trim().length > maxForumCategoryName) throw new Error(tr('카테고리 이름은 1~{0}자로 입력해 주세요.', [maxForumCategoryName]))
    return accounts.requireActive(identifier(uid)).renameForumCategory(identifier(chatId), identifier(categoryId), name.trim())
  })
  handle('delete-forum-category', (uid, chatId, categoryId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).deleteForumCategory(identifier(chatId), identifier(categoryId))
  })
  handle('hide-messages', (uid, chatId, messageIds) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!Array.isArray(messageIds) || !messageIds.length || messageIds.length > 100) throw new Error(tr('삭제할 메시지를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).hideMessages(identifier(chatId), [...new Set(messageIds.map(identifier))])
  })
  handle('restore-chat', (uid, chatId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).restoreChat(identifier(chatId))
  })
  handle('clear-chat-history', (uid, chatId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).clearChatHistory(identifier(chatId))
  })
  handle('prepare-memo-chat', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.prepareMemoChat()
  })
  handle('blocked-users', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.blockedUsers()
  })
  handle('set-blocked-user', (uid, raw, blocked) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.setBlocked(blockTarget(raw), blocked === true)
  })
  handle('sign-in-sessions', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.signInSessions()
  })
  handle('revoke-sign-in-sessions', (uid, sessionId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.revokeSessions(signInSessionId(sessionId))
  })
  // No current code: the one kept on this device for an Apple sign-up (iOS updateBackupCode with SavedAccount.backupCode).
  handle('change-backup-code', async (uid, code) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = identifier(uid)
    const stored = code === null ? await credentialVault.backupCode(account).catch(() => null) : null
    if (code === null ? !stored : typeof code !== 'string' || !code.trim() || code.length > 256) throw new Error(tr('현재 복구 코드를 입력해 주세요.'))
    const result = await accounts.requireActive(account).accountTools.changeBackupCode(stored ?? String(code))
    if (stored && result.confirmed) await credentialVault.saveBackupCode(account, result.backupCode).catch(() => {})
    return result
  })
  handle('has-stored-backup-code', uid => credentialVault.backupCode(identifier(uid)).then(code => code !== null, () => false))
  handle('last-seen-privacy', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.lastSeenPrivacy()
  })
  handle('set-last-seen-privacy', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.setLastSeenPrivacy(lastSeenPrivacy(raw))
  })
  handle('report', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.report(reportRequest(raw))
  })
  handle('account-privacy', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.accountPrivacy()
  })
  handle('set-private-mode', (uid, value) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof value !== 'boolean') throw new Error(tr('설정을 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.setPrivateMode(value)
  })
  handle('set-auto-delete-months', (uid, months) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!autoDeleteMonthOptions.some(value => value === months)) throw new Error(tr('기간을 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.setAutoDeleteMonths(months as number)
  })
  handle('request-data-export', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.requestDataExport()
  })
  // The export's signed address opens in the browser, which downloads the JSON file.
  handle('open-data-export', raw => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    let url: URL
    try { url = new URL(String(raw)) } catch { throw new Error(tr('내려받기 주소를 확인하지 못했습니다.')) }
    if (url.protocol !== 'https:' || (url.hostname !== 'storage.googleapis.com' && url.hostname !== 'firebasestorage.googleapis.com')) throw new Error(tr('내려받기 주소를 확인하지 못했습니다.'))
    return shell.openExternal(url.href)
  })
  handle('delete-account', async uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    await accounts.requireActive(identifier(uid)).accountTools.deleteAccount()
    await authentication.forgetDeleted(identifier(uid))
  })
  handle('set-chat-auto-delete', (uid, chatId, seconds, myOnly) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const session = accounts.requireActive(identifier(uid)), id = identifier(chatId)
    if (typeof seconds !== 'number' || autoDeleteSecondsValue(seconds) !== seconds || typeof myOnly !== 'boolean') throw new Error(tr('자동 삭제 시간을 다시 선택해 주세요.'))
    const dialog = session.dialogs().find(item => item.id === id)
    if (!dialog || !canChangeAutoDelete(dialog, session.profile.uid)) throw new Error(tr('이 대화의 자동 삭제 설정을 바꿀 수 없습니다.'))
    const nextMyOnly = seconds > 0 && myOnly
    if ((dialog.autoDeleteSeconds ?? 0) === seconds && (seconds === 0 || Boolean(dialog.autoDeleteMyOnly) === nextMyOnly)) return 'done'
    return session.accountTools.setChatAutoDelete(id, seconds, nextMyOnly)
  })
  const inquiries = (uid: unknown) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelInquiries
  }
  const openInquiries = (uid: unknown) => accounts.active?.profile.uid === identifier(uid) ? accounts.active.channelInquiries : null
  handle('open-subscriber-inquiry', (uid, channelId) => inquiries(uid).openSubscriber(identifier(channelId)))
  handle('open-inquiry-list', (uid, raw) => inquiries(uid).openList(inquiryListRequest(raw)))
  handle('close-inquiry-list', (uid, requestId) => { openInquiries(uid)?.closeList(identifier(requestId)) })
  handle('open-inquiry-thread', (uid, raw) => inquiries(uid).openThread(inquiryThreadRequest(raw)))
  handle('close-inquiry-thread', (uid, requestId) => { openInquiries(uid)?.closeThread(identifier(requestId)) })
  handle('send-inquiry-message', (uid, raw) => inquiries(uid).send(inquirySendRequest(raw)))
  handle('edit-inquiry-message', (uid, raw) => inquiries(uid).edit(inquiryEditRequest(raw)))
  handle('delete-inquiry-message', (uid, raw) => inquiries(uid).remove(inquiryTargetRequest(raw)))
  handle('react-inquiry-message', (uid, raw) => inquiries(uid).react(inquiryReactionRequest(raw)))
  handle('pin-inquiry-message', (uid, raw) => inquiries(uid).setPinned(inquiryPinRequest(raw)))
  handle('set-inquiry-auto-delete', (uid, raw) => inquiries(uid).setAutoDelete(inquiryAutoDeleteRequest(raw)))
  handle('schedule-inquiry-message', (uid, raw) => inquiries(uid).schedule(inquiryScheduleRequest(raw)))
  handle('cancel-inquiry-scheduled', (uid, raw) => inquiries(uid).cancelScheduled(inquiryTargetRequest(raw)))
  handle('clear-inquiry-history', (uid, raw) => inquiries(uid).clear(inquiryThreadRequest(raw)))
  // ChannelInquiryChatView photo send: one picked file, re-encoded in the renderer before it is sent.
  handle('pick-inquiry-photo', async uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid))
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
    const result = await dialog.showOpenDialog(mainWindow, { title: tr('사진 선택'), properties: ['openFile'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
    const path = result.canceled ? '' : result.filePaths[0] ?? ''
    if (!path) return null
    const info = await fileStat(path)
    if (!info.isFile() || info.size > maxBackgroundInputBytes) throw new Error(tr('원본 20 MB 이하의 JPEG 또는 PNG 사진을 선택해 주세요.'))
    const bytes = new Uint8Array(await readFile(path))
    backgroundImageInfo(bytes)
    if (screenLocked || accounts.active !== account) { bytes.fill(0); throw new Error(tr('계정이 변경되었습니다.')) }
    return bytes
  })
  // ChannelInquiryChatView video and file sends: picked into the room's staging, sent from there.
  handle('pick-inquiry-attachment', (uid, raw, mode) => {
    if (mode !== 'video' && mode !== 'file') throw new Error(tr('첨부 종류를 확인해 주세요.'))
    return inquiries(uid).pickAttachment(inquiryThreadRequest(raw), mode, async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      const result = await dialog.showOpenDialog(mainWindow, { title: mode === 'video' ? tr('동영상 선택') : tr('파일 선택'), properties: ['openFile'],
        ...(mode === 'video' ? { filters: [{ name: tr('동영상'), extensions: ['mp4', 'm4v', 'mov'] }] } : {}) })
      return result.canceled ? null : result.filePaths
    })
  })
  handle('send-inquiry-attachment', (uid, raw, video) => inquiries(uid).sendAttachment(inquiryAttachmentRequest(raw), videoFacts(video)))
  handle('discard-inquiry-attachment', (uid, id) => { openInquiries(uid)?.discardAttachment(identifier(id)) })
  // An inquiry recording holds the same microphone grant a chat recording does (VoiceCaptures): reserved for
  // the open room with the window focused, active while recording, and ended when it is sent or put down.
  handle('begin-inquiry-voice', async (uid, raw) => {
    try { const grant = await beginInquiryVoice(uid, raw, 'audio'); recordVoiceStep('inquiry-begin', 'ok'); return grant }
    catch (error) { recordVoiceStep('inquiry-begin', voiceErrorCode(error)); throw error }
  })
  handle('begin-inquiry-round-video', async (uid, raw) => {
    try { const grant = await beginInquiryVoice(uid, raw, 'video'); recordVoiceStep('inquiry-video-begin', 'ok'); return grant }
    catch (error) { recordVoiceStep('inquiry-video-begin', voiceErrorCode(error)); throw error }
  })
  const beginInquiryVoice = async (uid: unknown, raw: unknown, media: CaptureMedia) => {
    if (!mainWindow?.isFocused() || screenLocked) throw new Error(tr('현재 문의 창에서 녹음을 시작해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), target = inquiryVoiceTarget(raw)
    const capture = { id: target.captureId, chatId: target.inquiryId }
    const validate = (): void => {
      if (screenLocked || shutdown !== 'running' || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.'))
      account.channelInquiries.requireOpenThread(target)
    }
    const grant = voiceCaptures.reserve({ validate }, capture, voiceCaptures.generationToken(), media)
    try {
      await askForRecording(media)
      validate(); voiceCaptures.permissionReady(capture); return grant
    } catch (error) { voiceCaptures.clear(capture.id); throw error }
  }
  // macOS asks once per device kind; a video message needs the camera as well as the microphone.
  const askForRecording = async (media: CaptureMedia): Promise<void> => {
    if (process.platform !== 'darwin') return
    if (!(await systemPreferences.askForMediaAccess('microphone'))) throw new Error(tr('시스템 설정에서 Morse의 마이크 접근을 허용해 주세요.'))
    if (media === 'video' && !(await systemPreferences.askForMediaAccess('camera'))) throw new Error(tr('시스템 설정에서 Morse의 카메라 접근을 허용해 주세요.'))
  }
  handle('activate-inquiry-voice', (uid, raw) => {
    try {
      const account = accounts.requireActive(identifier(uid)), target = inquiryVoiceTarget(raw)
      account.channelInquiries.requireOpenThread(target)
      const grant = voiceCaptures.activate({ id: target.captureId, chatId: target.inquiryId })
      recordVoiceStep('inquiry-activate', 'ok'); return grant
    } catch (error) { recordVoiceStep('inquiry-activate', voiceErrorCode(error)); throw error }
  })
  // As a chat recording: finished into a preview served on __voice-capture, then sent from that preview, so a
  // listen before sending and a retry after a failure both use the same recording.
  handle('finish-inquiry-voice', (uid, raw, bytes) => {
    try {
      const account = accounts.requireActive(identifier(uid)), target = inquiryVoiceTarget(raw)
      account.channelInquiries.requireOpenThread(target)
      const preview = voiceCaptures.finish({ id: target.captureId, chatId: target.inquiryId }, bytes)
      recordVoiceStep('inquiry-finish', 'ok'); return preview
    } catch (error) { recordVoiceStep('inquiry-finish', voiceErrorCode(error)); throw error }
    finally { if (bytes instanceof Uint8Array) bytes.fill(0) }
  })
  handle('send-inquiry-voice', async (uid, raw) => {
    let stage = 'request'
    try {
      const request = inquiryVoiceRequest(raw), capture = { id: request.captureId, chatId: request.inquiryId }
      stage = 'preview'
      const bytes = voiceCaptures.forSend(capture, request.sha256)
      stage = 'send'
      const result = await inquiries(uid).sendVoice(request, bytes)
      voiceCaptures.clear(request.captureId)
      recordVoiceStep('inquiry-send', result); return result
    } catch (error) { recordVoiceStep('inquiry-send', `${stage} ${voiceErrorCode(error)}`); throw error }
  })
  // A video message in an inquiry: the grant must be one reserved for the camera, then it is sent as a round video.
  handle('send-inquiry-round-video', async (uid, raw, bytes) => {
    let stage = 'request'
    try {
      if (!(bytes instanceof Uint8Array)) throw new Error(tr('다시 녹화해 주세요.'))
      const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      const target = inquiryVoiceTarget({ requestId: value.requestId, inquiryId: value.inquiryId, captureId: value.captureId })
      const message = { ...inquiryTargetRequest({ requestId: value.requestId, inquiryId: value.inquiryId, messageId: value.messageId }), ...inquiryReplyTo(value.replyToId) }
      if (!/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(message.messageId)) throw new Error(tr('영상 메시지를 다시 보내 주세요.'))
      const facts = roundVideoFacts({ duration: value.duration, thumb: value.thumb })
      if (Object.keys(value).some(key => !['requestId', 'inquiryId', 'captureId', 'messageId', 'duration', 'thumb', 'replyToId'].includes(key))) throw new Error(tr('영상 메시지 전송 요청을 확인해 주세요.'))
      stage = 'complete'
      const capture = { id: target.captureId, chatId: target.inquiryId }
      if (voiceCaptures.mediaOf(capture) !== 'video') throw new Error(tr('녹음 상태를 다시 확인해 주세요.'))
      voiceCaptures.complete(capture)
      stage = 'send'
      const result = await inquiries(uid).sendRoundVideo(message, new Uint8Array(bytes), facts, roundVideoSide)
      recordVoiceStep('inquiry-video-send', result); return result
    } catch (error) { recordVoiceStep('inquiry-video-send', `${stage} ${voiceErrorCode(error)}`); throw error }
    finally { if (bytes instanceof Uint8Array) bytes.fill(0) }
  })
  handle('record-voice-step', raw => { recordRendererVoiceStep(raw) }, true)
  handle('send-inquiry-photo', (uid, raw, bytes) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!(bytes instanceof Uint8Array)) throw new Error(tr('사진을 다시 선택해 주세요.'))
    return inquiries(uid).sendPhoto(inquiryPhotoRequest(raw), bytes)
  })
  handle('chat-folders', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.chatFolders()
  })
  handle('save-chat-folder', (uid, raw, create) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof create !== 'boolean') throw new Error(tr('잘못된 요청입니다.'))
    return accounts.requireActive(identifier(uid)).accountTools.saveChatFolder(chatFolderInput(raw), create)
  })
  handle('delete-chat-folder', (uid, folderId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.deleteChatFolder(identifier(folderId))
  })
  handle('reorder-chat-folders', (uid, folderIds) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.reorderChatFolders(chatFolderOrder(folderIds))
  })
  handle('create-invite-link', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.createInviteLink()
  })
  handle('use-invite-link', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).accountTools.useInviteLink(inviteToken(raw))
  })
  handle('resolve-voice-draft-navigation',async(uid,raw)=>{
    if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),request=voiceDraftStorageNavigation(raw),result=await account.resolveVoiceDraftNavigation(request)
    if(screenLocked || shutdown!=='running' || accounts.active!==account)throw new Error(tr('현재 계정을 확인해 주세요.'));return result
  })
  handle('voice-draft-storage',async uid=>{
    if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),value=await account.voiceDraftStorage.list()
    if(screenLocked || accounts.active!==account)throw new Error(tr('현재 계정을 확인해 주세요.'));return value
  })
  handle('remove-stored-voice-draft',async(uid,raw)=>{
    if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),removal=voiceDraftStorageRemoval(raw)
    voiceCaptures.clear(removal.id)
    try{await account.voiceDraftStorage.remove(removal);if(screenLocked || accounts.active!==account)throw new Error(tr('현재 계정을 확인해 주세요.'))}
    finally{voiceCaptures.clear(removal.id)}
  })
  handle('read-voice-draft',async(uid,rawChatId)=>{
    const account=accounts.requireActive(identifier(uid)),chatId=identifier(rawChatId)
    const record=await account.voiceDraftState<VoiceDraftRecord>({kind:'voice-draft-read',chatId})
    if(screenLocked || accounts.active!==account)throw new Error(tr('계정이 변경되었습니다.'));return record
  })
  handle('write-voice-draft',async(uid,raw)=>{
    const account=accounts.requireActive(identifier(uid)),request=voiceDraftWrite(raw)
    const validate=():void=>{if(screenLocked || shutdown!=='running' || accounts.active!==account)throw new Error(tr('현재 계정을 확인해 주세요.'));account.voiceQueueAccess(request.chatId)}
    validate()
    const known=await account.voiceDraftState<VoiceDraftRecord|null>({kind:'voice-draft-known',request});validate();if(known)return known
    const bytes=request.voice?voiceCaptures.forSend({id:request.voice.id,chatId:request.chatId},request.voice.sha256):undefined
    try{const record=await account.voiceDraftState<VoiceDraftRecord>({kind:'voice-draft-write',request,...(bytes?{bytes}:{})});validate();return record}finally{bytes?.fill(0)}
  })
  handle('restore-voice-draft',async(uid,raw)=>{
    const account=accounts.requireActive(identifier(uid)),reference=voiceDraftReference(raw)
    const validate=():void=>{if(screenLocked || shutdown!=='running' || accounts.active!==account)throw new Error(tr('현재 계정을 확인해 주세요.'));account.voiceCaptureAccess(reference.chatId)}
    validate();const generation=voiceCaptures.generationToken(),source=await account.voiceDraftState<VoiceDraftSource>({kind:'voice-draft-source',reference})
    try{
      validate();if(source.record.revision!==reference.revision || source.record.voice?.id!==reference.id)throw new Error(tr('음성 초안이 변경되었습니다.'))
      const preview=voiceCaptures.restore({validate},{id:reference.id,chatId:reference.chatId},source.bytes,generation)
      if(preview.sha256!==source.record.voice.sha256 || preview.bytes!==source.record.voice.bytes){voiceCaptures.clear(reference.id);throw new Error(tr('저장한 음성 원본이 일치하지 않습니다.'))}
      return{record:source.record,preview}
    }finally{source.bytes.fill(0)}
  })
  handle('open-queued-voice',async(uid,raw)=>{
    const account=accounts.requireActive(identifier(uid)),request=voiceQueueOpen(raw)
    const validate=():void=>{if(screenLocked || shutdown!=='running' || accounts.active!==account)throw new Error(tr('현재 계정을 확인해 주세요.'));account.voiceQueueAccess(request.chatId)}
    return voiceQueuePreviews.open(account.profile.uid,request,{validate,load:()=>account.voiceQueueSource({id:request.id,chatId:request.chatId,sha256:request.sha256,bytes:request.bytes,duration:request.duration})})
  })
  handle('release-queued-voice',requestId=>voiceQueuePreviews.clear(backgroundPhotoId(requestId)),true)
  handle('begin-voice-capture',async(uid,raw)=>{try{const grant=await beginChatVoice(uid,raw,'audio');recordVoiceStep('chat-begin','ok');return grant}catch(error){recordVoiceStep('chat-begin',voiceErrorCode(error));throw error}})
  handle('begin-round-video',async(uid,raw)=>{try{const grant=await beginChatVoice(uid,raw,'video');recordVoiceStep('chat-video-begin','ok');return grant}catch(error){recordVoiceStep('chat-video-begin',voiceErrorCode(error));throw error}})
  handle('send-round-video',async(uid,raw,bytes)=>{
    let stage='request'
    try{
      if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
      if(!(bytes instanceof Uint8Array))throw new Error(tr('다시 녹화해 주세요.'))
      const account=accounts.requireActive(identifier(uid)),request=roundVideoSendRequest(raw),capture={id:request.id,chatId:request.chatId}
      stage='complete'
      account.voiceCaptureAccess(request.chatId)
      if(voiceCaptures.mediaOf(capture)!=='video')throw new Error(tr('녹음 상태를 다시 확인해 주세요.'))
      voiceCaptures.complete(capture)
      stage='send'
      await account.sendRoundVideo(request,new Uint8Array(bytes));recordVoiceStep('chat-video-send','sent')
    }catch(error){recordVoiceStep('chat-video-send',`${stage} ${voiceErrorCode(error)}`);throw error}
    finally{if(bytes instanceof Uint8Array)bytes.fill(0)}
  })
  const beginChatVoice=async(uid:unknown,raw:unknown,media:CaptureMedia)=>{
    if(!mainWindow?.isFocused() || screenLocked)throw new Error(tr('현재 대화 창에서 녹음을 시작해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),target=voiceCaptureTarget(raw)
    const validate=():void=>{if(screenLocked || shutdown!=='running' || accounts.active!==account)throw new Error(tr('계정이 변경되었습니다.'));account.voiceCaptureAccess(target.chatId)}
    const generation=voiceCaptures.generationToken(),saved=await account.voiceDraftState<VoiceDraftRecord>({kind:'voice-draft-read',chatId:target.chatId});validate()
    if(saved.voice && media==='audio')throw new Error(tr('보관한 음성을 다시 열거나 정리한 뒤 새로 녹음해 주세요.'))
    const grant=voiceCaptures.reserve({validate},target,generation,media)
    try{await askForRecording(media);validate();voiceCaptures.permissionReady(target);return grant}catch(error){voiceCaptures.clear(target.id);throw error}
  }
  handle('activate-voice-capture',(uid,raw)=>{const account=accounts.requireActive(identifier(uid)),target=voiceCaptureTarget(raw);account.voiceCaptureAccess(target.chatId);return voiceCaptures.activate(target)})
  handle('finish-voice-capture',(uid,raw,bytes)=>{try{const account=accounts.requireActive(identifier(uid)),target=voiceCaptureTarget(raw);account.voiceCaptureAccess(target.chatId);const preview=voiceCaptures.finish(target,bytes);recordVoiceStep('chat-finish','ok');return preview}catch(error){recordVoiceStep('chat-finish',voiceErrorCode(error));throw error}finally{if(bytes instanceof Uint8Array)bytes.fill(0)}})
  handle('send-voice-capture',async(uid,raw)=>{
    if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),request=voiceSendRequest(raw)
    const source=():Uint8Array=>{if(screenLocked || accounts.active!==account)throw new Error(tr('계정이 변경되었습니다.'));return voiceCaptures.forSend(request,request.sha256)}
    try{await account.sendVoice(request,source);recordVoiceStep('chat-send','queued')}catch(error){recordVoiceStep('chat-send',voiceErrorCode(error));throw error}
    voiceCaptures.clear(request.id)
    if(screenLocked || accounts.active!==account)throw new Error(tr('계정이 변경되었습니다.'))
  })
  handle('release-voice-capture',id=>voiceCaptures.clear(backgroundPhotoId(id)),true)
  handle('refresh-discussion-join', uid => {
    if (screenLocked) throw new Error(tr('잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).discussionJoin.refresh()
  })
  handle('prepare-discussion-join', (uid, raw) => {
    if (screenLocked) throw new Error(tr('잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).discussionJoin.prepare(discussionJoinRequest(raw))
  })
  handle('discussion-join-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).discussionJoin.action(discussionJoinAction(raw))
  })
  handle('pick-builtin-background-photo', scope => backgroundPhotos.pick(backgroundPhotoOwner(backgroundPhotoScope(scope)),
    () => readFile(join(app.getAppPath(), 'out/renderer/backgrounds/chat_bg_9.jpg'))))
  handle('pick-background-photo', async scope => {
    const owner = backgroundPhotoOwner(backgroundPhotoScope(scope))
    return backgroundPhotos.pick(owner, async () => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
      const result = await dialog.showOpenDialog(mainWindow, { title: tr('대화 배경 사진 선택'), properties: ['openFile'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
  })
  handle('prepare-background-photo', (id, bytes) => backgroundPhotos.prepare(backgroundPhotoId(id), bytes))
  handle('release-background-photo', id => backgroundPhotos.release(backgroundPhotoId(id)), true)
  handle('background-photo-url', (scope, id) => backgroundPhotos.url(backgroundPhotoOwner(backgroundPhotoScope(scope)), backgroundPhotoId(id)))
  handle('release-background-photo-url', token => backgroundPhotos.revoke(backgroundPhotoId(token)), true)
  handle('chat-background', (uid, chatId) => accounts.requireActive(identifier(uid)).chatBackground(identifier(chatId)))
  handle('background-storage', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).backgroundStorage.list()
  })
  handle('remove-stored-background', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const accountUid = identifier(uid), removal = backgroundStorageRemoval(raw), account = accounts.requireActive(accountUid)
    try {
      const background = await account.backgroundStorage.remove(removal)
      if (accounts.active === account && !screenLocked) emit({ type: 'chat-background-changed', accountUid, chatId: removal.chatId, background })
    } finally { backgroundPhotos.revokeOwner(JSON.stringify([accountUid, removal.chatId])) }
  })
  handle('save-chat-background', async (uid, chatId, edit) => {
    const accountUid = identifier(uid), id = identifier(chatId)
    const account = accounts.requireActive(accountUid)
    const update = chatBackgroundEdit(edit)
    const photo = update.value?.preset === 'photo' ? backgroundPhotos.forSave(backgroundPhotoOwner({ kind: 'chat', accountUid, chatId: id }), update.value.photoId) : undefined
    try {
      const background = await account.chatBackground(id, update, photo)
      if (accounts.active === account && !screenLocked) emit({ type: 'chat-background-changed', accountUid, chatId: id, background })
      return background
    } finally { photo?.fill(0) }
  })
  handle('forward-targets', (uid, source) => accounts.requireActive(identifier(uid)).forwardTargets(forwardSource(source)))
  handle('forward-text', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 전달해 주세요.'))
    return accounts.requireActive(identifier(uid)).forwardText(forwardRequest(request))
  })
  handle('forward-media', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 전달해 주세요.'))
    return accounts.requireActive(identifier(uid)).forwardMedia(forwardRequest(request))
  })
  handle('forward-batch', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 전달해 주세요.'))
    return accounts.requireActive(identifier(uid)).forwardBatch(forwardBatchRequest(request))
  })
  // A message of an open inquiry room, forwarded into chats: the same queue, with the room as the source.
  handle('inquiry-forward-targets', (uid, source) => accounts.requireActive(identifier(uid)).inquiryForwardTargets(forwardSource(source)))
  handle('forward-inquiry-text', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 전달해 주세요.'))
    return accounts.requireActive(identifier(uid)).forwardInquiryText(forwardRequest(request))
  })
  handle('forward-inquiry-media', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 전달해 주세요.'))
    return accounts.requireActive(identifier(uid)).forwardInquiryMedia(forwardRequest(request))
  })
  // The rooms a forward may go into, and the send itself: a room receives messages, it does not queue them.
  handle('send-inquiry-sticker', (uid, raw, stickerId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).sendInquirySticker(inquiryTargetRequest(raw), identifier(stickerId))
  })
  handle('send-inquiry-pack-sticker', (uid, raw, setId, itemId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).sendInquiryPackSticker(inquiryTargetRequest(raw), identifier(setId), identifier(itemId))
  })
  handle('hide-inquiry-messages', (uid, inquiryId, messageIds) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!Array.isArray(messageIds)) throw new Error(tr('삭제할 메시지를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).hideInquiryMessages(inquiryIdentifier(inquiryId), [...new Set(messageIds.map(identifier))])
  })
  handle('inquiry-forward-rooms', (uid, source) => accounts.requireActive(identifier(uid)).inquiryForwardRooms(forwardSource(source)))
  handle('forward-to-inquiries', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 전달해 주세요.'))
    return accounts.requireActive(identifier(uid)).forwardToInquiries(inquiryForwardRequest(request))
  })
  handle('forward-inquiry-batch', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 전달해 주세요.'))
    return accounts.requireActive(identifier(uid)).forwardInquiryBatch(forwardBatchRequest(request))
  })
  handle('cancel-forward', (uid, id) => accounts.requireActive(identifier(uid)).cancelForward(identifier(id)))
  handle('set-dialog-pin', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 고정을 변경해 주세요.'))
    return accounts.requireActive(identifier(uid)).dialogPins.set(dialogPinRequest(request))
  })
  handle('check-dialog-pin', (uid, chatId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 고정 상태를 확인해 주세요.'))
    return accounts.requireActive(identifier(uid)).dialogPins.check(identifier(chatId))
  })
  handle('set-manual-unread', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 읽음 표시를 변경해 주세요.'))
    return accounts.requireActive(identifier(uid)).manualUnread.set(manualUnreadRequest(request))
  })
  handle('check-manual-unread', (uid, chatId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 읽음 상태를 확인해 주세요.'))
    return accounts.requireActive(identifier(uid)).manualUnread.check(identifier(chatId))
  })
  handle('auth-sign-in', code => authentication.signIn(code))
  handle('auth-sign-in-apple', () => authentication.signInWithApple())
  handle('auth-cancel', () => authentication.cancel())
  handle('auth-restore', uid => authentication.restore(identifier(uid)))
  handle('auth-sign-out', uid => authentication.signOut(uid === undefined ? accounts.active?.profile.uid ?? '' : identifier(uid)))
  handle('auth-add-account', () => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    authentication.beginAdd()
  })
  handle('auth-cancel-add', () => authentication.cancelAdd())
  handle('switch-account', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const id = identifier(uid)
    accounts.setActive(id); authentication.select(id); void credentialVault.setActive(id); void publish()
    updatePresence()
  })
  handle('app-lock-unlock', async raw => {
    const lock = requireAppLock(), passcode = passcodeInput(raw)
    if (!lock.locked) return 'correct'
    const result = await lock.unlock(passcode)
    if (result === 'correct') {
      const key = requireLocalKey()
      if (!key.ready && !await key.unlock(passcode)) {
        lock.lock(); updateScreenProtection()
        throw new Error(tr('로컬 데이터를 열지 못했습니다. 잠금 화면에서 로그아웃한 뒤 다시 로그인해 주세요.'))
      }
      // A passcode set before the data was encrypted wraps the key the first time it is entered (Domain::setPasscode).
      if (!key.protectedByPasscode) await key.protect(passcode).catch(() => {})
      updateScreenProtection(); checkAutoLock(); startAccounts()
    }
    return result
  })
  handle('app-lock-system-unlock', async () => {
    const lock = requireAppLock()
    if (!lock.locked || !touchIdAvailable || !lock.systemUnlockAllowed) return false
    try { await systemPreferences.promptTouchID(tr('잠금 해제')) } catch { return false }
    if (lock.locked) { lock.unlockBySystem(); updateScreenProtection(); checkAutoLock() }
    return true
  })
  handle('app-lock-lock', () => { lockApp() })
  handle('app-lock-check', raw => {
    const lock = requireAppLock()
    if (lock.locked || !lock.enabled) throw new Error(tr('로컬 암호 상태를 다시 확인해 주세요.'))
    return lock.check(passcodeInput(raw))
  })
  handle('app-lock-create', async raw => {
    const lock = requireAppLock(), passcode = passcodeInput(raw)
    if (lock.locked || !passcode) throw new Error(tr('암호를 입력해 주세요.'))
    await lock.create(passcode, touchIdAvailable)
    await requireLocalKey().protect(passcode)
    void publish(); checkAutoLock()
  })
  handle('app-lock-change', async raw => {
    const lock = requireAppLock(), passcode = passcodeInput(raw)
    if (lock.locked || !lock.enabled || !passcode) throw new Error(tr('암호를 입력해 주세요.'))
    const result = await lock.change(passcode)
    if (result === 'saved') await requireLocalKey().protect(passcode)
    void publish()
    return result
  })
  handle('app-lock-remove', async () => {
    const lock = requireAppLock()
    if (lock.locked) throw new Error(tr('잠금을 먼저 해제해 주세요.'))
    await requireLocalKey().protect(null)
    await lock.remove(); cancelAutoLock(); void publish()
  })
  handle('app-lock-auto', async seconds => {
    const lock = requireAppLock()
    if (lock.locked || !lock.enabled) throw new Error(tr('로컬 암호 상태를 다시 확인해 주세요.'))
    await lock.setAutoLock(autoLockValue(seconds)); cancelAutoLock(); checkAutoLock(); void publish()
  })
  handle('app-lock-system', async enabled => {
    const lock = requireAppLock()
    if (typeof enabled !== 'boolean' || lock.locked || !lock.enabled) throw new Error(tr('로컬 암호 상태를 다시 확인해 주세요.'))
    await lock.setSystemUnlock(enabled); void publish()
  })
  // PasscodeLockWidget log out: a forgotten passcode is replaced by signing in again.
  handle('app-lock-sign-out', async () => {
    const lock = requireAppLock()
    if (!lock.enabled) throw new Error(tr('로컬 암호가 꺼져 있습니다.'))
    await authentication.signOutAll()
    const key = requireLocalKey()
    if (key.ready) await key.protect(null)
    else { await accounts.flush().catch(() => {}); await replaceLocalData() }
    await lock.remove(); cancelAutoLock(); updateScreenProtection(); startAccounts()
  })
  handle('auth-create-account', userId => authentication.createAccount(userId))
  handle('refresh-profile', uid => accounts.requireActive(identifier(uid)).selfProfile.refresh())
  handle('send-story-reply', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReplyDraft.send(storyReplySendRequest(raw))
  })
  handle('save-story-reply-text', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReplyDraft.saveText(storyReplyTextWrite(raw))
  })
  handle('refresh-story-reply-draft', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReplyDraft.refresh()
  })
  handle('prepare-story-reply-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReplyDraft.prepare(storyReplyDraftPrepare(raw))
  })
  handle('story-reply-draft-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReplyDraft.action(storyReplyDraftAction(raw))
  })
  handle('refresh-story-view-receipt', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyViewReceipt.refresh()
  })
  handle('prepare-story-view-receipt', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyViewReceipt.prepare(storyViewReceiptPrepare(raw))
  })
  handle('story-view-receipt-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyViewReceipt.action(storyViewReceiptAction(raw))
  })
  handle('refresh-story-reaction-change', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReactionChange.refresh()
  })
  handle('prepare-story-reaction-change', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReactionChange.prepare(storyReactionChangePrepare(raw))
  })
  handle('story-reaction-change-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyReactionChange.action(storyReactionChangeAction(raw))
  })
  handle('refresh-story-hidden-change', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyHiddenChange.refresh()
  })
  handle('prepare-story-hidden-change', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyHiddenChange.prepare(storyHiddenChangePrepare(raw))
  })
  handle('story-hidden-change-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyHiddenChange.action(storyHiddenChangeAction(raw))
  })
  handle('refresh-story-privacy-move', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyPrivacyMove.refresh()
  })
  handle('prepare-story-privacy-move', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyPrivacyMove.prepare(storyPrivacyMovePrepare(raw))
  })
  handle('story-privacy-move-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyPrivacyMove.action(storyPrivacyMoveAction(raw))
  })
  handle('refresh-story-removal', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyRemoval.refresh()
  })
  handle('prepare-story-removal', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyRemoval.prepare(storyRemovalPrepare(raw))
  })
  handle('story-removal-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyRemoval.action(storyRemovalAction(raw))
  })
  handle('refresh-note-removal', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteRemoval.refresh()
  })
  handle('prepare-note-removal', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteRemoval.prepare(noteRemovalPrepare(raw))
  })
  handle('note-removal-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteRemoval.action(noteRemovalAction(raw))
  })
  handle('refresh-story-caption-save', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyCaptionSave.refresh()
  })
  handle('prepare-story-caption-save', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyCaptionSave.prepare(storyCaptionSavePrepare(raw))
  })
  handle('story-caption-save-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyCaptionSave.action(storyCaptionSaveAction(raw))
  })
  handle('refresh-note-text-save', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteTextSave.refresh()
  })
  handle('prepare-note-text-save', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteTextSave.prepare(noteTextSavePrepare(raw))
  })
  handle('note-text-save-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteTextSave.action(noteTextSaveAction(raw))
  })
  handle('refresh-note-creation', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteCreation.refresh()
  })
  handle('prepare-note-creation', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteCreation.prepare(noteCreationPrepare(raw))
  })
  handle('note-creation-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteCreation.action(noteCreationAction(raw))
  })
  handle('refresh-story-publication', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyPublication.refresh()
  })
  handle('prepare-story-publication', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyPublication.prepare(storyPublicationPrepare(raw))
  })
  handle('story-publication-action', async(uid,raw)=>{
    if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),action=storyPublicationAction(raw)
    storySavedAudio.clear()
    try{return await account.storyPublication.action(action)}finally{storySavedAudio.clear()}
  })
  handle('read-story-composer-audio',async(uid,raw)=>{
    if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),value=await account.readStoryComposerAudio(storyComposerDraftTarget(raw))
    if(screenLocked || accounts.active!==account)throw new Error(tr('계정이 변경되었습니다.'));return value
  })
  handle('save-story-composer-audio',async(uid,raw)=>{
    if(screenLocked)throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request=storyComposerAudioWrite(raw),account=accounts.requireActive(identifier(uid)),base=await account.storyComposerPhotoPreparation({id:request.id,draftRevision:request.draftRevision})
    const owner={...base,key:`audio:${base.key}`,validate:()=>{if(screenLocked || accounts.active!==account)throw new Error(tr('계정이 변경되었습니다.'));base.validate()}}
    storySavedAudio.clear();owner.validate();const bytes=request.sourceId?storyAudioInputs.forSave(owner,request.sourceId):undefined
    try{owner.validate();const value=await account.saveStoryComposerAudio(request,bytes);owner.validate();if(request.sourceId)storyAudioInputs.release(request.sourceId);return value}finally{storySavedAudio.clear();bytes?.fill(0)}
  })
  handle('pick-story-composer-audio', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), target = storyComposerPhotoTarget(raw)
    const base = await account.storyComposerPhotoPreparation(target)
    const owner = { ...base,key:`audio:${base.key}`,validate:() => { if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.'));base.validate() } }
    let selected: import('../shared/story-composer-audio').StoryAudioCandidate | null = null
    try {
      selected = await storyAudioInputs.pick(owner,async () => {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
        const result = await dialog.showOpenDialog(mainWindow,{ title:tr('스토리 오디오 입력 검토'),properties:['openFile'],filters:[{ name:tr('기본 PCM WAV'),extensions:['wav'] }] })
        return result.canceled ? null : result.filePaths[0] ?? null
      })
      if (selected) { await account.storyComposerPhotoPreparation(target);owner.validate() }
      return selected
    } catch (error) { if (selected) storyAudioInputs.release(selected.id);throw error }
  })
  handle('preview-story-composer-audio', async (uid,raw) => {
    if(screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),source=storyAudioSource(raw),base=await account.storyComposerPhotoPreparation({id:source.id,draftRevision:source.draftRevision})
    const owner={...base,key:`audio:${base.key}`,validate:()=>{if(screenLocked || accounts.active!==account) throw new Error(tr('계정이 변경되었습니다.'));base.validate()}}
    return storyAudioInputs.preview(owner,source.sourceId)
  })
  handle('confirm-story-composer-audio', async (uid,raw) => {
    if(screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),request=storyAudioConfirm(raw),base=await account.storyComposerPhotoPreparation({id:request.id,draftRevision:request.draftRevision})
    const owner={...base,key:`audio:${base.key}`,validate:()=>{if(screenLocked || accounts.active!==account) throw new Error(tr('계정이 변경되었습니다.'));base.validate()}}
    return storyAudioInputs.confirm(owner,request)
  })
  handle('release-story-composer-audio', id => storyAudioInputs.release(backgroundPhotoId(id)),true)
  handle('pick-story-composer-video', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), target = storyComposerPhotoTarget(raw)
    const base = await account.storyComposerPhotoPreparation(target)
    const owner = { ...base, key: `video:${base.key}`, validate: () => { if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')); base.validate() } }
    let selected: import('../shared/story-composer-video').StoryVideoCandidate | null = null
    try {
      selected = await storyVideoInputs.pick(owner, async () => {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
        const result = await dialog.showOpenDialog(mainWindow, { title: tr('스토리 영상 입력 검토'), properties: ['openFile'], filters: [{ name: tr('기본 MP4'), extensions: ['mp4', 'm4v'] }] })
        return result.canceled ? null : result.filePaths[0] ?? null
      })
      if (selected) { await account.storyComposerPhotoPreparation(target); owner.validate() }
      return selected
    } catch (error) { if (selected) storyVideoInputs.release(selected.id); throw error }
  })
  handle('preview-story-composer-video', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), source = storyVideoSource(raw)
    const base = await account.storyComposerPhotoPreparation({ id: source.id, draftRevision: source.draftRevision })
    const owner = { ...base, key: `video:${base.key}`, validate: () => { if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')); base.validate() } }
    return storyVideoInputs.preview(owner, source.sourceId)
  })
  handle('prepare-story-video-poster', async (uid, raw, bytes) => {
    try {
      if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
      const account = accounts.requireActive(identifier(uid)), request = storyVideoPosterRequest(raw)
      const base = await account.storyComposerPhotoPreparation({ id: request.id, draftRevision: request.draftRevision })
      const owner = { ...base, key: `video:${base.key}`, validate: () => { if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')); base.validate() } }
      return storyVideoInputs.preparePoster(owner, request, bytes)
    } finally { if (bytes instanceof Uint8Array) bytes.fill(0) }
  })
  handle('release-story-composer-video', id => storyVideoInputs.release(backgroundPhotoId(id)), true)
  handle('check-story-video-publication', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), request = storyVideoObservationRequest(raw)
    const active = (): void => { if (screenLocked || shutdown !== 'running' || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')) }
    const value = await account.storyVideoUpload.check(request,active); active(); return value
  })
  handle('publish-story-video-publication', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), request = storyVideoPublishRequest(raw)
    const active = (): void => { if (screenLocked || shutdown !== 'running' || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')) }
    storySavedAudio.clear();storySavedVideos.clear()
    try { const value = await account.storyVideoUpload.commit(request,active); active(); return value }
    finally { storySavedAudio.clear();storySavedVideos.clear() }
  })
  handle('upload-story-video-publication', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), request = storyVideoUploadRequest(raw)
    const active = (): void => { if (screenLocked || shutdown !== 'running' || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')) }
    storySavedAudio.clear()
    try{const value = await account.storyVideoUpload.upload(request,active); active(); return value}finally{storySavedAudio.clear()}
  })
  handle('pause-story-video-upload', uid => accounts.requireActive(identifier(uid)).storyVideoUpload.pause(), true)
  handle('read-story-video-publication', async uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), value = await account.storyVideoPublicationState({ kind: 'story-video-publication-read' })
    if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.'))
    return value
  })
  handle('prepare-story-video-publication', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), request = storyVideoPublicationPrepare(raw)
    const value = await account.storyVideoPublicationState({ kind: 'story-video-publication-prepare', request })
    if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.'))
    return value
  })
  handle('dismiss-story-video-publication', async (uid, id) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account=accounts.requireActive(identifier(uid)),key=backgroundPhotoId(id)
    storySavedAudio.clear()
    try{const value=await account.storyVideoPublicationState({kind:'story-video-publication-dismiss',id:key});if(screenLocked || accounts.active!==account)throw new Error(tr('계정이 변경되었습니다.'));return value}finally{storySavedAudio.clear()}
  })
  handle('read-story-composer-video', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), value = await account.readStoryComposerVideo(storyComposerDraftTarget(raw))
    if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.'))
    return value
  })
  handle('save-story-composer-video', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request = storyComposerVideoWrite(raw), account = accounts.requireActive(identifier(uid))
    storySavedVideos.clear()
    const base = await account.storyComposerPhotoPreparation({ id: request.id, draftRevision: request.draftRevision })
    const owner = { ...base, key: `video:${base.key}`, validate: () => { if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')); base.validate() } }
    owner.validate()
    const pair = request.media ? storyVideoInputs.forSave(owner, request.media.sourceId, request.media.posterId) : undefined
    try {
      owner.validate(); const value = await account.saveStoryComposerVideo(request, pair); owner.validate()
      if (request.media) storyVideoInputs.release(request.media.sourceId)
      return value
    } finally { storySavedVideos.clear(); pair?.video.fill(0); pair?.poster.fill(0) }
  })
  handle('read-story-composer-photo', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).readStoryComposerPhoto(storyComposerDraftTarget(raw))
  })
  handle('pick-story-composer-photo', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const accountUid = identifier(uid), target = storyComposerPhotoTarget(raw), account = accounts.requireActive(accountUid)
    const base = await account.storyComposerPhotoPreparation(target)
    const owner = { ...base, validate: () => { if (screenLocked || accounts.active !== account) throw new Error(tr('계정이 변경되었습니다.')); base.validate() } }
    let selected: { id: string; bytes: Uint8Array } | null = null
    try {
      selected = await backgroundPhotos.pick(owner, async () => {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
        const result = await dialog.showOpenDialog(mainWindow, { title: tr('새 스토리 사진 선택'), properties: ['openFile'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
        return result.canceled ? null : result.filePaths[0] ?? null
      })
      if (selected) { await account.storyComposerPhotoPreparation(target); owner.validate() }
      return selected
    } catch (error) { if (selected) { selected.bytes.fill(0); backgroundPhotos.release(selected.id) } throw error }
  })
  handle('save-story-composer-photo', async (uid, raw, input, thumbnail) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request = storyComposerPhotoWrite(raw), account = accounts.requireActive(identifier(uid))
    const base = await account.storyComposerPhotoPreparation({ id: request.id, draftRevision: request.draftRevision })
    const owner = { ...base, validate: () => { if (screenLocked || accounts.active !== account) throw new Error(tr('계정이변경되었습니다.')); base.validate() } }
    owner.validate()
    if (request.sourceId === null) {
      if (input !== undefined || thumbnail !== undefined) throw new Error(tr('사진 비우기 요청을 확인해 주세요.'))
      return account.saveStoryComposerPhoto(request)
    }
    let bytes: Uint8Array | undefined
    try {
      const pair = storyComposerPhotoPair(input, thumbnail)
      backgroundPhotos.prepare(request.sourceId, pair.full)
      bytes = backgroundPhotos.forSave(owner, request.sourceId)
      if (!bytes) throw new Error(tr('사진을 다시 선택해 주세요.'))
      return await account.saveStoryComposerPhoto(request, bytes, pair.thumbnail)
    } finally { bytes?.fill(0); if (input instanceof Uint8Array) input.fill(0); if (thumbnail instanceof Uint8Array) thumbnail.fill(0); backgroundPhotos.release(request.sourceId) }
  })
  handle('save-story-composer-draft', (uid, raw) => {
    const account = accounts.requireActive(identifier(uid)), request = storyComposerDraftWrite(raw)
    if (request.draft === null) { storySavedAudio.clear();storySavedVideos.clear() }
    const result = account.saveStoryComposerDraft(request)
    return request.draft === null ? result.finally(() => { storySavedAudio.clear();storySavedVideos.clear() }) : result
  }, true)
  handle('save-note-draft', (uid, raw) => accounts.requireActive(identifier(uid)).saveNoteDraft(noteDraftWrite(raw)), true)
  handle('search-note-page', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).spaceNotes.search(notePageSearch(raw))
  })
  handle('page-space-notes', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).spaceNotes.page(spaceNotesPageRequest(raw))
  })
  handle('open-own-story-audio', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).ownStories.loadAudio(ownStoryAudioRequest(raw))
  })
  handle('close-own-story-audio', (uid, id) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.ownStories.audio.dismiss(identifier(id))
  })
  handle('open-own-story-video', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).ownStories.loadVideo(ownStoryVideoRequest(raw))
  })
  handle('close-own-story-video', (uid, id) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.ownStories.video.dismiss(identifier(id))
  })
  handle('open-own-story-photo', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).ownStories.loadPhoto(ownStoryPhotoRequest(raw))
  })
  handle('close-own-story-photo', (uid, id) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.ownStories.photo.dismiss(identifier(id))
  })
  handle('read-contact-story-reaction', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contactStoryReaction.read(contactStoryReactionRequest(raw))
  })
  handle('close-contact-story-reaction', (uid, id) => accounts.requireActive(identifier(uid)).contactStoryReaction.dismiss(identifier(id)), true)
  handle('open-contact-story-photo-audio', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request = contactStoryPhotoAudioRequest(raw), active = accounts.requireActive(identifier(uid))
    active.contactStoryPhotoAudio.prepareSource(request)
    if (request.privacy !== 'everyone') active.contactStoryAudience.extendForMedia(request.audienceId!, request.profileRequestId, request.privacy)
    active.contactPublicStoryPhoto.pause(); active.contactPublicStoryVideo.pause(); active.contactAudienceStoryPhoto.pause(); active.contactAudienceStoryVideo.pause()
    return active.contactStoryPhotoAudio.open(request)
  })
  handle('close-contact-story-photo-audio', (uid, id) => accounts.requireActive(identifier(uid)).contactStoryPhotoAudio.dismiss(identifier(id)), true)
  handle('open-contact-audience-story-video', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request = contactAudienceStoryVideoRequest(raw), active = accounts.requireActive(identifier(uid))
    active.contactAudienceStories.videoSource(request); active.contactStoryPhotoAudio.pause(); active.contactStoryAudience.extendForMedia(request.audienceId, request.profileRequestId, request.privacy); active.contactAudienceStoryPhoto.pause(); active.contactPublicStoryPhoto.pause(); active.contactPublicStoryVideo.pause()
    return active.contactAudienceStoryVideo.open(request)
  })
  handle('close-contact-audience-story-video', (uid, id) => accounts.requireActive(identifier(uid)).contactAudienceStoryVideo.dismiss(identifier(id)), true)
  handle('open-contact-audience-story-photo', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request = contactAudienceStoryPhotoRequest(raw), active = accounts.requireActive(identifier(uid))
    active.contactAudienceStories.photoSource(request); active.contactStoryPhotoAudio.pause(); active.contactAudienceStoryVideo.pause(); active.contactPublicStoryPhoto.pause(); active.contactPublicStoryVideo.pause()
    return active.contactAudienceStoryPhoto.open(request)
  })
  handle('close-contact-audience-story-photo', (uid, id) => accounts.requireActive(identifier(uid)).contactAudienceStoryPhoto.dismiss(identifier(id)), true)
  handle('read-contact-audience-stories', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contactAudienceStories.read(contactAudienceStoriesRequest(raw))
  })
  handle('page-contact-audience-stories', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contactAudienceStories.page(contactAudienceStoriesPageRequest(raw))
  })
  handle('close-contact-audience-stories', (uid, id) => accounts.requireActive(identifier(uid)).contactAudienceStories.dismiss(identifier(id)), true)
  handle('open-contact-story-audience', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contactStoryAudience.open(contactStoryAudienceRequest(raw))
  })
  handle('close-contact-story-audience', (uid, id) => accounts.requireActive(identifier(uid)).contactStoryAudience.dismiss(identifier(id)), true)
  handle('open-contact-public-story-video', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request = contactPublicStoryVideoRequest(raw), active = accounts.requireActive(identifier(uid))
    active.contactPublicStories.videoSource(request); active.contactStoryPhotoAudio.pause(); active.contactAudienceStoryPhoto.pause(); active.contactAudienceStoryVideo.pause(); active.contactPublicStoryPhoto.pause()
    return active.contactPublicStoryVideo.open(request)
  })
  handle('close-contact-public-story-video', (uid, id) => accounts.requireActive(identifier(uid)).contactPublicStoryVideo.dismiss(identifier(id)), true)
  handle('open-contact-public-story-photo', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const request = contactPublicStoryPhotoRequest(raw), active = accounts.requireActive(identifier(uid))
    active.contactPublicStories.photoSource(request); active.contactStoryPhotoAudio.pause(); active.contactAudienceStoryPhoto.pause(); active.contactAudienceStoryVideo.pause(); active.contactPublicStoryVideo.pause()
    return active.contactPublicStoryPhoto.open(request)
  })
  handle('close-contact-public-story-photo', (uid, id) => accounts.requireActive(identifier(uid)).contactPublicStoryPhoto.dismiss(identifier(id)), true)
  handle('page-contact-public-stories', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contactPublicStories.page(contactPublicStoriesPageRequest(raw))
  })
  handle('read-contact-public-stories', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contactPublicStories.read(contactPublicStoriesRequest(raw))
  })
  handle('close-contact-public-stories', (uid, id) => accounts.requireActive(identifier(uid)).contactPublicStories.dismiss(identifier(id)), true)
  handle('open-own-stories', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).ownStories.open(ownStoriesRequest(raw))
  })
  handle('page-own-stories', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).ownStories.page(ownStoriesPageRequest(raw))
  })
  handle('close-own-stories', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.ownStories.dismiss(identifier(requestId))
  })
  handle('open-contact-audience-story-link', (uid, raw) => {
    if (screenLocked || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !mainWindow.isFocused()) throw new Error(tr('현재 청중 스토리 창에서 전체 웹 주소를 확인해 주세요.'))
    const request = contactAudienceStoryLinkRequest(raw), active = accounts.requireActive(identifier(uid))
    const url = active.contactAudienceStories.linkSource(request)
    return shell.openExternal(url)
  })
  handle('open-contact-public-story-link', (uid, raw) => {
    if (screenLocked || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !mainWindow.isFocused()) throw new Error(tr('현재 공개 스토리 창에서 전체 웹 주소를 확인해 주세요.'))
    const request = contactPublicStoryLinkRequest(raw), active = accounts.requireActive(identifier(uid))
    const url = active.contactPublicStories.linkSource(request)
    return shell.openExternal(url)
  })
  handle('open-story-caption-link', (uid, raw) => {
    if (screenLocked || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !mainWindow.isFocused()) throw new Error(tr('현재 스토리 창에서 웹 링크를 선택해 주세요.'))
    const request = storyCaptionLinkRequest(raw), active = accounts.requireActive(identifier(uid))
    const url = active.ownStories.captionLinkSource(request)
    return shell.openExternal(url)
  })
  handle('select-own-story', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).ownStories.select(ownStorySelection(raw))
  })
  handle('open-space-notes', (uid, requestId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).spaceNotes.open(identifier(requestId))
  })
  handle('close-space-notes', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.spaceNotes.dismiss(identifier(requestId))
  })
  handle('rebase-note-edit-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteEditComparison.rebase(noteEditRebaseRequest(raw))
  })
  handle('compare-note-edit-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).noteEditComparison.compare(noteEditComparisonRequest(raw))
  })
  handle('close-note-edit-comparison', (uid, id) => accounts.requireActive(identifier(uid)).noteEditComparison.dismiss(identifier(id)), true)
  handle('read-story-view-records', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyViewRecords.read(storyViewRecordsRequest(raw))
  })
  handle('close-story-view-records', (uid, id) => accounts.requireActive(identifier(uid)).storyViewRecords.dismiss(identifier(id)), true)
  handle('read-story-hidden-audience', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).storyHiddenAudience.read(storyHiddenAudienceRequest(raw))
  })
  handle('close-story-hidden-audience', (uid, id) => accounts.requireActive(identifier(uid)).storyHiddenAudience.dismiss(identifier(id)), true)
  handle('start-story-caption-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).startStoryCaptionDraft(storyCaptionDraftStart(raw))
  })
  handle('read-story-caption-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).readStoryCaptionDraft(storyCaptionDraftTarget(raw))
  })
  handle('save-story-caption-draft', (uid, raw) => accounts.requireActive(identifier(uid)).saveStoryCaptionDraft(storyCaptionDraftWrite(raw)), true)
  handle('start-note-edit-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).startNoteEditDraft(noteEditDraftStart(raw))
  })
  handle('read-note-edit-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).readNoteEditDraft(noteEditDraftTarget(raw))
  })
  handle('save-note-edit-draft', (uid, raw) => accounts.requireActive(identifier(uid)).saveNoteEditDraft(noteEditDraftWrite(raw)), true)
  handle('set-space-note-pin', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).spaceNotes.pin.save(notePinRequest(raw))
  })
  handle('select-space-note', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).spaceNotes.select(spaceNoteSelection(raw))
  })
  handle('channels-visible', (uid, visible) => {
    if (typeof visible !== 'boolean' || (screenLocked && visible)) throw new Error(tr('채널 화면과 잠금 상태를 확인해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.setVisible(visible)
  })
  handle('open-channel-photo-clear', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.openPhotoClear(channelPhotoClear(raw))
  })
  handle('clear-channel-photo', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.photoClear.save(channelPhotoClear(raw))
  })
  handle('close-channel-photo-clear', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.closePhotoClear(identifier(requestId))
  })
  handle('open-channel-name', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.openName(channelNameEdit(raw))
  })
  handle('save-channel-name', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.nameEditor.save(channelNameEdit(raw))
  })
  handle('close-channel-name', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.closeName(identifier(requestId))
  })
  handle('open-channel-tags', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const channels = accounts.requireActive(identifier(uid)).channels, request = channelTagsEdit(raw)
    channels.openTags(request)
  })
  handle('save-channel-tags', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.tagsEditor.save(channelTagsEdit(raw))
  })
  handle('close-channel-tags', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.closeTags(identifier(requestId))
  })
  handle('open-channel-introduction', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const channels = accounts.requireActive(identifier(uid)).channels, request = channelIntroductionEdit(raw)
    channels.openIntroduction(request)
  })
  handle('save-channel-introduction', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.introduction.save(channelIntroductionEdit(raw))
  })
  handle('close-channel-introduction', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.closeIntroduction(identifier(requestId))
  })
  handle('discussion-leave-work', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).discussionLeaveWork(channelDiscussionNavigation(raw))
  })
  // A discussion room deleted from the chat list is left, the way iOS deletes one for me.
  handle('discussion-row-departure', (uid, chatId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).discussionRowDeparture(identifier(chatId))
  })
  handle('resolve-discussion-departure', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).resolveDiscussionDeparture(channelDiscussionNavigation(raw))
  })
  handle('resolve-channel-discussion', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).resolveChannelDiscussion(channelDiscussionNavigation(raw))
  })
  handle('open-channel-admin-appointment', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.openAdminAppointment(channelAdminAppointment(raw))
  })
  handle('appoint-channel-admin', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.adminAppointment.save(channelAdminAppointment(raw))
  })
  handle('close-channel-admin-appointment', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.closeAdminAppointment(identifier(requestId))
  })
  handle('open-channel-admin-removal', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.openAdminRemoval(channelAdminRemoval(raw))
  })
  handle('remove-channel-admin', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.adminRemoval.save(channelAdminRemoval(raw))
  })
  handle('close-channel-admin-removal', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.closeAdminRemoval(identifier(requestId))
  })
  handle('open-channel-admin-permissions', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.openAdminPermissions(channelAdminPermissionsEdit(raw))
  })
  handle('save-channel-admin-permissions', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.adminPermissions.save(channelAdminPermissionsEdit(raw))
  })
  handle('close-channel-admin-permissions', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.closeAdminPermissions(identifier(requestId))
  })
  handle('open-channel-admins', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.admins.open(channelAdminsSelection(raw))
  })
  handle('close-channel-admins', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.admins.dismiss(identifier(requestId))
  })
  handle('open-channel-subscribers', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.subscribers.open(channelSubscribersSelection(raw))
  })
  handle('close-channel-subscribers', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.subscribers.dismiss(identifier(requestId))
  })
  handle('open-channel-join-requests', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.joinRequests.open(channelJoinRequestsSelection(raw))
  })
  handle('close-channel-join-requests', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.joinRequests.dismiss(identifier(requestId))
  })
  handle('open-public-preview-photos', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelPublicPreview.openPhotos(publicChannelPhotosRequest(raw))
  })
  handle('close-public-preview-photos', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channelPublicPreview.dismissPhotos(identifier(requestId))
  })
  // Telegram's «Copy Image» / «Copy» (PhotoMedia::setToClipboard): the picture the window shows, as a PNG it drew,
  // goes on the system clipboard as an image.
  handle('copy-image', async png => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!(png instanceof Uint8Array) || !png.byteLength || png.byteLength > 64 * 1024 * 1024) throw new Error(tr('이미지를 복사하지 못했습니다.'))
    // Only a picture that decodes goes on the clipboard.
    if (nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength)).isEmpty()) throw new Error(tr('이미지를 복사하지 못했습니다.'))
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  })
  handle('copy-listed-channel-share-text', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const text = accounts.requireActive(identifier(uid)).channels.shareText(channelShareRequest(raw))
    clipboard.writeText(text)
  })
  handle('copy-listed-channel-link', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const url = accounts.requireActive(identifier(uid)).channels.shareLink(channelShareRequest(raw))
    clipboard.writeText(url)
  })
  handle('copy-public-channel-share-text', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const text = accounts.requireActive(identifier(uid)).channelPublicPreview.shareText(channelShareRequest(raw))
    clipboard.writeText(text)
  })
  handle('copy-public-channel-link', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const url = accounts.requireActive(identifier(uid)).channelPublicPreview.shareLink(channelShareRequest(raw))
    clipboard.writeText(url)
  })
  handle('open-public-preview-membership', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelPublicPreview.membership.open(channelMembershipRequest(raw))
  })
  handle('close-public-preview-membership', (uid, requestId) => {
    accounts.requireActive(identifier(uid)).channelPublicPreview.membership.dismiss(identifier(requestId))
  })
  handle('show-channel-cover', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.showCover(channelCoverRequest(raw))
  })
  handle('hide-channel-cover', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.hideCover(identifier(requestId))
  })
  handle('visible-channel-photos', (uid, raw) => {
    const ids = visibleChannelPhotos(raw)
    if (screenLocked && ids.length) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const session = accounts.requireActive(identifier(uid))
    session.channels.avatars.setVisible(ids)
    // Channels outside the account's list (the channel tab's discover rail) have their own photos.
    session.channelHome.avatars.setVisible(ids)
  })
  handle('refresh-channels', uid => accounts.requireActive(identifier(uid)).channels.refresh())
  handle('visible-channel-stories', (uid, raw) => {
    const ids = visibleChannelPhotos(raw)
    if (screenLocked && ids.length) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelStories.setVisible(ids)
  })
  handle('channel-story-media', (uid, channelId, storyId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelStories.media(identifier(channelId), identifier(storyId))
  })
  handle('mark-channel-story-viewed', (uid, channelId, storyId) => {
    if (screenLocked) return
    return accounts.requireActive(identifier(uid)).channelStories.markViewed(identifier(channelId), identifier(storyId))
  })
  handle('react-channel-story', (uid, channelId, storyId, emoji) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof emoji !== 'string') throw new Error(tr('반응을 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelStories.react(identifier(channelId), identifier(storyId), emoji)
  })
  handle('publish-channel-story', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const { caption, kind, media, thumbnail, durationSeconds } = value
    // storage.rules: a picture under 10 MB, a video under 50 MB.
    if (typeof caption !== 'string' || caption.length > maxChannelStoryCaption || (kind !== 'image' && kind !== 'video')
      || !(media instanceof Uint8Array) || !media.byteLength || media.byteLength >= (kind === 'video' ? 50 : 10) * 1024 * 1024
      || !(thumbnail instanceof Uint8Array) || !thumbnail.byteLength || thumbnail.byteLength >= 2 * 1024 * 1024
      || (durationSeconds !== null && (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600))) throw new Error(tr('채널 스토리 내용을 확인해 주세요.'))
    const session = accounts.requireActive(identifier(uid)), channelId = identifier(value.channelId)
    return session.channelStories.publish({ channelId, caption, kind, media, thumbnail, durationSeconds: kind === 'video' ? durationSeconds as number | null : null }, () => session.ownsChannel(channelId))
  })
  handle('remove-channel-story', (uid, channelId, storyId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const session = accounts.requireActive(identifier(uid)), id = identifier(channelId)
    return session.channelStories.remove(id, identifier(storyId), () => session.ownsChannel(id))
  })
  handle('open-channel-home', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelHome.open()
  })
  handle('like-channel-home-post', (uid, channelId, postId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelHome.like(identifier(channelId), identifier(postId))
  })
  handle('close-channel-home', uid => { if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channelHome.close() })
  handle('refresh-channel-home', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelHome.refresh()
  })
  handle('open-channel-category', (uid, category) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelHome.openCategory(category)
  })
  handle('close-channel-category', uid => { if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channelHome.closeCategory() })
  handle('resolve-channel-post-pin', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.pinResolutionEditor.save(channelPostPinResolution(raw))
  })
  handle('clear-channel-post-extra-pin', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.extraPinEditor.save(channelPostExtraPin(raw))
  })
  handle('save-channel-post-pin', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.pinEditor.save(channelPostPinEdit(raw))
  })
  handle('save-channel-post-text', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.textEditor.save(channelPostTextEdit(raw))
  })
  // MorseStickerEditor «배경 제거».
  handle('sticker-cutout', async (uid, bytes) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid))
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error(tr('사진을 확인해 주세요.'))
    const result = await mediaHelper.cutout(bytes)
    if (result.status === 'ok') return result.png
    throw new Error(result.status === 'no-subject' ? tr('분리할 피사체를 찾지 못했습니다.') : result.status === 'unavailable' ? tr('이 Mac에서는 배경 제거를 사용할 수 없어요.') : tr('처리하지 못했습니다. 다시 시도해 주세요.'))
  })
  // «스티커 만들기» for a GIF or MP4: the chosen square, every frame kept, at the sticker size.
  handle('sticker-crop-animated', async (uid, bytes, kind, square) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid))
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maxStickerBytes || (kind !== 'gif' && kind !== 'mp4')) throw new Error(tr('스티커 파일을 확인해 주세요.'))
    const value = square as Record<string, unknown> | null
    const numbers = value && typeof value === 'object' ? [value.x, value.y, value.size] : []
    if (numbers.length !== 3 || numbers.some(number => typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 16384) || (value!.size as number) < 1) throw new Error(tr('스티커 파일을 확인해 주세요.'))
    const cropped = await mediaHelper.cropAnimated(bytes, kind, { x: value!.x as number, y: value!.y as number, size: value!.size as number }, stickerSidePx)
    if (cropped) return cropped
    if (process.platform === 'darwin') throw new Error(tr('처리하지 못했습니다. 다시 시도해 주세요.'))
    return null
  })
  // MorseVoiceTranscriptService: the voice message's audio, recognized in the app's language.
  handle('transcribe-voice', async (uid, bytes) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid))
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error(tr('음성 메시지를 확인해 주세요.'))
    return mediaHelper.transcribe(bytes, locale())
  })
  handle('add-sticker', (uid, bytes) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maxStickerBytes) throw new Error(tr('스티커 파일을 확인해 주세요.'))
    return accounts.requireActive(identifier(uid)).addSticker(bytes)
  })
  handle('remove-sticker', (uid, id) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error(tr('스티커를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).removeSticker(id)
  })
  handle('send-sticker', (uid, chatId, id, stickerId, reply) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof stickerId !== 'string' || !/^[a-f0-9]{64}$/.test(stickerId)) throw new Error(tr('스티커를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).sendSticker(identifier(chatId), identifier(id), stickerId, replyBinding(reply))
  })
  // Telegram StickerPackScreen: the set of a tapped sticker, its install state, and sending one of its stickers.
  handle('open-sticker-pack', (uid, chatId, messageId, version) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof version !== 'string' || version.length > 64) throw new Error(tr('스티커를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).openStickerPack(identifier(chatId), identifier(messageId), version)
  })
  handle('close-sticker-pack', uid => { accounts.requireActive(identifier(uid)).closeStickerPack() })
  handle('install-sticker-pack', (uid, setId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).installStickerPack(identifier(setId))
  })
  handle('owned-sticker-packs', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).ownedStickerPacks()
  })
  handle('create-sticker-pack', (uid, title) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error(tr('스티커팩 이름을 입력해 주세요.'))
    return accounts.requireActive(identifier(uid)).createStickerPack(title)
  })
  handle('add-sticker-to-pack', (uid, setId, bytes) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error(tr('스티커를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).addStickerToPack(identifier(setId), bytes)
  })
  handle('uninstall-sticker-pack', (uid, setId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).uninstallStickerPack(identifier(setId))
  })
  handle('send-pack-sticker', (uid, chatId, id, setId, itemId, reply) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof itemId !== 'string' || !/^[a-f0-9]{64}$/.test(itemId)) throw new Error(tr('스티커를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).sendPackSticker(identifier(chatId), identifier(id), identifier(setId), itemId, replyBinding(reply))
  })
  handle('open-post-likers', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).openPostLikers(postLikersRequest(raw))
  })
  handle('close-post-likers', (uid, requestId) => { if (accounts.active?.profile.uid === identifier(uid)) accounts.active.closePostLikers(identifier(requestId)) })
  handle('set-channel-post-like', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.likes.save(channelPostLikeRequest(raw))
  })
  handle('remove-public-preview-comment', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelPublicPreview.comments.removal.save(channelCommentRemoval(raw))
  })
  handle('remove-channel-comment', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.comments.removal.save(channelCommentRemoval(raw))
  })
  handle('set-post-visibility', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.visibilityEditor.save(postVisibilityRequest(raw))
  })
  handle('remove-channel-post', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.removalEditor.save(postRemovalTarget(raw))
  })
  handle('set-public-preview-like', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelPublicPreview.likes.save(channelPostLikeRequest(raw))
  })
  handle('open-public-preview-comments', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelPublicPreview.comments.open(channelCommentsRequest(raw))
  })
  handle('close-public-preview-comments', (uid, selectionId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channelPublicPreview.comments.dismiss(identifier(selectionId))
  })
  handle('open-public-preview-media', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelPublicPreview.media.load(channelPostMediaRequest(raw))
  })
  handle('close-public-preview-media', (uid, selectionId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channelPublicPreview.media.dismiss(identifier(selectionId))
  })
  handle('open-public-channel-link', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const active = accounts.requireActive(identifier(uid))
    await active.channelPublicPreview.openLink(publicChannelLinkRequest(raw))
    active.channels.posts.media.clear(); void publish()
  })
  handle('open-public-channel-preview', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const active = accounts.requireActive(identifier(uid))
    active.channelPublicPreview.open(publicChannelPreviewRequest(raw))
    active.channels.posts.media.clear()
    void publish()
  })
  handle('open-public-preview-channel-feed', (uid, requestId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelPublicPreview.openChannelFeed(identifier(requestId))
  })
  handle('load-public-preview-posts', (uid, requestId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channelPublicPreview.loadPosts(identifier(requestId))
  })
  handle('close-public-channel-preview', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channelPublicPreview.dismiss(identifier(requestId))
  })
  handle('search-public-channels', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelDiscovery.search(channelDiscoveryRequest(raw))
  })
  handle('close-channel-discovery', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channelDiscovery.dismiss(identifier(requestId))
  })
  handle('refresh-channel-creation', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelCreation.refresh()
  })
  handle('prepare-channel-creation', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelCreation.prepare(channelCreationPrepare(raw))
  })
  handle('channel-creation-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelCreation.action(channelCreationAction(raw))
  })
  handle('refresh-post-creation', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).postCreation.refresh()
  })
  handle('prepare-post-creation', (uid, raw, photos) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (photos !== undefined && (!Array.isArray(photos) || photos.length > maxPostPhotos)) throw new Error(tr('사진은 최대 10장까지 게시할 수 있습니다.'))
    const list = Array.isArray(photos) ? photos.map(postPhotoBytes) : []
    return accounts.requireActive(identifier(uid)).postCreation.prepare(postCreationPrepare(raw, list.length), list)
  })
  handle('pick-channel-post-photos', async (uid, remaining) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid))
    if (typeof remaining !== 'number' || !Number.isInteger(remaining) || remaining < 1 || remaining > maxPostPhotos) throw new Error(tr('사진은 최대 10장까지 고를 수 있습니다.'))
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
    const result = await dialog.showOpenDialog(mainWindow, { title: tr('사진 선택 (최대 10장)'), properties: ['openFile', 'multiSelections'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
    if (result.canceled) return []
    const files: Uint8Array[] = []
    for (const path of result.filePaths.slice(0, remaining)) {
      const info = await fileStat(path)
      if (!info.isFile() || info.size > maxBackgroundInputBytes) throw new Error(tr('원본 20 MB 이하의 JPEG 또는 PNG 사진을 선택해 주세요.'))
      const bytes = new Uint8Array(await readFile(path))
      backgroundImageInfo(bytes); files.push(bytes)
    }
    if (screenLocked || accounts.active !== account) { for (const bytes of files) bytes.fill(0); throw new Error(tr('계정이 변경되었습니다.')) }
    return files
  })
  handle('post-creation-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).postCreation.action(postCreationAction(raw))
  })
  handle('refresh-comment-creation', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).commentCreation.refresh()
  })
  handle('prepare-comment-creation', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).commentCreation.prepare(commentCreationPrepare(raw))
  })
  handle('comment-creation-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).commentCreation.action(commentCreationAction(raw))
  })
  handle('read-post-draft', (uid, raw) => {
    if (screenLocked) throw new Error(tr('잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).readPostDraft(postDraftTarget(raw))
  })
  handle('save-post-draft', (uid, raw) => accounts.requireActive(identifier(uid)).savePostDraft(postDraftWrite(raw)), true)
  handle('select-comment-draft-parent', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).selectCommentDraftParent(commentDraftParent(raw))
  })
  handle('read-comment-draft' , (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).readCommentDraft(commentDraftTarget(raw))
  })
  handle('save-comment-draft', (uid, raw) => accounts.requireActive(identifier(uid)).saveCommentDraft(commentDraftWrite(raw)), true)
  handle('open-channel-comments', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.posts.comments.open(channelCommentsRequest(raw))
  })
  handle('close-channel-comments', (uid, selectionId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.posts.comments.dismiss(identifier(selectionId))
  })
  handle('open-channel-posts', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    accounts.requireActive(identifier(uid)).channels.posts.open(channelPostsRequest(raw))
  })
  handle('open-channel-post-media', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channels.posts.media.load(channelPostMediaRequest(raw))
  })
  handle('close-channel-post-media', (uid, selectionId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.posts.media.dismiss(identifier(selectionId))
  })
  handle('close-channel-posts', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.channels.posts.dismiss(identifier(requestId))
  })
  handle('visible-contact-photos', (uid, ids) => {
    try {
      if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
      const list = visibleDialogPhotos(ids)
      accounts.requireActive(identifier(uid)).contacts.listAvatars.setVisible(list)
      accounts.requireActive(identifier(uid)).presence.setPeers('contacts', list)
      recordAvatarStep('contacts', '', 'visible-request', list.length ? 'some' : 'none')
    } catch (error) { recordAvatarStep('contacts', '', 'visible-request-rejected', error instanceof Error ? error.message : ''); throw error }
  })
  handle('save-contact-details', (uid, requestId, edit) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 저장해 주세요.'))
    return accounts.requireActive(identifier(uid)).contacts.saveDetails(identifier(requestId), contactDetailsEdit(edit))
  })
  handle('pick-contact-photo', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const owner = accounts.requireActive(identifier(uid)).contacts.photoPreparation(contactPhotoBinding(raw))
    return backgroundPhotos.pick(owner, async () => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
      const result = await dialog.showOpenDialog(mainWindow, { title: tr('연락처 개인 사진 선택'), properties: ['openFile'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
  })
  handle('contact-photo-storage', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contacts.photoStorageInventory()
  })
  handle('remove-stored-contact-photo', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).contacts.removeStoredPhoto(contactPhotoRemoval(raw))
  })
  handle('save-contact-photo', async (uid, raw, input) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const contact = accounts.requireActive(identifier(uid)).contacts, edit = contactPhotoEdit(raw), owner = contact.photoPreparation(edit)
    if (!edit.photoId) {
      if (input !== undefined) throw new Error(tr('개인 사진 해제를 다시 확인해 주세요.'))
      return contact.savePhoto(edit)
    }
    let bytes: Uint8Array | undefined
    try {
      backgroundPhotos.prepare(edit.photoId, profilePhotoBytes(input))
      bytes = backgroundPhotos.forSave(owner, edit.photoId)
      if (!bytes) throw new Error(tr('이 연락처에서 사진을 다시 선택해 주세요.'))
      await contact.savePhoto(edit, bytes)
    } finally { bytes?.fill(0); backgroundPhotos.release(edit.photoId) }
  })
  handle('delete-contact', (uid, requestId, operationId, version) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 삭제해 주세요.'))
    if (typeof version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(version)) throw new Error(tr('최신 연락처를 다시 확인해 주세요.'))
    return accounts.requireActive(identifier(uid)).contacts.delete(identifier(requestId), identifier(operationId), version)
  })
  handle('undo-contact-delete', (uid, operationId) => accounts.requireActive(identifier(uid)).contacts.undoDelete(identifier(operationId)))
  handle('search-contact', (uid, requestId, publicId) => accounts.requireActive(identifier(uid)).contactDiscovery.search(identifier(requestId), publicMorseId(publicId)))
  handle('add-contact', (uid, requestId) => accounts.requireActive(identifier(uid)).contactDiscovery.add(identifier(requestId)))
  handle('close-contact-search', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.contactDiscovery.closeSearch(identifier(requestId))
  })
  handle('open-support-chat', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).openSupportChat()
  })
  handle('start-contact-chat', (uid, requestId) => accounts.requireActive(identifier(uid)).startContactChat(identifier(requestId)))
  handle('discard-direct-draft', (uid, chatId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 다시 시도해 주세요.'))
    return accounts.requireActive(identifier(uid)).discardDirectDraft(identifier(chatId))
  })
  handle('open-contact-profile', (uid, peerUid, requestId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    accounts.requireActive(identifier(uid)).contacts.open(identifier(peerUid), identifier(requestId))
    accounts.requireActive(identifier(uid)).presence.setPeers('profile', [identifier(peerUid)])
  })
  handle('open-participants', (uid, chatId, requestId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    accounts.requireActive(identifier(uid)).openParticipants(identifier(chatId), identifier(requestId))
  })
  handle('close-participants', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.closeParticipants(identifier(requestId))
  })
  handle('participant-contact', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).participantContact(participantContactRequest(request))
  })
  handle('visible-dialog-photos', (uid, ids) => {
    try {
      if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
      const list = visibleDialogPhotos(ids)
      accounts.requireActive(identifier(uid)).dialogAvatars.setVisible(list)
      { const session = accounts.requireActive(identifier(uid)); session.presence.setPeers('dialogs', session.directPeers(list)) }
      recordAvatarStep('dialogs', '', 'visible-request', list.length ? 'some' : 'none')
    } catch (error) { recordAvatarStep('dialogs', '', 'visible-request-rejected', error instanceof Error ? error.message : ''); throw error }
  })
  handle('load-group-photo', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).loadGroupPhoto(groupPhotoRequest(request))
  })
  handle('clear-group-photo', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).clearGroupPhoto(groupPhotoClear(request))
  })
  handle('save-group-announcement', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 그룹 소개를 저장해 주세요.'))
    return accounts.requireActive(identifier(uid)).saveGroupAnnouncement(groupAnnouncementEdit(request))
  })
  handle('save-group-name', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 그룹 이름을 저장해 주세요.'))
    return accounts.requireActive(identifier(uid)).saveGroupName(groupNameEdit(request))
  })
  handle('add-participant-contact', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).addParticipantContact(participantAddRequest(request))
  })
  handle('add-chat-contact', (uid, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).addChatContact(chatContactRequest(request))
  })
  handle('close-contact-profile', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) { accounts.active.contacts.closeProfile(identifier(requestId)); accounts.active.presence.setPeers('profile', []) }
  })
  handle('copy-contact-id', (uid, requestId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 복사해 주세요.'))
    clipboard.writeText(accounts.requireActive(identifier(uid)).contacts.copyId(identifier(requestId)))
  })
  handle('save-profile-name', (uid, edit) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 이름을 저장해 주세요.'))
    return accounts.requireActive(identifier(uid)).selfProfile.saveName(profileNameEdit(edit))
  })
  handle('clear-profile-photo', (uid, edit) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 사진을 제거해 주세요.'))
    return accounts.requireActive(identifier(uid)).selfProfile.clearPhoto(profilePhotoClear(edit))
  })
  handle('refresh-channel-join-decisions', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelJoinDecisions.refresh()
  })
  handle('prepare-channel-join-decision', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelJoinDecisions.prepare(channelJoinDecisionRequest(raw))
  })
  handle('channel-join-decision-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelJoinDecisions.action(channelJoinDecisionAction(raw))
  })
  handle('refresh-channel-access', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelAccess.refresh()
  })
  handle('prepare-channel-access', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelAccess.prepare(channelAccessRequest(raw))
  })
  handle('channel-access-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelAccess.action(channelAccessAction(raw))
  })
  handle('pick-channel-photo', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), owner = account.channelPhotoPreparation(channelPhotoBinding(raw))
    return backgroundPhotos.pick(owner, async () => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
      const result = await dialog.showOpenDialog(mainWindow, { title: tr('채널 사진 선택'), properties: ['openFile'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
  })
  handle('queue-channel-photo', async (uid, raw, input) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), request = channelPhotoUploadRequest(raw)
    const owner = account.channelPhotoPreparation({ channelId: request.channelId, title: request.title, version: request.version, kind: request.kind })
    backgroundPhotos.prepare(request.id, channelPhotoBytes(input, request.kind))
    const bytes = backgroundPhotos.forSave(owner, request.id)
    if (!bytes) throw new Error(tr('사진을 다시 선택해 주세요.'))
    try { await account.channelPhotoUpload.queue(request, bytes) }
    finally { bytes.fill(0); backgroundPhotos.release(request.id) }
  })
  handle('channel-photo-upload-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).channelPhotoUpload.action(channelPhotoUploadAction(raw))
  })
  handle('pick-group-photo', async (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), owner = account.groupPhotoPreparation(groupPhotoBinding(raw))
    return backgroundPhotos.pick(owner, async () => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
      const result = await dialog.showOpenDialog(mainWindow, { title: tr('그룹 사진 선택'), properties: ['openFile'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
  })
  handle('queue-group-photo', async (uid, raw, input) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), request = groupPhotoUploadRequest(raw)
    const owner = account.groupPhotoPreparation({ chatId: request.chatId, title: request.title, version: request.version })
    backgroundPhotos.prepare(request.id, profilePhotoBytes(input))
    const bytes = backgroundPhotos.forSave(owner, request.id)
    if (!bytes) throw new Error(tr('사진을 다시 선택해 주세요.'))
    try { await account.groupPhotoUpload.queue(request, bytes) }
    finally { bytes.fill(0); backgroundPhotos.release(request.id) }
  })
  handle('group-photo-upload-action', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).groupPhotoUpload.action(groupPhotoUploadAction(raw))
  })
  handle('pick-profile-photo', async (uid, version) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), owner = account.selfProfile.photoPreparation(profilePhotoClear({ version }).version)
    return backgroundPhotos.pick(owner, async () => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error(tr('창을 다시 열어 주세요.'))
      const result = await dialog.showOpenDialog(mainWindow, { title: tr('프로필 사진 선택'), properties: ['openFile'], filters: [{ name: tr('사진 (JPEG·PNG)'), extensions: ['jpg', 'jpeg', 'png'] }] })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
  })
  handle('queue-profile-photo', async (uid, rawVersion, rawId, input) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const account = accounts.requireActive(identifier(uid)), version = profilePhotoClear({ version: rawVersion }).version, id = backgroundPhotoId(rawId)
    const owner = account.selfProfile.photoPreparation(version)
    backgroundPhotos.prepare(id, profilePhotoBytes(input))
    const bytes = backgroundPhotos.forSave(owner, id)
    if (!bytes) throw new Error(tr('사진을 다시 선택해 주세요.'))
    try { await account.selfProfile.photoUpload.queue(id, bytes, version) }
    finally { bytes.fill(0); backgroundPhotos.release(id) }
  })
  handle('profile-photo-upload-action', (uid, action) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).selfProfile.photoUpload.action(profilePhotoUploadAction(action))
  })
  handle('profile-photo-history-action', (uid, action) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).selfProfile.photoUpload.historyAction(profilePhotoHistoryAction(action))
  })
  handle('save-bio', (uid, edit) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 소개를 저장해 주세요.'))
    return accounts.requireActive(identifier(uid)).selfProfile.save(bioEdit(edit))
  })
  handle('copy-profile-id', uid => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 복사해 주세요.'))
    clipboard.writeText(accounts.requireActive(identifier(uid)).selfProfile.copyId())
  })
  handle('third-party-notices', async () => {
    const text = await readFile(join(app.getAppPath(), 'resources/THIRD_PARTY_NOTICES.txt'), 'utf8')
    if (text.length > 2 * 1024 * 1024) throw new Error(tr('고지문을 불러오지 못했습니다.'))
    return text
  })
  handle('preferences', async patch => {
    const update = preferencePatch(patch)
    if (update.closeToTray && (process.platform !== 'win32' || !desktopShell.status().trayAvailable)) throw new Error(tr('시스템 트레이를 사용할 수 없습니다.'))
    const owner = update.chatBackground ? backgroundPhotoOwner({ kind: 'device' }) : undefined
    const photo = update.chatBackground?.preset === 'photo' ? backgroundPhotos.forSave(owner!, update.chatBackground.photoId) : undefined
    try { await settings.update(update, photo, owner?.validate) }
    finally { photo?.fill(0) }
    if ('storyStealth' in update) accounts.active?.storyViewReceipt.pause()
    if ('notifications' in update || 'showNotificationPreview' in update || 'notifyPersonal' in update || 'notifyGroup' in update || 'inAppNotifications' in update) for (const session of accounts.all) session.notificationPreferencesChanged()
    if ('spellCheck' in update && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.session.setSpellCheckerEnabled(settings.preferences.spellCheck)
    applyTheme()
    await publish()
    return rendererSnapshot()
  })
  handle('history', (uid, chatId, before) => accounts.requireActive(identifier(uid)).history(identifier(chatId), historyPosition(before)))
  handle('latest-history', (uid, chatId) => accounts.requireActive(identifier(uid)).latestHistory(identifier(chatId)))
  handle('search-messages', (uid, chatId, id, query) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 검색해 주세요.'))
    return accounts.requireActive(identifier(uid)).searchMessages(identifier(chatId), identifier(id), searchQuery(query))
  })
  handle('shared-media', (uid, chatId, id, filter) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 열어 주세요.'))
    return accounts.requireActive(identifier(uid)).sharedMedia(identifier(chatId), identifier(id), sharedMediaFilter(filter))
  })
  handle('more-search', (uid, chatId, id) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 검색해 주세요.'))
    return accounts.requireActive(identifier(uid)).moreSearch(identifier(chatId), identifier(id))
  })
  handle('jump-search', (uid, chatId, id, messageId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).jumpSearch(identifier(chatId), identifier(id), identifier(messageId))
  })
  handle('jump-date', (uid, chatId, at) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0 || at > Date.now() + 86400000) throw new Error(tr('날짜를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).jumpDate(identifier(chatId), at)
  })
  handle('jump-reply', (uid, chatId, messageId, version) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 선택해 주세요.'))
    if (typeof version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(version)) throw new Error(tr('답장 메시지를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).jumpReply(identifier(chatId), identifier(messageId), version)
  })
  handle('close-search', (uid, chatId, id) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.closeSearch(identifier(chatId), identifier(id))
  })
  handle('close-history', (uid, chatId) => {
    const accountUid = identifier(uid), id = identifier(chatId)
    if (accounts.active?.profile.uid === accountUid) accounts.active.closeHistory(id)
  })
  handle('refresh-dialogs', uid => accounts.requireActive(identifier(uid)).refresh())
  handle('open-media', (uid, chatId, request) => accounts.requireActive(identifier(uid)).openMedia(identifier(chatId), mediaRequest(request)))
  // Telegram's automatic media download: the renderer asks per photo message, and the preference
  // decides whether it asks at all. A picture that cannot be previewed answers with nothing.
  handle('photo-preview', (uid, chatId, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).photoPreview(identifier(chatId), mediaRequest(request))
  })
  // The placeholder for a photo whose message carried none: fetched once, kept as a few hundred
  // bytes, and drawn blurred. Telegram fetches the small size here whatever the preference says.
  handle('photo-thumb', (uid, chatId, request) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).photoThumb(identifier(chatId), mediaRequest(request))
  })
  handle('pick-attachment', (uid, chatId, mode) => {
    if (mode !== 'media' && mode !== 'file' && mode !== 'album') throw new Error(tr('첨부 종류를 확인해 주세요.'))
    return accounts.requireActive(identifier(uid)).pickAttachment(identifier(chatId), mode, async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      const result = await dialog.showOpenDialog(mainWindow, { title: mode === 'album' ? tr('사진 선택 (최대 10장)') : mode === 'media' ? tr('사진·동영상 선택') : tr('파일 선택'),
        properties: mode === 'album' ? ['openFile', 'multiSelections'] : ['openFile'],
        ...(mode === 'album' ? { filters: [{ name: tr('사진'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }] } :
          mode === 'media' ? { filters: [{ name: tr('사진·동영상'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'm4v', 'mov'] }] } : {}) })
      return result.canceled ? null : result.filePaths
    })
  })
  // iOS DataStorageView «캐시 정리»: the browser caches of this window, the pictures kept in memory and each account's
  // picture and media cache files. Messages, drafts and files kept on purpose stay.
  // Ui::UserpicButton Role::OpenPhoto → SessionController::openPhoto, with the peer's album under the arrows.
  handle('open-profile-photos', (uid, peerUid) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).openProfilePhotos(identifier(peerUid))
  })
  handle('show-profile-photo', (uid, peerUid, index) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > 100) throw new Error(tr('사진을 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).peerPhotos.show(identifier(peerUid), index)
  })
  handle('close-profile-photos', uid => { accounts.get(identifier(uid))?.peerPhotos.close() })
  handle('cache-usage', async () => {
    const browser = mainWindow && !mainWindow.isDestroyed() ? await mainWindow.webContents.session.getCacheSize() : 0
    const pictures = await Promise.all(accounts.all.map(session => session.userpics.usage()))
    const media = await Promise.all(accounts.all.map(session => session.mediaFiles.usage()))
    return browser + [...pictures, ...media].reduce((sum, bytes) => sum + bytes, 0)
  })
  handle('clear-cache', async () => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.webContents.session.clearCache()
      await mainWindow.webContents.session.clearStorageData({ storages: ['cachestorage', 'shadercache', 'serviceworkers'] })
    }
    for (const session of accounts.all) session.clearMediaCaches()
    await Promise.all(accounts.all.map(session => session.userpics.clear()))
    await Promise.all(accounts.all.map(session => session.mediaFiles.clear()))
    return 'done'
  })
  handle('replace-attachment-image', (uid, chatId, id, itemId, bytes) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength >= 10 * 1024 * 1024) throw new Error(tr('준비한 사진을 확인하지 못했습니다.'))
    return accounts.requireActive(identifier(uid)).replaceAttachmentImage(identifier(chatId), identifier(id), identifier(itemId), bytes)
  })
  handle('edit-attachment-video', (uid, chatId, id, itemId, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const start = value.start, end = value.end, preset = value.preset, overlay = value.overlay
    const png = overlay instanceof Uint8Array && overlay.byteLength > 8 && overlay.byteLength < 10 * 1024 * 1024 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => overlay[index] === byte)
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.5 || end > maxVideoSourceSeconds
      || (preset !== '960x540' && preset !== '1280x720' && preset !== 'medium') || (overlay !== undefined && !png)) throw new Error(tr('동영상 편집 내용을 확인해 주세요.'))
    return accounts.requireActive(identifier(uid)).editAttachmentVideo(identifier(chatId), identifier(id), identifier(itemId), { start, end, preset, ...(png ? { overlay: overlay as Uint8Array } : {}) })
  })
  handle('discard-attachment', (uid, id) => { if (accounts.active?.profile.uid === identifier(uid)) accounts.active.discardAttachment(identifier(id)) })
  handle('drop-attachments', (uid, chatId, paths, mode) => {
    if (mode !== 'media' && mode !== 'file') throw new Error(tr('첨부 종류를 확인해 주세요.'))
    if (!Array.isArray(paths) || !paths.length || paths.length > maxAlbumPhotos ||
        paths.some(path => typeof path !== 'string' || path.length > 32768 || path.includes('\0') || !isAbsolute(path))) throw new Error(tr('컴퓨터에 저장된 파일을 끌어 놓아 주세요.'))
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 다시 놓아 주세요.'))
    return accounts.requireActive(identifier(uid)).dropAttachments(identifier(chatId), paths, mode)
  })
  // A picture on the clipboard has no file to point at, so its bytes come through (HistoryWidget::canSendFiles).
  handle('paste-attachments', (uid, chatId, items) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제한 뒤 다시 붙여넣어 주세요.'))
    if (!Array.isArray(items) || !items.length || items.length > maxAlbumPhotos) throw new Error(tr('첨부 목록을 확인해 주세요.'))
    const entries = items.map(item => {
      const value = item as { name?: unknown; bytes?: unknown }
      if (typeof value.name !== 'string' || value.name.length > 260 || !(value.bytes instanceof Uint8Array) || !value.bytes.byteLength || value.bytes.byteLength >= 50 * 1024 * 1024) {
        throw new Error(tr('붙여넣은 사진을 확인하지 못했습니다.'))
      }
      return { name: value.name, bytes: value.bytes }
    })
    return accounts.requireActive(identifier(uid)).pasteAttachments(identifier(chatId), entries)
  })
  handle('send-attachment', (uid, chatId, id, caption, itemIds, reply, video) => {
    if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > maxAlbumPhotos || new Set(itemIds).size !== itemIds.length) throw new Error(tr('첨부 목록을 확인해 주세요.'))
    return accounts.requireActive(identifier(uid)).sendAttachment(identifier(chatId), identifier(id), draftText(caption), itemIds.map(identifier), replyBinding(reply), videoFacts(video))
  })
  handle('close-media', (uid, requestId) => {
    if (accounts.active?.profile.uid === identifier(uid)) accounts.active.media.clear(identifier(requestId))
  })
  handle('save-media', (uid, requestId) => accounts.requireActive(identifier(uid)).media.save(identifier(requestId), async name => {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const result = await dialog.showSaveDialog(mainWindow, { title: tr('첨부 저장'), defaultPath: join(app.getPath('downloads'), name), buttonLabel: tr('저장'), properties: ['showOverwriteConfirmation'] })
    return result.canceled ? null : result.filePath ?? null
  }))
  handle('message-actions', (uid, chatId) => accounts.requireActive(identifier(uid)).messageActions(identifier(chatId)))
  handle('mutate-message', (uid, chatId, request) => accounts.requireActive(identifier(uid)).mutateMessage(identifier(chatId), actionRequest(request)))
  handle('check-message-action', (uid, chatId, id) => accounts.requireActive(identifier(uid)).checkMessageAction(identifier(chatId), identifier(id)))
  handle('dismiss-message-action', (uid, chatId, id) => accounts.requireActive(identifier(uid)).dismissMessageAction(identifier(chatId), identifier(id)))
  handle('mark-visible-read', (uid, chatId, revision, messageId) => {
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error(tr('잘못된 표시 위치입니다.'))
    return accounts.requireActive(identifier(uid)).markVisibleRead(identifier(chatId), revision, identifier(messageId))
  })
  handle('draft', (uid, chatId) => accounts.requireActive(identifier(uid)).draft(identifier(chatId)))
  handle('pin-message', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).pinMessage(pinMessageRequest(raw))
  })
  handle('jump-pinned', (uid, chatId, messageId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).jumpPinned(identifier(chatId), identifier(messageId))
  })
  handle('reply-draft', (uid, chatId) => accounts.requireActive(identifier(uid)).replyDraft(identifier(chatId)))
  handle('translation-gate', (uid, chatId, messageId) => {
    if (screenLocked) return false
    return translator.differs(accounts.requireActive(identifier(uid)).translationSource(identifier(chatId), identifier(messageId)))
  })
  handle('translate-message', (uid, chatId, messageId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return translator.translate(accounts.requireActive(identifier(uid)).translationSource(identifier(chatId), identifier(messageId)))
  })
  // System Settings › General › Language & Region › Translation Languages
  handle('open-translation-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.Localization-Settings.extension'))
  // A link pressed in a message (Telegram's UrlClickHandler::Open): only web, file transfer and mail addresses
  // leave the app, so a message can never start another program through a custom scheme.
  // reCAPTCHA's notice lives on the sign-in screen now that the check itself is not shown: Google's two pages only.
  handle('open-recaptcha-terms', which => shell.openExternal(which === 'terms' ? 'https://policies.google.com/terms' : 'https://policies.google.com/privacy'))
  handle('open-message-link', raw => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    if (typeof raw !== 'string' || !raw || raw.length > 4096) throw new Error(tr('링크를 열 수 없습니다.'))
    let url: URL
    try { url = new URL(raw) } catch { throw new Error(tr('링크를 열 수 없습니다.')) }
    if (!['http:', 'https:', 'ftp:', 'mailto:'].includes(url.protocol)) throw new Error(tr('링크를 열 수 없습니다.'))
    return shell.openExternal(url.href)
  })
  handle('select-reply', (uid, chatId, messageId, version) => {
    if (typeof version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(version)) throw new Error(tr('최신 메시지를 다시 선택해 주세요.'))
    return accounts.requireActive(identifier(uid)).selectReply(identifier(chatId), identifier(messageId), version)
  })
  handle('cancel-reply', (uid, chatId, selectionId) => accounts.requireActive(identifier(uid)).cancelReply(identifier(chatId), identifier(selectionId)))
  handle('save-draft', (uid, chatId, text) => accounts.requireActive(identifier(uid)).saveDraft(identifier(chatId), draftText(text)), true)
  handle('complete-close', (id, success) => { if (pendingClose?.id === identifier(id)) pendingClose.finish(success === true) }, true)
  handle('send-text', (uid, chatId, text, id, reply, silent) => accounts.requireActive(identifier(uid)).sendText(identifier(chatId), draftText(text), identifier(id), replyBinding(reply), silent === true))
  handle('schedule-event-reminder', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).scheduleEventReminder(eventReminderRequest(raw))
  })
  handle('send-deferred', (uid, raw) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).sendDeferred(deferredSendRequest(raw))
  })
  // The composer says whether its person is typing; nothing leaves this device when «입력 중 표시 보내기» is off.
  handle('report-typing', (uid, chatId, typing) => {
    if (screenLocked || typeof typing !== 'boolean') return
    const account = accounts.active
    if (!account || account.profile.uid !== identifier(uid)) return
    if (typing && !settings.preferences.sendTypingIndicator) return
    account.reportTyping(identifier(chatId), typing)
  })
  handle('cancel-deferred', (uid, chatId, kind, messageId) => {
    if (screenLocked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    return accounts.requireActive(identifier(uid)).cancelDeferred(identifier(chatId), deferredKind(kind), identifier(messageId))
  })
  handle('retry-message', (uid, chatId, id) => accounts.requireActive(identifier(uid)).retry(identifier(chatId), identifier(id)))
  handle('outgoing', async(uid, chatId) => {const account=accounts.requireActive(identifier(uid)),target=identifier(chatId),value=await account.outgoing(target);voiceQueuePreviews.observe(account.profile.uid,target,value);return value})
  handle('discard-outgoing', (uid, chatId, id) => accounts.requireActive(identifier(uid)).discard(identifier(chatId), identifier(id)))
}

// Api::Updates::updateOnline (Telegram Desktop, mtproto_config defaults): the account shown in a
// focused, visible window is online until the user is idle for offlineIdleTimeout; after the window
// loses focus it stays online for offlineBlurTimeout. Other accounts on this device are offline.
const offlineIdleTimeout = 30000, offlineBlurTimeout = 5000, onlineUpdatePeriod = 120000
let presenceTimer: ReturnType<typeof setTimeout> | null = null, presenceBlurUntil = 0
function updatePresence(): void {
  if (presenceTimer) clearTimeout(presenceTimer)
  presenceTimer = null
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const shown = shutdown === 'running' && !screenLocked && !systemSuspended && Boolean(window?.isVisible() && !window.isMinimized())
  const focused = Boolean(window?.isFocused()), now = Date.now(), idle = powerMonitor.getSystemIdleTime() * 1000
  const online = shown && (focused || now < presenceBlurUntil) && idle < offlineIdleTimeout
  const activeUid = accounts.active?.profile.uid
  for (const session of accounts.all) session.presence.setOnline(online && session.profile.uid === activeUid)
  if (shown) accounts.active?.presence.prepare()
  if (shutdown !== 'running') return
  // Online: look again before the idle limit or the blur grace ends. Idle in a focused window:
  // Updates::checkIdleFinish polls every 900 ms for the user to come back.
  const wait = online ? Math.max(1000, Math.min(onlineUpdatePeriod, offlineIdleTimeout - idle, focused ? onlineUpdatePeriod : presenceBlurUntil - now)) : shown && focused ? 900 : 0
  if (wait > 0) presenceTimer = setTimeout(updatePresence, wait)
}
// iOS maxDeviceAccounts / server device slots: two accounts, four with premium.
function maxAccounts(): number { return accounts.active?.selfProfile.snapshot.profile?.premium ? 4 : 2 }
function accountStates(): AccountAuthState[] {
  const activeUid = accounts.active?.profile.uid ?? null
  return authentication.states().map(state => {
    const session = accounts.get(state.uid), profile = session?.selfProfile.snapshot.profile
    let unread = 0
    if (session && session.state === 'ready' && session.readStatus === 'ready') for (const dialog of session.dialogs()) {
      const count = accountUnreadCount(dialog)
      if (!dialog.muted && !dialog.archived && dialog.kind !== 'secret' && Number.isSafeInteger(count) && count > 0) unread = Math.min(100000, unread + count)
    }
    // Each account's own photo, as Settings::AccountsList paints every account's userpic.
    const photo = session?.selfProfile.snapshot.photo
    return { ...state, userId: profile?.userId || state.userId, displayName: profile?.displayName || state.displayName, connected: Boolean(session), active: state.uid === activeUid, unread,
      photo: photo?.status === 'ready' ? photo.url : null }
  })
}
function updateDesktopShell(): void {
  if (!settings) return
  desktopShell.update(settings.preferences, accounts.all.filter(session => session.state === 'ready' && session.readStatus === 'ready')
    .map(session => ({ uid: session.profile.uid, dialogs: session.dialogs() })), shutdown === 'running' && !screenLocked)
}
function updateScreenProtection(): void {
  screenLocked = screenIsLocked || systemSuspended || userInactive || Boolean(appLock?.locked)
  if (screenLocked) { voiceQueuePreviews.clear();voiceCaptures.clear();storySavedAudio.clear(); storyAudioInputs.clear(); storySavedVideos.clear(); storyVideoInputs.clear(); backgroundPhotos.clear() }
  emit({ type: 'background-photo-availability', available: !screenLocked })
  if (screenLocked) { contextMenus.close(); accounts.active?.cancelSearch() }
  if (screenLocked) clearProfilePhotoCache()
  for (const session of accounts.all) {
    session.selfProfile.setLocked(screenLocked); session.contacts.setLocked(screenLocked); session.setLocked(screenLocked)
    session.notificationPreferencesChanged(); session.readingActivityChanged()
  }
  updatePresence()
  void publish()
}
function appLockSnapshot(): AppLockSnapshot {
  return appLock?.snapshot(touchIdAvailable) ?? { enabled: false, locked: false, autoLock: 3600, systemUnlock: 'none', systemUnlockEnabled: false, systemUnlockAllowed: false }
}
function requireLocalKey(): LocalDataKey {
  if (!localKey) throw new Error(tr('잠시 후 다시 시도해 주세요.'))
  return localKey
}
function requireAppLock(): AppLock {
  if (!appLock) throw new Error(tr('잠시 후 다시 시도해 주세요.'))
  return appLock
}
function cancelAutoLock(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer)
  autoLockTimer = null; shouldLockAt = 0
}
// Core::Application::lockByPasscode
function lockApp(): void {
  if (!appLock?.enabled || appLock.locked) return
  appLock.lock(); cancelAutoLock(); updateScreenProtection()
}
// Core::Application::checkAutoLock: lock after the chosen time without system input, or when the
// timer fires more than three seconds late (kAutoLockTimeoutLateMs, e.g. the computer slept).
function checkAutoLock(): void {
  if (!appLock?.enabled || appLock.locked || !accounts.active || shutdown !== 'running') { cancelAutoLock(); return }
  const now = Date.now(), lockInMs = appLock.autoLockSeconds * 1000, idle = powerMonitor.getSystemIdleTime() * 1000
  if (idle >= lockInMs || (shouldLockAt > 0 && now > shouldLockAt + 3000)) { lockApp(); return }
  if (autoLockTimer) clearTimeout(autoLockTimer)
  shouldLockAt = now + lockInMs - idle
  autoLockTimer = setTimeout(() => { autoLockTimer = null; checkAutoLock() }, lockInMs - idle)
}
function refreshScreenLock(): void {
  const state = powerMonitor.getSystemIdleState(1)
  if (state === 'locked') screenIsLocked = true
  else if (state === 'active' || state === 'idle') screenIsLocked = false
}
function showWindow(): void {
  if (shutdown !== 'running') return
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return }
  windowState.show()
}
function shortcut(command: ShortcutCommand): void {
  if (shutdown !== 'running' || screenLocked || contextMenus.open || !mainWindow || mainWindow.isDestroyed()) return
  // Account proof and native dialogs own their keyboard focus while they are open.
  if (BrowserWindow.getFocusedWindow() !== mainWindow) return
  emit({ type: 'shortcut', command })
}
// A notification of another account switches the window to that account first (Telegram).
function openNotificationChat(uid: string, chatId: string): void {
  const owner = accounts.get(uid)
  const valid = (): boolean => Boolean(owner && accounts.get(uid) === owner &&
    owner.readStatus === 'ready' && !screenLocked && shutdown === 'running' &&
    owner.dialogs().some(dialog => dialog.id === chatId && dialog.participantUids.includes(uid) && dialog.kind !== 'secret'))
  if (!valid()) return
  showWindow()
  const switching = accounts.active !== owner
  if (switching) { accounts.setActive(uid); authentication.select(uid); void credentialVault.setActive(uid); void publish(); updatePresence() }
  // The window opens the chat once it shows this account.
  const send = (): void => { if (valid() && accounts.active === owner) emit({ type: 'open-notification-chat', accountUid: uid, chatId }) }
  if (mainWindow?.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send)
  else send()
}
// A 1:1 inquiry room opens beside its channel, as pressing its row in the list does.
function openNotificationInquiry(uid: string, channelId: string, inquiryId: string): void {
  const owner = accounts.get(uid)
  const valid = (): boolean => Boolean(owner && accounts.get(uid) === owner && owner.readStatus === 'ready' && !screenLocked && shutdown === 'running')
  if (!valid()) return
  showWindow()
  if (accounts.active !== owner) { accounts.setActive(uid); authentication.select(uid); void credentialVault.setActive(uid); void publish(); updatePresence() }
  const send = (): void => { if (valid() && accounts.active === owner) emit({ type: 'open-notification-inquiry', accountUid: uid, channelId, inquiryId }) }
  if (mainWindow?.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send)
  else send()
}
function createMenu(): void {
  const platform = process.platform === 'darwin' ? 'macOS' : 'Windows'
  const item = (command: ShortcutCommand): MenuItemConstructorOptions => ({
    label: shortcuts[command].label, accelerator: shortcutAccelerator(command, platform), click: () => shortcut(command)
  })
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: 'Morse', submenu: [
      { role: 'about' }, { type: 'separator' },
      item('show-settings'),
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ] } as MenuItemConstructorOptions] : []),
    { label: tr('파일'), submenu: [
      item('show-chats'), item('show-contacts'), item('show-channels'),
      ...(process.platform !== 'darwin' ? [
        item('show-settings'),
        { role: 'quit', label: tr('Morse 종료') } as MenuItemConstructorOptions
      ] : [{ role: 'close' } as MenuItemConstructorOptions])
    ] },
    { label: tr('편집'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: tr('대화'), submenu: [item('find-dialog'), item('find-message'), { type: 'separator' },
      item('previous-dialog'), item('next-dialog'), item('focus-composer')] },
    { label: tr('보기'), submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: tr('창'), submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ role: 'front' } as MenuItemConstructorOptions] : [])] },
    { label: tr('도움말'), submenu: [item('show-shortcuts')] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
function createWindow(): void {
  if (shutdown !== 'running') return
  mainWindow = new BrowserWindow({
    ...windowState.initial(), show: false, title: 'Morse',
    backgroundColor: windowBackground(),
    icon: join(app.getAppPath(), 'resources/brand/morse.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
      spellcheck: true, devTools: !app.isPackaged, navigateOnDragDrop: false, additionalArguments: [`--morse-language=${language()}`] }
  })
  const window = mainWindow
  windowState.attach(window)
  window.webContents.session.setSpellCheckerEnabled(settings.preferences.spellCheck)
  window.setContentProtection(contentProtected)
  window.webContents.on('before-input-event', (_event, input) => {
    const normalized = { key: input.key, code: input.code, ctrlKey: input.control, metaKey: input.meta,
      altKey: input.alt, shiftKey: input.shift, isComposing: input.isComposing }
    // Keep the DOM key event for focused controls and scoped dispatch. Prevent
    // Electron from invoking the same custom command again via its menu.
    window.webContents.setIgnoreMenuShortcuts(composingKey(normalized) || Boolean(shortcutFor(normalized, process.platform === 'darwin' ? 'macOS' : 'Windows')))
  })
  window.on('blur', () => { contextMenus.close(); if (!window.webContents.isDestroyed()) window.webContents.setIgnoreMenuShortcuts(false) })
  window.on('hide', () => contextMenus.close()); window.on('minimize', () => contextMenus.close())
  window.webContents.on('did-finish-load', () => emit({ type: 'full-screen', value: window.isFullScreen() }))
  window.on('enter-full-screen', () => emit({ type: 'full-screen', value: true }))
  window.on('leave-full-screen', () => emit({ type: 'full-screen', value: false }))
  const readingActivityChanged = (): void => { for (const session of accounts.all) session.readingActivityChanged() }
  window.on('focus', readingActivityChanged); window.on('blur', readingActivityChanged)
  window.on('focus', updatePresence); window.on('blur', () => { presenceBlurUntil = Date.now() + offlineBlurTimeout; updatePresence() })
  for (const change of ['show', 'hide', 'minimize', 'restore'] as const) window.on(change as 'show', updatePresence)
  window.on('show', readingActivityChanged); window.on('hide', readingActivityChanged)
  window.on('minimize', readingActivityChanged); window.on('restore', readingActivityChanged)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!trustedURL(url)) event.preventDefault() })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.on('context-menu', (_event, params) => {
    if (params.frame !== window.webContents.mainFrame || !trustedURL(params.frame.url)) return
    const account = accounts.active
    const valid = (): boolean => accounts.active === account && !screenLocked && shutdown === 'running' && !window.isDestroyed() && window.isFocused() && trustedURL(window.webContents.getURL())
    const flags = params.editFlags, password = params.formControlType === 'input-password'
    // Chromium's spell checker offers its suggestions first, as a text field's menu does elsewhere.
    const suggestions: ContextMenuItem[] = params.isEditable && params.misspelledWord ? [
      ...params.dictionarySuggestions.slice(0, 6).map(word => ({ label: word, choose: () => { window.webContents.replaceMisspelling(word); return null } })),
      ...(params.dictionarySuggestions.length ? [] : [{ label: tr('추천 단어 없음'), enabled: false }]), { type: 'separator' as const }] : []
    const items: ContextMenuItem[] = params.isEditable
      ? [...suggestions, { role: 'undo', enabled: flags.canUndo }, { role: 'redo', enabled: flags.canRedo }, { type: 'separator' },
        { role: 'cut', enabled: !password && flags.canCut }, { role: 'copy', enabled: !password && flags.canCopy },
        { role: 'paste', enabled: flags.canPaste }, { role: 'selectAll', enabled: flags.canSelectAll }]
      : params.selectionText && !password ? [{ role: 'copy', enabled: flags.canCopy }, { role: 'selectAll', enabled: flags.canSelectAll }] : []
    if (items.length) void contextMenus.show(window, null, randomUUID(), valid, () => items).catch(() => {})
  })
  window.webContents.on('render-process-gone', () => {
    voiceQueuePreviews.clear();voiceCaptures.clear();storySavedAudio.clear(); storyAudioInputs.clear(); storySavedVideos.clear(); storyVideoInputs.clear(); backgroundPhotos.clear()
    contextMenus.close()
    for (const session of accounts.all) session.readingActivityChanged()
    dialog.showErrorBox('Morse', tr('화면이 중단되었습니다. 앱을 다시 열어 주세요.'))
  })
  window.once('ready-to-show', () => { if (shutdown === 'running') windowState.show() })
  window.on('close', event => {
    if (shutdown !== 'running') return
    event.preventDefault()
    if (process.platform === 'darwin' || desktopShell.canCloseToTray(settings.preferences)) { void windowState.save(); window.hide() }
    else app.quit()
  })
  window.on('closed', () => { voiceQueuePreviews.clear();voiceCaptures.clear();storySavedAudio.clear(); storyAudioInputs.clear(); storySavedVideos.clear(); storyVideoInputs.clear(); backgroundPhotos.clear(); contextMenus.close(); if (mainWindow === window) mainWindow = null })
  void window.loadURL(entryURL).catch(() => dialog.showErrorBox('Morse', tr('앱 화면을 불러오지 못했습니다. 설치 파일을 확인해 주세요.')))
}

async function flushRendererDrafts(): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isCrashed() || mainWindow.webContents.isLoadingMainFrame()) return true
  return new Promise(resolve => {
    const id = randomUUID()
    const finish = (success: boolean): void => {
      if (pendingClose?.id !== id) return
      pendingClose = null; clearTimeout(timer); resolve(success)
    }
    const timer = setTimeout(() => finish(false), 10000)
    pendingClose = { id, finish }
    emit({ type: 'prepare-close', requestId: id })
  })
}

async function configureRenderer(): Promise<void> {
  const rendererRoot = resolve(__dirname, '../renderer')
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8' }
  protocol.handle('morse', async request => {
    const url = new URL(request.url)
    if(url.hostname==='app' && url.pathname.startsWith('/__voice-queue/')){
      if(shutdown!=='running' || screenLocked || url.search || url.hash || url.username || url.password || url.port)return new Response(null,{status:403})
      return voiceQueuePreviews.response(url.pathname.slice('/__voice-queue/'.length),request)
    }
    if(url.hostname==='app' && url.pathname.startsWith('/__voice-capture/')){
      if(shutdown!=='running' || screenLocked || url.search || url.hash || url.username || url.password || url.port)return new Response(null,{status:403})
      return voiceCaptures.response(url.pathname.slice('/__voice-capture/'.length),request)
    }
    if(url.hostname==='app' && url.pathname.startsWith('/__story-saved-audio/')) {
      if(shutdown!=='running' || screenLocked || url.search || url.hash || url.username || url.password || url.port)return new Response(null,{status:403})
      return storySavedAudio.response(url.pathname.slice('/__story-saved-audio/'.length),request)
    }
    if(url.hostname==='app' && url.pathname.startsWith('/__story-audio-input/')) {
      if(shutdown!=='running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null,{status:403})
      return storyAudioInputs.response(url.pathname.slice('/__story-audio-input/'.length),request)
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__story-saved-video/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return storySavedVideos.response(url.pathname.slice('/__story-saved-video/'.length), request)
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__story-video-input/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return storyVideoInputs.response(url.pathname.slice('/__story-video-input/'.length), request)
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__background-photo/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return backgroundPhotos.response(url.pathname.slice('/__background-photo/'.length), request)
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-personal/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contacts.personalPhotos.response(url.pathname.slice('/__contact-personal/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__channel-photo-upload/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channelPhotoUpload.response(url.pathname.slice('/__channel-photo-upload/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__group-photo-upload/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.groupPhotoUpload.response(url.pathname.slice('/__group-photo-upload/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__public-channel-avatar/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channelPublicPreview.avatars.response(url.pathname.slice('/__public-channel-avatar/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__public-channel-cover/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channelPublicPreview.cover.response(url.pathname.slice('/__public-channel-cover/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__channel-cover/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channels.cover.response(url.pathname.slice('/__channel-cover/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__channel-avatar/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      const channelAvatar = url.pathname.slice('/__channel-avatar/'.length)
      const listed = accounts.active?.channels.avatars.response(channelAvatar, request)
      if (listed && listed.status !== 403) return listed
      // The chat list's inquiry rows and discussion rows show the same channel pictures.
      const rows = accounts.active?.inquiryRowImages(channelAvatar, request)
      if (rows && rows.status !== 403) return rows
      const discussion = accounts.active?.discussionAvatars.response(channelAvatar, request)
      if (discussion && discussion.status !== 403) return discussion
      return accounts.active?.channelHome.avatars.response(channelAvatar, request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__channel-story/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channelStories.response(url.pathname.slice('/__channel-story/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__channel-home-image/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channelHome.images.response(url.pathname.slice('/__channel-home-image/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__channel-post-picture/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channels.posts.pictures.response(url.pathname.slice('/__channel-post-picture/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__public-channel-post-media/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channelPublicPreview.media.response(url.pathname.slice('/__public-channel-post-media/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__own-story-audio/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.ownStories.audio.response(url.pathname.slice('/__own-story-audio/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__own-story-video-audio/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.ownStories.video.response(url.pathname.slice('/__own-story-video-audio/'.length), request, true) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__own-story-video/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.ownStories.video.response(url.pathname.slice('/__own-story-video/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-audience-story-video-audio/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactAudienceStoryVideo.response(url.pathname.slice('/__contact-audience-story-video-audio/'.length), request, true) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-story-photo-audio-image/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactStoryPhotoAudio.response('image', url.pathname.slice('/__contact-story-photo-audio-image/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-story-photo-audio-sound/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactStoryPhotoAudio.response('audio', url.pathname.slice('/__contact-story-photo-audio-sound/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-audience-story-video/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactAudienceStoryVideo.response(url.pathname.slice('/__contact-audience-story-video/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-public-story-video-audio/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactPublicStoryVideo.response(url.pathname.slice('/__contact-public-story-video-audio/'.length), request, true) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-public-story-video/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactPublicStoryVideo.response(url.pathname.slice('/__contact-public-story-video/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-audience-story-photo/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactAudienceStoryPhoto.response(url.pathname.slice('/__contact-audience-story-photo/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__contact-public-story-photo/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.contactPublicStoryPhoto.response(url.pathname.slice('/__contact-public-story-photo/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__own-story-photo/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.ownStories.photo.response(url.pathname.slice('/__own-story-photo/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__channel-post-media/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.channels.posts.media.response(url.pathname.slice('/__channel-post-media/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith(`/${userpicRoute}/`)) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      // One address per picture: whichever current list, box or profile shows it answers with its bytes.
      const token = url.pathname.slice(userpicRoute.length + 2), active = accounts.active
      const holders: (() => Response | Promise<Response>)[] = active ? [
        () => active.dialogAvatars.response(token, request), () => active.contacts.listAvatars.response(token, request),
        () => active.contacts.photoResponse(token, request), () => active.groupPhotoResponse(token, request), () => active.channelPeople.response(token, request)
      ] : []
      // The accounts list shows every account's own photo.
      for (const session of accounts.all) holders.push(() => session.selfProfile.photoResponse(token, request))
      // A picture opened from a profile, including an earlier one this device remembers.
      if (active) holders.push(() => active.peerPhotos.response(token, request))
      for (const holder of holders) {
        const response = await holder()
        if (response.status !== 403) return response
      }
      return new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__profile-upload/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.selfProfile.photoUpload.response(url.pathname.slice('/__profile-upload/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__profile-history/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.selfProfile.photoUpload.historyResponse(url.pathname.slice('/__profile-history/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__inquiry-draft/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.inquiryAttachmentPreview(url.pathname.slice('/__inquiry-draft/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__draft-media/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.attachmentPreview(url.pathname.slice('/__draft-media/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__sticker/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.stickerResponse(url.pathname.slice('/__sticker/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__sticker-pack/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      const [setId, itemId, ...rest] = url.pathname.slice('/__sticker-pack/'.length).split('/')
      if (!setId || !itemId || rest.length) return new Response(null, { status: 403 })
      return accounts.active?.stickerPackResponse(setId, itemId, request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__photo-preview/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.photoPreviewResponse(url.pathname.slice('/__photo-preview/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (url.hostname === 'app' && url.pathname.startsWith('/__media/')) {
      if (shutdown !== 'running' || screenLocked || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 403 })
      return accounts.active?.media.response(url.pathname.slice('/__media/'.length), request) ?? new Response(null, { status: 403 })
    }
    if (request.method !== 'GET' || url.hostname !== 'app') return new Response(null, { status: 403 })
    let file: string
    try { file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`) }
    catch { return new Response(null, { status: 400 }) }
    if (!file.startsWith(`${rendererRoot}${sep}`) || !['.html', '.js', '.css', '.jpg', '.png', '.svg', '.otf', '.txt'].includes(extname(file))) {
      return new Response(null, { status: 403 })
    }
    try {
      return new Response(new Uint8Array(await readFile(file)), {
        headers: { 'Content-Type': mime[extname(file)]!, 'X-Content-Type-Options': 'nosniff' }
      })
    } catch { return new Response(null, { status: 404 }) }
  })
  const recordingRefusal=(contents:Electron.WebContents|null,isMainFrame:boolean,url:string|undefined,media:CaptureMedia):string=>
    !contents || contents!==mainWindow?.webContents?'not-main-window':!isMainFrame?'not-main-frame':!url || !trustedURL(url)?'untrusted-page':shutdown!=='running'?'shutting-down':screenLocked?'locked':!voiceCaptures.permissionAllowed(media)?'no-reserved-grant':''
  const audioPermission=(contents:Electron.WebContents|null,isMainFrame:boolean,url:string|undefined,media:CaptureMedia='audio'):boolean=>!recordingRefusal(contents,isMainFrame,url,media)
  // The device decision, once per request (the check handler is asked far more often and is left out).
  const audioRequestPermission=(contents:Electron.WebContents|null,isMainFrame:boolean,url:string|undefined,media:CaptureMedia):boolean=>{
    const refusal=recordingRefusal(contents,isMainFrame,url,media)
    recordVoiceStep(media==='video'?'camera-request':'microphone-request',refusal || 'allowed')
    return !refusal
  }
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>{const types='mediaTypes' in details?details.mediaTypes:undefined;const media:CaptureMedia|null=!Array.isArray(types) || !types.length || types.some(type=>type!=='audio' && type!=='video')?null:types.includes('video')?'video':'audio';if(permission==='media' && !media)recordVoiceStep('microphone-request','not-audio-or-video');callback(permission==='media' && media!==null && audioRequestPermission(contents,details.isMainFrame,details.requestingUrl,media))})
  session.defaultSession.setPermissionCheckHandler((contents,permission,_origin,details)=>permission==='media' && (details.mediaType==='audio' || details.mediaType==='video') && audioPermission(contents,details.isMainFrame,details.requestingUrl,details.mediaType==='video'?'video':'audio'))
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const local = (url.protocol === 'morse:' && url.hostname === 'app') || url.protocol === 'data:' || url.protocol === 'blob:'
    const development = Boolean(developmentURL && ['http:', 'ws:'].includes(url.protocol) && url.host === new URL(developmentURL).host)
    callback({ cancel: !(local || development) })
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    const link = argv.find(value => /^(morse|talky):/i.test(value))
    if (link) receiveSchemeLink(link)
    else if (app.isReady() && settings) showWindow()
  })
  // macOS hands a morse:// or talky:// link to the running app, or starts it with one.
  app.on('open-url', (event, url) => { event.preventDefault(); receiveSchemeLink(url) })
  { const link = process.argv.find(value => /^(morse|talky):/i.test(value)); if (link) receiveSchemeLink(link) }
  app.on('activate', () => { if (app.isReady() && settings) showWindow() })
  app.on('before-quit', event => {
    if (shutdown === 'done') return
    event.preventDefault()
    if (shutdown === 'closing') return
    shutdown = 'closing'; contextMenus.close(); updateDesktopShell()
    for (const session of accounts.all) { session.contacts.cancelDeleteForQuit(); session.notificationPreferencesChanged() }
    void (async () => {
      if (!await flushRendererDrafts()) {
        shutdown = 'running'
        for (const session of accounts.all) session.notificationPreferencesChanged()
        updateDesktopShell(); showWindow()
        dialog.showErrorBox('Morse', tr('작성 중인 내용의 저장을 확인하지 못했습니다. 내용을 복사해 보관한 뒤 다시 종료해 주세요.'))
        return
      }
      try { await windowState?.save(); translator.close(); mediaHelper.close(); await authentication?.close(); accounts.closeAll(); await accounts.flush(); await settings?.flush() }
      catch { dialog.showErrorBox('Morse', tr('종료 중 저장소 오류가 발생했습니다. 다음 실행 시 저장 상태를 확인해 주세요.')) }
      finally { shutdown = 'done'; desktopShell.close(); appUpdates.close(); if (appUpdates.requested) appUpdates.install(); else app.quit() }
    })()
  })
  void app.whenReady().then(async () => {
    if (app.isPackaged) for (const scheme of ['morse', 'talky']) app.setAsDefaultProtocolClient(scheme)
    if (!['darwin', 'win32'].includes(process.platform)) throw new Error(tr('macOS와 Windows에서 사용할 수 있습니다.'))
    settings = new SettingsStore(app.getPath('userData'))
    await settings.load()
    windowState = new WindowState(settings, message => emit({ type: 'error', message }))
    appLock = new AppLock(app.getPath('userData'))
    await appLock.load()
    localKey = new LocalDataKey(app.getPath('userData'))
    setLocalDataKey(() => localKey!.hex())
    // A key record that cannot be read may be a refused keychain prompt as well as a damaged file, so the local data is
    // only replaced when the person chooses to start it over.
    if (await localKey.load() === 'unreadable') {
      const { response } = await dialog.showMessageBox({ type: 'warning', defaultId: 0, cancelId: 2, noLink: true,
        buttons: [tr('다시 열기'), tr('로컬 데이터 새로 시작'), tr('종료')],
        message: tr('이 기기의 로컬 데이터 키를 읽지 못했습니다.'),
        detail: tr('키체인 접근을 거부했다면 다시 열어 허용해 주세요. 새로 시작하면 이 기기에만 있던 기록은 휴지통으로 옮겨지고, 저장된 계정은 다시 연결됩니다.') })
      if (response === 1) await replaceLocalData()
      else { if (response === 0) app.relaunch(); app.exit(0); return }
    }
    touchIdAvailable = process.platform === 'darwin' && systemPreferences.canPromptTouchID()
    refreshScreenLock(); screenLocked = screenIsLocked || appLock.locked
    credentialVault = new CredentialVault(join(app.getPath('userData'), 'credentials'))
    authentication = new AuthenticationDomain(productionAuthentication(), credentialVault, app.getVersion(), () => { void publish() }, {
        activated: (profile, credentials, makeActive) => {
          accounts.activate(profile, credentials, join(app.getPath('userData'), 'accounts'), makeActive)
          const session = accounts.get(profile.uid)
          session?.selfProfile.setLocked(screenLocked); session?.contacts.setLocked(screenLocked); session?.setLocked(screenLocked)
          if (accounts.active?.profile.uid === profile.uid) void credentialVault.setActive(profile.uid)
          checkAutoLock()
          updatePresence()
        },
        connection: (uid, state) => accounts.connection(uid, state),
        notificationHint: (uid, hint) => accounts.get(uid)?.notificationHint(hint),
        reactionUpdated: (uid, body) => accounts.get(uid)?.reactionUpdated(body),
        closed: (uid, purge) => { accounts.close(uid, purge); updatePresence() },
        maxAccounts: () => maxAccounts(),
        activeUid: () => accounts.active?.profile.uid ?? null
      })
    if (process.platform === 'win32') app.setAppUserModelId('com.morse.messenger.desktop')
    desktopShell.initialize()
    notifications.initialize()
    applyTheme()
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground())
      void publish()
    })
    await configureRenderer()
    registerIPC(); createMenu(); createWindow()
    appUpdates.start()
    if (localKey.ready) startAccounts(); else void authentication.prepare()
    for (const event of ['resume', 'unlock-screen', 'user-did-become-active'] as const) powerMonitor.on(event as 'resume', () => checkAutoLock())
    checkAutoLock()
    powerMonitor.on('suspend', () => {
      systemSuspended = true; updateScreenProtection(); void windowState.save(); authentication.suspend(); updatePresence()
    })
    powerMonitor.on('resume', () => {
      if (shutdown !== 'running') return
      systemSuspended = false; refreshScreenLock(); updateScreenProtection(); windowState.recover(); authentication.resume(); updatePresence()
    })
    powerMonitor.on('lock-screen', () => { screenIsLocked = true; updateScreenProtection() })
    powerMonitor.on('unlock-screen', () => { screenIsLocked = false; updateScreenProtection() })
    powerMonitor.on('user-did-resign-active', () => { userInactive = true; updateScreenProtection() })
    powerMonitor.on('user-did-become-active', () => { userInactive = false; refreshScreenLock(); updateScreenProtection() })
  }).catch(error => {
    dialog.showErrorBox(tr('Morse를 열 수 없습니다'), error instanceof Error ? error.message : tr('앱 초기화에 실패했습니다.'))
    app.quit()
  })
}
