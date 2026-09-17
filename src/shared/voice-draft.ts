import { object,identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { voiceUploadProof,type VoiceUploadProof } from './voice-send'
import { maxVoiceCaptureBytes } from './voice-capture'
import { tr } from './i18n'
export const maxSavedVoiceDrafts=100
export const maxSavedVoiceDraftBytes=64*1024*1024
export interface VoiceDraftItem extends VoiceUploadProof {id:string;bytes:number}
export interface VoiceDraftRecord {chatId:string;revision:string|null;voice:VoiceDraftItem|null}
export interface VoiceDraftWrite {chatId:string;expected:string|null;revision:string;voice:VoiceDraftItem|null}
export interface VoiceDraftReference {chatId:string;revision:string;id:string}
export interface VoiceDraftSource {record:VoiceDraftRecord;bytes:Uint8Array}
export function voiceDraftItem(raw:unknown):VoiceDraftItem{
  const v=object(raw)
  if(Object.keys(v).some(k=>!['id','bytes','duration','sha256'].includes(k)) || typeof v.bytes!=='number' || !Number.isSafeInteger(v.bytes) || v.bytes<16 || v.bytes>=maxVoiceCaptureBytes)throw new Error(tr('보관할 음성 원본을 확인해 주세요.'))
  return{id:backgroundPhotoId(v.id),bytes:v.bytes,...voiceUploadProof({duration:v.duration,sha256:v.sha256})}
}
export function voiceDraftWrite(raw:unknown):VoiceDraftWrite{
  const v=object(raw)
  if(Object.keys(v).some(k=>!['chatId','expected','revision','voice'].includes(k)))throw new Error(tr('현재 음성 초안의 저장 버전을 확인해 주세요.'))
  const expected=v.expected===null?null:backgroundPhotoId(v.expected),revision=backgroundPhotoId(v.revision)
  if(expected===revision)throw new Error(tr('새 저장 버전이 필요합니다.'))
  return{chatId:identifier(v.chatId),expected,revision,voice:v.voice===null?null:voiceDraftItem(v.voice)}
}
export function voiceDraftReference(raw:unknown):VoiceDraftReference{
  const v=object(raw);if(Object.keys(v).some(k=>!['chatId','revision','id'].includes(k)))throw new Error(tr('다시 열 음성 초안을 확인해 주세요.'))
  return{chatId:identifier(v.chatId),revision:backgroundPhotoId(v.revision),id:backgroundPhotoId(v.id)}
}
