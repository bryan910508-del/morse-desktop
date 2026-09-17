import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyComposerPhotoTarget,type StoryComposerPhotoTarget } from './story-composer-photo'
import type { StoryAudioHeaderInfo } from './story-composer-audio'
import { tr } from './i18n'
export interface StoryComposerAudioRecord { id:string;revision:string|null;audio:(StoryAudioHeaderInfo & { sourceId:string;bytes:number;sha256:string;md5:string })|null }
export interface StoryComposerAudioWrite extends StoryComposerPhotoTarget { expected:string|null;revision:string;sourceId:string|null }
export function storyComposerAudioWrite(raw:unknown):StoryComposerAudioWrite {
  const v=object(raw);if(Object.keys(v).some(k=>!['id','draftRevision','expected','revision','sourceId'].includes(k)))throw new Error(tr('현재 오디오 저장본을 확인해 주세요.'))
  const expected=v.expected===null?null:backgroundPhotoId(v.expected),revision=backgroundPhotoId(v.revision)
  if(expected===revision)throw new Error(tr('새 오디오 저장 버전이 필요합니다.'))
  return {...storyComposerPhotoTarget({id:v.id,draftRevision:v.draftRevision}),expected,revision,sourceId:v.sourceId===null?null:backgroundPhotoId(v.sourceId)}
}
export interface StoryComposerAudioReference { id:string;revision:string;sourceId:string }
export interface StoryComposerAudioStoredSource { record:StoryComposerAudioRecord;bytes:Uint8Array }
export interface StoryComposerAudioView { token:string;url:string;expiresAt:number;record:StoryComposerAudioRecord }
export function storyComposerAudioReference(raw:unknown):StoryComposerAudioReference{const v=object(raw);if(Object.keys(v).some(k=>!['id','revision','sourceId'].includes(k)))throw new Error(tr('현재 저장한 오디오를 선택해 주세요.'));return{id:backgroundPhotoId(v.id),revision:backgroundPhotoId(v.revision),sourceId:backgroundPhotoId(v.sourceId)}}
