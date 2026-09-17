import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { ChannelPostMediaItem } from '../../../shared/channel-post-media'
import { positionMilliseconds, type MessagePosition } from '../../../shared/model'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { useShortcut } from '../app/shortcuts'
import { bytes, errorText, fullTime } from '../app/format'
import { Spinner } from '../ui/controls'
import { tr } from '../../../shared/i18n'

// A channel feed the user reads as a member, or the read-only public preview.
export type ChannelSurface = 'channel' | 'public-preview'
export interface MediaPost { id: string; revision: string; text: string; position: MessagePosition; media: ChannelPostMediaItem[] }

// Media::View::OverlayWidget for channel posts; main keeps one media selection.
function ChannelMediaViewer({ accountUid, channelId, requestId, post, initialIndex, title, surface, close }: {
  accountUid: string; channelId: string; requestId: string; post: MediaPost; initialIndex: number; title: string; surface: ChannelSurface; close(): void
}) {
  const items = post.media.filter(item => item.available)
  const [index, setIndex] = useState(initialIndex)
  const [selectionId, setSelectionId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState(''), [failed, setFailed] = useState(false)
  const player = useRef<HTMLVideoElement | null>(null)
  const position = items.findIndex(item => item.index === index), item = items[position]
  const presentation: 'image' | 'video' = item?.kind === 'video' && item.videoAvailable ? 'video' : 'image'
  const media = useDesktop(state => { const value = surface === 'public-preview' ? state?.channelPublicPreview?.media : state?.channels?.posts?.media; return value?.selectionId === selectionId ? value : null })
  useEffect(() => {
    setError(''); setFailed(false)
    const request = { requestId, channelId, postId: post.id, revision: post.revision, index, presentation, selectionId }
    void (surface === 'public-preview' ? window.morse.openPublicPreviewMedia(accountUid, request) : window.morse.openChannelPostMedia(accountUid, request))
      .catch(reason => setError(errorText(reason, tr('미디어를 열지 못했습니다.'))))
    return () => {
      player.current?.pause()
      void (surface === 'public-preview' ? window.morse.closePublicPreviewMedia(accountUid, selectionId) : window.morse.closeChannelPostMedia(accountUid, selectionId)).catch(() => {})
    }
  }, [selectionId])
  useEffect(() => {
    const pause = (): void => player.current?.pause()
    window.addEventListener('blur', pause)
    return () => window.removeEventListener('blur', pause)
  }, [])
  const go = (step: number): void => {
    const next = items[position + step]
    if (next) { setIndex(next.index); setSelectionId(crypto.randomUUID()) }
  }
  useShortcut(120, command => {
    if (command === 'previous-dialog') { go(-1); return true }
    if (command === 'next-dialog') { go(1); return true }
    return false
  })
  const url = media?.status === 'ready' && media.url && !failed ? media.url : null
  const problem = error || (media?.status === 'error' ? media.message : '') || (failed ? tr('미디어를 표시하지 못했습니다. 다시 열어 주세요.') : '')
  const percent = media?.total ? Math.round(100 * media.loaded / Math.max(1, media.total)) : null
  return <div className="media-viewer" role="dialog" aria-modal="true" aria-label={tr('게시물 미디어')} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'ArrowLeft') go(-1); else if (event.key === 'ArrowRight') go(1) }}
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <header className="media-viewer-top">
      <div className="media-viewer-meta"><strong className="ellipsis">{title}</strong><span>{fullTime(positionMilliseconds(post.position))}{items.length > 1 ? ` · ${position + 1} / ${items.length}` : ''}</span></div>
      <button className="media-viewer-button" aria-label={tr('닫기')} data-autofocus onClick={close}><X size={22} /></button>
    </header>
    <div className="media-viewer-stage" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      {!url && !problem && <div className="media-viewer-loading" role="status"><Spinner size={34} /><span>{percent !== null ? `${percent}%` : media?.loaded ? bytes(media.loaded) : tr('불러오는 중')}</span></div>}
      {problem && <div className="media-viewer-loading" role="alert"><p>{problem}</p><button className="button secondary" onClick={() => setSelectionId(crypto.randomUUID())}>{tr('다시 시도')}</button></div>}
      {url && media?.presentation === 'image' && <img src={url} alt={tr('게시물 사진 {0}', [index + 1])} draggable={false} onError={() => setFailed(true)} />}
      {url && media?.presentation === 'video' && <video ref={element => { player.current = element }} src={url} controls autoPlay playsInline controlsList="nodownload noremoteplayback" disablePictureInPicture onError={() => setFailed(true)} />}
    </div>
    {position > 0 && <button className="media-viewer-nav previous" aria-label={tr('이전')} onClick={() => go(-1)}><ChevronLeft size={32} /></button>}
    {position >= 0 && position < items.length - 1 && <button className="media-viewer-nav next" aria-label={tr('다음')} onClick={() => go(1)}><ChevronRight size={32} /></button>}
    {post.text && <p className="media-viewer-caption selectable">{post.text}</p>}
  </div>
}

export function showChannelMedia(accountUid: string, channelId: string, requestId: string, post: MediaPost, index: number, title: string, surface: ChannelSurface = 'channel'): void {
  controller.showLayer(close => <ChannelMediaViewer accountUid={accountUid} channelId={channelId} requestId={requestId} post={post} initialIndex={index} title={title} surface={surface} close={close} />)
}
