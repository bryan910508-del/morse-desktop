import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { storyAudioHeaders } from '../media/story-audio-headers'
import { storyPublicationAudioFields,type StoryPublicationAudioFields } from '../../shared/story-publication-audio'
import { executeStoryComposerAudio } from './story-composer-audios'
import type { StoryComposerAudioRecord,StoryComposerAudioStoredSource } from '../../shared/story-composer-audio-storage'
const fail=():never=>{throw Object.assign(new Error('Publication audio changed'),{deliveryCode:'conflict'})}
export function prepareStoryPublicationAudio(db:Database.Database,draftId:string,revision?:string):{fields:StoryPublicationAudioFields;bytes:Uint8Array|null}{
  const record=executeStoryComposerAudio(db,{kind:'story-composer-audio-read',target:{id:draftId}}) as StoryComposerAudioRecord
  if(!record.audio){if(revision!==undefined)return fail();return{fields:{},bytes:null}}
  if(!revision || record.revision!==revision)return fail()
  const source=executeStoryComposerAudio(db,{kind:'story-composer-audio-source',reference:{id:draftId,revision,sourceId:record.audio.sourceId}}) as StoryComposerAudioStoredSource
  try{if(JSON.stringify(record)!==JSON.stringify(source.record))return fail();return{fields:storyPublicationAudioFields(revision,record.audio),bytes:source.bytes}}catch(error){source.bytes.fill(0);throw error}
}
export function storeStoryPublicationAudio(db:Database.Database,id:string,bytes:Uint8Array|null):void{
  if(db.prepare('SELECT 1 FROM story_publication_audios').get())return fail()
  if(bytes)db.prepare('INSERT INTO story_publication_audios(publication_id,audio) VALUES(?,?)').run(id,Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength))
}
export function requireStoryPublicationAudio(db:Database.Database,intent:{id:string}&StoryPublicationAudioFields):void{
  const row=db.prepare('SELECT length(audio) AS bytes FROM story_publication_audios WHERE publication_id=?').get(intent.id) as {bytes:number}|undefined
  if(intent.audio ? !row || row.bytes!==intent.audio.bytes : !!row)return fail()
}
export function storyPublicationAudioSource(db:Database.Database,intent:{id:string}&StoryPublicationAudioFields):Uint8Array {
  if(!intent.audio || !intent.audioRevision)return fail()
  const row=db.prepare('SELECT CASE WHEN length(audio)<15728640 THEN audio END AS audio FROM story_publication_audios WHERE publication_id=?').get(intent.id) as {audio:Uint8Array|null}|undefined
  try{
    if(!(row?.audio instanceof Uint8Array))return fail()
    const bytes=Buffer.from(row.audio.buffer,row.audio.byteOffset,row.audio.byteLength),info=storyAudioHeaders(bytes),value=intent.audio
    if(bytes.byteLength!==value.bytes || createHash('sha256').update(bytes).digest('hex')!==value.sha256 || createHash('md5').update(bytes).digest('base64')!==value.md5 || Object.entries(info).some(([key,entry])=>value[key as keyof typeof value]!==entry))return fail()
    return new Uint8Array(bytes)
  }finally{row?.audio?.fill(0)}
}
export function requireStoryPublicationAudioDraft(db:Database.Database,intent:{draftId:string}&StoryPublicationAudioFields):void {
  const record=executeStoryComposerAudio(db,{kind:'story-composer-audio-read',target:{id:intent.draftId}}) as StoryComposerAudioRecord
  if(!intent.audio){if(record.audio)return fail();return}
  if(!record.audio || record.revision!==intent.audioRevision || Object.entries(intent.audio).some(([key,value])=>record.audio![key as keyof typeof record.audio]!==value))return fail()
}
