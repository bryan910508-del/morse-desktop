import { object,identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export const voiceCaptureMime='audio/mp4;codecs=mp4a.40.2'
export const maxVoiceCaptureBytes=4*1024*1024
export interface VoiceCaptureTarget {id:string;chatId:string}
export interface VoiceCaptureGrant extends VoiceCaptureTarget {expiresAt:number}
export interface VoiceCapturePreview extends VoiceCaptureGrant {url:string;bytes:number;sha256:string}
export function voiceCaptureTarget(raw:unknown):VoiceCaptureTarget{const v=object(raw);if(Object.keys(v).some(k=>!['id','chatId'].includes(k)))throw new Error(tr('현재 음성 녹음 대화를 확인해 주세요.'));return{id:backgroundPhotoId(v.id),chatId:identifier(v.chatId)}}
