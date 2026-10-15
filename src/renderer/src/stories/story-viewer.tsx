import { Link as LinkIcon } from 'lucide-react'
import { firstStoryCaptionLink } from '../../../shared/story-caption-link'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Flag, Pause, Play, Send, Volume2, VolumeX, X } from 'lucide-react'
import { showReportBox } from '../boxes/report-box'
import type { DesktopSnapshot } from '../../../shared/model'
import { storyReactions, type PeerStoryRow } from '../../../shared/peer-stories'
import { composingKey } from '../../../shared/shortcuts'
import { desktop, shallowEqual, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { waitFor } from '../app/contacts'
import { useShortcut } from '../app/shortcuts'
import { Spinner } from '../ui/controls'
import { UserAvatar } from '../ui/user-avatar'
import { tr } from '../../../shared/i18n'

export interface StoryMediaState { status: 'loading' | 'ready' | 'error'; url: string | null; audioUrl: string | null; loaded: number; total: number | null; message: string }
export type StoryKind = 'photo' | 'photo-audio' | 'poster' | 'video' | 'none'
export interface StoryMediaSource { open(): Promise<void>; close(): void; select(state: DesktopSnapshot | null): StoryMediaState | null }

export const storyPhotoDuration = 6000

export function storyKind(story: { mediaType: 'image' | 'video' | 'unknown'; audio: 'none' | 'attached' | 'unknown'; hasThumbnail: boolean }): StoryKind {
  if (story.mediaType === 'image') return story.audio === 'attached' ? 'photo-audio' : 'photo'
  if (story.mediaType === 'video') return story.audio !== 'unknown' ? 'video' : story.hasThumbnail ? 'poster' : 'none'
  return 'none'
}

export function storyAgo(time: number): string {
  const minutes = Math.floor((Date.now() - time) / 60000)
  return minutes < 1 ? tr('방금') : minutes < 60 ? tr('{0}분 전', [minutes]) : tr('{0}시간 전', [Math.floor(minutes / 60)])
}

export function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(document.hidden)
  useEffect(() => {
    const visibility = (): void => setHidden(document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])
  return hidden
}

// Photo stories advance on a timer; video stories report their own position.
export function useStoryProgress(key: string | null, duration: number | null, stopped: boolean, timed: boolean, done: () => void): { progress: number; setProgress(value: number): void } {
  const [progress, setProgress] = useState(0)
  const elapsed = useRef(0), finish = useRef(done)
  finish.current = done
  useEffect(() => { setProgress(0); elapsed.current = 0 }, [key])
  useEffect(() => {
    if (duration === null || stopped || !timed) return
    let frame = 0, last = performance.now()
    const step = (now: number): void => {
      elapsed.current += now - last; last = now
      const value = Math.min(1, elapsed.current / duration)
      setProgress(value)
      if (value >= 1) finish.current(); else frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [duration, stopped, timed, key])
  return { progress, setProgress }
}

export function StoryMediaView({ kind, source, paused, muted, onDuration, onTime, onEnded, onShown }: {
  kind: StoryKind; source: StoryMediaSource; paused: boolean; muted: boolean
  onDuration(milliseconds: number): void; onTime(fraction: number): void; onEnded(): void; onShown(): void
}) {
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement | null>(null), audio = useRef<HTMLAudioElement | null>(null)
  const shown = useRef(false)
  useEffect(() => {
    if (kind === 'none') { setError(tr('이 스토리 형식은 데스크톱에서 표시할 수 없습니다.')); onDuration(storyPhotoDuration); return }
    void source.open().catch(reason => { setError(errorText(reason, tr('스토리를 열지 못했습니다.'))); onDuration(storyPhotoDuration) })
    return () => { video.current?.pause(); audio.current?.pause(); source.close() }
  }, [source])
  const media = useDesktop(state => source.select(state), shallowEqual)
  useEffect(() => {
    for (const player of [video.current, audio.current]) {
      if (!player) continue
      if (paused) player.pause(); else void player.play().catch(() => {})
    }
  }, [paused, media?.url, media?.audioUrl])
  const show = (): void => { if (!shown.current) { shown.current = true; onShown() } }
  const problem = error || (media?.status === 'error' ? media.message || tr('스토리를 불러오지 못했습니다.') : '')
  if (problem) return <div className="media-viewer-loading" role="alert"><p>{problem}</p></div>
  if (!media || media.status !== 'ready' || !media.url) {
    const percent = media?.total ? Math.round(100 * media.loaded / Math.max(1, media.total)) : null
    return <div className="media-viewer-loading" role="status"><Spinner size={30} />{percent !== null && <span>{percent}%</span>}</div>
  }
  if (kind === 'video') return <>
    <video ref={element => { video.current = element }} src={media.url} autoPlay playsInline muted={Boolean(media.audioUrl) || muted} controlsList="nodownload noremoteplayback" disablePictureInPicture
      onLoadedMetadata={event => { const duration = event.currentTarget.duration; onDuration(Number.isFinite(duration) && duration > 0 ? duration * 1000 : storyPhotoDuration); show() }}
      onTimeUpdate={event => {
        const element = event.currentTarget
        if (element.duration > 0) onTime(element.currentTime / element.duration)
        if (audio.current && Math.abs(audio.current.currentTime - element.currentTime) > 0.3) audio.current.currentTime = element.currentTime
      }}
      onEnded={onEnded} onError={() => setError(tr('이 동영상은 재생할 수 없습니다.'))} />
    {media.audioUrl && <audio ref={element => { audio.current = element }} src={media.audioUrl} autoPlay muted={muted} />}
  </>
  return <>
    <img src={media.url} alt={tr('스토리')} draggable={false} onLoad={() => { if (!media.audioUrl) onDuration(storyPhotoDuration); show() }} onError={() => setError(tr('사진을 표시하지 못했습니다.'))} />
    {media.audioUrl && <audio ref={element => { audio.current = element }} src={media.audioUrl} autoPlay muted={muted}
      onLoadedMetadata={event => { const duration = event.currentTarget.duration; onDuration(Number.isFinite(duration) && duration > 0 ? Math.min(60000, duration * 1000) : storyPhotoDuration) }} />}
  </>
}

interface PeerStories { uid: string; requestId: string; items: PeerStoryRow[]; start: number }

// B408 S2: one person's stories as main opens them (peer-stories.ts) — this account's feed first, else the server's
// getMorsePeerStories; there are no pages or windows to keep open. Data::Stories opens a peer at its first story
// after what was read (StoriesSourceInfo readTill), and at the first one when everything is read.
async function openPeer(accountUid: string, uid: string): Promise<PeerStories> {
  const requestId = crypto.randomUUID()
  const result = await window.morse.openPeerStories(accountUid, { id: requestId, ownerId: uid })
  if (result.outcome !== 'ready') { void window.morse.closePeerStories(accountUid, requestId).catch(() => {}); throw new Error(result.message || tr('스토리를 불러오지 못했습니다.')) }
  const mark = result.readUpTo
  const unread = mark ? result.rows.findIndex(row => row.createdAt > mark.createdAt || (row.createdAt === mark.createdAt && row.id > mark.storyId)) : 0
  return { uid, requestId, items: result.rows, start: unread < 0 ? 0 : unread }
}
const target = (peer: PeerStories, item: PeerStoryRow): { requestId: string; storyId: string; version: string } => ({ requestId: peer.requestId, storyId: item.id, version: item.version })

function peerSource(accountUid: string, peer: PeerStories, item: PeerStoryRow, kind: StoryKind): StoryMediaSource {
  const selectionId = crypto.randomUUID(), base = { selectionId, ...target(peer, item) }
  const quiet = (task: Promise<void>): void => { void task.catch(() => {}) }
  if (kind === 'photo-audio') return {
    open: () => window.morse.openPeerStoryPhotoAudio(accountUid, base),
    close: () => quiet(window.morse.closePeerStoryPhotoAudio(accountUid, selectionId)),
    select: state => {
      const value = state?.peerStoryPhotoAudio
      return value?.selectionId === selectionId ? { status: value.status, url: value.photoUrl, audioUrl: value.audioUrl, loaded: value.loaded, total: value.total, message: '' } : null
    }
  }
  if (kind === 'video') return {
    open: () => window.morse.openPeerStoryVideo(accountUid, { ...base, mode: item.audio === 'attached' ? 'with-audio' : 'original' }),
    close: () => quiet(window.morse.closePeerStoryVideo(accountUid, selectionId)),
    select: state => {
      const value = state?.peerStoryVideo?.selectionId === selectionId ? state.peerStoryVideo.media : null
      return value ? { status: value.status, url: value.url, audioUrl: value.audioUrl, loaded: value.loaded, total: value.total, message: value.message } : null
    }
  }
  return {
    open: () => window.morse.openPeerStoryPhoto(accountUid, { ...base, presentation: kind === 'poster' ? 'video-poster' : 'image' }),
    close: () => quiet(window.morse.closePeerStoryPhoto(accountUid, selectionId)),
    select: state => {
      const value = state?.peerStoryPhoto?.selectionId === selectionId ? state.peerStoryPhoto.media : null
      return value ? { status: value.status, url: value.url, audioUrl: null, loaded: value.loaded, total: value.total, message: value.message } : null
    }
  }
}

// Media::Stories::Controller::preloadNext fetches the stories around the one on screen
// (kPreloadNextMediaCount 3) so that moving on shows a story that is already there.
const preloadAhead = 3
function preloadStory(accountUid: string, peer: PeerStories, item: PeerStoryRow): Promise<void> {
  const kind = storyKind(item), base = { selectionId: crypto.randomUUID(), ...target(peer, item) }
  if (kind === 'video') return window.morse.preloadPeerStoryVideo(accountUid, { ...base, mode: item.audio === 'attached' ? 'with-audio' : 'original' })
  if (kind === 'photo' || kind === 'poster') return window.morse.preloadPeerStoryPhoto(accountUid, { ...base, presentation: kind === 'poster' ? 'video-poster' : 'image' })
  return Promise.resolve()
}

function PeerStoryMedia({ accountUid, peer, item, ...props }: { accountUid: string; peer: PeerStories; item: PeerStoryRow; paused: boolean; muted: boolean; onDuration(milliseconds: number): void; onTime(fraction: number): void; onEnded(): void; onShown(): void }) {
  const kind = storyKind(item)
  const [source] = useState(() => peerSource(accountUid, peer, item, kind))
  return <StoryMediaView kind={kind} source={source} {...props} />
}

// Story replies go through the StoryReplyDraft record: prepare from the open
// story, store the text revision, then send it as a direct message.
async function sendStoryReply(accountUid: string, peer: PeerStories, item: PeerStoryRow, text: string): Promise<string> {
  const waiting = tr('이전 답장 기록을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.')
  const idle = () => { const value = desktop.value?.storyReplyDraft; return value && value.status !== 'loading' && !value.busy ? value : null }
  const initial = desktop.value?.storyReplyDraft
  if (!initial || (initial.status === 'loading' && !initial.busy)) await window.morse.refreshStoryReplyDraft(accountUid).catch(() => {})
  let state = await waitFor(idle, 10000, waiting)
  if (state.status === 'error') { await window.morse.refreshStoryReplyDraft(accountUid); state = await waitFor(idle, 10000, waiting) }
  if (state.pending) await trackWrite(window.morse.storyReplyDraftAction(accountUid, { id: state.pending.id, state: 'prepared', revision: state.pending.revision, action: 'dismiss' }))
  const id = crypto.randomUUID()
  await trackWrite(window.morse.prepareStoryReplyDraft(accountUid, { id, ...target(peer, item) }))
  const pending = await waitFor(() => { const value = idle(); return value?.pending?.id === id ? value.pending : null }, 5000, tr('답장을 준비하지 못했습니다.'))
  const revision = crypto.randomUUID()
  const saved = await trackWrite(window.morse.saveStoryReplyText(accountUid, { id, text, expected: pending.revision, revision }))
  if (saved.revision !== revision) throw new Error(tr('답장을 저장하지 못했습니다.'))
  return (await trackWrite(window.morse.sendStoryReply(accountUid, { id, revision }))).chatId
}

// Media::Stories::View: one person's active stories, then the next person in the row.
function StoryViewer({ accountUid, peers, startIndex, close }: { accountUid: string; peers: string[]; startIndex: number; close(): void }) {
  const [peerIndex, setPeerIndex] = useState(startIndex)
  const [peer, setPeer] = useState<PeerStories | null>(null)
  const [itemIndex, setItemIndex] = useState(0)
  const [error, setError] = useState('')
  const [duration, setDuration] = useState<number | null>(null)
  const [paused, setPaused] = useState(false), [muted, setMuted] = useState(false), [reacting, setReacting] = useState(false)
  const [reply, setReply] = useState(''), [typing, setTyping] = useState(false), [replying, setReplying] = useState(false)
  const [myReaction, setMyReaction] = useState<string | null>(null)
  const [shownIndex, setShownIndex] = useState(-1)
  const hidden = usePageHidden()
  const current = useRef<PeerStories | null>(null)
  const seen = useRef(new Set<string>())
  const uid = peers[peerIndex]
  const contact = useDesktop(state => uid ? state?.contacts?.items.find(item => item.uid === uid) ?? null : null)
  // Someone met only in a chat is named as that chat is.
  const chatName = useDesktop(state => uid ? state?.dialogs?.find(dialog => (dialog.kind === 'direct' || dialog.kind === 'secret') && dialog.participantUids.includes(uid))?.title ?? '' : '')
  const item = peer?.items[itemIndex] ?? null
  const key = item ? `${peer!.requestId}:${item.id}` : null
  const stopped = paused || hidden || reacting || typing || replying || Boolean(reply)

  const next = (): void => {
    if (!peer) return
    if (itemIndex + 1 < peer.items.length) setItemIndex(itemIndex + 1)
    else setPeerIndex(peerIndex + 1)
  }
  const previous = (): void => {
    if (itemIndex > 0) setItemIndex(itemIndex - 1)
    else if (peerIndex > 0) setPeerIndex(peerIndex - 1)
  }
  const { progress, setProgress } = useStoryProgress(key, duration, stopped, item ? storyKind(item) !== 'video' : false, next)
  // B423: stories of this list main found deleted (peer-stories.ts applyDeleted). The one on screen closes the viewer, as
  // tdesktop's Controller does on Destroyed (media_stories_controller.cpp:1025-1032); the others only leave the list.
  const deleted = useDesktop(state => peer && state?.peerStoriesDeleted?.requestId === peer.requestId ? state.peerStoriesDeleted.storyIds.join(',') : '')
  useEffect(() => {
    if (!peer || !deleted) return
    const ids = deleted.split(',')
    if (item && ids.includes(item.id)) { close(); return }
    const items = peer.items.filter(story => !ids.includes(story.id))
    if (items.length === peer.items.length) return
    const updated = { ...peer, items }
    current.current = updated
    setPeer(updated); setItemIndex(item ? Math.max(0, items.findIndex(story => story.id === item.id)) : 0)
  }, [deleted])
  // This account's reaction on the story (its views/{me} record) is shown as selected.
  useEffect(() => {
    setMyReaction(null)
    if (!peer || !item) return
    let alive = true
    void window.morse.readPeerStoryReaction(accountUid, target(peer, item)).then(value => { if (alive) setMyReaction(value) }).catch(() => {})
    return () => { alive = false }
  }, [accountUid, peer, key])

  useEffect(() => {
    if (!uid) { close(); return }
    let alive = true
    setPeer(null); setItemIndex(0); setError(''); setReply('')
    void openPeer(accountUid, uid).then(value => {
      if (!alive) { void window.morse.closePeerStories(accountUid, value.requestId).catch(() => {}); return }
      current.current = value
      if (value.items.length) { setPeer(value); setItemIndex(value.start) }
      else setPeerIndex(index => index + 1)
    }).catch(reason => { if (alive) setError(errorText(reason, tr('스토리를 불러오지 못했습니다.'))) })
    return () => {
      alive = false
      const value = current.current
      current.current = null
      if (value) void window.morse.closePeerStories(accountUid, value.requestId).catch(() => {})
    }
  }, [uid])

  // Controller::preloadNext, run once this story is on screen: fetching the next ones must not take
  // the connection away from the one the viewer is waiting for.
  useEffect(() => {
    if (!peer || !item || shownIndex !== itemIndex) return
    let alive = true
    const targets = peer.items.slice(itemIndex + 1, itemIndex + 1 + preloadAhead)
    void (async () => {
      for (const next of targets) {
        if (!alive) return
        // A story that could not be fetched ahead is simply opened when it is reached.
        await preloadStory(accountUid, peer, next).catch(() => {})
      }
    })()
    return () => { alive = false }
  }, [peer, itemIndex, shownIndex])

  useEffect(() => { setDuration(null) }, [key])

  useShortcut(120, command => {
    if (command === 'previous-dialog') { previous(); return true }
    if (command === 'next-dialog') { next(); return true }
    return false
  })

  // tdesktop Data::Stories::markAsRead: once a story is on screen, main moves the read mark and, unless this device
  // views without being seen, writes the view (peer-stories.ts seen).
  const markViewed = (target_: PeerStories, story: PeerStoryRow): void => {
    const id = `${target_.requestId}:${story.id}`
    if (seen.current.has(id)) return
    seen.current.add(id)
    void window.morse.peerStorySeen(accountUid, target(target_, story)).catch(() => { seen.current.delete(id) })
  }

  async function react(choice: typeof storyReactions[number]): Promise<void> {
    if (!peer || !item || reacting) return
    setReacting(true)
    // The reaction already chosen is taken back (stories.sendReaction with none).
    const emoji = myReaction === choice ? null : choice
    try {
      const stored = await window.morse.setPeerStoryReaction(accountUid, { ...target(peer, item), emoji })
      setMyReaction(stored)
      if (stored) controller.toast(tr('{0} 반응을 보냈습니다.', [stored]))
    } catch (reason) { controller.toast(errorText(reason, tr('반응을 보내지 못했습니다.')), 'error') }
    finally { setReacting(false) }
  }

  async function submitReply(): Promise<void> {
    const text = reply.trim()
    if (!peer || !item || replying || !text) return
    setReplying(true)
    try {
      const chatId = await sendStoryReply(accountUid, peer, item, text)
      setReply('')
      controller.toast(tr('답장을 보냈습니다.'), 'default', { label: tr('대화 열기'), run: () => { close(); controller.openChat(chatId) } })
    } catch (reason) { controller.toast(errorText(reason, tr('답장을 보내지 못했습니다.')), 'error') }
    finally { setReplying(false) }
  }

  const openLink = (url: string): void => {
    if (!peer || !item) return
    void window.morse.openPeerStoryLink(accountUid, { ...target(peer, item), url }).catch(reason => controller.toast(errorText(reason, tr('링크를 열지 못했습니다.')), 'error'))
  }

  const name = contact?.displayName ?? chatName
  return <div className="story-viewer" role="dialog" aria-modal="true" aria-label={tr('스토리')} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') previous()
      else if (event.key === 'ArrowRight') next()
      else if (event.key === ' ') { event.preventDefault(); setPaused(value => !value) }
    }}
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <button className="media-viewer-button story-close" aria-label={tr('닫기')} data-autofocus onClick={close}><X size={22} /></button>
    <button className={`story-nav${peerIndex > 0 || itemIndex > 0 ? '' : ' hidden'}`} aria-label={tr('이전 스토리')} onClick={previous}><ChevronLeft size={32} /></button>
    <div className="story-frame">
      {peer && <div className="story-progress">{peer.items.map((story, index) => <span key={story.id}><i style={{ width: `${index < itemIndex ? 100 : index === itemIndex ? progress * 100 : 0}%` }} /></span>)}</div>}
      <header className="story-header">
        <UserAvatar uid={uid ?? null} name={name || '?'} size={32} />
        <span><strong className="ellipsis">{name}</strong>{item && <small>{storyAgo(item.createdAt)}{item.privacy === 'contacts' ? tr(' · 연락처 공개') : item.privacy === 'closeFriends' ? tr(' · 친한 친구') : ''}</small>}</span>
        <button className="icon-button small" aria-label={paused ? tr('재생') : tr('일시 정지')} onClick={() => setPaused(value => !value)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        {item?.audio === 'attached' && <button className="icon-button small" aria-label={muted ? tr('소리 켜기') : tr('소리 끄기')} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
        {/* A10 §3-1 (Telegram stories.report): the story itself, owned by this person. */}
        {peer && item && <button className="icon-button small" aria-label={tr('스토리 신고')} onClick={() => { setPaused(true); showReportBox(accountUid, { type: 'story', targetId: item.id, ownerType: 'user', ownerId: peer.uid }, tr('스토리 신고')) }}><Flag size={18} /></button>}
      </header>
      <div className="story-stage">
        {error ? <div className="media-viewer-loading" role="alert"><p>{error}</p></div>
          : !peer || !item ? <div className="media-viewer-loading" role="status"><Spinner size={30} /></div>
            : <PeerStoryMedia key={key!} accountUid={accountUid} peer={peer} item={item} paused={stopped} muted={muted}
              onDuration={setDuration} onTime={setProgress} onEnded={next} onShown={() => { setShownIndex(itemIndex); markViewed(peer, item) }} />}
      </div>
      <button type="button" className="story-tap previous" aria-label={tr('이전')} tabIndex={-1} onClick={previous} />
      <button type="button" className="story-tap next" aria-label={tr('다음')} tabIndex={-1} onClick={next} />
      {item?.caption && <p className="story-caption with-reply selectable">{item.caption}{firstStoryCaptionLink(item.caption) && <button type="button" className="story-caption-link" onClick={() => openLink(firstStoryCaptionLink(item.caption)!)}><LinkIcon size={14} />{tr('링크 열기')}</button>}</p>}
      {item && <div className="story-bottom">
        {/* A reply is a message to them; this account messages its contacts (story-reply-draft sendAllowed). */}
        {contact && <div className="story-reply">
          <input className="story-reply-field" value={reply} maxLength={1000} placeholder={tr('{0}님에게 답장', [name])} aria-label={tr('스토리 답장')} disabled={replying}
            onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} onChange={event => setReply(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Escape') { event.currentTarget.blur(); return }
              if (event.key === 'Enter' && !composingKey(event.nativeEvent)) { event.preventDefault(); void submitReply() }
            }} />
          <button type="button" className="story-reply-send" aria-label={tr('답장 보내기')} disabled={replying || !reply.trim()} onClick={() => { void submitReply() }}>{replying ? <Spinner size={16} /> : <Send size={18} />}</button>
        </div>}
        <div className="story-reactions" role="group" aria-label={tr('반응')}>
          {storyReactions.map(choice => <button key={choice} type="button" className={myReaction === choice ? 'selected' : undefined} aria-pressed={myReaction === choice} disabled={reacting} aria-label={tr('{0} 반응', [choice])} onClick={() => { void react(choice) }}>{choice}</button>)}
        </div>
      </div>}
    </div>
    <button className="story-nav" aria-label={tr('다음 스토리')} onClick={next}><ChevronRight size={32} /></button>
  </div>
}

export function showStoryViewer(accountUid: string, peers: string[], index: number, onClose?: () => void): void {
  controller.showLayer(close => <StoryViewer accountUid={accountUid} peers={peers} startIndex={index} close={close} />, { onClose })
}
