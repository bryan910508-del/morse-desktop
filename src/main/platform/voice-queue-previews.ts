import { createHash,randomUUID } from 'node:crypto'
import { sameVoiceQueue,type VoiceQueueOpen,type VoiceQueueSource,type VoiceQueueView } from '../../shared/voice-queue-preview'
import type { OutgoingSnapshot } from '../../shared/delivery'
import { forwardMediaFormat } from '../media/forward-media-format'
import { channelMediaResponse } from '../media/channel-media-response'
import { tr } from '../../shared/i18n'
interface Owner {validate():void;load():Promise<VoiceQueueSource|null>}
interface Slot {uid:string;request:VoiceQueueOpen;owner:Owner;revision:number;view:VoiceQueueView|null;token:string|null;bytes:Buffer|null;timer:NodeJS.Timeout|null}
export class VoiceQueuePreviews {
  private slot:Slot|null=null
  private loading=false
  constructor(private readonly revoked:(requestId:string)=>void){}
  async open(uid:string,request:VoiceQueueOpen,owner:Owner):Promise<VoiceQueueView>{
    this.prune();owner.validate();if(this.slot || this.loading)throw new Error(tr('열려 있는 보관 음성을 먼저 닫아 주세요.'))
    const slot:Slot={uid,request,owner,revision:-1,view:null,token:null,bytes:null,timer:null};this.slot=slot;this.loading=true
    let source:VoiceQueueSource|null=null,adopted=false
    try{
      source=await owner.load();owner.validate()
      if(this.slot!==slot || !source || !sameVoiceQueue(source.reference,request))throw new Error(tr('보관 음성이 변경되었거나 전송 목록에서 정리되었습니다.'))
      const bytes=Buffer.from(source.bytes.buffer,source.bytes.byteOffset,source.bytes.byteLength)
      if(bytes.byteLength!==request.bytes || createHash('sha256').update(bytes).digest('hex')!==request.sha256)throw new Error(tr('보관 음성 원본이 일치하지 않습니다.'))
      forwardMediaFormat('voice',bytes)
      const token=randomUUID(),expiresAt=Date.now()+600000,view={request,url:`morse://app/__voice-queue/${token}`,expiresAt}
      slot.token=token;slot.view=view;slot.bytes=bytes;slot.timer=setTimeout(()=>this.clear(request.requestId),600000);slot.timer.unref();adopted=true;return view
    }finally{this.loading=false;if(!adopted){source?.bytes.fill(0);if(this.slot===slot)this.clear(request.requestId)}}
  }
  observe(uid:string,chatId:string,snapshot:OutgoingSnapshot):void{
    const slot=this.slot;if(!slot || slot.uid!==uid || slot.request.chatId!==chatId || snapshot.revision<=slot.revision)return
    slot.revision=snapshot.revision
    const item=snapshot.items.find(item=>item.id===slot.request.id),metadata=item?.voicePreview
    if(!item || !metadata || !sameVoiceQueue({...metadata,id:item.id,chatId:item.chatId},slot.request))this.clear(slot.request.requestId)
  }
  response(token:string,request:Request):Response{
    this.prune();const slot=this.slot
    if(!slot?.view || !slot.bytes || slot.token!==token)return new Response(null,{status:404})
    const validate=():void=>{slot.owner.validate();if(this.slot!==slot || slot.view!.expiresAt<=Date.now())throw new Error(tr('보관 음성 미리 듣기가 종료되었습니다.'))}
    try{return channelMediaResponse(slot.bytes,'audio/mp4',request,validate)}catch{return new Response(null,{status:403})}
  }
  clear(requestId?:string):void{const slot=this.slot;if(!slot || (requestId && slot.request.requestId!==requestId))return;this.slot=null;if(slot.timer)clearTimeout(slot.timer);slot.bytes?.fill(0);this.revoked(slot.request.requestId)}
  prune():void{const slot=this.slot;if(slot){try{slot.owner.validate();if(slot.view && slot.view.expiresAt<=Date.now())this.clear(slot.request.requestId)}catch{this.clear(slot.request.requestId)}}}
}
