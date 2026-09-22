import { showPostLikers } from './post-likers-box'
import { showReportBox } from '../boxes/report-box'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, Copy, Film, Globe, Heart, Image as ImageIcon, Info, Link, Lock, MessageCircle, Pencil, Pin, PinOff, Send, Trash2, X, Flag } from 'lucide-react'
import type { ChannelSummary } from '../../../shared/channels'
import type { ChannelPostsSnapshot, ChannelPostText } from '../../../shared/channel-posts'
import type { PostDraftRecord, PostDraftVisibility } from '../../../shared/channel-post-drafts'
import { channelPostLikeRequest } from '../../../shared/channel-post-like'
import { composingKey } from '../../../shared/shortcuts'
import { useDesktop } from '../app/store'
import { controller, useUi } from '../app/ui'
import { errorText, messageTime, positionTime, sameDay, serviceDate } from '../app/format'
import { copyText } from '../app/clipboard'
import { draftFlushers, trackWrite } from '../app/drafts'
import { DraftWriter } from '../app/channel-drafts'
import { publishPost } from '../app/channel-publish'
import { prepareChannelPostPhoto } from '../photos/prepare-channel-post-photo'
import { maxPostPhotos } from '../../../shared/channel-post-photo'
import { retainChannels } from '../app/channel-visibility'
import { Avatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { showTextEditBox } from '../boxes/text-edit-box'
import { postPinBase, preparePostPin } from './channel-post-pin-state'
import { canClearExtraPin, prepareExtraPin, preparePinResolution, referencedUnpinnedPost } from './channel-post-pin-extra-state'
import { preparePostVisibility, visibilityEditable } from './channel-post-visibility-state'
import { preparePostRemovalReview } from './channel-post-removal-state'
import { showChannelMedia } from './channel-media-viewer'
import { openComments } from './channel-ui'
import '../styles/channels.css'
import { locale, tr } from '../../../shared/i18n'

type Result = { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
interface LikeOverride { revision: string; selected: boolean; count: number }

const typeLabels: Record<ChannelSummary['type'], string> = { public: tr('공개 채널'), private: tr('비공개 채널'), invite: tr('초대 전용 채널'), unknown: tr('채널') }

export function channelSubtitle(channel: ChannelSummary | null): string {
  if (channel?.status !== 'ready') return tr('채널')
  return [typeLabels[channel.type], channel.subscriberCount !== null ? tr('구독자 {0}명', [channel.subscriberCount.toLocaleString(locale())]) : ''].filter(Boolean).join(' · ')
}

export function reportResult(task: Promise<Result>, success?: string): void {
  void trackWrite(task).then(result => {
    if (result.outcome === 'saved') { if (success) controller.toast(success) }
    else controller.toast(result.message, result.outcome === 'rejected' ? 'error' : 'default')
  }).catch(reason => controller.toast(errorText(reason, tr('요청을 처리하지 못했습니다.')), 'error'))
}

// HistoryView::ComposeControls for channel authors: the draft is kept on this
// device and one press publishes through the durable creation journal.
function photoDataURL(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(tr('사진 미리보기를 만들지 못했습니다.')))
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
  })
}

function ChannelComposer({ accountUid, channelId }: { accountUid: string; channelId: string }) {
  const enterToSend = useDesktop(snapshot => snapshot?.preferences.enterToSend ?? true)
  const [text, setText] = useState(''), [visibility, setVisibility] = useState<PostDraftVisibility>('public')
  const [loaded, setLoaded] = useState(false), [sending, setSending] = useState(false)
  const [photos, setPhotos] = useState<{ id: string; bytes: Uint8Array; url: string }[]>([]), [picking, setPicking] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const latest = useRef<{ text: string; visibility: PostDraftVisibility }>({ text: '', visibility: 'public' })
  const dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const writer = useMemo(() => new DraftWriter<PostDraftRecord>(() => window.morse.readPostDraft(accountUid, { channelId }),
    (expected, revision) => window.morse.savePostDraft(accountUid, { channelId, ...latest.current, expected, revision })), [accountUid, channelId])
  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    try { await writer.save() } catch (error) { dirty.current = true; throw error }
  }, [writer])
  useEffect(() => {
    let alive = true
    void writer.load().then(record => {
      if (!alive || dirty.current) return
      latest.current = { text: record.text, visibility: record.visibility }; setText(record.text); setVisibility(record.visibility)
    }).catch(() => {}).finally(() => { if (alive) setLoaded(true) })
    draftFlushers.add(flush)
    return () => { alive = false; draftFlushers.delete(flush); void flush().catch(() => {}) }
  }, [writer, flush])
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(224, element.scrollHeight)}px`
  }, [text])
  function change(next: { text: string; visibility: PostDraftVisibility }): void {
    latest.current = next; dirty.current = true; setText(next.text); setVisibility(next.visibility)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => {}) }, 300)
  }
  async function send(): Promise<void> {
    const content = latest.current
    if (sending || !loaded || picking || (!content.text.trim() && !photos.length)) return
    setSending(true)
    clearTimeout(timer.current); dirty.current = false
    try {
      const saved = await writer.save()
      if (!saved.revision) throw new Error(tr('초안을 저장하지 못했습니다.'))
      latest.current = { text: '', visibility: saved.visibility }; setText('')
      const result = await publishPost(accountUid, { channelId, text: saved.text, visibility: saved.visibility, draftRevision: saved.revision }, photos.map(photo => photo.bytes))
      setPhotos([])
      if (result === 'unconfirmed') controller.toast(tr('게시 결과를 확인하고 있습니다. 잠시 후 채널을 확인해 주세요.'))
      await writer.load().catch(() => {})
    } catch (reason) {
      if (!latest.current.text) { latest.current = content; setText(content.text) }
      controller.toast(errorText(reason, tr('글을 게시하지 못했습니다.')), 'error')
      await writer.load().catch(() => {})
    } finally { setSending(false); field.current?.focus({ preventScroll: true }) }
  }
  // ChannelService.createPost: up to 10 photos per post.
  async function addPhotos(): Promise<void> {
    if (picking || sending || photos.length >= maxPostPhotos) return
    setPicking(true)
    try {
      const files = await window.morse.pickChannelPostPhotos(accountUid, maxPostPhotos - photos.length), prepared: typeof photos = []
      for (const file of files) {
        const bytes = await prepareChannelPostPhoto(file, new AbortController().signal)
        prepared.push({ id: crypto.randomUUID(), bytes, url: await photoDataURL(bytes) })
      }
      setPhotos(current => [...current, ...prepared].slice(0, maxPostPhotos))
    } catch (reason) { controller.toast(errorText(reason, tr('사진을 준비하지 못했습니다.')), 'error') }
    finally { setPicking(false) }
  }
  const subscribers = visibility === 'subscribers'
  return <div className="compose">
    {subscribers && <p className="compose-hint">{tr('구독자에게만 공개되는 글로 게시합니다.')}</p>}
    {photos.length > 0 && <div className="channel-compose-photos">{photos.map(photo => <div key={photo.id} className="channel-compose-photo">
      <img src={photo.url} alt="" />
      <button type="button" className="icon-button small" aria-label={tr('사진 빼기')} disabled={sending} onClick={() => setPhotos(current => current.filter(item => item.id !== photo.id))}><X size={14} /></button>
    </div>)}</div>}
    <div className="compose-row">
      <button className={`icon-button channel-compose-visibility${subscribers ? ' subscribers' : ''}`} disabled={!loaded || sending}
        aria-label={subscribers ? tr('공개 범위: 구독자 (눌러서 공개로 변경)') : tr('공개 범위: 공개 (눌러서 구독자로 변경)')}
        onClick={() => change({ ...latest.current, visibility: subscribers ? 'public' : 'subscribers' })}>{subscribers ? <Lock size={20} /> : <Globe size={20} />}</button>
      <button className="icon-button" aria-label={tr('사진 추가')} title={tr('사진 추가 (최대 10장)')} disabled={!loaded || sending || picking || photos.length >= maxPostPhotos} onClick={() => { void addPhotos() }}>{picking ? <Spinner size={18} /> : <ImageIcon size={20} />}</button>
      <textarea ref={field} className="compose-field" rows={1} value={text} maxLength={5000} disabled={!loaded || sending} placeholder={tr('채널에 글 쓰기')} aria-label={tr('채널 글 작성')}
        onChange={event => change({ ...latest.current, text: event.target.value })} onBlur={() => { void flush().catch(() => {}) }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || composingKey(event.nativeEvent)) return
          const modifier = event.metaKey || event.ctrlKey
          if (enterToSend ? !event.shiftKey && !modifier && !event.altKey : modifier) { event.preventDefault(); void send() }
        }} />
      <button className="compose-send" aria-label={tr('게시')} disabled={!loaded || sending || picking || (!text.trim() && !photos.length)} onClick={() => { void send() }}>{sending ? <Spinner size={18} /> : <Send size={20} />}</button>
    </div>
  </div>
}

function PostView({ post, name, likes, likeBusy, pinned, onLike, onLikers, onMedia, onComments, onMenu }: {
  post: ChannelPostText; name: string; likes: { selected: boolean | null; count: number | null }; likeBusy: boolean; pinned: boolean
  onLike(): void; onLikers?(): void; onMedia(index: number): void; onComments(): void; onMenu(point: { x: number; y: number }): void
}) {
  const time = positionTime(post.position)
  return <article className="channel-post" onContextMenu={event => { event.preventDefault(); onMenu(pointFor(event, event.currentTarget)) }}>
    <span className="channel-post-author ellipsis">{name}</span>
    {post.hasMedia && <div className="channel-post-media">
      {/* Telegram draws a channel post's media in the post itself; a picture that is not there yet keeps its place. */}
      {post.media.map(item => item.picture && item.available
        ? <button key={item.index} type="button" className="channel-post-picture" onClick={() => onMedia(item.index)}
          aria-label={item.kind === 'video' ? tr('동영상 {0} 열기', [item.index + 1]) : tr('사진 {0} 열기', [item.index + 1])}
          style={item.picture.width && item.picture.height ? { aspectRatio: String(item.picture.width / item.picture.height) } : undefined}>
          {item.picture.status === 'ready' && item.picture.url
            ? <><img src={item.picture.url} alt="" draggable={false} decoding="async" />{item.picture.video && <span className="channel-post-play"><Film size={18} /></span>}</>
            : item.picture.status === 'error'
              ? <span className="channel-media-chip">{item.kind === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}{item.kind === 'video' ? tr('동영상') : tr('사진')} {item.index + 1}</span>
              // The post's own blurred thumb is drawn while the picture is read, as Telegram draws it under a photo.
              : item.picture.blur ? <img className="blurred" src={item.picture.blur} alt="" draggable={false} decoding="async" />
                : <Spinner size={18} />}
        </button>
        : <button key={item.index} type="button" className="channel-media-chip" disabled={!item.available} onClick={() => onMedia(item.index)}>
          {item.kind === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}{item.kind === 'video' ? tr('동영상') : item.kind === 'image' ? tr('사진') : tr('지원하지 않는 첨부')} {item.index + 1}
        </button>)}
      {post.mediaCount > post.media.length && <span className="channel-media-more">{tr('외 {0}개', [post.mediaCount - post.media.length])}</span>}
    </div>}
    {post.text && <p className="channel-post-text selectable">{post.text}</p>}
    <div className="channel-post-footer">
      <button type="button" className={`channel-like${likes.selected ? ' active' : ''}`} disabled={likeBusy || likes.selected === null} aria-pressed={likes.selected === true}
        aria-label={likes.selected ? tr('좋아요 취소') : tr('좋아요')} onClick={onLike}>
        <Heart size={14} fill={likes.selected ? 'currentColor' : 'none'} />
      </button>
      {/* iOS PostLikersView opens from the like count. */}
      {likes.count !== null && likes.count > 0 && <button type="button" className="channel-like-count" disabled={!onLikers} aria-label={tr('좋아요 누른 사람')} onClick={onLikers}>{likes.count.toLocaleString(locale())}</button>}
      <span className="channel-post-meta">
        {pinned && <Pin size={12} aria-label={tr('고정됨')} />}
        {post.visibility === 'subscribers' && <Lock size={12} aria-label={tr('구독자 공개')} />}
        {time !== null && <time dateTime={new Date(time).toISOString()}>{messageTime(time)}</time>}
      </span>
    </div>
    <button type="button" className="channel-post-comments" onClick={onComments}>
      <MessageCircle size={16} /><span>{post.commentCount ? tr('댓글 {0}개', [post.commentCount.toLocaleString(locale())]) : tr('댓글 남기기')}</span>
    </button>
  </article>
}

// HistoryWidget for a Morse channel: the feed of posts with Telegram's
// channel post bubbles, pinned bar, comments entry and author composer.
export function ChannelSection({ accountUid, channelId, oneColumn, leftmost }: { accountUid: string; channelId: string; oneColumn: boolean; leftmost: boolean }) {
  const channel = useDesktop(state => state?.channels?.items.find(item => item.id === channelId) ?? null)
  const [requestId] = useState(() => crypto.randomUUID())
  const [attempt, setAttempt] = useState(0)
  const snapshot = useDesktop(state => { const value = state?.channels?.posts; return value?.requestId === requestId && value.channelId === channelId ? value : null })
  const [count, setCount] = useState(30)
  const [likes, setLikes] = useState<Record<string, LikeOverride>>({})
  const [likeBusy, setLikeBusy] = useState<ReadonlySet<string>>(new Set())
  const busyRef = useRef(new Set<string>())
  const scroller = useRef<HTMLDivElement>(null), stick = useRef(true), anchor = useRef<number | null>(null)
  const [atBottom, setAtBottom] = useState(true), [focus, setFocus] = useState<string | null>(null)
  useEffect(() => retainChannels(accountUid), [accountUid])
  useEffect(() => {
    void window.morse.openChannelPosts(accountUid, { requestId, channelId }).catch(reason => controller.toast(errorText(reason, tr('채널 게시물을 불러오지 못했습니다.')), 'error'))
    return () => { void window.morse.closeChannelPosts(accountUid, requestId).catch(() => {}) }
  }, [accountUid, channelId, requestId, attempt])
  const posts = snapshot?.status === 'ready' ? snapshot.posts : null
  const shown = useMemo(() => (posts ?? []).slice(0, count).reverse(), [posts, count])
  const name = channel?.status === 'ready' ? channel.name : tr('채널')
  const pinnedId = snapshot?.pins?.reference.status === 'known' ? snapshot.pins.reference.postId : null
  const pinnedPost = pinnedId ? posts?.find(post => post.id === pinnedId) ?? null : null
  const unresolvedPin = referencedUnpinnedPost(snapshot)
  // The channel still names a post whose own pin flag is off; the owner chooses which side wins.
  const resolvePin = (action: 'restore' | 'clear'): void => {
    if (!snapshot) return
    try { reportResult(window.morse.resolveChannelPostPin(accountUid, preparePinResolution(snapshot, action)), action === 'restore' ? tr('게시물을 다시 고정했습니다.') : tr('고정을 비웠습니다.')) }
    catch (reason) { controller.toast(errorText(reason, tr('고정 정보를 다시 확인해 주세요.')), 'error') }
  }

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    if (focus) {
      const row = element.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(focus)}"]`)
      if (row) {
        row.scrollIntoView({ block: 'center' }); row.classList.add('highlight')
        setTimeout(() => row.classList.remove('highlight'), 1500); setFocus(null); return
      }
    }
    if (anchor.current !== null) { element.scrollTop = element.scrollHeight - anchor.current; anchor.current = null }
    else if (stick.current) element.scrollTop = element.scrollHeight
  }, [shown, focus])

  const loadOlder = (): void => {
    const element = scroller.current
    if (!posts || count >= posts.length) return
    if (element) anchor.current = element.scrollHeight - element.scrollTop
    setCount(value => Math.min(posts.length, value + 30))
  }
  const onScroll = (): void => {
    const element = scroller.current
    if (!element) return
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    stick.current = bottom; setAtBottom(bottom)
    if (element.scrollTop < 200) loadOlder()
  }
  const jumpTo = (postId: string): void => {
    const index = posts?.findIndex(post => post.id === postId) ?? -1
    if (index < 0) return
    stick.current = false
    if (index >= count) setCount(index + 1)
    setFocus(postId)
  }
  // The channel tab's feed opens a channel at the pressed post.
  const openedAt = useUi(state => state.channelId === channelId ? state.channelPostId : null)
  useEffect(() => {
    if (!openedAt || !posts) return
    jumpTo(openedAt); controller.clearChannelPost()
  }, [openedAt, posts])

  function likeState(post: ChannelPostText): { selected: boolean | null; count: number | null } {
    const override = likes[post.id]
    if (override && override.revision === post.revision && post.likes.selected !== override.selected) return override
    return { selected: post.likes.selected, count: post.likes.count }
  }
  function toggleLike(post: ChannelPostText): void {
    if (busyRef.current.has(post.id)) return
    const info = post.likes
    if (info.status !== 'ready' || info.selected === null || info.count === null) { controller.toast(info.message || tr('좋아요 상태를 확인하고 있습니다.')); return }
    let request
    try { request = channelPostLikeRequest({ id: crypto.randomUUID(), requestId, channelId, postId: post.id, revision: post.revision, selected: info.selected, count: info.count, desired: !info.selected }) }
    catch (reason) { controller.toast(errorText(reason, tr('좋아요를 변경할 수 없습니다.')), 'error'); return }
    const desired = request.desired, base = info.count
    const setBusy = (busy: boolean): void => { if (busy) busyRef.current.add(post.id); else busyRef.current.delete(post.id); setLikeBusy(new Set(busyRef.current)) }
    const revert = (): void => setLikes(value => { const next = { ...value }; delete next[post.id]; return next })
    setBusy(true)
    setLikes(value => ({ ...value, [post.id]: { revision: post.revision, selected: desired, count: Math.max(0, base + (desired ? 1 : -1)) } }))
    void trackWrite(window.morse.setChannelPostLike(accountUid, request)).then(result => {
      if (result.outcome === 'rejected') { revert(); controller.toast(result.message, 'error') }
      else if (result.outcome === 'uncertain') controller.toast(result.message)
    }).catch(() => { revert(); controller.toast(tr('좋아요를 변경하지 못했습니다.'), 'error') }).finally(() => setBusy(false))
  }

  function openPostMenu(state: ChannelPostsSnapshot, post: ChannelPostText, point: { x: number; y: number }): void {
    const base = postPinBase(state), owner = state.pins?.owned === true
    const sharing = channel?.status === 'ready' ? channel.publicSharing : null
    const canPin = owner && post.own && Boolean(base) && post.pinFlag === 'unpinned' && post.editableText !== null
    const canUnpin = owner && base?.previous?.id === post.id
    const pin = (next: string | null): void => {
      try { reportResult(window.morse.saveChannelPostPin(accountUid, preparePostPin(state, next)), next ? tr('게시물을 고정했습니다.') : tr('고정을 해제했습니다.')) }
      catch (reason) { controller.toast(errorText(reason, tr('고정 정보를 다시 확인해 주세요.')), 'error') }
    }
    const clearExtra = (): void => {
      try { reportResult(window.morse.clearChannelPostExtraPin(accountUid, prepareExtraPin(state, post.id)), tr('별도 고정 표시를 해제했습니다.')) }
      catch (reason) { controller.toast(errorText(reason, tr('고정 정보를 다시 확인해 주세요.')), 'error') }
    }
    const edit = (): void => {
      const original = post.editableText
      if (original === null) return
      showTextEditBox({ title: tr('게시물 수정'), label: tr('본문'), initial: original, maxLength: 5000, multiline: true, allowEmpty: false,
        save: text => window.morse.saveChannelPostText(accountUid, { id: crypto.randomUUID(), requestId, channelId, postId: post.id, revision: post.revision, original, text }) })
    }
    const visibility = (): void => {
      try { reportResult(window.morse.setPostVisibility(accountUid, preparePostVisibility(state, post.id)), tr('공개 범위를 변경했습니다.')) }
      catch (reason) { controller.toast(errorText(reason, tr('공개 범위를 다시 확인해 주세요.')), 'error') }
    }
    const remove = async (): Promise<void> => {
      let target
      try { target = preparePostRemovalReview(state, post.id).target }
      catch (reason) { controller.toast(errorText(reason, tr('게시물을 다시 확인해 주세요.')), 'error'); return }
      if (!await confirmBox({ title: tr('게시물 삭제'), text: tr('이 게시물을 채널에서 삭제할까요?'), confirm: tr('삭제'), danger: true })) return
      reportResult(window.morse.removeChannelPost(accountUid, target), tr('게시물을 삭제했습니다.'))
    }
    popupMenu.open(point, [
      { label: tr('댓글 보기'), icon: <MessageCircle size={18} />, onSelect: () => openComments(channelId, post.id) },
      post.text ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { const copied = copyText(post.text); controller.toast(copied ? tr('텍스트를 복사했습니다.') : tr('텍스트를 복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null,
      sharing && post.visibility === 'public' ? { label: tr('링크 복사'), icon: <Link size={18} />, onSelect: () => {
        void window.morse.copyListedChannelLink(accountUid, { requestId, channelId, channelVersion: sharing.version, post: { id: post.id, revision: post.revision } })
          .then(() => controller.toast(tr('게시물 링크를 복사했습니다.'))).catch(reason => controller.toast(errorText(reason, tr('링크를 복사하지 못했습니다.')), 'error'))
      } } : null,
      post.own || canUnpin ? 'separator' : null,
      canPin ? { label: base?.previous ? tr('이 게시물로 고정 교체') : tr('고정'), icon: <Pin size={18} />, onSelect: () => pin(post.id) } : null,
      canUnpin ? { label: tr('고정 해제'), icon: <PinOff size={18} />, onSelect: () => pin(null) } : null,
      canClearExtraPin(state, post.id) ? { label: tr('별도 고정 표시 해제'), icon: <PinOff size={18} />, onSelect: clearExtra } : null,
      post.own && post.editableText !== null ? { label: tr('수정'), icon: <Pencil size={18} />, onSelect: edit } : null,
      post.own && visibilityEditable(state, post.id) ? { label: post.visibility === 'public' ? tr('구독자에게만 공개') : tr('모두에게 공개'), icon: post.visibility === 'public' ? <Lock size={18} /> : <Globe size={18} />, onSelect: visibility } : null,
      post.own && state.pins?.channelVersion ? { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void remove() } } : null,
      // iOS ChannelDetailView post menu «신고» (ChannelReportView .post).
      !post.own ? 'separator' : null,
      !post.own ? { label: tr('신고'), icon: <Flag size={18} />, danger: true, onSelect: () => showReportBox(accountUid, { type: 'post', targetId: post.id, channelId }, tr('신고')) } : null
    ])
  }

  const authoring = snapshot?.authoring ?? null
  const bottom = authoring?.permission === 'allowed' ? <ChannelComposer accountUid={accountUid} channelId={channelId} />
    : snapshot?.status === 'ready' ? <div className="compose"><div className="compose-blocked">{authoring && authoring.role !== 'none' ? tr('이 채널에 글을 쓸 권한이 없습니다.') : channel?.owned ? tr('글 작성 권한을 확인하고 있습니다.') : tr('구독 중인 채널입니다.')}</div></div> : null

  let previousTime: number | null = null
  return <section className="channel-section" aria-label={name}>
    <header className={`top-bar${leftmost ? ' leftmost' : ''}`}>
      {oneColumn && <button className="icon-button" aria-label={tr('뒤로')} onClick={() => controller.closeChat()}><ArrowLeft size={20} /></button>}
      <button type="button" className="top-bar-peer" onClick={() => controller.toggleRight('info')}>
        <Avatar name={name} url={channel?.avatar?.status === 'ready' ? channel.avatar.url : null} size={40} kind="channel" />
        <span className="top-bar-title"><strong className="ellipsis">{name}</strong><span className="ellipsis">{channelSubtitle(channel)}</span></span>
      </button>
      <button className="icon-button" aria-label={tr('채널 정보')} onClick={() => controller.toggleRight('info')}><Info size={20} /></button>
    </header>
    {unresolvedPin && <div className="channel-pin-status" role="status">
      <PinOff size={18} /><span>{tr('고정된 게시물의 고정 표시가 꺼져 있습니다.')}</span>
      <button className="button flat" onClick={() => resolvePin('restore')}>{tr('다시 고정')}</button>
      <button className="button flat" onClick={() => resolvePin('clear')}>{tr('고정 비우기')}</button>
    </div>}
    {pinnedPost && !unresolvedPin && <button type="button" className="channel-pinned" onClick={() => jumpTo(pinnedPost.id)}>
      <Pin size={18} /><span className="channel-pinned-text"><strong>{tr('고정된 게시물')}</strong><span className="ellipsis">{pinnedPost.text || (pinnedPost.hasMedia ? tr('미디어') : tr('게시물'))}</span></span>
    </button>}
    <div className="channel-feed" ref={scroller} onScroll={onScroll}>
      {!snapshot || snapshot.status === 'loading' ? <div className="channel-feed-state" role="status"><Spinner size={26} /></div>
        : snapshot.status !== 'ready' ? <div className="channel-feed-state" role="status"><p>{snapshot.message || tr('채널 게시물을 불러오지 못했습니다.')}</p><button className="button secondary" onClick={() => setAttempt(value => value + 1)}>{tr('다시 시도')}</button></div>
          : !shown.length ? <div className="channel-feed-state"><span className="service-pill">{tr('아직 게시물이 없습니다')}</span></div>
            : <>
              {posts && count < posts.length && <div className="channel-feed-more"><button className="button flat" onClick={loadOlder}>{tr('이전 게시물 더 보기')}</button></div>}
              {shown.map(post => {
                const time = positionTime(post.position)
                const date = time !== null && (previousTime === null || !sameDay(previousTime, time))
                if (time !== null) previousTime = time
                return <div key={post.id}>
                  {date && time !== null && <div className="history-date"><span className="service-pill">{serviceDate(time)}</span></div>}
                  <div className="channel-post-row" data-post-id={post.id}>
                    <PostView post={post} name={name} likes={likeState(post)} likeBusy={likeBusy.has(post.id)} pinned={post.id === pinnedId}
                      onLike={() => toggleLike(post)} onLikers={() => showPostLikers(accountUid, channelId, post.id)} onMedia={index => showChannelMedia(accountUid, channelId, requestId, post, index, name)}
                      onComments={() => openComments(channelId, post.id)} onMenu={point => openPostMenu(snapshot, post, point)} />
                  </div>
                </div>
              })}
            </>}
    </div>
    {!atBottom && shown.length > 0 && <button className="history-down channel-down" aria-label={tr('최신 게시물로 이동')} onClick={() => {
      const element = scroller.current
      if (element) { stick.current = true; element.scrollTop = element.scrollHeight }
    }}><ArrowDown size={20} /></button>}
    {bottom}
  </section>
}
