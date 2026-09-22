import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, File as FileIcon, X } from 'lucide-react'
import type { ChatMessage } from '../../../shared/model'
import type { MediaReady } from '../../../shared/media'
import { positionMilliseconds } from '../../../shared/model'
import { controller } from '../app/ui'
import { useDesktopEvent } from '../app/store'
import { useShortcut } from '../app/shortcuts'
import { bytes, errorText, fullTime } from '../app/format'
import { Spinner } from '../ui/controls'
import { copyImage } from '../app/copy-image'
import { tr } from '../../../shared/i18n'

// Media::View::OverlayWidget: full-window viewer with save and album paging.
function MediaViewer({ accountUid, chatId, message, initialIndex, senderName, close }: { accountUid: string; chatId: string; message: ChatMessage; initialIndex: number; senderName: string; close(): void }) {
  const available = (message.attachments ?? []).filter(item => item.available)
  const [index, setIndex] = useState(initialIndex)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [ready, setReady] = useState<MediaReady | null>(null)
  const [progress, setProgress] = useState<{ loaded: number; total: number | null }>({ loaded: 0, total: null })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const player = useRef<HTMLMediaElement | null>(null)
  const position = available.findIndex(item => item.index === index)
  const attachment = available[position]
  useDesktopEvent(event => { if (event.type === 'media-progress' && event.accountUid === accountUid && event.requestId === requestId) setProgress({ loaded: event.loaded, total: event.total }) })
  useEffect(() => {
    let current = true
    setReady(null); setError(''); setProgress({ loaded: 0, total: null })
    void window.morse.openMedia(accountUid, chatId, { requestId, messageId: message.id, version: message.version, index }).then(value => { if (current) setReady(value) })
      .catch(reason => { if (current) setError(errorText(reason, tr('첨부를 불러오지 못했습니다.'))) })
    return () => { current = false; player.current?.pause(); void window.morse.closeMedia(accountUid, requestId).catch(() => {}) }
  }, [accountUid, chatId, message.id, message.version, index, requestId])
  useEffect(() => {
    const pause = (): void => player.current?.pause()
    window.addEventListener('blur', pause)
    return () => window.removeEventListener('blur', pause)
  }, [])
  const go = (step: number): void => {
    const next = available[position + step]
    if (next) { setIndex(next.index); setRequestId(crypto.randomUUID()) }
  }
  useShortcut(120, command => {
    if (command === 'previous-dialog') { go(-1); return true }
    if (command === 'next-dialog') { go(1); return true }
    return false
  })
  async function save(): Promise<void> {
    if (!ready || saving) return
    setSaving(true)
    try { if (await window.morse.saveMedia(accountUid, requestId)) controller.toast(tr('파일을 저장했습니다.')) }
    catch (reason) { controller.toast(errorText(reason, tr('파일을 저장하지 못했습니다.')), 'error') }
    finally { setSaving(false) }
  }
  // OverlayWidget::copyMedia: the photo, or the frame the video is on («Copy frame»); ⌘/Ctrl+C does the same.
  const copyable = Boolean(ready?.url) && (ready?.presentation === 'image' || ready?.presentation === 'video')
  function copy(): void {
    if (!ready?.url || !copyable) return
    if (ready.presentation === 'video') { if (player.current instanceof HTMLVideoElement) void copyImage(player.current) }
    else void copyImage(ready.url)
  }
  const percent = progress.total ? Math.round(100 * progress.loaded / Math.max(1, progress.total)) : null
  return <div className="media-viewer" role="dialog" aria-modal="true" aria-label={tr('첨부 보기')} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') go(-1); else if (event.key === 'ArrowRight') go(1)
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) { event.preventDefault(); copy() }
    }}
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <header className="media-viewer-top">
      <div className="media-viewer-meta"><strong className="ellipsis">{senderName}</strong><span>{fullTime(positionMilliseconds(message.position))}{available.length > 1 ? ` · ${position + 1} / ${available.length}` : ''}</span></div>
      {copyable && <button className="media-viewer-button" aria-label={ready?.presentation === 'video' ? tr('프레임 복사') : tr('복사')} title={ready?.presentation === 'video' ? tr('프레임 복사') : tr('복사')} onClick={copy}><Copy size={20} /></button>}
      <button className="media-viewer-button" aria-label={tr('저장')} disabled={!ready || saving} onClick={() => { void save() }}>{saving ? <Spinner size={18} /> : <Download size={20} />}</button>
      <button className="media-viewer-button" aria-label={tr('닫기')} data-autofocus onClick={close}><X size={22} /></button>
    </header>
    <div className="media-viewer-stage" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      {!ready && !error && <div className="media-viewer-loading" role="status"><Spinner size={34} /><span>{percent !== null ? `${percent}%` : progress.loaded ? bytes(progress.loaded) : tr('불러오는 중')}</span></div>}
      {error && <div className="media-viewer-loading" role="alert"><p>{error}</p><button className="button secondary" onClick={() => setRequestId(crypto.randomUUID())}>{tr('다시 시도')}</button></div>}
      {ready?.url && ready.presentation === 'image' && <img src={ready.url} alt={message.caption || attachment?.name || tr('사진')} draggable={false} />}
      {ready?.url && ready.presentation === 'video' && <video ref={element => { player.current = element }} src={ready.url} controls autoPlay controlsList="nodownload noremoteplayback" disablePictureInPicture onError={() => setError(tr('이 동영상 형식은 재생할 수 없습니다. 저장해서 확인해 주세요.'))} />}
      {ready?.url && ready.presentation === 'audio' && <audio ref={element => { player.current = element }} src={ready.url} controls autoPlay controlsList="nodownload noremoteplayback" />}
      {ready?.presentation === 'file' && <div className="media-viewer-file"><FileIcon size={48} /><strong>{ready.name}</strong><span>{bytes(ready.size)}</span><button className="button primary" disabled={saving} onClick={() => { void save() }}>{tr('저장')}</button></div>}
    </div>
    {position > 0 && <button className="media-viewer-nav previous" aria-label={tr('이전')} onClick={() => go(-1)}><ChevronLeft size={32} /></button>}
    {position >= 0 && position < available.length - 1 && <button className="media-viewer-nav next" aria-label={tr('다음')} onClick={() => go(1)}><ChevronRight size={32} /></button>}
    {message.caption && <p className="media-viewer-caption selectable">{message.caption}</p>}
  </div>
}

export function showMediaViewer(accountUid: string, chatId: string, message: ChatMessage, index: number, senderName: string): void {
  controller.showLayer(close => <MediaViewer accountUid={accountUid} chatId={chatId} message={message} initialIndex={index} senderName={senderName} close={close} />)
}
