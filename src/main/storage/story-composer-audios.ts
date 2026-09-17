import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { storyComposerDraftTarget,type StoryComposerDraftTarget } from '../../shared/story-composer-drafts'
import { storyComposerAudioReference,type StoryComposerAudioReference,type StoryComposerAudioStoredSource,storyComposerAudioWrite,type StoryComposerAudioWrite,type StoryComposerAudioRecord } from '../../shared/story-composer-audio-storage'
import { storyAudioHeaders } from '../media/story-audio-headers'
import { storedStoryComposerDraft } from './story-composer-drafts'
import { pendingStoryPublication } from './story-publication-table'
import { pendingStoryVideoPublication } from './story-video-publication-table'
export type StoryComposerAudioCommand={kind:'story-composer-audio-source';reference:StoryComposerAudioReference}|{kind:'story-composer-audio-read';target:StoryComposerDraftTarget}|{kind:'story-composer-audio-write';request:StoryComposerAudioWrite;bytes?:Uint8Array}
interface Row { revision:string;sourceId:string|null;audio:Uint8Array|null }
const fail=(code:'conflict'|'capacity'='conflict'):never=>{throw Object.assign(new Error('Story composer audio '+code),{deliveryCode:code})}
function stored(db:Database.Database,id:string):Row|undefined{return db.prepare('SELECT revision,source_id AS sourceId,CASE WHEN length(audio)<15728640 THEN audio END AS audio FROM story_composer_audios WHERE draft_id=?').get(id) as Row|undefined}
function record(id:string,row:Row|undefined):StoryComposerAudioRecord {
  if(!row)return{id,revision:null,audio:null}
  const revision=backgroundPhotoId(row.revision)
  if(row.sourceId===null){if(row.audio!==null)return fail();return{id,revision,audio:null}}
  if(!(row.audio instanceof Uint8Array))return fail()
  const bytes=Buffer.from(row.audio.buffer,row.audio.byteOffset,row.audio.byteLength),info=storyAudioHeaders(bytes)
  return{id,revision,audio:{...info,sourceId:backgroundPhotoId(row.sourceId),bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex'),md5:createHash('md5').update(bytes).digest('base64')}}
}
export function executeStoryComposerAudio(db:Database.Database,command:StoryComposerAudioCommand):StoryComposerAudioRecord|StoryComposerAudioStoredSource {
  if(command.kind==='story-composer-audio-source'){
    const reference=storyComposerAudioReference(command.reference),row=stored(db,reference.id)
    try{const current=record(reference.id,row);if(!storedStoryComposerDraft(db,{id:reference.id}).draft || current.revision!==reference.revision || current.audio?.sourceId!==reference.sourceId || !row?.audio)return fail();return{record:current,bytes:new Uint8Array(row.audio)}}finally{row?.audio?.fill(0)}
  }
  if(command.kind==='story-composer-audio-read'){
    const target=storyComposerDraftTarget(command.target),row=stored(db,target.id)
    try{const value=record(target.id,row);if(value.audio && !storedStoryComposerDraft(db,target).draft)return fail();return value}finally{row?.audio?.fill(0)}
  }
  try{return db.transaction(()=>{
    const request=storyComposerAudioWrite(command.request),draft=storedStoryComposerDraft(db,{id:request.id})
    if(!draft.draft || draft.revision!==request.draftRevision || pendingStoryPublication(db)?.draftId===request.id || pendingStoryVideoPublication(db)?.draftId===request.id)return fail()
    if(request.sourceId===null?command.bytes!==undefined:!(command.bytes instanceof Uint8Array))return fail()
    const next=record(request.id,{revision:request.revision,sourceId:request.sourceId,audio:command.bytes??null}),previous=stored(db,request.id)
    try{
      const current=record(request.id,previous)
      if(current.revision===request.revision){if(JSON.stringify(current)===JSON.stringify(next))return current;return fail()}
      if(current.revision!==request.expected || db.prepare('SELECT 1 FROM story_composer_audios WHERE revision=?').get(request.revision))return fail()
      const totals=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(COALESCE(length(audio),0)),0) AS bytes FROM story_composer_audios').get() as {count:number;bytes:number}
      if((!previous && totals.count>=10000) || totals.bytes-(previous?.audio?.byteLength??0)+(command.bytes?.byteLength??0)>128*1024*1024)return fail('capacity')
      const bytes=command.bytes
      db.prepare('INSERT INTO story_composer_audios(draft_id,revision,source_id,audio) VALUES(?,?,?,?) ON CONFLICT(draft_id) DO UPDATE SET revision=excluded.revision,source_id=excluded.source_id,audio=excluded.audio').run(request.id,request.revision,request.sourceId,bytes?Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength):null)
      return next
    }finally{previous?.audio?.fill(0)}
  })()}finally{command.bytes?.fill(0)}
}
