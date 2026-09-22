import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { controller } from '../app/ui'
import { useShortcut } from '../app/shortcuts'
import { errorText } from '../app/format'
import { Spinner } from './controls'
import { tr } from '../../../shared/i18n'

// Ui::UserpicButton with Role::OpenPhoto: a profile picture is a button, and pressing it opens that picture over
// the window (SessionController::openPhoto). Telegram then walks the peer's photo album with the arrows and the
// Left/Right keys (UserPhotos); Morse's server keeps no album, so the pictures walked are the ones this device
// watched go by for that person — what iOS keeps as ProfilePhotoHistory — with the current one first.
interface Album { accountUid: string; peerUid: string }
function PhotoViewer({ url, title, album, close }: { url: string; title: string; album: Album | null; close(): void }) {
  const [failed, setFailed] = useState(false)
  const [count, setCount] = useState(1)
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState(url)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!album) return
    let alive = true
    void window.morse.openProfilePhotos(album.accountUid, album.peerUid)
      .then(value => { if (alive && value) setCount(Math.max(1, value.count)) }).catch(() => {})
    return () => { alive = false; void window.morse.closeProfilePhotos(album.accountUid).catch(() => {}) }
  }, [album?.accountUid, album?.peerUid])
  // Moving to a picture asks for it and keeps the one on screen until the next is ready, as the overlay does.
  async function go(step: number): Promise<void> {
    if (!album || loading) return
    const next = index + step
    if (next < 0 || next >= count) return
    setLoading(true); setError('')
    try {
      const value = await window.morse.showProfilePhoto(album.accountUid, album.peerUid, next)
      if (!value?.url) { setError(tr('이 사진은 더 이상 볼 수 없습니다.')); setCount(current => Math.max(1, current - 1)); return }
      setIndex(next); setShown(value.url); setFailed(false)
    } catch (reason) { setError(errorText(reason, tr('사진을 불러오지 못했습니다.'))) }
    finally { setLoading(false) }
  }
  useShortcut(120, command => {
    if (!album || count < 2) return false
    if (command === 'previous-dialog') { void go(-1); return true }
    if (command === 'next-dialog') { void go(1); return true }
    return false
  })
  return <div className="media-viewer photo-viewer" role="dialog" aria-modal="true" aria-label={title || tr('프로필 사진')} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'ArrowLeft') void go(-1); else if (event.key === 'ArrowRight') void go(1) }}
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <header className="media-viewer-top">
      <div className="media-viewer-meta"><strong className="ellipsis">{title}</strong>{count > 1 && <span>{index + 1} / {count}</span>}</div>
      <button className="media-viewer-button" aria-label={tr('닫기')} data-autofocus onClick={close}><X size={22} /></button>
    </header>
    <div className="media-viewer-stage" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      {failed || error ? <div className="media-viewer-loading" role="alert"><p>{error || tr('사진을 표시하지 못했습니다.')}</p></div>
        : <img src={shown} alt={title || tr('프로필 사진')} draggable={false} onError={() => setFailed(true)} />}
      {loading && <div className="media-viewer-loading" role="status"><Spinner size={30} /></div>}
    </div>
    {index > 0 && <button className="media-viewer-nav previous" aria-label={tr('이전')} disabled={loading} onClick={() => { void go(-1) }}><ChevronLeft size={32} /></button>}
    {index < count - 1 && <button className="media-viewer-nav next" aria-label={tr('다음')} disabled={loading} onClick={() => { void go(1) }}><ChevronRight size={32} /></button>}
  </div>
}

export function showPhotoViewer(url: string, title: string, album: Album | null = null): void {
  if (!url) return
  controller.showLayer(close => <PhotoViewer url={url} title={title} album={album} close={close} />)
}
