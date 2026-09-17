import { executeVoiceDraftStorage } from './voice-draft-storage-table'
import { randomUUID } from 'node:crypto'
import { executeVoiceDraft } from './voice-draft-table'
import { readVoiceQueueSource,voiceQueueMetadata } from './voice-queue-source'
import { executeStoryReplyDetach } from './story-reply-detach-table'
import { executeStoryReplySend } from './story-reply-send-table'
import { executeStoryReplyDraft } from './story-reply-draft-table'
import { executeStoryViewReceipt } from './story-view-receipt-table'
import { executeStoryReactionChange } from './story-reaction-change-table'
import { executeStoryPublication } from './story-publication-table'
import { executeStoryVideoPublication } from './story-video-publication-table'
import { executeStoryComposerAudio } from './story-composer-audios'
import { executeStoryComposerVideo } from './story-composer-videos'
import { executeStoryComposerPhoto } from './story-composer-photos'
import { executeStoryComposerDraft } from './story-composer-drafts'
import { executeStoryHiddenChange } from './story-hidden-change-table'
import { executeStoryPrivacyMove } from './story-privacy-move-table'
import { executeStoryRemoval } from './story-removal-table'
import { executeStoryCaptionSave } from './story-caption-save-table'
import { executeStoryCaptionDraft } from './story-caption-drafts'
import { executeNoteRemoval } from './space-note-removal-table'
import { executeNoteTextSave } from './space-note-text-save-table'
import { executeNoteEditDraft } from './space-note-edit-drafts'
import { executeNoteCreation } from './space-note-creation-table'
import { executeNoteDraft } from './space-note-drafts'
import { executeChannelCreation } from './channel-creation-table'
import { executePostCreation, executePostPhotos } from './channel-post-creation-table'
import { executePostDraft } from './channel-post-drafts'
import { executeCommentCreation } from './channel-comment-creation-table'
import { executeCommentDraft } from './channel-comment-drafts'
import { executeDiscussionJoin, guardDiscussionJoin } from './channel-discussion-join-table'
import { executeDiscussionLeaveWork } from './discussion-leave-work'
import { executeChannelJoinDecision } from './channel-join-decision-table'
import { executeChannelAccess } from './channel-access-table'
import { executeChannelPhotoUpload } from './channel-photo-upload-table'
import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { isPlainDatabase, openEncryptedDatabase, rawKey } from './encrypted-database'
import { identifier, draftText, outgoingText } from '../../shared/validation'
import { maxQueuedMessages } from '../../shared/delivery'
import { textDigest } from '../messaging/text-identity'
import type { DeliveryCommand, StoredIntent } from './delivery-protocol'
import { executeReadReceipt } from './read-receipt-table'
import { executeMessageAction } from './message-action-table'
import { executeUpload, listUploadParts } from './upload-table'
import { executePendingDirect } from './pending-direct-table'
import { executeReplyDraft, requireReply, storedReply } from './reply-draft-table'
import { executeMessageBookmark } from './message-bookmark-table'
import { executeHiddenChat } from './hidden-chat-table'
import { executeHiddenMessage } from './hidden-message-table'
import { executeChatFlag } from './chat-flag-table'
import { executeContactFlag } from './contact-flag-table'
import { executeSticker } from './sticker-table'
import { executeEventReminder } from './event-reminder-table'
import { executeContactPhoto } from './contact-photo-table'
import { executeContactDetails } from './contact-details-table'
import { executeForward } from './forward-table'
import { executeForwardTexts } from './forward-text-batch-table'
import { executeForwardBatch } from './forward-batch-table'
import { executeChatBackground } from './chat-background-table'
import { executeProfileUpload } from './profile-photo-upload-table'
import { executeGroupPhotoUpload } from './group-photo-upload-table'
import { UserpicStore } from './userpic-cache-table'

const { directory, uid, scope, key } = workerData as { directory: string; uid: string; scope: string; key: string }
identifier(uid)
mkdirSync(directory, { recursive: true, mode: 0o700 })
const file = join(directory, 'delivery.sqlite')
const db = openEncryptedDatabase(file, key)
chmodSync(file, 0o600)
// Pictures already fetched live in their own cache file, sealed with the same local key.
const userpics = new UserpicStore(join(directory, 'userpics.sqlite'), key)
db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL'); db.pragma('busy_timeout = 5000'); db.pragma('secure_delete = ON')
const version = db.pragma('user_version', { simple: true }) as number
// The archive of retired journals written by an earlier version is encrypted with the same key.
const retiredArchive = join(directory, 'delivery-retired-records.sqlite')
if (existsSync(retiredArchive) && isPlainDatabase(retiredArchive)) { openEncryptedDatabase(retiredArchive, key).close(); chmodSync(retiredArchive, 0o600) }
if (version > 63) throw new Error('Unsupported delivery database version')
// v63 retires the group create/add/leave/remove and close friend change journals.
// Their rows move to a separate file next to this database before the tables are dropped.
if (version < 63) {
  const retired = ['group_creations', 'group_member_additions', 'group_leaves', 'group_member_removals', 'close_friend_changes']
    .filter(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
  if (retired.length) {
    const archive = join(directory, 'delivery-retired-records.sqlite')
    if (isPlainDatabase(archive)) openEncryptedDatabase(archive, key).close()
    db.prepare('ATTACH DATABASE ? AS retired KEY ?').run(archive, rawKey(key))
    try {
      db.transaction(() => {
        for (const table of retired) {
          db.exec(`CREATE TABLE IF NOT EXISTS retired.${table} AS SELECT * FROM main.${table} WHERE 0`)
          db.exec(`INSERT INTO retired.${table} SELECT * FROM main.${table}`)
          db.exec(`DROP TABLE main.${table}`)
        }
      })()
    } finally { db.exec('DETACH DATABASE retired') }
    chmodSync(archive, 0o600)
  }
}
db.transaction(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS owner (scope TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS voice_drafts (chat_id TEXT PRIMARY KEY,revision TEXT NOT NULL UNIQUE,payload TEXT,source BLOB);
    CREATE TABLE IF NOT EXISTS story_publication_commits (publication_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS story_photo_uploads (publication_id TEXT NOT NULL, part TEXT NOT NULL, state TEXT NOT NULL, session TEXT, receipt TEXT, PRIMARY KEY(publication_id,part));
    CREATE TABLE IF NOT EXISTS story_video_commits (publication_id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS story_video_uploads (publication_id TEXT NOT NULL, part TEXT NOT NULL, state TEXT NOT NULL, session TEXT, receipt TEXT, PRIMARY KEY(publication_id,part));
    CREATE TABLE IF NOT EXISTS story_video_publications (id TEXT PRIMARY KEY, payload TEXT, video BLOB, poster BLOB, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_publications (id TEXT PRIMARY KEY, payload TEXT, full BLOB, thumbnail BLOB, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_publication_audios (publication_id TEXT PRIMARY KEY,audio BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS story_composer_audios (draft_id TEXT PRIMARY KEY,revision TEXT NOT NULL UNIQUE,source_id TEXT,audio BLOB);
    CREATE TABLE IF NOT EXISTS story_composer_videos (draft_id TEXT PRIMARY KEY, revision TEXT NOT NULL UNIQUE, source_id TEXT, poster_id TEXT, video BLOB, poster BLOB, frame_time REAL);
    CREATE TABLE IF NOT EXISTS story_composer_photos (draft_id TEXT PRIMARY KEY, revision TEXT NOT NULL UNIQUE, photo_id TEXT, full BLOB, thumbnail BLOB);
    CREATE TABLE IF NOT EXISTS story_composer_drafts (id TEXT PRIMARY KEY, payload TEXT, revision TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS story_reply_detachments (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS story_reply_texts (draft_id TEXT PRIMARY KEY, text TEXT NOT NULL, revision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_reply_drafts (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_view_receipts (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_reaction_changes (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_hidden_changes (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_privacy_moves (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_removals (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_caption_saves (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_caption_drafts (privacy TEXT NOT NULL, story_id TEXT NOT NULL, payload TEXT, revision TEXT NOT NULL UNIQUE, PRIMARY KEY(privacy,story_id));
    CREATE TABLE IF NOT EXISTS space_note_removals (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS space_note_text_saves (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS space_note_edit_drafts (note_id TEXT PRIMARY KEY, payload TEXT, revision TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS space_note_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS space_note_drafts (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER NOT NULL, revision TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS channel_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channel_post_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channel_post_photos (photo_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, position INTEGER NOT NULL, source BLOB NOT NULL, session TEXT, uploaded INTEGER NOT NULL DEFAULT 0, UNIQUE(post_id, position));
    CREATE TABLE IF NOT EXISTS channel_post_drafts (channel_id TEXT PRIMARY KEY, text TEXT NOT NULL, visibility TEXT NOT NULL, revision TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS channel_comment_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channel_comment_drafts (channel_id TEXT NOT NULL, post_id TEXT NOT NULL, text TEXT NOT NULL, revision TEXT NOT NULL UNIQUE, parent_id TEXT, parent_revision TEXT, PRIMARY KEY(channel_id,post_id));
    CREATE TABLE IF NOT EXISTS channel_discussion_joins (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channel_join_decisions (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channel_access_changes (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channel_photo_uploads (id TEXT PRIMARY KEY, payload TEXT, stage TEXT NOT NULL, source BLOB, sha256 TEXT, md5 TEXT, session TEXT, url TEXT, apply_version TEXT);
    CREATE TABLE IF NOT EXISTS group_photo_uploads (id TEXT PRIMARY KEY, payload TEXT, stage TEXT NOT NULL, source BLOB, sha256 TEXT, md5 TEXT, session TEXT, url TEXT, apply_version TEXT);
    CREATE TABLE IF NOT EXISTS contact_personal_photos (peer_uid TEXT PRIMARY KEY, version TEXT NOT NULL, photo_id TEXT, source BLOB, sha256 TEXT);
    CREATE TABLE IF NOT EXISTS profile_photo_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, url TEXT NOT NULL, source BLOB NOT NULL, sha256 TEXT NOT NULL, md5 TEXT NOT NULL, applied_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_photo_upload (slot INTEGER PRIMARY KEY CHECK(slot=1), id TEXT NOT NULL, stage TEXT NOT NULL, session TEXT, url TEXT, source BLOB NOT NULL, sha256 TEXT NOT NULL, md5 TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_background_photos (chat_id TEXT PRIMARY KEY, id TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_backgrounds (chat_id TEXT PRIMARY KEY, value TEXT, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS forward_receipts (operation_id TEXT PRIMARY KEY, request_digest TEXT NOT NULL, content_digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contact_details (peer_uid TEXT PRIMARY KEY, nickname TEXT NOT NULL, note TEXT NOT NULL, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_drafts (chat_id TEXT PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reply_drafts (chat_id TEXT PRIMARY KEY, selection_id TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS message_bookmarks (chat_id TEXT NOT NULL, message_id TEXT NOT NULL, created_at REAL NOT NULL, PRIMARY KEY(chat_id, message_id));
    CREATE TABLE IF NOT EXISTS event_reminders (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, title TEXT NOT NULL, event_start REAL NOT NULL, fire_at REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS hidden_chats (chat_id TEXT PRIMARY KEY, hidden_at REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS cleared_chats (chat_id TEXT PRIMARY KEY, cutoff REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_flags (chat_id TEXT PRIMARY KEY, muted INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, category TEXT);
    CREATE TABLE IF NOT EXISTS stickers (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data BLOB NOT NULL, created_at REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS contact_flags (peer_uid TEXT PRIMARY KEY, favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS hidden_messages (chat_id TEXT NOT NULL, message_id TEXT NOT NULL, hidden_at REAL NOT NULL, PRIMARY KEY(chat_id, message_id));
    CREATE TABLE IF NOT EXISTS pending_directs (chat_id TEXT PRIMARY KEY, peer_uid TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL, created_at REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS intents (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
      chat_id TEXT NOT NULL, wire TEXT, digest TEXT NOT NULL, created_at REAL NOT NULL,
      state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS intent_state ON intents(state,sequence);
    CREATE TABLE IF NOT EXISTS read_receipts (chat_id TEXT PRIMARY KEY, observed TEXT NOT NULL,
      confirmed TEXT, pending INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS message_actions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
      chat_id TEXT NOT NULL, message_id TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS action_pending ON message_actions(chat_id,message_id) WHERE state IN ('queued','uncertain');
    CREATE TABLE IF NOT EXISTS upload_parts (intent_id TEXT NOT NULL, part_index INTEGER NOT NULL,
      descriptor TEXT NOT NULL, source BLOB NOT NULL, url TEXT, PRIMARY KEY(intent_id,part_index));
    CREATE TABLE IF NOT EXISTS notification_receipts (chat_id TEXT NOT NULL, message_id TEXT NOT NULL,
      PRIMARY KEY(chat_id,message_id));
    `)
  if (version < 54) db.exec("INSERT OR IGNORE INTO story_reply_texts(draft_id,text,revision) SELECT id,'',id FROM story_reply_drafts WHERE payload IS NOT NULL")
  const draftColumns = new Set((db.pragma('table_info(channel_comment_drafts)') as { name: string }[]).map(column => column.name))
  if (!(db.pragma('table_info(chat_flags)') as { name: string }[]).some(column => column.name === 'category')) db.exec('ALTER TABLE chat_flags ADD COLUMN category TEXT')
  for (const name of ['parent_id', 'parent_revision']) if (!draftColumns.has(name)) db.exec(`ALTER TABLE channel_comment_drafts ADD COLUMN ${name} TEXT`)
  const columns = new Set((db.pragma('table_info(intents)') as { name: string }[]).map(column => column.name))
  for (const [name, type] of [['upload', 'TEXT'], ['source', 'BLOB'], ['source_digest', 'TEXT'], ['upload_request_digest', 'TEXT'], ['forward_operation_id', 'TEXT']]) if (!columns.has(name!)) db.exec(`ALTER TABLE intents ADD COLUMN ${name} ${type}`)
  const owner = db.prepare('SELECT scope FROM owner LIMIT 1').get() as { scope: string } | undefined
  if (owner?.scope !== scope) {
    db.exec('DELETE FROM voice_drafts; DELETE FROM channel_post_photos; DELETE FROM story_publication_audios; DELETE FROM story_publication_commits; DELETE FROM story_photo_uploads; DELETE FROM story_video_commits; DELETE FROM story_video_uploads; DELETE FROM story_video_publications; DELETE FROM story_publications; DELETE FROM story_composer_audios; DELETE FROM story_composer_videos; DELETE FROM story_composer_photos; DELETE FROM story_composer_drafts; DELETE FROM story_reply_detachments; DELETE FROM story_reply_texts; DELETE FROM story_reply_drafts; DELETE FROM story_view_receipts; DELETE FROM story_reaction_changes; DELETE FROM story_hidden_changes; DELETE FROM story_privacy_moves; DELETE FROM story_removals; DELETE FROM story_caption_saves; DELETE FROM story_caption_drafts; DELETE FROM space_note_removals; DELETE FROM space_note_text_saves; DELETE FROM space_note_edit_drafts; DELETE FROM space_note_creations; DELETE FROM space_note_drafts; DELETE FROM channel_creations; DELETE FROM channel_post_creations; DELETE FROM channel_post_drafts; DELETE FROM channel_comment_creations; DELETE FROM channel_comment_drafts; DELETE FROM channel_discussion_joins; DELETE FROM channel_join_decisions; DELETE FROM channel_access_changes; DELETE FROM channel_photo_uploads; DELETE FROM group_photo_uploads; DELETE FROM contact_personal_photos; DELETE FROM profile_photo_history; DELETE FROM profile_photo_upload; DELETE FROM chat_background_photos; DELETE FROM chat_backgrounds; DELETE FROM forward_receipts; DELETE FROM contact_details; DELETE FROM reply_drafts; DELETE FROM message_bookmarks; DELETE FROM event_reminders; DELETE FROM pending_directs; DELETE FROM notification_receipts; DELETE FROM upload_parts; DELETE FROM intents; DELETE FROM local_drafts; DELETE FROM read_receipts; DELETE FROM hidden_chats; DELETE FROM cleared_chats; DELETE FROM hidden_messages; DELETE FROM chat_flags; DELETE FROM contact_flags; DELETE FROM stickers; DELETE FROM message_actions; DELETE FROM owner;')
    db.prepare('INSERT INTO owner(scope) VALUES(?)').run(scope)
    userpics.clear()
  }
  if (version < 5) {
    // Preserve v4 identities, descriptors, source digest and finalized wire.
    // SQL moves the bounded originals without loading every BLOB into JS.
    db.exec(`INSERT INTO upload_parts(intent_id,part_index,descriptor,source,url)
      SELECT id,0,upload,source,NULLIF(json_extract(wire,'$.mediaUrl'),'') FROM intents
      WHERE wire IS NOT NULL AND upload IS NOT NULL AND source IS NOT NULL;
      UPDATE intents SET source=NULL;`)
  }
  // Completed identities remain consumed. Index only body-bearing records for
  // pending-list/count and per-chat reads, without indexing every tombstone again.
  db.exec(`CREATE INDEX IF NOT EXISTS intent_pending_sequence ON intents(sequence) WHERE wire IS NOT NULL;
    CREATE INDEX IF NOT EXISTS intent_pending_chat ON intents(chat_id,sequence) WHERE wire IS NOT NULL;
    CREATE INDEX IF NOT EXISTS action_pending_sequence ON message_actions(sequence) WHERE payload IS NOT NULL;
    CREATE INDEX IF NOT EXISTS action_pending_chat ON message_actions(chat_id) WHERE payload IS NOT NULL;`)
  // v24 retains one group photo upload/apply record and consumed photo identities.
  db.pragma('user_version = 63')
})()

function execute(command: DeliveryCommand): unknown {
  guardDiscussionJoin(db, command)
  switch (command.kind) {
    case 'comment-creation-read': case 'comment-creation-prepare': case 'comment-creation-state': return executeCommentCreation(db, command, uid)
    case 'channel-creation-read': case 'channel-creation-prepare': case 'channel-creation-state': return executeChannelCreation(db, command, uid)
    case 'post-creation-read': case 'post-creation-prepare': case 'post-creation-state': return executePostCreation(db, command, uid)
    case 'post-photo-read': case 'post-photo-state': return executePostPhotos(db, command)
    case 'note-removal-read': case 'note-removal-prepare': case 'note-removal-state': return executeNoteRemoval(db, command, uid)
    case 'note-text-save-read': case 'note-text-save-prepare': case 'note-text-save-state': return executeNoteTextSave(db, command, uid)
    case 'story-reply-detach-known': case 'story-reply-detach-list': case 'story-reply-detach': return executeStoryReplyDetach(db, uid, command)
    case 'story-reply-send-history': case 'story-reply-send-known': case 'enqueue-story-reply': return executeStoryReplySend(db, command, uid)
    case 'story-reply-source-rebase': case 'story-reply-draft-read': case 'story-reply-draft-prepare': case 'story-reply-draft-dismiss': case 'story-reply-text-write': return executeStoryReplyDraft(db, command, uid)
    case 'story-view-receipt-read': case 'story-view-receipt-prepare': case 'story-view-receipt-state': return executeStoryViewReceipt(db, command, uid)
    case 'story-reaction-change-read': case 'story-reaction-change-prepare': case 'story-reaction-change-state': return executeStoryReactionChange(db, command, uid)
    case 'story-hidden-change-read': case 'story-hidden-change-prepare': case 'story-hidden-change-state': return executeStoryHiddenChange(db, command, uid)
    case 'story-privacy-move-read': case 'story-privacy-move-prepare': case 'story-privacy-move-state': return executeStoryPrivacyMove(db, command, uid)
    case 'story-removal-read': case 'story-removal-prepare': case 'story-removal-state': return executeStoryRemoval(db, command, uid)
    case 'story-caption-save-read': case 'story-caption-save-prepare': case 'story-caption-save-state': return executeStoryCaptionSave(db, command, uid)
    case 'story-caption-draft-rebase': case 'story-caption-draft-list': case 'story-caption-draft-read': case 'story-caption-draft-seed': case 'story-caption-draft-write': return executeStoryCaptionDraft(db, command)
    case 'note-edit-draft-rebase': case 'note-edit-draft-list': case 'note-edit-draft-read': case 'note-edit-draft-seed': case 'note-edit-draft-write': return executeNoteEditDraft(db, command)
    case 'note-creation-read': case 'note-creation-prepare': case 'note-creation-state': return executeNoteCreation(db, command, uid)
    case 'story-publication-submit': case 'story-publication-outcome':
    case 'story-publication-upload-begin': case 'story-publication-upload-source': case 'story-publication-upload-session': case 'story-publication-upload-ack': case 'story-publication-upload-block':
    case 'story-publication-audio-source': case 'story-publication-read': case 'story-publication-prepare': case 'story-publication-dismiss': case 'story-publication-source': return executeStoryPublication(db, command, uid)
    case 'story-video-publication-submit': case 'story-video-publication-outcome':
    case 'story-video-publication-upload-begin': case 'story-video-publication-upload-source': case 'story-video-publication-upload-session': case 'story-video-publication-upload-ack': case 'story-video-publication-upload-block':
    case 'story-video-publication-audio-source': case 'story-video-publication-read': case 'story-video-publication-prepare': case 'story-video-publication-dismiss': return executeStoryVideoPublication(db, command, uid)
    case 'story-composer-audio-source': case 'story-composer-audio-read': case 'story-composer-audio-write': return executeStoryComposerAudio(db,command)
    case 'story-composer-video-source': case 'story-composer-video-read': case 'story-composer-video-write': return executeStoryComposerVideo(db, command)
    case 'story-composer-photo-read': case 'story-composer-photo-source': case 'story-composer-photo-write': return executeStoryComposerPhoto(db, command)
    case 'story-composer-draft-read': case 'story-composer-draft-list': case 'story-composer-draft-write': return executeStoryComposerDraft(db, command, uid)
    case 'note-draft-read': case 'note-draft-list': case 'note-draft-write': return executeNoteDraft(db, command)
    case 'post-draft-read': case 'post-draft-list': case 'post-draft-write': return executePostDraft(db, command)
    case 'comment-draft-parent': case 'comment-draft-read': case 'comment-draft-list': case 'comment-draft-write': return executeCommentDraft(db, command)
    case 'discussion-join-read': case 'discussion-join-prepare': case 'discussion-join-state': return executeDiscussionJoin(db, command)
    case 'discussion-leave-work': case 'discussion-leave-clear-drafts': case 'discussion-leave-dismiss-record': return executeDiscussionLeaveWork(db, command)
    case 'channel-join-decision-read': case 'channel-join-decision-prepare': case 'channel-join-decision-state': return executeChannelJoinDecision(db, uid, command)
    case 'channel-access-read': case 'channel-access-prepare': case 'channel-access-state': return executeChannelAccess(db, command)
    case 'channel-photo-upload-read': case 'channel-photo-upload-create': case 'channel-photo-upload-state': case 'channel-photo-upload-discard': return executeChannelPhotoUpload(db, command)
    case 'group-photo-upload-read': case 'group-photo-upload-create': case 'group-photo-upload-state': case 'group-photo-upload-discard': return executeGroupPhotoUpload(db, command)
    case 'profile-upload-finalize': case 'profile-history-restore': case 'profile-history-forget':
    case 'profile-upload-read': case 'profile-upload-create': case 'profile-upload-state': case 'profile-upload-discard': return executeProfileUpload(db, uid, command)
    case 'chat-background': case 'chat-background-save': case 'chat-background-photo': case 'background-storage-list': case 'background-storage-remove': return executeChatBackground(db, command)
    case 'forward-batch-known': case 'enqueue-forward-batch': return executeForwardBatch(db, uid, command)
    case 'forward-texts-known': case 'enqueue-forward-texts': return executeForwardTexts(db, uid, command)
    case 'forward-known': case 'enqueue-forward': case 'enqueue-forward-media': return executeForward(db, uid, command)
    case 'contact-photo-list': case 'contact-photo-source': case 'contact-photo-save': case 'contact-photo-remove': return executeContactPhoto(db, command)
    case 'contact-labels': case 'contact-details': case 'contact-details-save': return executeContactDetails(db, command)
    case 'reply-draft': case 'reply-select': case 'reply-clear': return executeReplyDraft(db, command)
    case 'bookmarks-read': case 'bookmark-set': return executeMessageBookmark(db, command)
    case 'hidden-chats-read': case 'hidden-chat-set': case 'cleared-chats-read': case 'cleared-chat-set': return executeHiddenChat(db, command)
    case 'hidden-messages-read': case 'hidden-messages-add': return executeHiddenMessage(db, command)
    case 'chat-flags-read': case 'chat-flag-set': return executeChatFlag(db, command)
    case 'contact-flags-read': case 'contact-flag-set': return executeContactFlag(db, command)
    case 'stickers-list': case 'sticker-read': case 'sticker-add': case 'sticker-remove': return executeSticker(db, command)
    case 'userpic-read': case 'userpic-write': case 'userpic-owners': case 'userpic-owner': case 'userpic-usage': case 'userpic-clear': return userpics.execute(command)
    case 'event-reminders': case 'event-reminder-add': case 'event-reminder-remove': return executeEventReminder(db, command)
    case 'text-known': {
      const wire = command.wire
      if (wire.senderId !== uid || wire.type !== 'text') throw new Error('Invalid text identity')
      const old = db.prepare('SELECT chat_id,digest,forward_operation_id FROM intents WHERE id=?').get(identifier(wire.id)) as { chat_id: string; digest: string; forward_operation_id: string | null } | undefined
      if (old && (old.forward_operation_id || old.chat_id !== wire.chatId || old.digest !== textDigest(wire))) throw Object.assign(new Error('Intent conflict'), { deliveryCode: 'conflict' })
      return Boolean(old)
    }
    case 'direct-list': case 'direct-open': case 'direct-confirm': case 'direct-discard': case 'direct-supersede': return executePendingDirect(db, uid, command)
    case 'notification-claim': return db.prepare('INSERT OR IGNORE INTO notification_receipts(chat_id,message_id) VALUES(?,?)')
      .run(identifier(command.chatId), identifier(command.messageId)).changes === 1
    case 'attachment-known': case 'enqueue-attachment':
    case 'upload-source': case 'upload-session': case 'upload-complete': case 'upload-ready': return executeUpload(db, uid, command)
    case 'action-list': case 'action-enqueue': case 'action-claim': case 'action-state': case 'action-finish': case 'action-dismiss': case 'action-prune':
      return executeMessageAction(db, command)
    case 'read-list': case 'read-enqueue': case 'read-confirm': case 'read-reject': case 'read-sync':
      return executeReadReceipt(db, command)
    case 'voice-draft-storage-match':case 'voice-draft-storage-list':case 'voice-draft-storage-remove':return executeVoiceDraftStorage(db,command)
    case 'voice-draft-read':case 'voice-draft-known':case 'voice-draft-write':case 'voice-draft-source':return executeVoiceDraft(db,command)
    case 'voice-queue-source': return readVoiceQueueSource(db,uid,command.reference)
    case 'ready': return null
    case 'list': {
      const rows = (command.chatId
        ? db.prepare('SELECT sequence,id,chat_id,wire,created_at,state,reason,upload,forward_operation_id,upload_request_digest FROM intents WHERE wire IS NOT NULL AND chat_id=? ORDER BY sequence').all(identifier(command.chatId))
        : db.prepare('SELECT sequence,id,chat_id,wire,created_at,state,reason,upload,forward_operation_id,upload_request_digest FROM intents WHERE wire IS NOT NULL ORDER BY sequence').all()) as
        { sequence: number; id: string; chat_id: string; wire: string; created_at: number; state: StoredIntent['state']; reason: string; upload: string | null; forward_operation_id: string | null; upload_request_digest: string | null }[]
      return rows.map(row => {
        const wire = JSON.parse(row.wire) as StoredIntent['wire']
        if (wire.senderId !== uid || wire.chatId !== row.chat_id || wire.id !== row.id) throw new Error('Intent identity mismatch')
        const upload = row.upload ? JSON.parse(row.upload) as StoredIntent['upload'] : undefined
        const parts = upload ? listUploadParts(db, row.id) : undefined
        return { sequence: row.sequence, id: row.id, chatId: row.chat_id, wire, upload, parts, voicePreview:voiceQueueMetadata(wire,parts,row.upload_request_digest,!!row.forward_operation_id),
          text: parts && parts.length > 1 ? `사진 ${parts.length}장` : upload ? upload.name : wire.text,
          createdAt: row.created_at, state: row.state, reason: row.reason, forwarded: Boolean(row.forward_operation_id), forwardOperationId: row.forward_operation_id ?? undefined }
      }) satisfies StoredIntent[]
    }
    case 'draft': return (db.prepare('SELECT text FROM local_drafts WHERE chat_id=?').get(identifier(command.chatId)) as { text: string } | undefined)?.text ?? ''
    case 'save-draft':
      db.prepare('INSERT INTO local_drafts(chat_id,text) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET text=excluded.text')
        .run(identifier(command.chatId), draftText(command.text)); return null
    case 'enqueue': {
      db.transaction(() => {
        const wire = command.wire, digest = textDigest(wire)
        identifier(wire.id); identifier(wire.chatId)
        if (wire.senderId !== uid || wire.type !== 'text' || wire.isEncrypted !== false || wire.protocolVersion !== 3 || outgoingText(wire.text) !== wire.text) throw new Error('Invalid text intent')
        const peer = db.prepare('SELECT peer_uid FROM pending_directs WHERE chat_id=?').get(wire.chatId) as { peer_uid: string } | undefined
        if (peer && (wire.peerUid !== peer.peer_uid || wire.chatType !== 'direct')) throw Object.assign(new Error('Direct identity conflict'), { deliveryCode: 'conflict' })
        const old = db.prepare('SELECT chat_id,digest,forward_operation_id FROM intents WHERE id=?').get(wire.id) as { chat_id: string; digest: string; forward_operation_id: string | null } | undefined
        if (old) {
          if (old.forward_operation_id || old.chat_id !== wire.chatId || old.digest !== digest) throw Object.assign(new Error('Intent conflict'), { deliveryCode: 'conflict' })
          // Completed/discarded IDs remain consumed even after their body is gone.
          const current = storedReply(db, wire.chatId)
          if (!current || current.selectionId === command.reply?.selectionId) {
            db.prepare('DELETE FROM local_drafts WHERE chat_id=? AND text=?').run(wire.chatId, command.expectedDraft)
            if (current) db.prepare('DELETE FROM reply_drafts WHERE chat_id=? AND selection_id=?').run(wire.chatId, current.selectionId)
          }
          return
        }
        requireReply(db, wire.chatId, command.reply, wire.replyToId)
        const count = db.prepare('SELECT COUNT(*) AS count FROM intents WHERE wire IS NOT NULL').get() as { count: number }
        if (count.count >= maxQueuedMessages) throw Object.assign(new Error('Outbox full'), { deliveryCode: 'capacity' })
        db.prepare("INSERT INTO intents(id,chat_id,wire,digest,created_at,state) VALUES(?,?,?,?,?,'queued')")
          .run(wire.id, wire.chatId, JSON.stringify(wire), digest, Date.now())
        db.prepare('DELETE FROM local_drafts WHERE chat_id=? AND text=?').run(wire.chatId, command.expectedDraft)
        db.prepare('DELETE FROM reply_drafts WHERE chat_id=?').run(wire.chatId)
      })(); return null
    }
    case 'claim': return db.prepare("UPDATE intents SET state='uncertain',reason='ack-pending' WHERE id=? AND state='queued' AND wire IS NOT NULL").run(command.id).changes === 1
    case 'release-unemitted':
      // Only the live drain can prove it never emitted this claimed intent.
      // Restart recovery must leave uncertain records for canonical lookup.
      db.prepare("UPDATE intents SET state='queued',reason='' WHERE id=? AND state='uncertain' AND reason='ack-pending' AND wire IS NOT NULL")
        .run(identifier(command.id)); return null
    case 'state':
      db.prepare('UPDATE intents SET state=?,reason=? WHERE id=? AND wire IS NOT NULL').run(command.state, command.reason, command.id); return null
    case 'finish':
      db.transaction(() => {
        db.prepare('DELETE FROM upload_parts WHERE intent_id=?').run(command.id)
        db.prepare('UPDATE intents SET state=?,wire=NULL,upload=NULL,source=NULL,reason=? WHERE id=?').run(command.discarded ? 'discarded' : 'done', '', command.id)
      })(); return null
    case 'prune': {
      const allowed = new Set(command.allowed)
      db.transaction(() => {
        for (const row of db.prepare('SELECT chat_id FROM pending_directs').all() as { chat_id: string }[]) allowed.add(row.chat_id)
        const chats = db.prepare('SELECT chat_id FROM intents WHERE wire IS NOT NULL UNION SELECT chat_id FROM local_drafts UNION SELECT chat_id FROM reply_drafts UNION SELECT chat_id FROM voice_drafts WHERE payload IS NOT NULL').all() as { chat_id: string }[]
        for (const { chat_id } of chats) if (!allowed.has(chat_id)) {
          db.prepare('DELETE FROM upload_parts WHERE intent_id IN (SELECT id FROM intents WHERE chat_id=?)').run(chat_id)
          db.prepare("UPDATE intents SET state='discarded',wire=NULL,upload=NULL,source=NULL,reason='' WHERE chat_id=?").run(chat_id)
          db.prepare('DELETE FROM local_drafts WHERE chat_id=?').run(chat_id)
          db.prepare('DELETE FROM reply_drafts WHERE chat_id=?').run(chat_id)
          db.prepare('UPDATE voice_drafts SET payload=NULL,source=NULL,revision=? WHERE chat_id=?').run(randomUUID(),chat_id)
        }
      })(); return null
    }
    case 'close':
      if (command.purge) db.transaction(() => { db.exec('DELETE FROM voice_drafts; DELETE FROM channel_post_photos; DELETE FROM story_publication_audios; DELETE FROM story_publication_commits; DELETE FROM story_photo_uploads; DELETE FROM story_video_commits; DELETE FROM story_video_uploads; DELETE FROM story_video_publications; DELETE FROM story_publications; DELETE FROM story_composer_audios; DELETE FROM story_composer_videos; DELETE FROM story_composer_photos; DELETE FROM story_composer_drafts; DELETE FROM story_reply_detachments; DELETE FROM story_reply_texts; DELETE FROM story_reply_drafts; DELETE FROM story_view_receipts; DELETE FROM story_reaction_changes; DELETE FROM story_hidden_changes; DELETE FROM story_privacy_moves; DELETE FROM story_removals; DELETE FROM story_caption_saves; DELETE FROM story_caption_drafts; DELETE FROM space_note_removals; DELETE FROM space_note_text_saves; DELETE FROM space_note_edit_drafts; DELETE FROM space_note_creations; DELETE FROM space_note_drafts; DELETE FROM channel_creations; DELETE FROM channel_post_creations; DELETE FROM channel_post_drafts; DELETE FROM channel_comment_creations; DELETE FROM channel_comment_drafts; DELETE FROM channel_discussion_joins; DELETE FROM channel_join_decisions; DELETE FROM channel_access_changes; DELETE FROM channel_photo_uploads; DELETE FROM group_photo_uploads; DELETE FROM contact_personal_photos; DELETE FROM profile_photo_history; DELETE FROM profile_photo_upload; DELETE FROM chat_background_photos; DELETE FROM chat_backgrounds; DELETE FROM forward_receipts; DELETE FROM contact_details; DELETE FROM reply_drafts; DELETE FROM message_bookmarks; DELETE FROM event_reminders; DELETE FROM pending_directs; DELETE FROM notification_receipts; DELETE FROM upload_parts; DELETE FROM intents; DELETE FROM local_drafts; DELETE FROM read_receipts; DELETE FROM hidden_chats; DELETE FROM cleared_chats; DELETE FROM hidden_messages; DELETE FROM chat_flags; DELETE FROM contact_flags; DELETE FROM stickers; DELETE FROM message_actions; DELETE FROM owner;') })()
      if (command.purge) userpics.clear()
      userpics.close()
      db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); return null
  }
}
parentPort!.on('message', (request: { id: number; command: DeliveryCommand }) => {
  try {
    const value=execute(request.command)
    try{parentPort!.postMessage({id:request.id,ok:true,value})}
    finally{if(request.command.kind==='voice-draft-source' && value)(value as import('../../shared/voice-draft').VoiceDraftSource).bytes.fill(0);if(request.command.kind==='voice-queue-source' && value)(value as import('../../shared/voice-queue-preview').VoiceQueueSource).bytes.fill(0)}
  }
  catch (error) {
    const code = error && typeof error === 'object' && 'deliveryCode' in error ? error.deliveryCode : 'storage'
    parentPort!.postMessage({ id: request.id, ok: false, code: code === 'capacity' || code === 'conflict' ? code : 'storage' })
  }
  finally {
    if (request.command.kind === 'channel-photo-upload-create') request.command.bytes.fill(0)
    if (request.command.kind === 'group-photo-upload-create') request.command.bytes.fill(0)
    if(request.command.kind==='voice-draft-write')request.command.bytes?.fill(0)
    if (request.command.kind === 'enqueue-attachment') for (const part of request.command.parts) part.bytes.fill(0)
    if (request.command.kind === 'enqueue-forward-media') for (const part of request.command.media.parts) part.bytes.fill(0)
  }
})
