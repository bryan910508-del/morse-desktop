import { randomUUID,createHash } from 'node:crypto'
import { storyAudioHeaders } from '../media/story-audio-headers'
import { channelMediaResponse } from '../media/channel-media-response'
import type { StoryComposerAudioReference,StoryComposerAudioStoredSource,StoryComposerAudioView } from '../../shared/story-composer-audio-storage'
import { tr } from '../../shared/i18n'
interface Owner { validate():void;load():Promise<StoryComposerAudioStoredSource> }
interface Lease { owner:Owner;view:StoryComposerAudioView;bytes:Buffer;timer:NodeJS.Timeout }
export class StorySavedAudio {
  private lease:Lease|null=null
  private loading=false
  private generation=0
  async open(owner:Owner,reference:StoryComposerAudioReference):Promise<StoryComposerAudioView>{
    this.prune();owner.validate();if(this.loading || this.lease)throw new Error(tr('열려 있는 저장 오디오를 먼저 닫아 주세요.'))
    this.loading=true;const generation=this.generation;let source:StoryComposerAudioStoredSource|null=null,adopted=false
    try{
      source=await owner.load();owner.validate();if(generation!==this.generation)throw new Error(tr('저장 오디오 열기가 변경되었습니다.'))
      const {record}=source,value=record.audio
      if(record.id!==reference.id || record.revision!==reference.revision || value?.sourceId!==reference.sourceId)throw new Error(tr('저장한 오디오가 변경되었습니다.'))
      const bytes=Buffer.from(source.bytes.buffer,source.bytes.byteOffset,source.bytes.byteLength),info=storyAudioHeaders(bytes)
      if(bytes.byteLength!==value.bytes || createHash('sha256').update(bytes).digest('hex')!==value.sha256 || Object.entries(info).some(([key,entry])=>value[key as keyof typeof value]!==entry))throw new Error(tr('저장한 오디오의 내용이 일치하지 않습니다.'))
      const token=randomUUID(),expiresAt=Date.now()+600000,view:StoryComposerAudioView={token,url:`morse://app/__story-saved-audio/${token}`,expiresAt,record}
      const timer=setTimeout(()=>this.release(token),600000);timer.unref();this.lease={owner,view,bytes,timer};adopted=true;return view
    }finally{this.loading=false;if(!adopted)source?.bytes.fill(0)}
  }
  response(token:string,request:Request):Response{
    this.prune();const current=this.lease;if(!current || current.view.token!==token)return new Response(null,{status:404})
    const validate=():void=>{current.owner.validate();if(this.lease!==current || current.view.expiresAt<=Date.now())throw new Error(tr('저장 오디오 보기가 만료되었습니다.'))}
    try{return channelMediaResponse(current.bytes,'audio/wav',request,validate)}catch{return new Response(null,{status:403})}
  }
  release(token:string):void{const current=this.lease;if(current?.view.token===token){this.lease=null;clearTimeout(current.timer);current.bytes.fill(0)}}
  clear():void{this.generation++;if(this.lease)this.release(this.lease.view.token)}
  prune():void{if(this.lease){try{this.lease.owner.validate();if(this.lease.view.expiresAt<=Date.now())this.release(this.lease.view.token)}catch{if(this.lease)this.release(this.lease.view.token)}}}
}
