import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Film, Globe, Image as ImageIcon, ImagePlus, Star, Users, Volume2, X } from 'lucide-react'
import { storyPrivacyNames, type StoryPrivacy } from '../../../shared/own-stories'
import type { StoryComposerDraftContent } from '../../../shared/story-composer-drafts'
import type { StoryComposerPhotoPair } from '../../../shared/story-composer-photo'
import type { StoryVideoCandidate } from '../../../shared/story-composer-video'
import type { StoryAudioCandidate } from '../../../shared/story-composer-audio'
import { backgroundImageInfo, maxBackgroundPhotoBytes } from '../../../shared/background-photo-bytes'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { duration as formatDuration, errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { waitFor } from '../app/contacts'
import { offerRecovery, SilentError } from '../app/channel-publish'
import { Spinner, TextField } from '../ui/controls'
import { Box } from '../ui/layers'
import { prepareStoryComposerPhoto } from '../photos/prepare-story-composer-photo'
import { withoutMetadata } from '../photos/jpeg-metadata'
import { tr } from '../../../shared/i18n'

const privacies: StoryPrivacy[] = ['everyone', 'contacts', 'closeFriends']
const privacyIcons: Record<StoryPrivacy, ReactNode> = { everyone: <Globe size={16} />, contacts: <Users size={16} />, closeFriends: <Star size={16} /> }
const waiting = tr('이전 스토리의 게시 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.')

type Media = { kind: 'photo'; preview: string } | { kind: 'video'; preview: string; duration: number }

function dataURL(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(tr('사진을 표시하지 못했습니다.')))
    reader.onerror = () => reject(new Error(tr('사진을 표시하지 못했습니다.')))
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
  })
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const timer = setTimeout(() => { cleanup(); reject(new Error(tr('소리 길이를 제한 시간 안에 확인하지 못했습니다.'))) }, 30000)
    const cleanup = (): void => { clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute('src'); audio.load() }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => { const value = audio.duration; cleanup(); Number.isFinite(value) ? resolve(value) : reject(new Error(tr('소리 길이를 확인하지 못했습니다.'))) }
    audio.onerror = () => { cleanup(); reject(new Error(tr('선택한 소리 파일을 읽지 못했습니다.'))) }
    audio.src = url
  })
}

// The first frame becomes the story poster (at most 360px), as the old composer did.
function videoPoster(url: string, candidate: StoryVideoCandidate): Promise<{ bytes: Uint8Array; width: number; height: number; duration: number; frameTime: number; preview: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const timer = setTimeout(() => fail(tr('영상의 첫 장면을 제한 시간 안에 읽지 못했습니다.')), 30000)
    let settled = false
    const cleanup = (): void => { clearTimeout(timer); video.onloadeddata = null; video.onerror = null; video.removeAttribute('src'); video.load() }
    const fail = (message: string): void => { if (settled) return; settled = true; cleanup(); reject(new Error(message)) }
    video.muted = true; video.preload = 'auto'; video.playsInline = true; video.disableRemotePlayback = true
    video.onerror = () => fail(tr('이 영상을 읽지 못했습니다. 다른 MP4 영상을 선택해 주세요.'))
    video.onloadeddata = () => {
      void (async () => {
        if (video.duration !== candidate.declaredDuration || video.videoWidth !== candidate.trackWidth || video.videoHeight !== candidate.trackHeight) { fail(tr('영상 정보가 파일 기록과 달라 사용할 수 없습니다.')); return }
        const width = video.videoWidth, height = video.videoHeight, ratio = Math.min(1, 360 / Math.max(width, height))
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)))
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) { fail(tr('영상 표지를 만들지 못했습니다.')); return }
        context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .75 })
        canvas.width = 1; canvas.height = 1
        if (blob.type !== 'image/jpeg' || blob.size > maxBackgroundPhotoBytes) { fail(tr('영상 표지를 만들지 못했습니다.')); return }
        const raw = new Uint8Array(await blob.arrayBuffer()), bytes = withoutMetadata(raw)
        if (bytes !== raw) raw.fill(0)
        backgroundImageInfo(bytes, true)
        const preview = await dataURL(bytes)
        if (settled) { bytes.fill(0); return }
        settled = true
        const frameTime = video.currentTime, duration = video.duration
        cleanup()
        resolve({ bytes, width, height, duration, frameTime, preview })
      })().catch(() => fail(tr('영상 표지를 만들지 못했습니다.')))
    }
    video.src = url
  })
}

// The durable publication record: prepare → upload → publish → close. Nothing is
// on the server before "publish", so earlier failures close the record; an
// uncertain publish keeps it and is never sent again automatically.
async function publishStory(accountUid: string, request: { draftId: string; draftRevision: string; photoRevision: string; audioRevision?: string }): Promise<'done' | 'unconfirmed'> {
  const snapshot = () => desktop.value?.storyPublication ?? null
  const idle = () => { const value = snapshot(); return value && value.status !== 'loading' && !value.busy ? value : null }
  const initial = snapshot()
  if (!initial || (initial.status === 'loading' && !initial.busy)) await window.morse.refreshStoryPublication(accountUid).catch(() => {})
  let state = await waitFor(idle, 10000, waiting)
  if (state.status === 'error') { await window.morse.refreshStoryPublication(accountUid); state = await waitFor(idle, 10000, waiting) }
  if (state.status !== 'ready') throw new Error(state.message || waiting)
  const previous = state.pending
  if (previous?.state === 'submitted') {
    offerRecovery(`story-photo:${previous.id}`, async () => {
      await window.morse.storyPublicationAction(accountUid, { id: previous.id, state: 'submitted', action: 'check' })
      return await waitFor(() => { const value = idle(); return value?.observation ? value.observation.message : null }, 5000).catch(() => null)
    }, () => window.morse.storyPublicationAction(accountUid, { id: previous.id, state: 'submitted', action: 'dismiss' }))
    throw new SilentError()
  }
  if (previous) await trackWrite(window.morse.storyPublicationAction(accountUid, { id: previous.id, state: previous.state, action: 'dismiss' }))
  const id = crypto.randomUUID()
  await trackWrite(window.morse.prepareStoryPublication(accountUid, { id, ...request }))
  const record = () => { const value = idle(); return value?.pending?.id === id ? value.pending : null }
  const unsent = async (): Promise<void> => {
    const current = await waitFor(record, 3000).catch(() => null)
    if (current && (current.state === 'prepared' || current.state === 'uploading' || current.state === 'uploaded')) {
      await window.morse.storyPublicationAction(accountUid, { id, state: current.state, action: 'dismiss' }).catch(() => {})
    }
  }
  try {
    await waitFor(() => record()?.state === 'prepared' ? true : null, 5000, tr('게시 준비를 확인하지 못했습니다.'))
    await trackWrite(window.morse.storyPublicationAction(accountUid, { id, state: 'prepared', action: 'upload' }))
    await waitFor(() => record()?.state === 'uploaded' ? true : null, 5000, tr('사진 업로드를 확인하지 못했습니다.'))
  } catch (error) { await unsent(); throw error }
  try { await trackWrite(window.morse.storyPublicationAction(accountUid, { id, state: 'uploaded', action: 'publish' })) }
  catch (error) {
    const current = await waitFor(record, 3000).catch(() => null)
    if (current?.state === 'submitted') return 'unconfirmed'
    await unsent(); throw error
  }
  const outcome = await waitFor(() => { const value = record(); return value && value.state !== 'uploaded' ? value.state : null }, 5000).catch(() => null)
  if (outcome === 'confirmed' || outcome === 'rejected') await window.morse.storyPublicationAction(accountUid, { id, state: outcome, action: 'dismiss' }).catch(() => {})
  if (outcome === 'rejected') throw new Error(tr('스토리를 올리지 못했습니다. 연결을 확인해 주세요.'))
  return outcome === 'confirmed' ? 'done' : 'unconfirmed'
}

// The video publication record follows the same steps; each call returns the record.
async function publishVideoStory(accountUid: string, request: { draftId: string; draftRevision: string; videoRevision: string; audioRevision?: string }, onPhase?: (phase: 'upload' | 'publish') => void): Promise<'done' | 'unconfirmed'> {
  const previous = await window.morse.readStoryVideoPublication(accountUid)
  if (previous?.state === 'submitted') {
    offerRecovery(`story-video:${previous.id}`, async () => (await window.morse.checkStoryVideoPublication(accountUid, { id: previous.id, state: 'submitted' })).message,
      () => window.morse.dismissStoryVideoPublication(accountUid, previous.id))
    throw new SilentError()
  }
  if (previous) await trackWrite(window.morse.dismissStoryVideoPublication(accountUid, previous.id))
  const id = crypto.randomUUID()
  const prepared = await trackWrite(window.morse.prepareStoryVideoPublication(accountUid, { id, ...request }))
  if (prepared?.id !== id || prepared.state !== 'prepared') throw new Error(tr('게시 준비를 확인하지 못했습니다.'))
  const unsent = async (): Promise<void> => {
    const current = await window.morse.readStoryVideoPublication(accountUid).catch(() => null)
    if (current?.id === id && (current.state === 'prepared' || current.state === 'uploading' || current.state === 'uploaded')) await window.morse.dismissStoryVideoPublication(accountUid, id).catch(() => {})
  }
  try {
    onPhase?.('upload')
    const uploaded = await trackWrite(window.morse.uploadStoryVideoPublication(accountUid, { id, state: 'prepared' }))
    if (uploaded.id !== id || uploaded.state !== 'uploaded') throw new Error(tr('영상 업로드를 확인하지 못했습니다.'))
  } catch (error) { await unsent(); throw error }
  let result: Awaited<ReturnType<typeof window.morse.publishStoryVideoPublication>>
  onPhase?.('publish')
  try { result = await trackWrite(window.morse.publishStoryVideoPublication(accountUid, { id, state: 'uploaded' })) }
  catch (error) {
    const current = await window.morse.readStoryVideoPublication(accountUid).catch(() => null)
    if (current?.id === id && current.state === 'submitted') return 'unconfirmed'
    if (current?.id === id && (current.state === 'confirmed' || current.state === 'rejected')) await window.morse.dismissStoryVideoPublication(accountUid, id).catch(() => {})
    else await unsent()
    throw error
  }
  if (result.state === 'confirmed' || result.state === 'rejected') await window.morse.dismissStoryVideoPublication(accountUid, id).catch(() => {})
  if (result.state === 'rejected') throw new Error(tr('스토리를 올리지 못했습니다. 연결을 확인해 주세요.'))
  return result.state === 'confirmed' ? 'done' : 'unconfirmed'
}

// Telegram's story composer: one photo or video, an optional sound, a caption and the audience.
function StoryComposer({ accountUid, close, onPublished }: { accountUid: string; close(): void; onPublished?: () => void }) {
  const [draftId] = useState(() => crypto.randomUUID())
  const [caption, setCaption] = useState(''), [privacy, setPrivacy] = useState<StoryPrivacy>('contacts')
  const [media, setMedia] = useState<Media | null>(null), [sound, setSound] = useState<number | null>(null)
  const [busy, setBusy] = useState<'photo' | 'video' | 'audio' | 'publish' | null>(null), [error, setError] = useState('')
  const draftRevision = useRef<string | null>(null), published = useRef(false)
  // Only the file upload can be stopped; nothing is on the server before publishing.
  const [uploading, setUploading] = useState(false)
  const progress = useDesktop(state => state?.storyPublication?.busy ? state.storyPublication.progress : null)
  const target = { id: draftId }

  // A story that was not published leaves no device draft or media behind.
  useEffect(() => () => {
    const expected = draftRevision.current
    if (published.current || !expected) return
    void trackWrite(window.morse.saveStoryComposerDraft(accountUid, { id: draftId, draft: null, expected, revision: crypto.randomUUID() })).catch(() => {})
  }, [])

  async function saveDraft(content: StoryComposerDraftContent): Promise<string> {
    const revision = crypto.randomUUID()
    const record = await trackWrite(window.morse.saveStoryComposerDraft(accountUid, { id: draftId, draft: content, expected: draftRevision.current, revision }))
    draftRevision.current = record.revision
    if (record.revision !== revision) throw new Error(tr('초안을 저장하지 못했습니다.'))
    return revision
  }
  // A draft holds a photo or a video; the saved video goes before a new photo.
  async function clearVideo(revision: string): Promise<void> {
    const [video, photo] = await Promise.all([window.morse.readStoryComposerVideo(accountUid, target), window.morse.readStoryComposerPhoto(accountUid, target)])
    if (!video.video) return
    const next = crypto.randomUUID()
    const record = await trackWrite(window.morse.saveStoryComposerVideo(accountUid, { id: draftId, draftRevision: revision, expected: video.revision, expectedPhoto: photo.revision, revision: next, media: null }))
    if (record.revision !== next || record.video) throw new Error(tr('이전에 고른 영상을 비우지 못했습니다.'))
  }
  async function pickPhoto(): Promise<void> {
    if (busy) return
    setBusy('photo'); setError('')
    let raw: { id: string; bytes: Uint8Array } | null = null, pair: StoryComposerPhotoPair | null = null
    try {
      const revision = await saveDraft({ caption, privacy, hiddenFrom: [] })
      raw = await window.morse.pickStoryComposerPhoto(accountUid, { id: draftId, draftRevision: revision })
      if (!raw) return
      pair = await prepareStoryComposerPhoto(raw.bytes, new AbortController().signal)
      const url = await dataURL(pair.full), next = crypto.randomUUID()
      if (media?.kind === 'video') await clearVideo(revision)
      const current = await window.morse.readStoryComposerPhoto(accountUid, target)
      const record = await trackWrite(window.morse.saveStoryComposerPhoto(accountUid, { id: draftId, draftRevision: revision, expected: current.revision, revision: next, sourceId: raw.id }, pair.full, pair.thumbnail))
      if (record.revision !== next || !record.photo) throw new Error(tr('사진을 저장하지 못했습니다.'))
      setMedia({ kind: 'photo', preview: url })
    } catch (reason) { setError(errorText(reason, tr('사진을 준비하지 못했습니다.'))) }
    finally {
      raw?.bytes.fill(0); pair?.full.fill(0); pair?.thumbnail.fill(0)
      if (raw) void window.morse.releaseBackgroundPhoto(raw.id).catch(() => {})
      setBusy(null)
    }
  }
  async function pickVideo(): Promise<void> {
    if (busy) return
    setBusy('video'); setError('')
    let candidate: StoryVideoCandidate | null = null, poster: Uint8Array | null = null
    try {
      const revision = await saveDraft({ caption, privacy, hiddenFrom: [] })
      candidate = await window.morse.pickStoryComposerVideo(accountUid, { id: draftId, draftRevision: revision })
      if (!candidate) return
      const source = { id: draftId, draftRevision: revision, sourceId: candidate.id }
      const frame = await videoPoster(await window.morse.previewStoryComposerVideo(accountUid, source), candidate)
      poster = frame.bytes
      const prepared = await window.morse.prepareStoryVideoPoster(accountUid, { ...source, posterId: crypto.randomUUID(), duration: frame.duration, width: frame.width, height: frame.height, frameTime: frame.frameTime }, frame.bytes)
      const [video, photo] = await Promise.all([window.morse.readStoryComposerVideo(accountUid, target), window.morse.readStoryComposerPhoto(accountUid, target)])
      const next = crypto.randomUUID()
      const record = await trackWrite(window.morse.saveStoryComposerVideo(accountUid, { id: draftId, draftRevision: revision, expected: video.revision, expectedPhoto: photo.revision, revision: next, media: { sourceId: candidate.id, posterId: prepared.posterId } }))
      if (record.revision !== next || !record.video) throw new Error(tr('영상을 저장하지 못했습니다.'))
      setMedia({ kind: 'video', preview: frame.preview, duration: record.video.declaredDuration })
    } catch (reason) { setError(errorText(reason, tr('영상을 준비하지 못했습니다.'))) }
    finally {
      poster?.fill(0)
      if (candidate) void window.morse.releaseStoryComposerVideo(candidate.id).catch(() => {})
      setBusy(null)
    }
  }
  async function pickSound(): Promise<void> {
    if (busy) return
    setBusy('audio'); setError('')
    let candidate: StoryAudioCandidate | null = null
    try {
      const revision = await saveDraft({ caption, privacy, hiddenFrom: [] })
      candidate = await window.morse.pickStoryComposerAudio(accountUid, { id: draftId, draftRevision: revision })
      if (!candidate) return
      const source = { id: draftId, draftRevision: revision, sourceId: candidate.id }
      const length = await audioDuration(await window.morse.previewStoryComposerAudio(accountUid, source))
      if (length !== candidate.declaredDuration) throw new Error(tr('소리 길이가 파일 기록과 달라 사용할 수 없습니다.'))
      const ready = await window.morse.confirmStoryComposerAudio(accountUid, { ...source, duration: length })
      if (ready.sourceId !== candidate.id || ready.sha256 !== candidate.sha256) throw new Error(tr('소리를 준비하지 못했습니다.'))
      const current = await window.morse.readStoryComposerAudio(accountUid, target), next = crypto.randomUUID()
      const record = await trackWrite(window.morse.saveStoryComposerAudio(accountUid, { id: draftId, draftRevision: revision, expected: current.revision, revision: next, sourceId: candidate.id }))
      if (record.revision !== next || !record.audio) throw new Error(tr('소리를 저장하지 못했습니다.'))
      setSound(record.audio.declaredDuration)
    } catch (reason) { setError(errorText(reason, tr('소리를 준비하지 못했습니다.'))) }
    finally {
      if (candidate) void window.morse.releaseStoryComposerAudio(candidate.id).catch(() => {})
      setBusy(null)
    }
  }
  async function removeSound(): Promise<void> {
    if (busy || !draftRevision.current) return
    setBusy('audio'); setError('')
    try {
      const current = await window.morse.readStoryComposerAudio(accountUid, target), next = crypto.randomUUID()
      const record = await trackWrite(window.morse.saveStoryComposerAudio(accountUid, { id: draftId, draftRevision: draftRevision.current, expected: current.revision, revision: next, sourceId: null }))
      if (record.revision !== next || record.audio) throw new Error(tr('소리를 빼지 못했습니다.'))
      setSound(null)
    } catch (reason) { setError(errorText(reason, tr('소리를 빼지 못했습니다.'))) }
    finally { setBusy(null) }
  }
  async function publish(): Promise<void> {
    if (busy || !media) return
    setBusy('publish'); setError('')
    try {
      const revision = await saveDraft({ caption, privacy, hiddenFrom: [] })
      const audio = await window.morse.readStoryComposerAudio(accountUid, target)
      const withAudio = audio.audio && audio.revision ? { audioRevision: audio.revision } : {}
      let result: 'done' | 'unconfirmed'
      if (media.kind === 'video') {
        const video = await window.morse.readStoryComposerVideo(accountUid, target)
        if (!video.video || !video.revision) throw new Error(tr('영상을 다시 선택해 주세요.'))
        result = await publishVideoStory(accountUid, { draftId, draftRevision: revision, videoRevision: video.revision, ...withAudio }, phase => setUploading(phase === 'upload'))
      } else {
        const photo = await window.morse.readStoryComposerPhoto(accountUid, target)
        if (!photo.photo || !photo.revision) throw new Error(tr('사진을 다시 선택해 주세요.'))
        result = await publishStory(accountUid, { draftId, draftRevision: revision, photoRevision: photo.revision, ...withAudio })
      }
      published.current = true
      close()
      controller.toast(result === 'done' ? tr('스토리를 올렸습니다.') : tr('스토리 게시 결과를 확인하고 있습니다. 잠시 후 내 스토리를 확인해 주세요.'))
      onPublished?.()
    } catch (reason) { setError(errorText(reason, tr('스토리를 올리지 못했습니다.'))); setBusy(null); setUploading(false) }
  }
  return <Box title={tr('새 스토리')} width={420} buttons={<>
    {uploading ? <button className="button flat" onClick={() => { void window.morse.pauseStoryVideoUpload(accountUid).catch(() => {}) }}>{tr('업로드 중단')}</button>
      : <button className="button flat" disabled={Boolean(busy)} onClick={close}>{tr('취소')}</button>}
    <button className="button flat" disabled={Boolean(busy) || !media} onClick={() => { void publish() }}>{busy === 'publish' && <Spinner size={14} />}{tr('올리기')}</button>
  </>}>
    <div className="story-compose-photo">
      {media ? <span className="story-compose-preview">
        <img src={media.preview} alt={media.kind === 'video' ? tr('올릴 영상의 표지') : tr('올릴 사진')} />
        {media.kind === 'video' && <span className="story-compose-badge"><Film size={14} />{formatDuration(media.duration)}</span>}
      </span> : <span className="story-compose-empty"><ImagePlus size={32} />{tr('사진이나 영상을 선택해 주세요')}</span>}
      <div className="story-compose-media-actions">
        <button className="button secondary" disabled={Boolean(busy)} onClick={() => { void pickPhoto() }}>{busy === 'photo' ? <Spinner size={14} /> : <ImageIcon size={16} />}{media?.kind === 'photo' ? tr('다른 사진') : tr('사진')}</button>
        <button className="button secondary" disabled={Boolean(busy)} onClick={() => { void pickVideo() }}>{busy === 'video' ? <Spinner size={14} /> : <Film size={16} />}{media?.kind === 'video' ? tr('다른 영상') : tr('영상')}</button>
        {sound === null && <button className="button secondary" disabled={Boolean(busy) || !media} onClick={() => { void pickSound() }}>{busy === 'audio' ? <Spinner size={14} /> : <Volume2 size={16} />}{tr('소리 추가')}</button>}
      </div>
      {sound !== null && <div className="story-compose-sound">
        <Volume2 size={16} /><span>{tr('소리 {0}', [formatDuration(sound)])}</span>
        <button className="icon-button small" aria-label={tr('소리 빼기')} disabled={Boolean(busy)} onClick={() => { void removeSound() }}>{busy === 'audio' ? <Spinner size={14} /> : <X size={16} />}</button>
      </div>}
      <p className="box-note">{tr('영상은 0.5~60초 MP4(50MB 미만), 소리는 WAV(15MB 미만) 파일을 사용할 수 있습니다.')}</p>
    </div>
    <TextField label={tr('설명 (선택)')} value={caption} onChange={setCaption} maxLength={2000} multiline rows={3} counter disabled={Boolean(busy)} />
    <div className="story-compose-privacy" role="radiogroup" aria-label={tr('공개 범위')}>
      {privacies.map(value => <button key={value} type="button" role="radio" aria-checked={privacy === value} className={`story-compose-option${privacy === value ? ' active' : ''}`} disabled={Boolean(busy)} onClick={() => setPrivacy(value)}>{privacyIcons[value]}{storyPrivacyNames[value]}</button>)}
    </div>
    {busy === 'publish' && <p className="box-note">{media?.kind === 'photo' && progress !== null ? tr('사진을 올리는 중… {0}%', [Math.round(progress * 100)]) : tr('스토리를 올리는 중…')}</p>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showStoryComposer(accountUid: string, onPublished?: () => void): void {
  controller.showLayer(close => <StoryComposer accountUid={accountUid} close={close} onPublished={onPublished} />, { dismissible: false })
}
