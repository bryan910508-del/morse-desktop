import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Film, Heart, Image as ImageIcon, Link, Megaphone, MessageCircle, Search } from 'lucide-react'
import { channelDiscoveryRequest } from '../../../shared/channel-discovery'
import { publicChannelLinkRequest } from '../../../shared/channel-share'
import { channelPostLikeRequest } from '../../../shared/channel-post-like'
import type { PublicChannelPost, PublicChannelPreviewSnapshot } from '../../../shared/channel-public-preview'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText, messageTime, positionTime, serviceDate } from '../app/format'
import { copyText } from '../app/clipboard'
import { trackWrite } from '../app/drafts'
import { waitFor } from '../app/contacts'
import { retainChannels } from '../app/channel-visibility'
import { Avatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { Box } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { CommentsThread } from './channel-comments-panel'
import { showChannelMedia } from './channel-media-viewer'
import { locale, tr } from '../../../shared/i18n'

interface LikeOverride { revision: string; selected: boolean; count: number }

function PreviewPost({ post, likes, likeBusy, onLike, onMedia, onComments, onMenu }: {
  post: PublicChannelPost; likes: { selected: boolean | null; count: number | null }; likeBusy: boolean
  onLike(): void; onMedia(index: number): void; onComments(): void; onMenu(point: { x: number; y: number }): void
}) {
  const time = positionTime(post.position)
  return <article className="channel-post" onContextMenu={event => { event.preventDefault(); onMenu(pointFor(event, event.currentTarget)) }}>
    {post.hasMedia && <div className="channel-post-media">
      {post.media.map(item => <button key={item.index} type="button" className="channel-media-chip" disabled={!item.available} onClick={() => onMedia(item.index)}>
        {item.kind === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}{item.kind === 'video' ? tr('동영상') : item.kind === 'image' ? tr('사진') : tr('지원하지 않는 첨부')} {item.index + 1}
      </button>)}
      {post.mediaCount > post.media.length && <span className="channel-media-more">{tr('외 {0}개', [post.mediaCount - post.media.length])}</span>}
    </div>}
    {post.text && <p className="channel-post-text selectable">{post.text}</p>}
    <div className="channel-post-footer">
      <button type="button" className={`channel-like${likes.selected ? ' active' : ''}`} disabled={likeBusy || likes.selected === null} aria-pressed={likes.selected === true}
        aria-label={likes.selected ? tr('좋아요 취소') : tr('좋아요')} onClick={onLike}>
        <Heart size={14} fill={likes.selected ? 'currentColor' : 'none'} />{likes.count !== null && likes.count > 0 ? likes.count.toLocaleString(locale()) : ''}
      </button>
      <span className="channel-post-meta">{time !== null && <time dateTime={new Date(time).toISOString()}>{serviceDate(time)} {messageTime(time)}</time>}</span>
    </div>
    <button type="button" className="channel-post-comments" onClick={onComments}>
      <MessageCircle size={16} /><span>{post.commentCount ? tr('댓글 {0}개', [post.commentCount.toLocaleString(locale())]) : tr('댓글 남기기')}</span>
    </button>
  </article>
}

// Public channel search with Telegram's channel preview: posts, likes, comments,
// media and sharing are available before joining.
function ChannelDiscoveryBox({ accountUid, initialLink, close }: { accountUid: string; initialLink?: string; close(): void }) {
  const [query, setQuery] = useState(''), [link, setLink] = useState(initialLink ?? '')
  const [searchId, setSearchId] = useState<string | null>(null), [previewId, setPreviewId] = useState<string | null>(null)
  const [error, setError] = useState(''), [joining, setJoining] = useState(false), [feedBusy, setFeedBusy] = useState(false)
  const [commentsPost, setCommentsPost] = useState<string | null>(null), [count, setCount] = useState(30)
  const [photoId, setPhotoId] = useState<string | null>(null), [memberId, setMemberId] = useState<string | null>(null)
  const [likes, setLikes] = useState<Record<string, LikeOverride>>({})
  const [likeBusy, setLikeBusy] = useState<ReadonlySet<string>>(new Set())
  const busyRef = useRef(new Set<string>())
  const search = useDesktop(state => { const value = state?.channelDiscovery; return searchId && value?.requestId === searchId ? value : null })
  const preview = useDesktop(state => { const value = state?.channelPublicPreview; return previewId && value?.requestId === previewId ? value : null })
  const previewChannel = preview?.channelId ?? null
  const readyChannel = preview?.status === 'ready' && preview.metadata ? preview.channelId : null
  const listed = useDesktop(state => previewChannel ? Boolean(state?.channels?.items.some(item => item.id === previewChannel && item.status === 'ready' && (item.owned || item.subscriptionListed))) : false)
  useEffect(() => retainChannels(accountUid), [accountUid])
  useEffect(() => () => { if (searchId) void window.morse.closeChannelDiscovery(accountUid, searchId).catch(() => {}) }, [accountUid, searchId])
  useEffect(() => {
    setCommentsPost(null); setLikes({}); setCount(30)
    return () => { if (previewId) void window.morse.closePublicChannelPreview(accountUid, previewId).catch(() => {}) }
  }, [accountUid, previewId])
  useEffect(() => {
    if (preview?.status === 'ready' && !preview.postsRequested && previewId) void window.morse.loadPublicPreviewPosts(accountUid, previewId).catch(() => {})
  }, [preview?.status, preview?.postsRequested, previewId])
  // The channel photo, cover and the viewer's own join request are read with the preview.
  useEffect(() => {
    if (!previewId || !readyChannel) return
    const photos = crypto.randomUUID(), member = crypto.randomUUID()
    setPhotoId(photos); setMemberId(member)
    void window.morse.openPublicPreviewPhotos(accountUid, { requestId: photos, previewRequestId: previewId, channelId: readyChannel }).catch(() => {})
    void window.morse.openPublicPreviewMembership(accountUid, { requestId: member, channelId: readyChannel }).catch(() => {})
    return () => {
      void window.morse.closePublicPreviewPhotos(accountUid, photos).catch(() => {})
      void window.morse.closePublicPreviewMembership(accountUid, member).catch(() => {})
    }
  }, [accountUid, previewId, readyChannel])

  function runSearch(): void {
    let request
    try { request = channelDiscoveryRequest({ requestId: crypto.randomUUID(), query }) }
    catch (reason) { setError(errorText(reason, tr('검색어를 확인해 주세요.'))); return }
    setError(''); setPreviewId(null); setSearchId(request.requestId)
    void window.morse.searchPublicChannels(accountUid, request).catch(reason => setError(errorText(reason, tr('채널을 찾지 못했습니다.'))))
  }
  function openLink(): void {
    let request
    try { request = publicChannelLinkRequest({ requestId: crypto.randomUUID(), url: link }) }
    catch (reason) { setError(errorText(reason, tr('채널 링크를 확인해 주세요.'))); return }
    setError(''); setPreviewId(request.requestId)
    void window.morse.openPublicChannelLink(accountUid, request).catch(reason => { setPreviewId(null); setError(errorText(reason, tr('채널 링크를 열지 못했습니다.'))) })
  }
  // A channel address pressed in a message opens its preview at once, as the iOS deep link sheet does.
  useEffect(() => { if (initialLink) openLink() }, [])
  function openRow(channelId: string, version: string): void {
    if (!searchId) return
    const id = crypto.randomUUID()
    setError(''); setPreviewId(id)
    void window.morse.openPublicChannelPreview(accountUid, { requestId: id, searchRequestId: searchId, channelId, version })
      .catch(reason => { setPreviewId(null); setError(errorText(reason, tr('채널을 열지 못했습니다.'))) })
  }
  function open(channelId: string): void { close(); controller.openChannel(channelId) }
  async function join(): Promise<void> {
    if (!preview || joining) return
    const channelId = preview.channelId
    setJoining(true)
    try {
      const result = await trackWrite(window.morse.joinChannel(accountUid, channelId))
      if (result === 'pending') controller.toast(tr('가입 요청을 보냈습니다. 채널 소유자가 승인하면 참여됩니다.'))
      else if (result === 'unconfirmed') controller.toast(tr('가입 결과를 확인하고 있습니다. 잠시 후 채널 목록을 확인해 주세요.'))
      else {
        controller.toast(tr('채널에 가입했습니다.'))
        await waitFor(() => desktop.value?.channels?.items.some(item => item.id === channelId && item.status === 'ready') ? true : null, 15000)
          .then(() => open(channelId)).catch(() => {})
      }
    } catch (reason) { controller.toast(errorText(reason, tr('채널에 가입하지 못했습니다.')), 'error') }
    finally { setJoining(false) }
  }
  function openFeed(): void {
    if (!previewId || feedBusy) return
    setFeedBusy(true); setCount(30)
    void window.morse.openPublicPreviewChannelFeed(accountUid, previewId)
      .catch(reason => controller.toast(errorText(reason, tr('채널 글 목록을 열지 못했습니다.')), 'error')).finally(() => setFeedBusy(false))
  }
  function share(state: PublicChannelPreviewSnapshot, kind: 'link' | 'text', post?: PublicChannelPost): void {
    if (!state.metadata) return
    const request = { requestId: state.requestId, channelId: state.channelId, channelVersion: state.metadata.version, ...(post ? { post: { id: post.id, revision: post.revision } } : {}) }
    void (kind === 'link' ? window.morse.copyPublicChannelLink(accountUid, request) : window.morse.copyPublicChannelShareText(accountUid, request))
      .then(() => controller.toast(kind === 'link' ? tr('링크를 복사했습니다.') : tr('공유 문구를 복사했습니다.')))
      .catch(reason => controller.toast(errorText(reason, tr('복사하지 못했습니다.')), 'error'))
  }
  function likeState(post: PublicChannelPost): { selected: boolean | null; count: number | null } {
    const override = likes[post.id]
    if (override && override.revision === post.revision && post.likes.selected !== override.selected) return override
    return { selected: post.likes.selected, count: post.likes.count }
  }
  function toggleLike(state: PublicChannelPreviewSnapshot, post: PublicChannelPost): void {
    if (busyRef.current.has(post.id)) return
    const info = post.likes
    if (info.status !== 'ready' || info.selected === null || info.count === null) { controller.toast(info.message || tr('좋아요 상태를 확인하고 있습니다.')); return }
    let request
    try { request = channelPostLikeRequest({ id: crypto.randomUUID(), requestId: state.requestId, channelId: state.channelId, postId: post.id, revision: post.revision, selected: info.selected, count: info.count, desired: !info.selected }) }
    catch (reason) { controller.toast(errorText(reason, tr('좋아요를 변경할 수 없습니다.')), 'error'); return }
    const desired = request.desired, base = info.count
    const setBusy = (busy: boolean): void => { if (busy) busyRef.current.add(post.id); else busyRef.current.delete(post.id); setLikeBusy(new Set(busyRef.current)) }
    const revert = (): void => setLikes(value => { const next = { ...value }; delete next[post.id]; return next })
    setBusy(true)
    setLikes(value => ({ ...value, [post.id]: { revision: post.revision, selected: desired, count: Math.max(0, base + (desired ? 1 : -1)) } }))
    void trackWrite(window.morse.setPublicPreviewLike(accountUid, request)).then(result => {
      if (result.outcome === 'rejected') { revert(); controller.toast(result.message, 'error') }
      else if (result.outcome === 'uncertain') controller.toast(result.message)
    }).catch(() => { revert(); controller.toast(tr('좋아요를 변경하지 못했습니다.'), 'error') }).finally(() => setBusy(false))
  }
  function openPostMenu(state: PublicChannelPreviewSnapshot, post: PublicChannelPost, point: { x: number; y: number }): void {
    popupMenu.open(point, [
      { label: tr('댓글 보기'), icon: <MessageCircle size={18} />, onSelect: () => setCommentsPost(post.id) },
      post.text ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { const copied = copyText(post.text); controller.toast(copied ? tr('텍스트를 복사했습니다.') : tr('텍스트를 복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null,
      { label: tr('게시물 링크 복사'), icon: <Link size={18} />, onSelect: () => share(state, 'link', post) },
      { label: tr('공유 문구 복사'), icon: <Copy size={18} />, onSelect: () => share(state, 'text', post) }
    ])
  }

  const metadata = preview?.status === 'ready' ? preview.metadata : null
  const photos = preview?.photos?.requestId === photoId ? preview.photos : null
  const avatarUrl = photos?.avatar?.status === 'ready' ? photos.avatar.url : null, coverUrl = photos?.cover?.status === 'ready' ? photos.cover.url : null
  const membership = preview?.membership?.requestId === memberId && preview.membership.status === 'ready' ? preview.membership.info : null
  const requested = membership?.joinRequest === 'pending'
  const commentTarget = commentsPost && preview?.postStatus === 'ready' ? preview.posts.find(post => post.id === commentsPost) ?? null : null
  const back = commentsPost ? () => setCommentsPost(null) : () => setPreviewId(null)
  return <Box title={previewId ? <span className="box-title-back"><button className="icon-button small" aria-label={commentsPost ? tr('미리보기로') : tr('검색으로')} onClick={back}><ArrowLeft size={18} /></button>{commentsPost ? tr('댓글') : tr('채널 미리보기')}</span> : tr('채널 찾기')}
    width={440} onClose={close} className="channel-discovery"
    buttons={previewId && metadata && !commentsPost ? listed
      ? <button className="button flat" onClick={() => open(metadata.id)}>{tr('채널 열기')}</button>
      : <button className="button flat" disabled={joining || requested} onClick={() => { void join() }}>{joining && <Spinner size={14} />}{requested ? tr('가입 요청 보냄') : tr('가입')}</button> : undefined}>
    {previewId ? !preview || preview.status === 'loading' ? <div className="empty-state"><Spinner size={22} /></div>
      : !metadata ? <div className="empty-state">{preview.message || tr('채널을 열 수 없습니다.')}</div>
        : commentsPost ? !commentTarget ? <div className="empty-state">{tr('게시물을 찾을 수 없습니다.')}</div>
          : <div className="channel-preview-comments">
            {commentTarget.text && <p className="channel-comments-post">{commentTarget.text}</p>}
            <CommentsThread key={commentTarget.id} accountUid={accountUid} channelId={preview.channelId} requestId={preview.requestId} post={commentTarget} surface="public-preview" />
          </div>
          : <div className="channel-preview">
            {coverUrl && <div className="channel-preview-cover"><img src={coverUrl} alt="" draggable={false} /></div>}
            <div className="info-cover">
              <Avatar name={metadata.name} url={avatarUrl} size={72} kind="channel" />
              <h2 className="selectable">{metadata.name}</h2>
              <span>{metadata.subscriberCount !== null ? tr('구독자 {0}명', [metadata.subscriberCount.toLocaleString(locale())]) : tr('공개 채널')}{metadata.ownerName ? ` · ${metadata.ownerName}` : ''}</span>
            </div>
            {metadata.description && <p className="channel-preview-description selectable">{metadata.description}</p>}
            {metadata.tags && metadata.tags.length > 0 && <p className="channel-preview-tags">{metadata.tags.map(tag => `#${tag}`).join(' ')}</p>}
            <div className="channel-preview-actions">
              <button className="button flat" onClick={() => share(preview, 'link')}><Link size={16} />{tr('링크 복사')}</button>
              <button className="button flat" onClick={() => share(preview, 'text')}><Copy size={16} />{tr('공유 문구 복사')}</button>
            </div>
            {requested && <p className="box-note">{tr('가입 요청을 보냈습니다. 채널 소유자의 승인을 기다리고 있습니다.')}</p>}
            {preview.linkedPostId && <div className="channel-preview-linked"><span>{tr('공유받은 게시물만 표시하고 있습니다.')}</span>
              <button className="button flat" disabled={feedBusy} onClick={openFeed}>{feedBusy && <Spinner size={14} />}{tr('전체 글 보기')}</button></div>}
            <div className="section-label">{preview.linkedPostId ? tr('공유받은 게시물') : tr('최근 게시물')}</div>
            {preview.postStatus === 'loading' || preview.postStatus === 'idle' ? <div className="empty-state"><Spinner size={20} /></div>
              : preview.postStatus !== 'ready' ? <div className="empty-state">{preview.postMessage || tr('게시물을 불러오지 못했습니다.')}</div>
                : !preview.posts.length ? <div className="empty-state">{tr('공개 게시물이 없습니다.')}</div>
                  : <div className="channel-preview-posts">
                    {preview.posts.slice(0, count).map(post => <PreviewPost key={post.id} post={post} likes={likeState(post)} likeBusy={likeBusy.has(post.id)}
                      onLike={() => toggleLike(preview, post)} onMedia={index => showChannelMedia(accountUid, preview.channelId, preview.requestId, post, index, metadata.name, 'public-preview')}
                      onComments={() => setCommentsPost(post.id)} onMenu={point => openPostMenu(preview, post, point)} />)}
                    {count < preview.posts.length && <button className="button flat" onClick={() => setCount(value => value + 30)}>{tr('더 보기')}</button>}
                    {preview.postMessage && <p className="box-note">{preview.postMessage}</p>}
                  </div>}
          </div>
      : <>
        <form className="channel-discovery-form" onSubmit={event => { event.preventDefault(); runSearch() }}>
          <label className="search-field"><Search size={16} /><input value={query} maxLength={200} placeholder={tr('채널 이름 또는 #태그')} data-autofocus onChange={event => setQuery(event.target.value)} /></label>
        </form>
        <form className="channel-discovery-form" onSubmit={event => { event.preventDefault(); openLink() }}>
          <label className="search-field"><Link size={16} /><input type="url" value={link} maxLength={2048} placeholder={tr('공유받은 채널 링크 붙여넣기')} onChange={event => setLink(event.target.value)} /></label>
        </form>
        {error && <p className="box-error" role="alert">{error}</p>}
        {!search ? <div className="empty-state"><Megaphone size={28} /><span>{tr('이름 앞부분이나 태그로 공개 채널을 찾을 수 있습니다.')}</span></div>
          : search.status === 'loading' ? <div className="empty-state"><Spinner size={22} /></div>
            : search.status !== 'ready' ? <div className="empty-state">{search.message || tr('검색 결과를 불러오지 못했습니다.')}</div>
              : !search.rows.length ? <div className="empty-state">{tr('일치하는 공개 채널이 없습니다.')}</div>
                : <div className="peer-list tall">
                  {search.rows.map(row => <button key={row.id} type="button" className="peer-row" onClick={() => openRow(row.id, row.version)}>
                    <Avatar name={row.name} size={42} kind="channel" />
                    <span className="peer-row-text"><strong className="ellipsis">{row.name}</strong>
                      <small className="ellipsis">{[row.subscriberCount !== null ? tr('구독자 {0}명', [row.subscriberCount.toLocaleString(locale())]) : '', row.tags?.length ? row.tags.map(tag => `#${tag}`).join(' ') : row.description].filter(Boolean).join(' · ')}</small></span>
                  </button>)}
                  {search.limited && <p className="box-note channel-discovery-limit">{tr('결과가 많아 일부만 표시합니다. 더 구체적으로 검색해 보세요.')}</p>}
                </div>}
      </>}
  </Box>
}

export function showChannelDiscoveryBox(accountUid: string, initialLink?: string): void {
  controller.showLayer(close => <ChannelDiscoveryBox accountUid={accountUid} initialLink={initialLink} close={close} />)
}
