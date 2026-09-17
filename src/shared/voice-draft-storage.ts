import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { voiceDraftReference,type VoiceDraftItem,type VoiceDraftReference } from './voice-draft'
import { tr } from './i18n'
export interface VoiceDraftStorageRow {chatId:string;revision:string;voice:VoiceDraftItem}
export interface VoiceDraftStorageItem extends VoiceDraftStorageRow {title:string;listed:boolean}
export interface VoiceDraftStorageSnapshot {token:string;items:VoiceDraftStorageItem[];bytes:number;limit:number;expiresAt:number}
export interface VoiceDraftStorageNavigation extends VoiceDraftReference {token:string}
export interface VoiceDraftNavigationResult extends VoiceDraftReference {version:string}
export function voiceDraftStorageNavigation(raw:unknown):VoiceDraftStorageNavigation{
  const v=object(raw);if(Object.keys(v).some(k=>!['chatId','revision','id','token'].includes(k)))throw new Error(tr('이동할 보관 음성 대상을 확인해 주세요.'))
  return{...voiceDraftReference({chatId:v.chatId,revision:v.revision,id:v.id}),token:backgroundPhotoId(v.token)}
}
export interface VoiceDraftStorageRemoval extends VoiceDraftReference {token:string;operationId:string}
export function voiceDraftStorageRemoval(raw:unknown):VoiceDraftStorageRemoval {
  const v=object(raw)
  if(Object.keys(v).some(k=>!['chatId','revision','id','token','operationId'].includes(k)))throw new Error(tr('현재 보관 음성 정리 대상을 확인해 주세요.'))
  const reference=voiceDraftReference({chatId:v.chatId,revision:v.revision,id:v.id}),operationId=backgroundPhotoId(v.operationId)
  if(operationId===reference.revision)throw new Error(tr('새 음성 정리 요청을 확인해 주세요.'))
  return{...reference,token:backgroundPhotoId(v.token),operationId}
}
