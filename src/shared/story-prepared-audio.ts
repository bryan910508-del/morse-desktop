import { object } from './validation'
import { storyComposerAudioReference,type StoryComposerAudioReference } from './story-composer-audio-storage'
import type { PendingStoryPublication } from './story-publication'
import { tr } from './i18n'
export interface StoryPreparedAudioRequest extends StoryComposerAudioReference {kind:'photo'|'video';state:PendingStoryPublication['state']}
export function storyPreparedAudioRequest(raw:unknown):StoryPreparedAudioRequest {
  const v=object(raw)
  if(Object.keys(v).some(k=>!['id','revision','sourceId','kind','state'].includes(k)) || (v.kind!=='photo' && v.kind!=='video') || typeof v.state!=='string' || !['prepared','uploading','uploaded','submitted','confirmed','rejected'].includes(v.state))throw new Error(tr('현재 게시 준비 오디오를 선택해 주세요.'))
  return {...storyComposerAudioReference({id:v.id,revision:v.revision,sourceId:v.sourceId}),kind:v.kind,state:v.state as StoryPreparedAudioRequest['state']}
}
