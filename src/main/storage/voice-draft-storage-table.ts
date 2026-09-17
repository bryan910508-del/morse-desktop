import type Database from 'better-sqlite3-multiple-ciphers'
import { voiceDraftStorageRemoval,type VoiceDraftStorageRemoval,type VoiceDraftStorageRow } from '../../shared/voice-draft-storage'
import { maxSavedVoiceDrafts,maxSavedVoiceDraftBytes,type VoiceDraftRecord,type VoiceDraftReference,voiceDraftReference } from '../../shared/voice-draft'
import { storedVoiceDraft } from './voice-draft-table'
export type VoiceDraftStorageCommand={kind:'voice-draft-storage-match';reference:VoiceDraftReference}|{kind:'voice-draft-storage-list'}|{kind:'voice-draft-storage-remove';removal:VoiceDraftStorageRemoval}
const conflict=():never=>{throw Object.assign(new Error('Stored voice draft changed'),{deliveryCode:'conflict'})}
export function executeVoiceDraftStorage(db:Database.Database,command:VoiceDraftStorageCommand):VoiceDraftStorageRow[]|VoiceDraftRecord {
  if(command.kind==='voice-draft-storage-list'){
    const rows=db.prepare('SELECT chat_id FROM voice_drafts WHERE payload IS NOT NULL ORDER BY chat_id LIMIT ?').all(maxSavedVoiceDrafts+1) as {chat_id:string}[]
    if(rows.length>maxSavedVoiceDrafts)throw new Error('Voice draft inventory bound exceeded')
    const result=rows.map(row=>{const record=storedVoiceDraft(db,row.chat_id);if(!record.voice || !record.revision)return conflict();return{chatId:record.chatId,revision:record.revision,voice:record.voice}})
    if(result.reduce((sum,row)=>sum+row.voice.bytes,0)>maxSavedVoiceDraftBytes)throw new Error('Voice draft inventory capacity exceeded')
    return result
  }
  if(command.kind==='voice-draft-storage-match'){
    const reference=voiceDraftReference(command.reference),current=storedVoiceDraft(db,reference.chatId)
    if(current.revision!==reference.revision || current.voice?.id!==reference.id)return conflict()
    return current
  }
  const removal=voiceDraftStorageRemoval(command.removal)
  return db.transaction(()=>{
    const current=storedVoiceDraft(db,removal.chatId)
    if(current.revision!==removal.revision || current.voice?.id!==removal.id)return conflict()
    if(db.prepare('SELECT 1 FROM voice_drafts WHERE revision=?').get(removal.operationId))return conflict()
    if(db.prepare('UPDATE voice_drafts SET payload=NULL,source=NULL,revision=? WHERE chat_id=? AND revision=?').run(removal.operationId,removal.chatId,removal.revision).changes!==1)return conflict()
    return{chatId:removal.chatId,revision:removal.operationId,voice:null}
  })()
}
