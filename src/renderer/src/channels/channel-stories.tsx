import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Eye, Film, Image as ImageIcon, Pause, Play, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { channelStoryPhotoSide, channelStoryReactions, channelStoryThumbnailSide, maxChannelStoryCaption, type ChannelStory } from '../../../shared/channel-stories'
import type { GroupPhotoImage } from '../../../shared/group-photo'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { useShortcut } from '../app/shortcuts'
import { PeerAvatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { storyAgo, storyPhotoDuration, usePageHidden, useStoryProgress } from '../stories/story-viewer'
import { readVideoFacts } from '../media/video-facts'
import { tr } from '../../../shared/i18n'

// iOS ChannelFeedView channel stories: a ring on the channel's picture (StoryRingView, a stronger ring while
// something is unseen), a press on the picture opens StoryViewerView over the channel's stories, and the owner
// posts from the «+» menu (StoryComposerView ownerType .channel).
export interface StoryChannel { id: string; name: string; avatar: GroupPhotoImage | null }

export function useChannelStoryVisibility(accountUid: string, channelIds: string[]): void {
  const key = channelIds.join(',')
  useEffect(() => {
    void window.morse.setVisibleChannelStories(accountUid, key ? key.split(',') : []).catch(() => {})
    const visible = (): void => { if (!document.hidden) void window.morse.setVisibleChannelStories(accountUid, key ? key.split(',') : []).catch(() => {}) }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [accountUid, key])
}

export function ChannelStoryRing({ accountUid, channel, owned, size, onOpen, label }: { accountUid: string; channel: StoryChannel; owned: boolean; size: number; onOpen(): void; label?: string }) {
  const list = useDesktop(state => state?.channelStories?.[channel.id] ?? null)
  const avatar = <PeerAvatar id={channel.id} name={channel.name || tr('채널')} image={channel.avatar} size={size} kind="channel" surface="channels" />
  if (!list) return <button type="button" className="channel-story-avatar" aria-label={label ?? channel.name} onClick={onOpen}>{avatar}</button>
  return <button type="button" className={`channel-story-avatar has-stories${list.unread ? ' unread' : ''}`}
    aria-label={tr('{0} 스토리{1}', [channel.name, list.unread ? tr(', 새 스토리 있음') : ''])} onClick={() => showChannelStoryViewer(accountUid, channel, owned, onOpen)}>
    <span className="channel-story-ring">{avatar}</span>
  </button>
}

function StoryMedia({ accountUid, channelId, story, paused, muted, onDuration, onTime, onEnded, onShown }: {
  accountUid: string; channelId: string; story: ChannelStory; paused: boolean; muted: boolean
  onDuration(milliseconds: number): void; onTime(fraction: number): void; onEnded(): void; onShown(): void
}) {
  const [media, setMedia] = useState<{ url: string; audioUrl: string | null } | null>(null)
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement | null>(null), audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    let alive = true
    setMedia(null); setError('')
    void window.morse.channelStoryMedia(accountUid, channelId, story.id).then(value => { if (alive) setMedia(value) })
      .catch(reason => { if (alive) { setError(errorText(reason, tr('스토리를 불러오지 못했습니다.'))); onDuration(storyPhotoDuration) } })
    return () => { alive = false; video.current?.pause(); audio.current?.pause() }
  }, [accountUid, channelId, story.id])
  useEffect(() => {
    for (const player of [video.current, audio.current]) {
      if (!player) continue
      if (paused) player.pause(); else void player.play().catch(() => {})
    }
  }, [paused, media])
  if (error) return <div className="media-viewer-loading" role="alert"><p>{error}</p></div>
  if (!media) return <div className="media-viewer-loading" role="status"><Spinner size={30} /></div>
  if (story.mediaType === 'video') return <video ref={element => { video.current = element }} src={media.url} autoPlay playsInline muted={muted} controlsList="nodownload noremoteplayback" disablePictureInPicture
    onLoadedMetadata={event => { const duration = event.currentTarget.duration; onDuration(Number.isFinite(duration) && duration > 0 ? duration * 1000 : storyPhotoDuration); onShown() }}
    onTimeUpdate={event => { const element = event.currentTarget; if (element.duration > 0) onTime(element.currentTime / element.duration) }}
    onEnded={onEnded} onError={() => setError(tr('이 동영상은 재생할 수 없습니다.'))} />
  return <>
    <img src={media.url} alt={tr('스토리')} draggable={false} onLoad={() => { if (!media.audioUrl) onDuration(storyPhotoDuration); onShown() }} onError={() => setError(tr('사진을 표시하지 못했습니다.'))} />
    {media.audioUrl && <audio ref={element => { audio.current = element }} src={media.audioUrl} autoPlay muted={muted}
      onLoadedMetadata={event => { const duration = event.currentTarget.duration; onDuration(Number.isFinite(duration) && duration > 0 ? Math.min(60000, duration * 1000) : storyPhotoDuration) }} />}
  </>
}

function ChannelStoryViewer({ accountUid, channel, owned, close }: { accountUid: string; channel: StoryChannel; owned: boolean; close(): void }) {
  const list = useDesktop(state => state?.channelStories?.[channel.id] ?? null)
  // The stories as they were when the viewer opened; a reaction or a receipt only updates each one in place.
  const [ids] = useState(() => list?.stories.map(story => story.id) ?? [])
  const [index, setIndex] = useState(() => Math.max(0, list?.stories.findIndex(story => !story.viewed) ?? 0))
  const [duration, setDuration] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(false)
  const [busy, setBusy] = useState(false)
  const hidden = usePageHidden()
  const story = list?.stories.find(item => item.id === ids[index]) ?? null
  const video = story?.mediaType === 'video'
  const next = (): void => { if (index + 1 < ids.length) { setIndex(index + 1); setDuration(null) } else close() }
  const previous = (): void => { if (index > 0) { setIndex(index - 1); setDuration(null) } }
  const { progress, setProgress } = useStoryProgress(story?.id ?? null, duration, paused || hidden || busy, !video, next)
  useEffect(() => { if (!story && ids.length) close() }, [story, ids.length])
  useShortcut(130, command => {
    if (command === 'back') { close(); return true }
    return false
  })
  async function react(emoji: string): Promise<void> {
    if (!story || busy) return
    try { await window.morse.reactToChannelStory(accountUid, channel.id, story.id, emoji) }
    catch (reason) { controller.toast(errorText(reason, tr('반응을 남기지 못했습니다.')), 'error') }
  }
  async function remove(): Promise<void> {
    if (!story || busy) return
    setPaused(true)
    if (!await confirmBox({ title: tr('스토리 삭제'), text: tr('이 채널 스토리를 삭제할까요?'), confirm: tr('삭제'), danger: true })) { setPaused(false); return }
    setBusy(true)
    try { await window.morse.removeChannelStory(accountUid, channel.id, story.id); controller.toast(tr('스토리를 삭제했습니다.')); close() }
    catch (reason) { controller.toast(errorText(reason, tr('스토리를 삭제하지 못했습니다.')), 'error'); setBusy(false); setPaused(false) }
  }
  return <div className="story-viewer" role="dialog" aria-modal="true" aria-label={tr('채널 스토리')} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); previous() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); next() }
      else if (event.key === ' ' && event.target === event.currentTarget) { event.preventDefault(); setPaused(value => !value) }
    }}>
    <button className="media-viewer-button story-close" aria-label={tr('닫기')} data-autofocus onClick={close}><X size={22} /></button>
    <button className={`story-nav${index > 0 ? '' : ' hidden'}`} aria-label={tr('이전 스토리')} onClick={previous}><ChevronLeft size={32} /></button>
    <div className="story-frame">
      <div className="story-progress">{ids.map((id, position) => <span key={id}><i style={{ width: `${position < index ? 100 : position === index ? progress * 100 : 0}%` }} /></span>)}</div>
      <header className="story-header">
        <PeerAvatar id={channel.id} name={channel.name || tr('채널')} image={channel.avatar} size={32} kind="channel" surface="channels" />
        <span><strong className="ellipsis">{channel.name}</strong>{story && <small>{storyAgo(story.createdAt)}</small>}</span>
        <button className="icon-button small" aria-label={paused ? tr('재생') : tr('일시 정지')} onClick={() => setPaused(value => !value)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        {(video || story?.audio) && <button className="icon-button small" aria-label={muted ? tr('소리 켜기') : tr('소리 끄기')} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
        {owned && story && <button className="icon-button small" aria-label={tr('스토리 삭제')} disabled={busy} onClick={() => { void remove() }}><Trash2 size={18} /></button>}
      </header>
      <div className="story-stage">
        {story ? <StoryMedia key={story.id} accountUid={accountUid} channelId={channel.id} story={story} paused={paused || hidden || busy} muted={muted}
          onDuration={setDuration} onTime={fraction => setProgress(fraction)} onEnded={next}
          onShown={() => { if (!story.viewed) void window.morse.markChannelStoryViewed(accountUid, channel.id, story.id).catch(() => {}) }} />
          : <div className="media-viewer-loading" role="status"><Spinner size={30} /></div>}
      </div>
      <button type="button" className="story-tap previous" aria-label={tr('이전')} tabIndex={-1} onClick={previous} />
      <button type="button" className="story-tap next" aria-label={tr('다음')} tabIndex={-1} onClick={next} />
      {story?.caption && <p className="story-caption selectable">{story.caption}</p>}
      {story && (owned
        ? <div className="story-reactions channel-story-owner"><Eye size={16} /><span>{tr('조회 {0}', [story.viewCount.toLocaleString()])}</span></div>
        : <div className="story-reactions" role="group" aria-label={tr('반응')}>
          {channelStoryReactions.map(choice => <button key={choice} type="button" className={story.reaction === choice ? 'selected' : undefined} aria-pressed={story.reaction === choice}
            aria-label={tr('{0} 반응', [choice])} onClick={() => { void react(choice) }}>{choice}</button>)}
        </div>)}
    </div>
    <button className="story-nav" aria-label={tr('다음 스토리')} onClick={next}><ChevronRight size={32} /></button>
  </div>
}

// ChannelFeedView.openSubscribedChannelAvatar: stories when there are some, the channel otherwise.
export function showChannelStoryViewer(accountUid: string, channel: StoryChannel, owned: boolean, fallback: () => void): void {
  if (!desktop.value?.channelStories?.[channel.id]?.stories.length) { fallback(); return }
  controller.showLayer(close => <ChannelStoryViewer accountUid={accountUid} channel={channel} owned={owned} close={close} />, { dismissible: false })
}

// StoryService.commitUpload's picture: the longer side at most 1080px as JPEG 0.82, and a 360px thumbnail at 0.75.
async function jpeg(source: CanvasImageSource, width: number, height: number, side: number, quality: number): Promise<Uint8Array> {
  const scale = Math.min(1, side / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')!
  context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error(tr('사진을 준비하지 못했습니다.'))
  return new Uint8Array(await blob.arrayBuffer())
}
async function posterOf(url: string): Promise<{ poster: Uint8Array; duration: number }> {
  const facts = await readVideoFacts(url)
  if (!facts) throw new Error(tr('이 동영상은 채널 스토리로 올릴 수 없습니다.'))
  const video = document.createElement('video')
  video.muted = true; video.preload = 'auto'; video.src = url
  try {
    await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error(tr('동영상을 불러오지 못했습니다.'))) })
    await new Promise<void>(resolve => { video.onseeked = () => resolve(); video.currentTime = Math.min(0.1, Math.max(0, facts.duration - 0.05)) })
    return { poster: await jpeg(video, video.videoWidth, video.videoHeight, channelStoryThumbnailSide, 0.75), duration: facts.duration }
  } finally { video.removeAttribute('src'); video.load() }
}

function ChannelStoryComposer({ accountUid, channel, close }: { accountUid: string; channel: StoryChannel; close(): void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ kind: 'image' | 'video'; url: string; file: File } | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url) }, [file])
  function pick(chosen: File | undefined): void {
    setError('')
    if (!chosen) return
    const kind = chosen.type.startsWith('image/') ? 'image' : chosen.type === 'video/mp4' || chosen.type === 'video/quicktime' ? 'video' : null
    if (!kind) { setError(tr('사진 또는 MP4·MOV 동영상을 선택해 주세요.')); return }
    // storage.rules: a video under 50 MB; a picture is made smaller before it goes out.
    if (kind === 'video' && chosen.size >= 50 * 1024 * 1024) { setError(tr('50 MB 미만의 동영상을 선택해 주세요.')); return }
    if (kind === 'image' && chosen.size >= 60 * 1024 * 1024) { setError(tr('사진이 너무 큽니다.')); return }
    setFile({ kind, url: URL.createObjectURL(chosen), file: chosen })
  }
  async function publish(): Promise<void> {
    if (!file || busy) return
    setBusy(true); setError('')
    let media: Uint8Array | null = null, thumbnail: Uint8Array | null = null
    try {
      let durationSeconds: number | null = null
      if (file.kind === 'image') {
        const bitmap = await createImageBitmap(file.file, { imageOrientation: 'from-image' })
        try {
          media = await jpeg(bitmap, bitmap.width, bitmap.height, channelStoryPhotoSide, 0.82)
          thumbnail = await jpeg(bitmap, bitmap.width, bitmap.height, channelStoryThumbnailSide, 0.75)
        } finally { bitmap.close() }
      } else {
        const prepared = await posterOf(file.url)
        media = new Uint8Array(await file.file.arrayBuffer()); thumbnail = prepared.poster; durationSeconds = prepared.duration
      }
      await window.morse.publishChannelStory(accountUid, { channelId: channel.id, caption: caption.trim(), kind: file.kind, media, thumbnail, durationSeconds })
      controller.toast(tr('채널 스토리를 올렸습니다.'))
      close()
    } catch (reason) { setError(errorText(reason, tr('채널 스토리를 올리지 못했습니다.'))) }
    finally { media?.fill(0); thumbnail?.fill(0); setBusy(false) }
  }
  const preview: ReactNode = !file ? <button type="button" className="channel-story-pick" disabled={busy} onClick={() => input.current?.click()}>
    <span><ImageIcon size={26} /><Film size={26} /></span>{tr('사진 또는 동영상 선택')}
  </button> : file.kind === 'image' ? <img src={file.url} alt="" /> : <video src={file.url} muted autoPlay loop playsInline />
  return <Box title={tr('{0} 채널 스토리', [channel.name])} width={380} onClose={busy ? undefined : close} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" data-autofocus disabled={busy || !file} onClick={() => { void publish() }}>{busy ? <Spinner size={14} /> : null}{tr('올리기')}</button>
  </>}>
    <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/heic,image/webp,video/mp4,video/quicktime" onChange={event => { pick(event.target.files?.[0]); event.target.value = '' }} />
    <div className="channel-story-preview">{preview}</div>
    {file && <button type="button" className="button flat" disabled={busy} onClick={() => input.current?.click()}>{tr('다른 파일 선택')}</button>}
    <label className="field"><span>{tr('설명')}</span><textarea rows={2} maxLength={maxChannelStoryCaption} value={caption} disabled={busy} placeholder={tr('설명 추가')} onChange={event => setCaption(event.target.value)} /></label>
    <p className="settings-note">{tr('채널 스토리는 24시간 동안 모든 사람에게 보여요.')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showChannelStoryComposer(accountUid: string, channel: StoryChannel): void {
  controller.showLayer(close => <ChannelStoryComposer accountUid={accountUid} channel={channel} close={close} />)
}
