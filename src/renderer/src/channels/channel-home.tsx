import { useEffect, useMemo, useRef, useState } from 'react'
import { usePostReads } from './post-reads'
import { ArrowLeft, ChevronRight, CircleDashed, Compass, Film, Heart, Image as ImageIcon, Megaphone, MessageCircle, PenSquare, Plus, Search } from 'lucide-react'
import { channelCategories, type ChannelCategoryId, type ChannelHomeChannel, type ChannelHomePost, type ChannelHomeSnapshot } from '../../../shared/channel-home'
import { channelDiscoveryRequest, type ChannelDiscoveryRow } from '../../../shared/channel-discovery'
import { channelShareURL } from '../../../shared/channel-share'
import { positionMilliseconds } from '../../../shared/model'
import { useDesktop } from '../app/store'
import { controller, useUi } from '../app/ui'
import { errorText } from '../app/format'
import { retainChannels } from '../app/channel-visibility'
import { AvatarScope, Avatar, PeerAvatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { showChannelCreateBox } from '../boxes/channel-create-box'
import { showChannelDiscoveryBox } from './channel-discovery-box'
import { ChannelStoryRing, showChannelStoryComposer, useChannelStoryVisibility } from './channel-stories'
import { locale, tr } from '../../../shared/i18n'
import { subscriberCountText } from '../../../shared/channel-subscriber-count'

const noChannels: ChannelHomeChannel[] = []

// ChannelFeedView.formatSubscribers, shared now with the channel subtitle and the discovery box.
function subscribers(count: number | null): string {
  return count === null ? '' : subscriberCountText(count)
}
// ChannelFeedTimelinePostCard.relativeTime.
function relativeTime(time: number, now = Date.now()): string {
  const seconds = (now - time) / 1000
  if (seconds < 60) return tr('방금')
  if (seconds < 3600) return tr('{0}분 전', [Math.floor(seconds / 60)])
  if (seconds < 86400) return tr('{0}시간 전', [Math.floor(seconds / 3600)])
  if (seconds < 604800) return tr('{0}일 전', [Math.floor(seconds / 86400)])
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(time)
}
// MorseChannelFeedPreviewAspect: a picture between 3:4 and 1.91:1.
function aspect(width: number, height: number): number {
  return width > 0 && height > 0 ? Math.min(Math.max(width / height, 3 / 4), 1.91) : 1
}

// A channel in the account's list opens in the chat pane; any other channel opens its public preview.
function openChannel(accountUid: string, channelId: string, listed: boolean, postId: string | null = null): void {
  if (listed) controller.openChannel(channelId, postId)
  else showChannelDiscoveryBox(accountUid, channelShareURL(channelId, postId ?? undefined))
}

function ChannelAvatar({ channel, size }: { channel: Pick<ChannelHomeChannel, 'id' | 'name' | 'avatar'>; size: number }) {
  return <PeerAvatar id={channel.id} name={channel.name || tr('채널')} image={channel.avatar} size={size} kind="channel" surface="channels" />
}

function PostCard({ accountUid, post, channel }: { accountUid: string; post: ChannelHomePost; channel: ChannelHomeChannel }) {
  const time = positionMilliseconds(post.position)
  const open = (): void => openChannel(accountUid, post.channelId, channel.listed, post.id)
  const image = post.image
  // ChannelFeedInteractiveTimelineRow.toggleLike: the heart changes at once and goes back if the write fails.
  const [pending, setPending] = useState<boolean | null>(null)
  const liked = pending ?? post.liked
  const likeCount = post.likeCount === null ? null : Math.max(0, post.likeCount + (pending === null || post.liked === null || pending === post.liked ? 0 : pending ? 1 : -1))
  useEffect(() => { if (pending !== null && pending === post.liked) setPending(null) }, [post.liked, pending])
  async function like(): Promise<void> {
    if (pending !== null || post.liked === null) { if (post.liked === null) open(); return }
    setPending(!post.liked)
    try { await window.morse.likeChannelHomePost(accountUid, post.channelId, post.id) }
    catch (reason) { setPending(null); controller.toast(errorText(reason, tr('좋아요를 바꾸지 못했습니다.')), 'error') }
  }
  return <article className="channel-home-post" data-channel-id={post.channelId} data-post-id={post.id}>
    <button type="button" className="channel-home-post-header" onClick={() => openChannel(accountUid, channel.id, channel.listed)}>
      <ChannelAvatar channel={channel} size={32} />
      <span className="channel-home-post-name ellipsis">{channel.name}</span>
      <span className="channel-home-post-time">· {relativeTime(time)}</span>
      {post.promoted && <span className="channel-home-badge">{tr('홍보')}</span>}
    </button>
    <button type="button" className="channel-home-post-body" onClick={open} aria-label={tr('게시물 열기')}>
      {post.mediaCount > 0 && (image?.status === 'ready' && image.url
        ? <span className="channel-home-post-image" style={{ aspectRatio: String(aspect(image.width, image.height)) }}>
          <img src={image.url} alt="" draggable={false} decoding="async" />
          {image.video && <span className="channel-home-post-video"><Film size={18} /></span>}
          {post.mediaCount > 1 && <span className="channel-home-post-count">1/{post.mediaCount}</span>}
        </span>
        : image && (image.status === 'loading' || image.status === 'idle')
          // immediateThumbnailData: the post's own blurred thumb holds the place, at the picture's own shape.
          ? <span className={`channel-home-post-image${image.blur ? '' : ' placeholder'}`} style={image.width && image.height ? { aspectRatio: String(aspect(image.width, image.height)) } : undefined}>
            {image.blur ? <img className="blurred" src={image.blur} alt="" draggable={false} decoding="async" /> : <Spinner size={18} />}
          </span>
          : <span className="channel-home-post-media">{image?.video ? <Film size={16} /> : <ImageIcon size={16} />}{tr('첨부 {0}개', [post.mediaCount])}</span>)}
      {post.text && <span className="channel-home-post-text">{post.text}</span>}
    </button>
    <div className="channel-home-post-footer">
      <button type="button" className={`channel-home-post-action${liked ? ' liked' : ''}`} onClick={() => { void like() }} aria-label={tr('좋아요')} aria-pressed={liked ?? undefined}>
        <Heart size={17} fill={liked ? 'currentColor' : 'none'} />{likeCount ? likeCount.toLocaleString(locale()) : ''}
      </button>
      <button type="button" className="channel-home-post-action" onClick={open} aria-label={tr('댓글')}><MessageCircle size={17} />{post.commentCount ? post.commentCount.toLocaleString(locale()) : ''}</button>
    </div>
  </article>
}

function Feed({ accountUid, home }: { accountUid: string; home: ChannelHomeSnapshot }) {
  const byId = useMemo(() => new Map(home.channels.map(channel => [channel.id, channel])), [home.channels])
  const mine = home.mine
  // ChannelFeedView.presentChannelPlusAnchorMenu: one channel per account, a post goes to it.
  function plusMenu(point: { x: number; y: number }): void {
    popupMenu.open(point, [
      { label: tr('채널 만들기'), icon: <Megaphone size={18} />, onSelect: () => { void createChannel() } },
      { label: tr('게시물', [], 'kind'), icon: <PenSquare size={18} />, onSelect: () => { if (mine) controller.openChannel(mine.id); else showChannelCreateBox(accountUid) } },
      { label: tr('채널 스토리'), icon: <CircleDashed size={18} />, onSelect: () => { if (mine) showChannelStoryComposer(accountUid, mine); else showChannelCreateBox(accountUid) } }
    ])
  }
  async function createChannel(): Promise<void> {
    if (!mine) { showChannelCreateBox(accountUid); return }
    if (await confirmBox({ title: tr('채널이 이미 있어요'), text: tr('계정당 1개의 채널만 만들 수 있어요.'), confirm: tr('내 채널로 이동') })) controller.openChannel(mine.id)
  }
  const empty = !mine && !home.subscribed.length && !home.posts.length
  const feedPosts = useRef<HTMLDivElement>(null)
  usePostReads(accountUid, feedPosts, home.posts.length > 0)
  useChannelStoryVisibility(accountUid, [...(mine ? [mine.id] : []), ...home.subscribed.map(channel => channel.id)])
  return <>
    <div className="channel-home-actions">
      <button type="button" className="channel-home-chip" onClick={() => controller.setChannelExplore(true)}><Compass size={16} />{tr('채널 탐색')}</button>
      <button type="button" className="icon-button small" aria-label={tr('만들기')} title={tr('만들기')} onClick={event => plusMenu(pointFor(event, event.currentTarget))}><Plus size={20} /></button>
    </div>
    {home.status === 'loading' && empty ? <div className="dialogs-empty" role="status"><Spinner size={22} /></div>
      : home.status === 'error' && empty ? <div className="dialogs-empty" role="alert">
        <p>{tr('채널 목록을 불러오지 못했습니다.')}</p>
        <button type="button" className="button secondary" onClick={() => { void window.morse.refreshChannelHome(accountUid).catch(() => {}) }}>{tr('다시 시도')}</button>
      </div>
      : empty ? <div className="dialogs-empty">
        <Megaphone size={40} />
        <strong>{tr('아직 채널이 없어요')}</strong>
        <button type="button" className="button secondary" onClick={() => showChannelCreateBox(accountUid)}>{tr('채널 만들기')}</button>
      </div>
      : <>
        {mine && <div className="channel-home-mine">
          <ChannelStoryRing accountUid={accountUid} channel={mine} owned size={36} onOpen={() => controller.openChannel(mine.id)} />
          <button type="button" className="channel-home-mine-open" onClick={() => controller.openChannel(mine.id)}>
            <span className="channel-home-mine-name ellipsis">{mine.name}</span>
            <span className="channel-home-badge">MY</span>
            <span className="channel-home-mine-count">{subscribers(mine.subscriberCount)}</span>
            <ChevronRight size={14} className="channel-home-chevron" />
          </button>
        </div>}
        {home.subscribed.length > 0 && <section className="channel-home-strip" aria-label={tr('구독 중', [], 'strip')}>
          <span className="channel-home-label">{tr('구독 중', [], 'strip')}</span>
          <div className="channel-home-strip-row">
            {home.subscribed.map(channel => <div key={channel.id} className="channel-home-strip-item" title={channel.name}>
              <ChannelStoryRing accountUid={accountUid} channel={channel} owned={channel.owned} size={52} onOpen={() => openChannel(accountUid, channel.id, channel.listed)} />
              <button type="button" className="ellipsis" onClick={() => openChannel(accountUid, channel.id, channel.listed)}>{channel.name}</button>
            </div>)}
          </div>
        </section>}
        {/* MorseChannelFeedReadTracker: a post of the feed on screen is read in its channel. */}
        <div ref={feedPosts} style={{ display: 'contents' }}>
          {home.posts.map(post => { const channel = byId.get(post.channelId); return channel ? <PostCard key={`${post.promoted ? 'p' : 'f'}:${post.id}`} accountUid={accountUid} post={post} channel={channel} /> : null })}
        </div>
      </>}
  </>
}

function ChannelRow({ channel, onOpen }: { channel: { id: string; name: string; description: string; subscriberCount: number | null; avatar?: ChannelHomeChannel['avatar'] }; onOpen(): void }) {
  return <button type="button" className="channel-home-row" onClick={onOpen}>
    {channel.avatar !== undefined ? <ChannelAvatar channel={{ id: channel.id, name: channel.name, avatar: channel.avatar }} size={52} /> : <Avatar name={channel.name} size={52} kind="channel" />}
    <span className="channel-home-row-body">
      <strong className="ellipsis">{channel.name}</strong>
      <span className="ellipsis">{subscribers(channel.subscriberCount)}</span>
      {channel.description && <span className="ellipsis">{channel.description}</span>}
    </span>
    <ChevronRight size={14} className="channel-home-chevron" />
  </button>
}

function Explore({ accountUid, home, query }: { accountUid: string; home: ChannelHomeSnapshot | null; query: string }) {
  const [tab, setTab] = useState<'trending' | 'new'>('trending')
  const [searchId, setSearchId] = useState<string | null>(null)
  const search = useDesktop(state => searchId && state?.channelDiscovery?.requestId === searchId ? state.channelDiscovery : null)
  const listed = useDesktop(state => state?.channels?.items)
  const listedIds = useMemo(() => new Set((listed ?? []).filter(item => item.status === 'ready').map(item => item.id)), [listed])
  const text = query.trim()
  // ChannelExplorePane.runSearch: public channels by name prefix and tag, 150 ms after typing stops.
  useEffect(() => {
    if (!text) { setSearchId(null); return }
    let request: ReturnType<typeof channelDiscoveryRequest>
    try { request = channelDiscoveryRequest({ requestId: crypto.randomUUID(), query: text }) } catch { setSearchId(null); return }
    const timer = setTimeout(() => {
      setSearchId(request.requestId)
      void window.morse.searchPublicChannels(accountUid, request).catch(() => {})
    }, 150)
    return () => { clearTimeout(timer); void window.morse.closeChannelDiscovery(accountUid, request.requestId).catch(() => {}) }
  }, [accountUid, text])
  const back = (): void => { controller.setQuery(''); controller.setChannelExplore(false); void window.morse.closeChannelCategory(accountUid).catch(() => {}) }
  const category = home?.category ?? null
  const categoryInfo = category ? channelCategories.find(item => item.id === category.id) : undefined

  if (text) return <div className="channel-home-explore">
    <button type="button" className="channel-home-back" onClick={back}><ArrowLeft size={16} />{tr('채널 탐색')}</button>
    <span className="channel-home-section-title">{tr('검색 결과')}</span>
    {!search || search.status === 'loading' ? <div className="dialogs-empty" role="status"><Spinner size={22} /></div>
      : search.status === 'ready' && search.rows.length ? <div className="channel-home-list">
        {search.rows.map((row: ChannelDiscoveryRow) => <ChannelRow key={row.id} channel={row} onOpen={() => openChannel(accountUid, row.id, listedIds.has(row.id))} />)}
      </div>
      : <div className="dialogs-empty"><Search size={36} /><p>{search.status === 'ready' ? tr('검색 결과가 없어요') : search.message || tr('채널을 찾지 못했습니다.')}</p></div>}
  </div>

  if (category) return <div className="channel-home-explore">
    <button type="button" className="channel-home-back" onClick={() => { void window.morse.closeChannelCategory(accountUid).catch(() => {}) }}><ArrowLeft size={16} />{tr('채널 탐색')}</button>
    <h2 className="channel-home-category-title"><span aria-hidden="true">{categoryInfo?.emoji}</span>{categoryInfo?.title}</h2>
    {category.status === 'loading' ? <div className="dialogs-empty" role="status"><Spinner size={22} /></div>
      : category.channels.length ? <div className="channel-home-list">
        {category.channels.map(channel => <ChannelRow key={channel.id} channel={channel} onOpen={() => openChannel(accountUid, channel.id, channel.listed)} />)}
      </div>
      : <div className="dialogs-empty"><Search size={36} /><p>{category.status === 'error' ? tr('채널 목록을 불러오지 못했습니다.') : tr('이 카테고리에 아직 채널이 없어요')}</p></div>}
  </div>

  // ChannelExplorePane.railChannels: promoted channels first, then the chosen list without them.
  const base = tab === 'trending' ? home?.discover.trending ?? noChannels : home?.discover.newest ?? noChannels
  const promoted = home?.discover.promoted ?? noChannels
  const rail = [...promoted, ...base.filter(channel => !promoted.some(item => item.id === channel.id))].slice(0, 12)
  return <div className="channel-home-explore">
    <button type="button" className="channel-home-back" onClick={back}><ArrowLeft size={16} />{tr('채널')}</button>
    <span className="channel-home-section-title">{tr('카테고리')}</span>
    <div className="channel-home-categories">
      {channelCategories.map(item => <button key={item.id} type="button" className="channel-home-category" onClick={() => { void window.morse.openChannelCategory(accountUid, item.id satisfies ChannelCategoryId).catch(() => {}) }}>
        <span className="channel-home-category-emoji" aria-hidden="true">{item.emoji}</span>
        <span className="ellipsis">{item.title}</span>
        <ChevronRight size={12} className="channel-home-chevron" />
      </button>)}
    </div>
    <div className="channel-home-rail-header">
      <span className="channel-home-section-title">{tr('추천 채널')}</span>
      <span className="channel-home-segments" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'trending'} onClick={() => setTab('trending')}>{tr('인기 채널')}</button>
        <button type="button" role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}>{tr('새로운 채널')}</button>
      </span>
    </div>
    {!home || home.discover.status === 'loading' ? <div className="dialogs-empty" role="status"><Spinner size={22} /></div>
      : !rail.length ? <p className="channel-home-note">{tr('이 카테고리에 아직 채널이 없어요')}</p>
      : <div className="channel-home-rail">
        {rail.map(channel => <button key={channel.id} type="button" className="channel-home-card" onClick={() => openChannel(accountUid, channel.id, channel.listed)}>
          <span className="channel-home-card-photo"><ChannelAvatar channel={channel} size={56} /></span>
          <strong className="ellipsis">{channel.name}</strong>
          <span className="ellipsis">{subscribers(channel.subscriberCount)}</span>
        </button>)}
      </div>}
  </div>
}

// iOS ChannelFeedView (the channel tab): my channel, the «구독 중» strip, recent posts of subscribed
// channels, and ChannelExplorePane with search, categories and recommended channels.
export function ChannelHome({ accountUid, query }: { accountUid: string; query: string }) {
  const home = useDesktop(state => state?.channelHome ?? null)
  const exploring = useUi(state => state.channelExplore) || Boolean(query.trim())
  useEffect(() => retainChannels(accountUid), [accountUid])
  useEffect(() => {
    void window.morse.openChannelHome(accountUid).catch(() => {})
    const visible = (): void => { if (!document.hidden) void window.morse.openChannelHome(accountUid).catch(() => {}) }
    document.addEventListener('visibilitychange', visible)
    return () => { document.removeEventListener('visibilitychange', visible); void window.morse.closeChannelHome(accountUid).catch(() => {}) }
  }, [accountUid])
  return <AvatarScope accountUid={accountUid} enabled surface="channels">
    <div className="dialogs-scroll channel-home">
      {exploring ? <Explore accountUid={accountUid} home={home} query={query} />
        : home ? <Feed accountUid={accountUid} home={home} /> : <div className="dialogs-empty" role="status"><Spinner size={22} /></div>}
    </div>
  </AvatarScope>
}
