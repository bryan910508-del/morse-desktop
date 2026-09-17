import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyComposerPhotoTarget,type StoryComposerPhotoTarget } from './story-composer-photo'
import { tr } from './i18n'
export const maxStoryAudioInputBytes = 15 * 1024 * 1024
export interface StoryAudioHeaderInfo { format: 'pcm-wav'; mime: 'audio/wav'; channels: 1 | 2; sampleRate: number; bitsPerSample: 8 | 16; frames: number; declaredDuration: number; dataBytes: number }
export interface StoryAudioCandidate extends StoryAudioHeaderInfo { id: string; bytes: number; sha256: string; expiresAt: number }
export interface StoryAudioSource extends StoryComposerPhotoTarget { sourceId:string }
export interface StoryAudioConfirm extends StoryAudioSource { duration:number }
export interface StoryAudioReady { sourceId:string;duration:number;sha256:string;frames:number }
export function storyAudioSource(raw:unknown):StoryAudioSource { const v=object(raw);if(Object.keys(v).some(k=>!['id','draftRevision','sourceId'].includes(k))) throw new Error(tr('현재 초안에서 선택한 오디오를 확인해 주세요.'));return {...storyComposerPhotoTarget({id:v.id,draftRevision:v.draftRevision}),sourceId:backgroundPhotoId(v.sourceId)} }
export function storyAudioConfirm(raw:unknown):StoryAudioConfirm { const v=object(raw);if(Object.keys(v).some(k=>!['id','draftRevision','sourceId','duration'].includes(k)) || typeof v.duration!=='number' || !Number.isFinite(v.duration) || v.duration<.5 || v.duration>600) throw new Error(tr('현재 오디오 길이를 확인해 주세요.'));return {...storyAudioSource({id:v.id,draftRevision:v.draftRevision,sourceId:v.sourceId}),duration:v.duration} }
