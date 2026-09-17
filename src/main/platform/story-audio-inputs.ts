import { channelMediaResponse } from '../media/channel-media-response'
import { storyAudioConfirm,type StoryAudioConfirm,type StoryAudioReady } from '../../shared/story-composer-audio'
import { randomUUID,createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { BackgroundPhotoOwner } from './background-photos'
import { maxStoryAudioInputBytes,type StoryAudioCandidate } from '../../shared/story-composer-audio'
import { storyAudioHeaders } from '../media/story-audio-headers'
import { tr } from '../../shared/i18n'
interface Input { owner:BackgroundPhotoOwner;bytes:Buffer;candidate:StoryAudioCandidate;timer:NodeJS.Timeout;token:string|null;confirmed:boolean }
export class StoryAudioInputs {
  private input: Input | null = null
  private picking = false
  private generation = 0
  async pick(owner: BackgroundPhotoOwner, choose: () => Promise<string | null>): Promise<StoryAudioCandidate | null> {
    this.prune()
    if (this.picking || this.input) throw new Error(tr('현재 오디오 입력 검토를 닫은 뒤 다시 선택해 주세요.'))
    this.picking = true; const generation = this.generation
    const validate = (): void => { owner.validate(); if (generation !== this.generation) throw new Error(tr('오디오 선택이 만료되었습니다.')) }
    let bytes: Buffer | null = null
    try {
      validate(); const path = await choose(); validate(); if (!path) return null
      const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const before = await file.stat()
        if (!before.isFile() || before.size < 44 || before.size >= maxStoryAudioInputBytes) throw new Error(tr('15 MiB 미만의 PCM WAV 파일을 선택해 주세요.'))
        bytes = Buffer.alloc(before.size + 1); let offset = 0
        while (offset < bytes.length) { validate(); const part = await file.read(bytes, offset, bytes.length - offset, offset); if (!part.bytesRead) break; offset += part.bytesRead }
        const after = await file.stat(); validate()
        if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(tr('선택한 오디오 파일이 변경되었습니다. 다시 선택해 주세요.'))
        const value = bytes.subarray(0, offset), info = storyAudioHeaders(value), id = randomUUID(), expiresAt = Date.now() + 15 * 60 * 1000
        const candidate: StoryAudioCandidate = { ...info, id, bytes: value.length, sha256: createHash('sha256').update(value).digest('hex'), expiresAt }
        const timer = setTimeout(() => this.release(id), expiresAt - Date.now()); timer.unref()
        this.input = { owner, bytes: Buffer.from(value), candidate, timer, token:null, confirmed:false }
        return { ...candidate }
      } finally { await file.close() }
    } catch (error) { if (this.input?.owner === owner) this.release(this.input.candidate.id); throw error }
    finally { bytes?.fill(0); this.picking = false }
  }
  private require(owner:BackgroundPhotoOwner,id:string):Input {
    this.prune();owner.validate();const input=this.input
    if(!input || input.candidate.id!==id || input.owner.key!==owner.key) throw new Error(tr('이 초안에서 오디오를 다시 선택해 주세요.'))
    input.owner.validate();return input
  }
  preview(owner:BackgroundPhotoOwner,id:string):string { const input=this.require(owner,id);input.token=randomUUID();return `morse://app/__story-audio-input/${input.token}` }
  confirm(owner:BackgroundPhotoOwner,raw:StoryAudioConfirm):StoryAudioReady {
    const request=storyAudioConfirm(raw),input=this.require(owner,request.sourceId),candidate=input.candidate
    if(request.duration!==candidate.declaredDuration) throw new Error(tr('브라우저와 PCM 선언 길이가 다릅니다. 자동으로 보정하지 않습니다.'))
    input.confirmed=true;return {sourceId:candidate.id,duration:request.duration,sha256:candidate.sha256,frames:candidate.frames}
  }
  response(token:string,request:Request):Response {
    this.prune();const input=this.input
    if(!input || !token || input.token!==token) return new Response(null,{status:404})
    const validate=():void=>{ input.owner.validate();if(this.input!==input || input.token!==token || input.candidate.expiresAt<=Date.now()) throw new Error(tr('오디오 미리보기가 만료되었습니다.')) }
    try{return channelMediaResponse(input.bytes,'audio/wav',request,validate)}catch{return new Response(null,{status:403})}
  }
  forSave(owner:BackgroundPhotoOwner,id:string):Uint8Array{const input=this.require(owner,id);if(!input.confirmed)throw new Error(tr('현재 오디오의 미리 듣기와 사용 준비를 확인해 주세요.'));return new Uint8Array(input.bytes)}
  release(id:string): void { if (this.input?.candidate.id === id) { clearTimeout(this.input.timer); this.input.bytes.fill(0); this.input = null } }
  prune(): void { if (this.input) { try { this.input.owner.validate(); if (this.input.candidate.expiresAt <= Date.now()) this.release(this.input.candidate.id) } catch { if (this.input) this.release(this.input.candidate.id) } } }
  clear(): void { this.generation++; if (this.input) this.release(this.input.candidate.id) }
}
