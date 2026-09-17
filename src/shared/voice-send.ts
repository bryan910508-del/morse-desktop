import { backgroundPhotoId } from './chat-background'
import { object } from './validation'
import { voiceCaptureTarget,type VoiceCaptureTarget } from './voice-capture'
import { replyBinding,type ReplyBinding } from './reply-draft'
import { tr } from './i18n'
export interface VoiceUploadProof {duration:number;sha256:string}
export interface VoiceSendRequest extends VoiceCaptureTarget,VoiceUploadProof {reply:ReplyBinding|null;draftRevision?:string}
export function voiceUploadProof(raw:unknown):VoiceUploadProof{const v=object(raw);if(Object.keys(v).some(k=>!['duration','sha256'].includes(k)) || typeof v.duration!=='number' || !Number.isFinite(v.duration) || v.duration<.5 || v.duration>60 || typeof v.sha256!=='string' || !/^[a-f0-9]{64}$/.test(v.sha256))throw new Error(tr('현재 음성 길이와 원본 식별값을 확인해 주세요.'));return{duration:v.duration,sha256:v.sha256}}
export function voiceSendRequest(raw:unknown):VoiceSendRequest{const v=object(raw);if(Object.keys(v).some(k=>!['id','chatId','duration','sha256','reply','draftRevision'].includes(k)))throw new Error(tr('현재 음성 전송 요청을 확인해 주세요.'));return{...voiceCaptureTarget({id:v.id,chatId:v.chatId}),...voiceUploadProof({duration:v.duration,sha256:v.sha256}),reply:replyBinding(v.reply),...(v.draftRevision===undefined?{}:{draftRevision:backgroundPhotoId(v.draftRevision)})}}
