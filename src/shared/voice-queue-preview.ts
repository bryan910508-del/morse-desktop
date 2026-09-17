import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { voiceCaptureTarget,type VoiceCaptureTarget,maxVoiceCaptureBytes } from './voice-capture'
import { tr } from './i18n'
export interface VoiceQueueMetadata {sha256:string;bytes:number;duration:number}
export interface VoiceQueueReference extends VoiceCaptureTarget,VoiceQueueMetadata {}
export interface VoiceQueueOpen extends VoiceQueueReference {requestId:string}
export interface VoiceQueueSource {reference:VoiceQueueReference;bytes:Uint8Array}
export interface VoiceQueueView {request:VoiceQueueOpen;url:string;expiresAt:number}
export function voiceQueueReference(raw:unknown):VoiceQueueReference {
  const v=object(raw)
  if(Object.keys(v).some(k=>!['id','chatId','sha256','bytes','duration'].includes(k)) || typeof v.sha256!=='string' || !/^[a-f0-9]{64}$/.test(v.sha256) || typeof v.bytes!=='number' || !Number.isSafeInteger(v.bytes) || v.bytes<16 || v.bytes>=maxVoiceCaptureBytes || typeof v.duration!=='number' || !Number.isSafeInteger(v.duration) || v.duration<1 || v.duration>60)throw new Error(tr('현재 보관 음성의 정보를 확인해 주세요.'))
  return{...voiceCaptureTarget({id:v.id,chatId:v.chatId}),sha256:v.sha256,bytes:v.bytes,duration:v.duration}
}
export function voiceQueueOpen(raw:unknown):VoiceQueueOpen {
  const v=object(raw);if(Object.keys(v).some(k=>!['id','chatId','sha256','bytes','duration','requestId'].includes(k)))throw new Error(tr('현재 음성 열람 요청을 확인해 주세요.'))
  return{...voiceQueueReference({id:v.id,chatId:v.chatId,sha256:v.sha256,bytes:v.bytes,duration:v.duration}),requestId:backgroundPhotoId(v.requestId)}
}
export function sameVoiceQueue(a:VoiceQueueReference,b:VoiceQueueReference):boolean{return a.id===b.id && a.chatId===b.chatId && a.sha256===b.sha256 && a.bytes===b.bytes && a.duration===b.duration}
