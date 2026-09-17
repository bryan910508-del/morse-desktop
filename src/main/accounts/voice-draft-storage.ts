import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { maxSavedVoiceDrafts,maxSavedVoiceDraftBytes,voiceDraftItem,type VoiceDraftRecord } from '../../shared/voice-draft'
import { identifier } from '../../shared/validation'
import { backgroundPhotoId } from '../../shared/chat-background'
import type { VoiceDraftStorageSnapshot,VoiceDraftStorageRow,VoiceDraftStorageRemoval,VoiceDraftStorageNavigation } from '../../shared/voice-draft-storage'
import type { VoiceDraftStorageCommand } from '../storage/voice-draft-storage-table'
import { tr } from '../../shared/i18n'
interface Source {validate():void;title(chatId:string):string|null}
export class VoiceDraftStorage {
  private inventory:{value:VoiceDraftStorageSnapshot;source:Source;deadline:number}|null=null
  private job:Promise<unknown>|null=null
  private revision=0
  private closed=false
  constructor(private readonly store:<T>(command:VoiceDraftStorageCommand,validate:()=>void)=>Promise<T>,private readonly source:()=>Source){}
  invalidate():void{this.revision++;this.inventory=null}
  async list():Promise<VoiceDraftStorageSnapshot>{
    if(this.closed || this.job)throw new Error(tr('진행 중인 음성 보관 작업을 먼저 마쳐 주세요.'))
    this.invalidate();const source=this.source(),revision=this.revision
    const validate=():void=>{source.validate();if(this.closed || revision!==this.revision)throw new Error(tr('음성 보관 목록을 다시 불러와 주세요.'))}
    validate();const task=this.store<VoiceDraftStorageRow[]>({kind:'voice-draft-storage-list'},validate);this.job=task
    try{
      const rows=await task;validate()
      if(rows.length>maxSavedVoiceDrafts || new Set(rows.map(row=>row.chatId)).size!==rows.length)throw new Error(tr('음성 보관 목록을 확인하지 못했습니다.'))
      const items=rows.map(row=>{const chatId=identifier(row.chatId),revision=backgroundPhotoId(row.revision),voice=voiceDraftItem(row.voice),title=source.title(chatId);return{chatId,revision,voice,listed:title!==null,title:title??''}}).sort((a,b)=>Number(b.listed)-Number(a.listed) || a.title.localeCompare(b.title,'ko') || a.chatId.localeCompare(b.chatId))
      const bytes=items.reduce((sum,item)=>sum+item.voice.bytes,0);if(bytes>maxSavedVoiceDraftBytes)throw new Error(tr('음성 보관 용량을 확인하지 못했습니다.'))
      const value={token:randomUUID(),items,bytes,limit:maxSavedVoiceDraftBytes,expiresAt:Date.now()+300000}
      this.inventory={value,source,deadline:performance.now()+300000};return value
    }finally{if(this.job===task)this.job=null}
  }
  async resolve(request:VoiceDraftStorageNavigation):Promise<VoiceDraftRecord>{
    if(this.closed || this.job)throw new Error(tr('진행 중인 음성 보관 작업을 먼저 마쳐 주세요.'))
    const inventory=this.inventory,item=inventory?.value.items.find(row=>row.chatId===request.chatId)
    const validate=():void=>{
      if(this.closed || !inventory || this.inventory!==inventory || inventory.value.token!==request.token || inventory.deadline<=performance.now() || !item?.listed || item.revision!==request.revision || item.voice.id!==request.id)throw new Error(tr('최신 보관 음성 목록에서 대화를 다시 선택해 주세요.'))
      inventory.source.validate();if(inventory.source.title(request.chatId)!==item.title)throw new Error(tr('대화 정보가 변경되었습니다. 목록을 다시 불러와 주세요.'))
    }
    validate();const task=this.store<VoiceDraftRecord>({kind:'voice-draft-storage-match',reference:{chatId:request.chatId,revision:request.revision,id:request.id}},validate);this.job=task
    try{const record=await task;validate();if(record.chatId!==request.chatId || record.revision!==request.revision || record.voice?.id!==request.id || JSON.stringify(record.voice)!==JSON.stringify(item!.voice))throw new Error(tr('보관한 음성이 변경되었습니다.'));return record}
    finally{if(this.job===task)this.job=null}
  }
  async remove(removal:VoiceDraftStorageRemoval):Promise<void>{
    if(this.closed || this.job)throw new Error(tr('진행 중인 음성 보관 작업을 먼저 마쳐 주세요.'))
    const inventory=this.inventory,item=inventory?.value.items.find(row=>row.chatId===removal.chatId)
    const validate=():void=>{
      if(this.closed || !inventory || this.inventory!==inventory || inventory.value.token!==removal.token || inventory.deadline<=performance.now() || !item || item.revision!==removal.revision || item.voice.id!==removal.id)throw new Error(tr('음성 보관 목록을 다시 불러온 뒤 정리해 주세요.'))
      inventory.source.validate();if(inventory.source.title(removal.chatId)!==(item.listed?item.title:null))throw new Error(tr('대화 정보가 변경되었습니다. 목록을 다시 불러와 주세요.'))
    }
    validate();const task=this.store<VoiceDraftRecord>({kind:'voice-draft-storage-remove',removal},validate);this.job=task
    try{const record=await task;validate();if(record.chatId!==removal.chatId || record.revision!==removal.operationId || record.voice!==null)throw new Error(tr('음성 초안 정리 결과를 확인하지 못했습니다.'))}
    finally{this.invalidate();if(this.job===task)this.job=null}
  }
  async close():Promise<void>{this.closed=true;this.invalidate();await this.job?.catch(()=>{})}
}
