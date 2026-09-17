import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import type { SendWire } from '../../shared/model'
import { voiceQueueReference,type VoiceQueueMetadata,type VoiceQueueReference,type VoiceQueueSource } from '../../shared/voice-queue-preview'
import type { UploadPart } from './upload-protocol'
import { listUploadParts } from './upload-table'
import { forwardMediaFormat } from '../media/forward-media-format'

export function voiceQueueMetadata(wire:SendWire,parts:UploadPart[]|undefined,receipt:string|null,forwarded:boolean):VoiceQueueMetadata|undefined {
  if(forwarded || !receipt || !/^[a-f0-9]{64}$/.test(receipt) || wire.type!=='voice' || wire.isEncrypted!==false || wire.protocolVersion!==3 || parts?.length!==1)return
  const upload=parts[0]!.upload
  if(parts[0]!.index!==0 || upload.id!==wire.id || upload.chatId!==wire.chatId || upload.kind!=='voice' || upload.contentType!=='application/octet-stream' || upload.path!==`chat_files/${wire.chatId}/${wire.id}.m4a`)return
  try{const value=voiceQueueReference({id:wire.id,chatId:wire.chatId,sha256:upload.sha256,bytes:upload.size,duration:wire.voiceDuration});return{sha256:value.sha256,bytes:value.bytes,duration:value.duration}}catch{return}
}
// A read of the existing upload original. It never claims, retries or finalizes an intent.
export function readVoiceQueueSource(db:Database.Database,uid:string,raw:VoiceQueueReference):VoiceQueueSource|null {
  const reference=voiceQueueReference(raw)
  const row=db.prepare('SELECT chat_id,wire,state,upload_request_digest,forward_operation_id FROM intents WHERE id=?').get(reference.id) as {chat_id:string;wire:string|null;state:string;upload_request_digest:string|null;forward_operation_id:string|null}|undefined
  if(!row?.wire || row.chat_id!==reference.chatId || !['uploading','upload-failed','queued','uncertain','failed'].includes(row.state))return null
  const wire=JSON.parse(row.wire) as SendWire
  if(wire.id!==reference.id || wire.chatId!==reference.chatId || wire.senderId!==uid)return null
  const parts=listUploadParts(db,reference.id),metadata=voiceQueueMetadata(wire,parts,row.upload_request_digest,!!row.forward_operation_id)
  if(!metadata || metadata.sha256!==reference.sha256 || metadata.bytes!==reference.bytes || metadata.duration!==reference.duration)return null
  const size=db.prepare('SELECT length(source) AS bytes FROM upload_parts WHERE intent_id=? AND part_index=0').get(reference.id) as {bytes:number}|undefined
  if(size?.bytes!==reference.bytes)return null
  const source=db.prepare('SELECT source FROM upload_parts WHERE intent_id=? AND part_index=0').get(reference.id) as {source:Buffer}|undefined
  if(!source?.source)return null
  try{
    const bytes=source.source
    if(bytes.byteLength!==reference.bytes || createHash('sha256').update(bytes).digest('hex')!==reference.sha256 || createHash('md5').update(bytes).digest('base64')!==parts[0]!.upload.md5)throw new Error('Stored voice original mismatch')
    forwardMediaFormat('voice',bytes)
    return{reference,bytes:new Uint8Array(bytes)}
  }finally{source.source.fill(0)}
}
