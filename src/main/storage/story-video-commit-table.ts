import { requireStoryPublicationAudioDraft } from './story-publication-audios'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PendingStoryVideoPublication } from '../../shared/story-video-publication'
import { storyPublicationTime, type StoryPublicationTime } from '../../shared/story-publication-commit'
import { storedStoryComposerDraft } from './story-composer-drafts'
export type StoryVideoCommitCommand = { kind: 'story-video-publication-submit'; id: string } | { kind: 'story-video-publication-outcome'; id: string; outcome: 'confirmed' | 'rejected' }
const fail = (): never => { throw Object.assign(new Error('Video publication or source draft changed'),{ deliveryCode:'conflict' }) }
export function readStoryVideoTime(db: Database.Database,id: string): StoryPublicationTime | null { const row = db.prepare('SELECT created_at AS createdAt,expires_at AS expiresAt FROM story_video_commits WHERE publication_id=?').get(id); return row ? storyPublicationTime(row) : null }
function requireDraft(db: Database.Database,current: PendingStoryVideoPublication): void {
  requireStoryPublicationAudioDraft(db,current)
  const draft = storedStoryComposerDraft(db,{ id:current.draftId }), video = db.prepare('SELECT revision,source_id AS sourceId,poster_id AS posterId FROM story_composer_videos WHERE draft_id=?').get(current.draftId) as { revision:string;sourceId:string|null;posterId:string|null } | undefined
  if (!draft.draft || draft.revision !== current.draftRevision || draft.draft.caption !== current.caption || draft.draft.privacy !== current.privacy || JSON.stringify(draft.draft.hiddenFrom) !== JSON.stringify(current.hiddenFrom) || video?.revision !== current.videoRevision || video.sourceId !== current.video.sourceId || video.posterId !== current.video.posterId) return fail()
}
export function mutateStoryVideoCommit(db: Database.Database,current: PendingStoryVideoPublication,command: StoryVideoCommitCommand): void {
  if(current.audio && current.uploads?.audio!=='acknowledged')return fail()
  if (current.id !== command.id || current.uploads?.video !== 'acknowledged' || current.uploads.poster !== 'acknowledged') return fail()
  if (command.kind === 'story-video-publication-submit') {
    if (current.state !== 'uploaded' || current.time || readStoryVideoTime(db,current.id)) return fail()
    requireDraft(db,current)
    const createdAt = Date.now(), time = storyPublicationTime({ createdAt,expiresAt:createdAt+86400000 })
    db.prepare('INSERT INTO story_video_commits(publication_id,created_at,expires_at) VALUES(?,?,?)').run(current.id,time.createdAt,time.expiresAt)
    db.prepare("UPDATE story_video_publications SET state='submitted' WHERE id=?").run(current.id)
  } else {
    if (current.state !== 'submitted' || !current.time || !['confirmed','rejected'].includes(command.outcome)) return fail()
    if (command.outcome === 'confirmed') {
      requireDraft(db,current)
      if(current.audio)db.prepare('UPDATE story_composer_audios SET revision=?,source_id=NULL,audio=NULL WHERE draft_id=?').run(randomUUID(),current.draftId)
      db.prepare('UPDATE story_composer_drafts SET payload=NULL,revision=? WHERE id=?').run(randomUUID(),current.draftId)
      db.prepare('UPDATE story_composer_videos SET revision=?,source_id=NULL,poster_id=NULL,video=NULL,poster=NULL,frame_time=NULL WHERE draft_id=?').run(randomUUID(),current.draftId)
    }
    db.prepare('UPDATE story_video_publications SET state=? WHERE id=?').run(command.outcome,current.id)
  }
}
