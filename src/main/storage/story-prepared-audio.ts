import type Database from 'better-sqlite3-multiple-ciphers'
import { storyPreparedAudioRequest,type StoryPreparedAudioRequest } from '../../shared/story-prepared-audio'
import type { StoryComposerAudioStoredSource } from '../../shared/story-composer-audio-storage'
import type { PendingStoryPublication } from '../../shared/story-publication'
import type { PendingStoryVideoPublication } from '../../shared/story-video-publication'
import { storyPublicationAudioSource } from './story-publication-audios'
export function preparedStoryAudioSource(db:Database.Database,pending:PendingStoryPublication|PendingStoryVideoPublication|null,raw:StoryPreparedAudioRequest,kind:'photo'|'video',uid:string):StoryComposerAudioStoredSource {
  const request=storyPreparedAudioRequest(raw)
  if(request.kind!==kind || !pending || pending.ownerId!==uid || pending.id!==request.id || pending.state!==request.state || pending.audioRevision!==request.revision || pending.audio?.sourceId!==request.sourceId)throw Object.assign(new Error('Prepared audio scope changed'),{deliveryCode:'conflict'})
  return {record:{id:pending.id,revision:pending.audioRevision,audio:pending.audio},bytes:storyPublicationAudioSource(db,pending)}
}
