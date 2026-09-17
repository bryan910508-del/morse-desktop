import type { ChannelPhotoBinding } from '../../../shared/channel-photo-upload'
import type { GroupPhotoBinding } from '../../../shared/group-photo-upload'
import { desktop } from './store'
import { controller } from './ui'
import { waitFor } from './contacts'
import { trackWrite } from './drafts'
import { cropPhoto } from '../boxes/photo-crop-box'
import { tr } from '../../../shared/i18n'

// Crops the picked photo and hands the result to main's durable record. The picked
// source copy is always released; main keeps its own prepared copy once queued.
async function prepare(picked: { id: string; bytes: Uint8Array }, title: string, shape: 'square' | 'cover', queue: (bytes: Uint8Array) => Promise<void>): Promise<boolean> {
  let bytes: Uint8Array | null = null
  try {
    bytes = await cropPhoto(picked.bytes, shape, title)
    if (!bytes) return false
    await trackWrite(queue(bytes))
    return true
  } finally { bytes?.fill(0); picked.bytes.fill(0); void window.morse.releaseBackgroundPhoto(picked.id).catch(() => {}) }
}

// Profile, group and channel photos keep the resumable upload pipeline in main;
// the user makes one choice and upload → apply → cleanup follow without prompts.
export async function changeProfilePhoto(accountUid: string): Promise<void> {
  const state = desktop.value?.selfProfile, profile = state?.status === 'ready' ? state.profile : null
  if (!state || !profile) throw new Error(tr('프로필을 불러온 뒤 다시 시도해 주세요.'))
  const upload = state.photoUpload
  if (upload.busy || upload.status === 'loading') throw new Error(tr('진행 중인 사진 작업을 마친 뒤 다시 시도해 주세요.'))
  if (upload.status === 'error') throw new Error(upload.message || tr('사진 기록을 확인하지 못했습니다. 앱을 다시 열어 주세요.'))
  if (upload.status === 'committing') throw new Error(tr('이전 사진 적용 결과를 확인하고 있습니다. 앱을 다시 열어 프로필을 확인해 주세요.'))
  if (upload.id && (upload.status === 'upload' || upload.status === 'ready')) await window.morse.profilePhotoUploadAction(accountUid, { id: upload.id, action: 'discard', version: profile.version })
  const picked = await window.morse.pickProfilePhoto(accountUid, profile.version)
  if (!picked || !await prepare(picked, tr('프로필 사진'), 'square', bytes => window.morse.queueProfilePhoto(accountUid, profile.version, picked.id, bytes))) return
  controller.toast(tr('프로필 사진을 올리고 있습니다…'))
  try {
    await trackWrite(window.morse.profilePhotoUploadAction(accountUid, { id: picked.id, action: 'upload', version: profile.version }))
    const version = desktop.value?.selfProfile?.profile?.version ?? profile.version
    await trackWrite(window.morse.profilePhotoUploadAction(accountUid, { id: picked.id, action: 'apply', version }))
  } catch (error) {
    // An uncertain apply keeps its committing receipt; only unsent records are closed.
    const settled = await waitFor(() => { const current = desktop.value?.selfProfile?.photoUpload; return current && !current.busy ? current : null }, 3000).catch(() => null)
    if (settled?.id === picked.id && (settled.status === 'upload' || settled.status === 'ready')) {
      await window.morse.profilePhotoUploadAction(accountUid, { id: picked.id, action: 'discard', version: desktop.value?.selfProfile?.profile?.version ?? profile.version }).catch(() => {})
    }
    throw error
  }
  controller.toast(tr('프로필 사진을 바꿨습니다.'))
}

type Stage = 'upload' | 'ready' | 'committing' | 'confirmed' | 'rejected'
interface UploadSnapshot { status: 'loading' | 'ready' | 'error'; busy: boolean; message: string; pending: { id: string; stage: Stage } | null; current: { version: string } | null }
interface UploadPipeline {
  snapshot(): UploadSnapshot | null
  action(request: { id: string; stage: Stage; action: 'upload' | 'apply' | 'check' | 'discard'; version?: string }): Promise<void>
  pick(): Promise<{ id: string; bytes: Uint8Array } | null>
  queue(id: string, bytes: Uint8Array): Promise<void>
}

// Group and channel photo records share stages: upload → ready → committing → confirmed | rejected.
async function replacePhoto(pipeline: UploadPipeline, label: string, shape: 'square' | 'cover'): Promise<void> {
  const state = pipeline.snapshot()
  if (!state || state.status !== 'ready' || state.busy) throw new Error(state?.message || tr('사진 기록을 확인한 뒤 다시 시도해 주세요.'))
  const previous = state.pending
  if (previous?.stage === 'committing') throw new Error(tr('이전 {0} 적용 결과를 확인해야 합니다. 잠시 후 다시 시도해 주세요.', [label]))
  if (previous) await pipeline.action({ id: previous.id, stage: previous.stage, action: 'discard' })
  const picked = await pipeline.pick()
  if (!picked || !await prepare(picked, label, shape, bytes => pipeline.queue(picked.id, bytes))) return
  const settled = () => { const current = pipeline.snapshot(); return current && !current.busy && current.pending?.id === picked.id ? current : null }
  controller.toast(tr('{0}을 올리고 있습니다…', [label]))
  try {
    await trackWrite(pipeline.action({ id: picked.id, stage: 'upload', action: 'upload' }))
    const current = await waitFor(() => { const value = settled(); return value?.pending?.stage === 'ready' && value.current ? value.current : null }, 5000, tr('최신 정보를 확인하지 못했습니다.'))
    await trackWrite(pipeline.action({ id: picked.id, stage: 'ready', action: 'apply', version: current.version }))
  } catch (error) {
    const stage = (await waitFor(settled, 3000).catch(() => null))?.pending?.stage
    if (stage === 'upload' || stage === 'ready') await pipeline.action({ id: picked.id, stage, action: 'discard' }).catch(() => {})
    throw error
  }
  const stage = (await waitFor(settled, 5000).catch(() => null))?.pending?.stage
  if (stage === 'confirmed' || stage === 'rejected') await pipeline.action({ id: picked.id, stage, action: 'discard' }).catch(() => {})
  if (stage === 'rejected') throw new Error(tr('{0}을 적용하지 못했습니다. 최신 정보에서 다시 시도해 주세요.', [label]))
  controller.toast(stage === 'confirmed' ? tr('{0}을 바꿨습니다.', [label]) : tr('{0}이 적용되었을 수 있습니다. 잠시 후 확인해 주세요.', [label]))
}

export function changeGroupPhoto(accountUid: string, binding: GroupPhotoBinding): Promise<void> {
  return replacePhoto({
    snapshot: () => desktop.value?.groupPhotoUpload ?? null,
    action: request => window.morse.groupPhotoUploadAction(accountUid, request),
    pick: () => window.morse.pickGroupPhoto(accountUid, binding),
    queue: (id, bytes) => window.morse.queueGroupPhoto(accountUid, { id, ...binding }, bytes)
  }, tr('그룹 사진'), 'square')
}

export function changeChannelPhoto(accountUid: string, binding: ChannelPhotoBinding): Promise<void> {
  return replacePhoto({
    snapshot: () => desktop.value?.channelPhotoUpload ?? null,
    action: request => window.morse.channelPhotoUploadAction(accountUid, request),
    pick: () => window.morse.pickChannelPhoto(accountUid, binding),
    queue: (id, bytes) => window.morse.queueChannelPhoto(accountUid, { id, ...binding }, bytes)
  }, binding.kind === 'cover' ? tr('채널 커버') : tr('채널 사진'), binding.kind === 'cover' ? 'cover' : 'square')
}
