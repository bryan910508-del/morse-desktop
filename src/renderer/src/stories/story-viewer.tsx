import { Link as LinkIcon } from 'lucide-react'
import { firstStoryCaptionLink } from '../../../shared/story-caption-link'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, Send, Volume2, VolumeX, X } from 'lucide-react'
import type { DesktopSnapshot } from '../../../shared/model'
import type { ContactPublicStory } from '../../../shared/contact-public-stories'
import { storyReactionChoices } from '../../../shared/contact-story-reaction'
import { composingKey } from '../../../shared/shortcuts'
import { desktop, shallowEqual, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { releaseContactProfile, waitFor } from '../app/contacts'
import { runJournal } from '../app/channel-publish'
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

type Privacy = 'everyone' | 'contacts'
interface StoryItem extends ContactPublicStory { privacy: Privacy; page: number; audienceId: string | null }
interface ListCursor { id: string; number: number }
interface PeerStories { uid: string; name: string; profileRequestId: string; items: StoryItem[]; observedAt: number; audienceId: string; lists: Partial<Record<Privacy, ListCursor>>; moves: Promise<unknown> }
type StoryPage = { outcome: 'ready' | 'unavailable'; ownerId: string; rows: ContactPublicStory[]; page: { number: number; canNext: boolean }; message: string }
const maxStoryPages = 20

// The contact story sources in main keep a 30 second window per list, bound to
// the open contact profile, and one open page (50 stories) per list: turning to
// another page closes the previous one. Lists are read again when the window runs out.
function readFirstPage(accountUid: string, peer: PeerStories, privacy: Privacy, id: string): Promise<StoryPage> {
  return privacy === 'everyone' ? window.morse.readContactPublicStories(accountUid, { id, profileRequestId: peer.profileRequestId })
    : window.morse.readContactAudienceStories(accountUid, { id, profileRequestId: peer.profileRequestId, audienceId: peer.audienceId, privacy: 'contacts' })
}
function turnPage(accountUid: string, peer: PeerStories, privacy: Privacy, previousId: string, id: string, direction: 'next' | 'previous'): Promise<StoryPage> {
  return privacy === 'everyone' ? window.morse.pageContactPublicStories(accountUid, { id, profileRequestId: peer.profileRequestId, previousId, direction })
    : window.morse.pageContactAudienceStories(accountUid, { id, profileRequestId: peer.profileRequestId, audienceId: peer.audienceId, privacy: 'contacts', previousId, direction })
}
// Media, receipts, reactions, replies and links need the story's own page open.
function storyListId(accountUid: string, peer: PeerStories, item: StoryItem): Promise<string> {
  const task = peer.moves.then(async () => {
    const cursor = peer.lists[item.privacy]
    if (!cursor) throw new Error(tr('스토리 목록을 다시 열어 주세요.'))
    for (let attempt = 0; cursor.number !== item.page; attempt++) {
      if (attempt > maxStoryPages * 2) throw new Error(tr('스토리 페이지를 이동하지 못했습니다.'))
      const id = crypto.randomUUID()
      let result: StoryPage
      try { result = await turnPage(accountUid, peer, item.privacy, cursor.id, id, cursor.number < item.page ? 'next' : 'previous') }
      catch {
        // An expired page cannot be turned; start again from the first page.
        cursor.id = id
        result = await readFirstPage(accountUid, peer, item.privacy, id)
      }
      cursor.id = id
      if (result.outcome !== 'ready') throw new Error(result.message || tr('스토리 목록을 다시 열어 주세요.'))
      cursor.number = result.page.number
    }
    return cursor.id
  })
  peer.moves = task.catch(() => {})
  return task
}

// Opens the first web address of a contact's story caption through main's link checks.
function openStoryLink(accountUid: string, peer: PeerStories, item: StoryItem, url: string): void {
  void storyListId(accountUid, peer, item).then(requestId => {
    const base = { profileRequestId: peer.profileRequestId, requestId, storyId: item.id, version: item.version, url }
    return item.privacy === 'everyone' || !item.audienceId ? window.morse.openContactPublicStoryLink(accountUid, base)
      : window.morse.openContactAudienceStoryLink(accountUid, { ...base, privacy: item.privacy, audienceId: item.audienceId })
  }).catch(reason => controller.toast(errorText(reason, tr('링크를 열지 못했습니다.')), 'error'))
}

async function readLists(accountUid: string, uid: string, name: string, profileRequestId: string): Promise<PeerStories> {
  const peer: PeerStories = { uid, name, profileRequestId, items: [], observedAt: Date.now(), audienceId: crypto.randomUUID(), lists: {}, moves: Promise.resolve() }
  // Every page is read so the row stays in time order across pages and lists.
  const readAll = async (privacy: Privacy): Promise<void> => {
    const cursor: ListCursor = { id: crypto.randomUUID(), number: 1 }
    peer.lists[privacy] = cursor
    let result = await readFirstPage(accountUid, peer, privacy, cursor.id)
    if (result.outcome !== 'ready' || result.ownerId !== uid) return
    for (;;) {
      const page = result.page.number
      cursor.number = page
      peer.items.push(...result.rows.map(row => ({ ...row, privacy, page, audienceId: privacy === 'contacts' ? peer.audienceId : null })))
      if (!result.page.canNext || page >= maxStoryPages) return
      const previous = cursor.id
      cursor.id = crypto.randomUUID()
      const turned = await turnPage(accountUid, peer, privacy, previous, cursor.id, 'next').catch(() => null)
      if (!turned || turned.outcome !== 'ready' || turned.ownerId !== uid) {
        // Later pages stay unread; reopen the first page so the stories already read still open.
        cursor.id = crypto.randomUUID(); cursor.number = 1
        await readFirstPage(accountUid, peer, privacy, cursor.id).catch(() => null)
        return
      }
      result = turned
    }
  }
  try { await readAll('everyone') } catch { /* Public stories unavailable for this contact. */ }
  try {
    await window.morse.openContactStoryAudience(accountUid, { id: peer.audienceId, profileRequestId })
    const audience = await waitFor(() => { const value = desktop.value?.contactStoryAudience; return value?.id === peer.audienceId && value.status === 'ready' ? value : null }, 8000)
    if (audience.contacts) await readAll('contacts')
  } catch { /* Contacts-only stories are not listable for this viewer. */ }
  peer.items.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  peer.observedAt = Date.now()
  return peer
}

function closeLists(accountUid: string, peer: PeerStories): void {
  if (peer.lists.everyone) void window.morse.closeContactPublicStories(accountUid, peer.lists.everyone.id).catch(() => {})
  if (peer.lists.contacts) void window.morse.closeContactAudienceStories(accountUid, peer.lists.contacts.id).catch(() => {})
  void window.morse.closeContactStoryAudience(accountUid, peer.audienceId).catch(() => {})
}

async function openPeer(accountUid: string, uid: string): Promise<PeerStories> {
  const profileRequestId = crypto.randomUUID()
  try {
    await window.morse.openContactProfile(accountUid, uid, profileRequestId)
    const profile = await waitFor(() => { const value = desktop.value?.contacts?.profile; return value?.requestId === profileRequestId && value.status !== 'loading' ? value : null }, 10000, tr('연락처를 불러오지 못했습니다.'))
    if (profile.status !== 'ready') throw new Error(profile.message || tr('연락처를 확인할 수 없습니다.'))
    return await readLists(accountUid, uid, profile.displayName, profileRequestId)
  } catch (error) { await releaseContactProfile(accountUid, profileRequestId); throw error }
}

function contactSource(accountUid: string, peer: PeerStories, item: StoryItem, kind: StoryKind): StoryMediaSource {
  const selectionId = crypto.randomUUID()
  const base = async () => ({ selectionId, requestId: await storyListId(accountUid, peer, item), storyId: item.id, version: item.version, profileRequestId: peer.profileRequestId })
  const audience = item.privacy === 'contacts' && item.audienceId ? { audienceId: item.audienceId, privacy: 'contacts' as const } : null
  const quiet = (task: Promise<void>): void => { void task.catch(() => {}) }
  if (kind === 'photo-audio') return {
    open: async () => window.morse.openContactStoryPhotoAudio(accountUid, { ...await base(), privacy: item.privacy, audienceId: item.audienceId }),
    close: () => quiet(window.morse.closeContactStoryPhotoAudio(accountUid, selectionId)),
    select: state => {
      const value = state?.contactStoryPhotoAudio
      return value?.selectionId === selectionId ? { status: value.status, url: value.photoUrl, audioUrl: value.audioUrl, loaded: value.loaded, total: value.total, message: '' } : null
    }
  }
  if (kind === 'video') {
    const mode = item.audio === 'attached' ? 'with-audio' as const : 'original' as const
    return {
      open: async () => { const request = await base(); return audience ? window.morse.openContactAudienceStoryVideo(accountUid, { ...request, mode, ...audience }) : window.morse.openContactPublicStoryVideo(accountUid, { ...request, mode }) },
      close: () => quiet(audience ? window.morse.closeContactAudienceStoryVideo(accountUid, selectionId) : window.morse.closeContactPublicStoryVideo(accountUid, selectionId)),
      select: state => {
        const source = audience ? state?.contactAudienceStoryVideo : state?.contactPublicStoryVideo
        const value = source?.selectionId === selectionId ? source.media : null
        return value ? { status: value.status, url: value.url, audioUrl: value.audioUrl, loaded: value.loaded, total: value.total, message: value.message } : null
      }
    }
  }
  const presentation = kind === 'poster' ? 'video-poster' as const : 'image' as const
  return {
    open: async () => { const request = await base(); return audience ? window.morse.openContactAudienceStoryPhoto(accountUid, { ...request, presentation, ...audience }) : window.morse.openContactPublicStoryPhoto(accountUid, { ...request, presentation }) },
    close: () => quiet(audience ? window.morse.closeContactAudienceStoryPhoto(accountUid, selectionId) : window.morse.closeContactPublicStoryPhoto(accountUid, selectionId)),
    select: state => {
      const source = audience ? state?.contactAudienceStoryPhoto : state?.contactPublicStoryPhoto
      const value = source?.selectionId === selectionId ? source.media : null
      return value ? { status: value.status, url: value.url, audioUrl: null, loaded: value.loaded, total: value.total, message: value.message } : null
    }
  }
}

function ContactStoryMedia({ accountUid, peer, item, ...props }: { accountUid: string; peer: PeerStories; item: StoryItem; paused: boolean; muted: boolean; onDuration(milliseconds: number): void; onTime(fraction: number): void; onEnded(): void; onShown(): void }) {
  const kind = storyKind(item)
  const [source] = useState(() => contactSource(accountUid, peer, item, kind))
  return <StoryMediaView kind={kind} source={source} {...props} />
}

// Story replies go through the StoryReplyDraft record: prepare from the open
// story, store the text revision, then send it as a direct message.
async function sendStoryReply(accountUid: string, peer: PeerStories, item: StoryItem, text: string): Promise<string> {
  const waiting = tr('이전 답장 기록을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.')
  const idle = () => { const value = desktop.value?.storyReplyDraft; return value && value.status !== 'loading' && !value.busy ? value : null }
  const initial = desktop.value?.storyReplyDraft
  if (!initial || (initial.status === 'loading' && !initial.busy)) await window.morse.refreshStoryReplyDraft(accountUid).catch(() => {})
  let state = await waitFor(idle, 10000, waiting)
  if (state.status === 'error') { await window.morse.refreshStoryReplyDraft(accountUid); state = await waitFor(idle, 10000, waiting) }
  if (state.pending) await trackWrite(window.morse.storyReplyDraftAction(accountUid, { id: state.pending.id, state: 'prepared', revision: state.pending.revision, action: 'dismiss' }))
  const id = crypto.randomUUID()
  await trackWrite(window.morse.prepareStoryReplyDraft(accountUid, { id, profileRequestId: peer.profileRequestId, requestId: await storyListId(accountUid, peer, item), storyId: item.id, version: item.version, privacy: item.privacy, audienceId: item.audienceId }))
  const pending = await waitFor(() => { const value = idle(); return value?.pending?.id === id ? value.pending : null }, 5000, tr('답장을 준비하지 못했습니다.'))
  const revision = crypto.randomUUID()
  const saved = await trackWrite(window.morse.saveStoryReplyText(accountUid, { id, text, expected: pending.revision, revision }))
  if (saved.revision !== revision) throw new Error(tr('답장을 저장하지 못했습니다.'))
  return (await trackWrite(window.morse.sendStoryReply(accountUid, { id, revision }))).chatId
}

// Media::Stories::View: one contact's active stories, then the next contact in the row.
function StoryViewer({ accountUid, peers, startIndex, close }: { accountUid: string; peers: string[]; startIndex: number; close(): void }) {
  const stealth = useDesktop(state => state?.preferences.storyStealth ?? false)
  const [peerIndex, setPeerIndex] = useState(startIndex)
  const [peer, setPeer] = useState<PeerStories | null>(null)
  const [itemIndex, setItemIndex] = useState(0)
  const [error, setError] = useState('')
  const [duration, setDuration] = useState<number | null>(null)
  const [paused, setPaused] = useState(false), [muted, setMuted] = useState(false), [reacting, setReacting] = useState(false)
  const [reply, setReply] = useState(''), [typing, setTyping] = useState(false), [replying, setReplying] = useState(false)
  const [myReaction, setMyReaction] = useState<string | null>(null)
  const hidden = usePageHidden()
  const current = useRef<PeerStories | null>(null)
  const receipts = useRef(new Set<string>()), receiptChain = useRef<Promise<void>>(Promise.resolve())
  const uid = peers[peerIndex]
  const contact = useDesktop(state => uid ? state?.contacts?.items.find(item => item.uid === uid) ?? null : null)
  const item = peer?.items[itemIndex] ?? null
  const key = item ? `${item.privacy}:${item.page}:${item.id}` : null
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
  // The reaction already stored for this story is shown as selected.
  useEffect(() => {
    setMyReaction(null)
    if (!peer || !item) return
    const id = crypto.randomUUID()
    let alive = true
    void storyListId(accountUid, peer, item).then(requestId => window.morse.readContactStoryReaction(accountUid, { id, profileRequestId: peer.profileRequestId, requestId, storyId: item.id, version: item.version, privacy: item.privacy, audienceId: item.audienceId }))
      .then(result => { if (alive && result.outcome === 'ready' && result.current?.field === 'stored') setMyReaction(result.current.value) }).catch(() => {})
    return () => { alive = false; void window.morse.closeContactStoryReaction(accountUid, id).catch(() => {}) }
  }, [accountUid, peer, key])

  useEffect(() => {
    if (!uid) { close(); return }
    let alive = true
    setPeer(null); setItemIndex(0); setError(''); setReply('')
    void openPeer(accountUid, uid).then(value => {
      if (!alive) { closeLists(accountUid, value); void releaseContactProfile(accountUid, value.profileRequestId); return }
      current.current = value
      if (value.items.length) setPeer(value)
      else setPeerIndex(index => index + 1)
    }).catch(reason => { if (alive) setError(errorText(reason, tr('스토리를 불러오지 못했습니다.'))) })
    return () => {
      alive = false
      const value = current.current
      current.current = null
      if (value) { closeLists(accountUid, value); void releaseContactProfile(accountUid, value.profileRequestId) }
    }
  }, [uid])

  // Re-read the lists before a story whose 30 second list window has passed.
  useEffect(() => {
    if (!peer || !item || Date.now() - peer.observedAt <= 25000) return
    let alive = true
    const story = item.id
    closeLists(accountUid, peer)
    void readLists(accountUid, peer.uid, peer.name, peer.profileRequestId).then(nextPeer => {
      if (!alive) { closeLists(accountUid, nextPeer); return }
      current.current = nextPeer
      if (!nextPeer.items.length) { setPeerIndex(index => index + 1); return }
      const index = nextPeer.items.findIndex(candidate => candidate.id === story)
      setPeer(nextPeer); setItemIndex(index >= 0 ? index : Math.min(itemIndex, nextPeer.items.length - 1))
    }).catch(reason => { if (alive) setError(errorText(reason, tr('스토리를 불러오지 못했습니다.'))) })
    return () => { alive = false }
  }, [peer, itemIndex])

  useEffect(() => { setDuration(null) }, [key])

  useShortcut(120, command => {
    if (command === 'previous-dialog') { previous(); return true }
    if (command === 'next-dialog') { next(); return true }
    return false
  })

  const markViewed = (target: PeerStories, story: StoryItem): void => {
    if (stealth || receipts.current.has(story.id)) return
    receipts.current.add(story.id)
    receiptChain.current = receiptChain.current.then(() => runJournal({
      current: () => desktop.value?.storyViewReceipt ?? null,
      refresh: () => window.morse.refreshStoryViewReceipt(accountUid),
      action: action => window.morse.storyViewReceiptAction(accountUid, action),
      prepare: async id => window.morse.prepareStoryViewReceipt(accountUid, { id, profileRequestId: target.profileRequestId, requestId: await storyListId(accountUid, target, story), storyId: story.id, version: story.version, privacy: story.privacy, audienceId: story.audienceId })
    }, { waiting: '', denied: '', rejected: '' }).then(() => {}, () => {}))
  }

  async function react(choice: typeof storyReactionChoices[number]): Promise<void> {
    if (!peer || !item || reacting) return
    setReacting(true)
    try {
      await runJournal({
        current: () => desktop.value?.storyReactionChange ?? null,
        refresh: () => window.morse.refreshStoryReactionChange(accountUid),
        action: action => window.morse.storyReactionChangeAction(accountUid, action),
        prepare: async id => window.morse.prepareStoryReactionChange(accountUid, { id, profileRequestId: peer.profileRequestId, requestId: await storyListId(accountUid, peer, item), storyId: item.id, version: item.version, privacy: item.privacy, audienceId: item.audienceId, choice })
      }, {
        waiting: tr('이전 반응을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 이 스토리에 반응할 수 없습니다.'),
        rejected: tr('반응을 보내지 못했습니다.')
      })
      setMyReaction(choice)
      controller.toast(tr('{0} 반응을 보냈습니다.', [choice]))
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

  const name = peer?.name ?? contact?.displayName ?? ''
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
      {peer && <div className="story-progress">{peer.items.map((story, index) => <span key={`${story.privacy}:${story.id}`}><i style={{ width: `${index < itemIndex ? 100 : index === itemIndex ? progress * 100 : 0}%` }} /></span>)}</div>}
      <header className="story-header">
        <UserAvatar uid={contact?.uid ?? null} name={name || '?'} size={32} />
        <span><strong className="ellipsis">{name}</strong>{item && <small>{storyAgo(item.createdAt)}{item.privacy === 'contacts' ? tr(' · 연락처 공개') : ''}</small>}</span>
        <button className="icon-button small" aria-label={paused ? tr('재생') : tr('일시 정지')} onClick={() => setPaused(value => !value)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        {item?.audio === 'attached' && <button className="icon-button small" aria-label={muted ? tr('소리 켜기') : tr('소리 끄기')} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
      </header>
      <div className="story-stage">
        {error ? <div className="media-viewer-loading" role="alert"><p>{error}</p></div>
          : !peer || !item ? <div className="media-viewer-loading" role="status"><Spinner size={30} /></div>
            : <ContactStoryMedia key={key!} accountUid={accountUid} peer={peer} item={item} paused={stopped} muted={muted}
              onDuration={setDuration} onTime={setProgress} onEnded={next} onShown={() => markViewed(peer, item)} />}
      </div>
      <button type="button" className="story-tap previous" aria-label={tr('이전')} tabIndex={-1} onClick={previous} />
      <button type="button" className="story-tap next" aria-label={tr('다음')} tabIndex={-1} onClick={next} />
      {item?.caption && <p className="story-caption with-reply selectable">{item.caption}{peer && firstStoryCaptionLink(item.caption) && <button type="button" className="story-caption-link" onClick={() => openStoryLink(accountUid, peer, item, firstStoryCaptionLink(item.caption)!)}><LinkIcon size={14} />{tr('링크 열기')}</button>}</p>}
      {item && <div className="story-bottom">
        <div className="story-reply">
          <input className="story-reply-field" value={reply} maxLength={1000} placeholder={tr('{0}님에게 답장', [name])} aria-label={tr('스토리 답장')} disabled={replying}
            onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} onChange={event => setReply(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Escape') { event.currentTarget.blur(); return }
              if (event.key === 'Enter' && !composingKey(event.nativeEvent)) { event.preventDefault(); void submitReply() }
            }} />
          <button type="button" className="story-reply-send" aria-label={tr('답장 보내기')} disabled={replying || !reply.trim()} onClick={() => { void submitReply() }}>{replying ? <Spinner size={16} /> : <Send size={18} />}</button>
        </div>
        <div className="story-reactions" role="group" aria-label={tr('반응')}>
          {storyReactionChoices.map(choice => <button key={choice} type="button" className={myReaction === choice ? 'selected' : undefined} aria-pressed={myReaction === choice} disabled={reacting} aria-label={tr('{0} 반응', [choice])} onClick={() => { void react(choice) }}>{choice}</button>)}
        </div>
      </div>}
    </div>
    <button className="story-nav" aria-label={tr('다음 스토리')} onClick={next}><ChevronRight size={32} /></button>
  </div>
}

export function showStoryViewer(accountUid: string, peers: string[], index: number, onClose?: () => void): void {
  controller.showLayer(close => <StoryViewer accountUid={accountUid} peers={peers} startIndex={index} close={close} />, { onClose })
}
