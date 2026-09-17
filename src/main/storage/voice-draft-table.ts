import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash,randomUUID } from 'node:crypto'
import { identifier } from '../../shared/validation'
import { backgroundPhotoId } from '../../shared/chat-background'
import { maxSavedVoiceDrafts,maxSavedVoiceDraftBytes,voiceDraftItem,voiceDraftWrite,voiceDraftReference,type VoiceDraftRecord,type VoiceDraftWrite,type VoiceDraftReference,type VoiceDraftSource } from '../../shared/voice-draft'
import type { VoiceUploadProof } from '../../shared/voice-send'
import { forwardMediaFormat } from '../media/forward-media-format'
export type VoiceDraftCommand={kind:'voice-draft-read';chatId:string}|{kind:'voice-draft-known';request:VoiceDraftWrite}|{kind:'voice-draft-write';request:VoiceDraftWrite;bytes?:Uint8Array}|{kind:'voice-draft-source';reference:VoiceDraftReference}
const fail=(code:'conflict'|'capacity'='conflict'):never=>{throw Object.assign(new Error('Voice draft '+code),{deliveryCode:code})}
interface Row {revision:string;payload:string|null;bytes:number|null}
export function storedVoiceDraft(db:Database.Database,chatId:string):VoiceDraftRecord{
  identifier(chatId)
  const row=db.prepare('SELECT revision,payload,length(source) AS bytes FROM voice_drafts WHERE chat_id=?').get(chatId) as Row|undefined
  if(!row)return{chatId,revision:null,voice:null}
  const revision=backgroundPhotoId(row.revision),voice=row.payload===null?null:voiceDraftItem(JSON.parse(row.payload))
  if(voice?voice.bytes!==row.bytes:row.bytes!==null)return fail()
  return{chatId,revision,voice}
}
function same(a:VoiceDraftRecord,b:VoiceDraftWrite):boolean{return a.chatId===b.chatId && a.revision===b.revision && JSON.stringify(a.voice)===JSON.stringify(b.voice)}
function checkBytes(voice:NonNullable<VoiceDraftRecord['voice']>,raw:Uint8Array):void{
  if(!(raw instanceof Uint8Array) || raw.byteLength!==voice.bytes || createHash('sha256').update(raw).digest('hex')!==voice.sha256)return fail()
  forwardMediaFormat('voice',Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength))
}
export function executeVoiceDraft(db:Database.Database,command:VoiceDraftCommand):VoiceDraftRecord|VoiceDraftSource|null{
  if(command.kind==='voice-draft-read')return storedVoiceDraft(db,identifier(command.chatId))
  if(command.kind==='voice-draft-source'){
    const reference=voiceDraftReference(command.reference),record=storedVoiceDraft(db,reference.chatId)
    if(record.revision!==reference.revision || record.voice?.id!==reference.id)return fail()
    const row=db.prepare('SELECT source FROM voice_drafts WHERE chat_id=?').get(reference.chatId) as {source:Buffer}|undefined
    if(!row?.source)return fail()
    try{checkBytes(record.voice,row.source);return{record,bytes:new Uint8Array(row.source)}}finally{row.source.fill(0)}
  }
  const request=voiceDraftWrite(command.request)
  if(command.kind==='voice-draft-known'){
    const record=storedVoiceDraft(db,request.chatId)
    if(record.revision===request.revision){if(!same(record,request))return fail();return record}
    if(record.revision!==request.expected)return fail()
    return null
  }
  try{return db.transaction(()=>{
    const previous=storedVoiceDraft(db,request.chatId)
    if(previous.revision===request.revision){if(!same(previous,request))return fail();return previous}
    if(previous.revision!==request.expected || db.prepare('SELECT 1 FROM voice_drafts WHERE revision=?').get(request.revision))return fail()
    if(request.voice){
      if(!command.bytes)return fail();checkBytes(request.voice,command.bytes)
      // An already consumed send identity cannot be reintroduced as a new draft.
      if(db.prepare('SELECT 1 FROM intents WHERE id=?').get(request.voice.id) || db.prepare("SELECT 1 FROM voice_drafts WHERE chat_id<>? AND json_extract(payload,'$.id')=?").get(request.chatId,request.voice.id))return fail()
    }else if(command.bytes!==undefined)return fail()
    const totals=db.prepare('SELECT COUNT(*) AS count,COUNT(payload) AS active,COALESCE(SUM(COALESCE(length(source),0)),0) AS bytes FROM voice_drafts').get() as {count:number;active:number;bytes:number}
    if((previous.revision===null && totals.count>=10000) || totals.active-(previous.voice?1:0)+(request.voice?1:0)>maxSavedVoiceDrafts || totals.bytes-(previous.voice?.bytes??0)+(request.voice?.bytes??0)>maxSavedVoiceDraftBytes)return fail('capacity')
    const bytes=command.bytes
    db.prepare('INSERT INTO voice_drafts(chat_id,revision,payload,source) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,source=excluded.source').run(request.chatId,request.revision,request.voice?JSON.stringify(request.voice):null,bytes?Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength):null)
    return{chatId:request.chatId,revision:request.revision,voice:request.voice}
  })()}finally{command.bytes?.fill(0)}
}
// Called inside the upload enqueue transaction, after its stable receipt lookup.
export function requireVoiceDraftForSend(db:Database.Database,chatId:string,id:string,proof:VoiceUploadProof,bytes:number,revision?:string):void{
  const current=storedVoiceDraft(db,chatId)
  if(revision===undefined){if(current.voice)return fail();return}
  backgroundPhotoId(revision)
  if(current.revision!==revision || current.voice?.id!==id || current.voice.duration!==proof.duration || current.voice.sha256!==proof.sha256 || current.voice.bytes!==bytes)return fail()
}
export function consumeVoiceDraft(db:Database.Database,chatId:string,revision:string):void{
  if(db.prepare('UPDATE voice_drafts SET revision=?,payload=NULL,source=NULL WHERE chat_id=? AND revision=? AND payload IS NOT NULL').run(randomUUID(),chatId,revision).changes!==1)return fail()
}
