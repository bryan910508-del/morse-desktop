import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import type { StoryComposerAudioRecord } from './story-composer-audio-storage'
import { tr } from './i18n'
export type StoryPublicationAudio=NonNullable<StoryComposerAudioRecord['audio']>
export interface StoryPublicationAudioFields { audioRevision?:string;audio?:StoryPublicationAudio }
export function storyPublicationAudioRevision(value:unknown):{audioRevision?:string}{return value===undefined?{}:{audioRevision:backgroundPhotoId(value)}}
export function storyPublicationAudioFields(revision:unknown,raw:unknown):StoryPublicationAudioFields {
  if(revision===undefined && raw===undefined)return{}
  const audioRevision=backgroundPhotoId(revision),v=object(raw)
  const keys=['format','mime','channels','sampleRate','bitsPerSample','frames','declaredDuration','dataBytes','sourceId','bytes','sha256','md5']
  const integer=(key:string,min:number,max:number):number=>{const value=v[key];if(typeof value!=='number' || !Number.isSafeInteger(value) || value<min || value>max)throw new Error(tr('준비 오디오 수치가 다릅니다.'));return value}
  if(Object.keys(v).some(k=>!keys.includes(k)) || v.format!=='pcm-wav' || v.mime!=='audio/wav' || (v.channels!==1 && v.channels!==2) || (v.bitsPerSample!==8 && v.bitsPerSample!==16))throw new Error(tr('준비 오디오 형식이 다릅니다.'))
  const sampleRate=integer('sampleRate',8000,96000),frames=integer('frames',1,57600000),dataBytes=integer('dataBytes',1,15728639),bytes=integer('bytes',44,15728639),declaredDuration=v.declaredDuration
  if(typeof declaredDuration!=='number' || !Number.isFinite(declaredDuration) || declaredDuration<.5 || declaredDuration>600 || frames/sampleRate!==declaredDuration || frames*v.channels*v.bitsPerSample/8!==dataBytes || dataBytes>bytes-44 || typeof v.sha256!=='string' || !/^[a-f0-9]{64}$/.test(v.sha256) || typeof v.md5!=='string' || !/^[A-Za-z0-9+/]{22}==$/.test(v.md5))throw new Error(tr('준비 오디오 길이·크기·식별값이 다릅니다.'))
  return {audioRevision,audio:{format:'pcm-wav',mime:'audio/wav',channels:v.channels,sampleRate,bitsPerSample:v.bitsPerSample,frames,declaredDuration,dataBytes,sourceId:backgroundPhotoId(v.sourceId),bytes,sha256:v.sha256,md5:v.md5}}
}
