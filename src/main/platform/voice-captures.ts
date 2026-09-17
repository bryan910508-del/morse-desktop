import { createHash,randomUUID } from 'node:crypto'
import { maxVoiceCaptureBytes,type VoiceCaptureTarget,type VoiceCaptureGrant,type VoiceCapturePreview } from '../../shared/voice-capture'
import { forwardMediaFormat } from '../media/forward-media-format'
import { channelMediaResponse } from '../media/channel-media-response'
import { tr } from '../../shared/i18n'
interface Owner {validate():void}
export type CaptureMedia='audio'|'video'
interface Capture {owner:Owner;target:VoiceCaptureTarget;phase:'reserved'|'recording'|'preview';permissionReady:boolean;expiresAt:number;timer:NodeJS.Timeout;bytes:Buffer|null;token:string|null;media:CaptureMedia}
export class VoiceCaptures {
  private current:Capture|null=null
  private generation=0
  generationToken():number{this.prune();if(this.current)throw new Error(tr('현재 음성 녹음을 먼저 닫아 주세요.'));return this.generation}
  constructor(private readonly revoked:(id:string)=>void,private readonly ended:(error:unknown)=>void=()=>{}){}
  reserve(owner:Owner,target:VoiceCaptureTarget,expectedGeneration:number,media:CaptureMedia='audio'):VoiceCaptureGrant{
    this.prune();owner.validate();if(this.current || expectedGeneration!==this.generation)throw new Error(tr('현재 음성 녹음을 먼저 닫아 주세요.'));this.generation++
    const timer=setTimeout(()=>this.clear(target.id),120000);timer.unref();const expiresAt=Date.now()+120000
    this.current={owner,target,phase:'reserved',permissionReady:false,expiresAt,timer,bytes:null,token:null,media};return{...target,expiresAt}
  }
  restore(owner:Owner,target:VoiceCaptureTarget,raw:Uint8Array,expectedGeneration:number):VoiceCapturePreview{
    this.prune();owner.validate();if(this.current || expectedGeneration!==this.generation)throw new Error(tr('현재 음성 녹음을 먼저 닫아 주세요.'));this.generation++
    if(!(raw instanceof Uint8Array) || !raw.byteLength || raw.byteLength>=maxVoiceCaptureBytes)throw new Error(tr('저장한 음성 원본의 크기를 확인해 주세요.'))
    const bytes=Buffer.from(raw);let adopted=false
    try{
      forwardMediaFormat('voice',bytes);owner.validate();const token=randomUUID(),expiresAt=Date.now()+600000,timer=setTimeout(()=>this.clear(target.id),600000);timer.unref()
      this.current={owner,target,phase:'preview',permissionReady:false,expiresAt,timer,bytes,token,media:'audio'};adopted=true
      return{...target,expiresAt,url:`morse://app/__voice-capture/${token}`,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}
    }finally{if(!adopted)bytes.fill(0)}
  }
  private require(target:VoiceCaptureTarget):Capture{this.prune();const current=this.current;if(!current || current.target.id!==target.id || current.target.chatId!==target.chatId)throw new Error(tr('음성 녹음이 종료되었거나 대화가 변경되었습니다.'));current.owner.validate();return current}
  permissionReady(target:VoiceCaptureTarget):void{const current=this.require(target);if(current.phase!=='reserved')throw new Error(tr('녹음 준비 상태가 다릅니다.'));current.permissionReady=true}
  // The camera only for a video message's grant; the microphone for either.
  permissionAllowed(media:CaptureMedia='audio'):boolean{this.prune();const current=this.current;return !!current && current.phase==='reserved' && current.permissionReady && (media==='audio' || current.media==='video')}
  mediaOf(target:VoiceCaptureTarget):CaptureMedia{return this.require(target).media}
  activate(target:VoiceCaptureTarget):VoiceCaptureGrant{const current=this.require(target);if(current.phase!=='reserved' || !current.permissionReady)throw new Error(tr('마이크 권한을 먼저 확인해 주세요.'));current.phase='recording';this.expire(current,65000);return{...target,expiresAt:current.expiresAt}}
  finish(target:VoiceCaptureTarget,raw:unknown):VoiceCapturePreview{
    const current=this.require(target);if(current.phase!=='recording' || !(raw instanceof Uint8Array) || !raw.byteLength || raw.byteLength>=maxVoiceCaptureBytes)throw new Error(tr('녹음 원본의 크기와 상태를 확인해 주세요.'))
    const bytes=Buffer.from(raw);let adopted=false
    try{forwardMediaFormat('voice',bytes);current.owner.validate();if(this.current!==current)throw new Error(tr('음성 녹음이 변경되었습니다.'));current.phase='preview';current.bytes=bytes;current.token=randomUUID();this.expire(current,600000);adopted=true;return{...target,expiresAt:current.expiresAt,url:`morse://app/__voice-capture/${current.token}`,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}}finally{if(!adopted)bytes.fill(0)}
  }
  // A channel inquiry sends its recording at once, without a preview: the recording ends here, and so does the microphone grant.
  complete(target:VoiceCaptureTarget):void{const current=this.require(target);if(current.phase!=='recording')throw new Error(tr('녹음 상태를 다시 확인해 주세요.'));this.clear(target.id)}
  private expire(current:Capture,ms:number):void{clearTimeout(current.timer);current.expiresAt=Date.now()+ms;current.timer=setTimeout(()=>this.clear(current.target.id),ms);current.timer.unref()}
  forSend(target:VoiceCaptureTarget,sha256:string):Uint8Array{const current=this.require(target);if(current.phase!=='preview' || !current.bytes || createHash('sha256').update(current.bytes).digest('hex')!==sha256)throw new Error(tr('현재 미리 듣기 원본을 다시 확인해 주세요.'));return new Uint8Array(current.bytes)}
  response(token:string,request:Request):Response{this.prune();const current=this.current;if(!current || current.phase!=='preview' || current.token!==token || !current.bytes)return new Response(null,{status:404});const validate=():void=>{current.owner.validate();if(this.current!==current || current.expiresAt<=Date.now())throw new Error(tr('음성 미리 듣기가 종료되었습니다.'))};try{return channelMediaResponse(current.bytes,'audio/mp4',request,validate)}catch{return new Response(null,{status:403})}}
  clear(id?:string):void{this.generation++;const current=this.current;if(!current || (id && current.target.id!==id))return;this.current=null;clearTimeout(current.timer);current.bytes?.fill(0);this.revoked(current.target.id)}
  prune():void{const current=this.current;if(current){try{current.owner.validate();if(current.expiresAt<=Date.now()){this.ended(new Error('expired'));this.clear(current.target.id)}}catch(error){this.ended(error);this.clear(current.target.id)}}}
}
