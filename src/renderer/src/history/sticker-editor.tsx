import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Package, Plus, Star } from 'lucide-react'
import { maxStickerBytes, stickerKind, stickerSidePx, type StickerItem } from '../../../shared/stickers'
import { maxStickerPackItems, maxStickerPackTitle, type StickerPack } from '../../../shared/sticker-packs'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Spinner } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

type Source =
  | { kind: 'still'; bitmap: ImageBitmap; url: string; original: Uint8Array; cut: boolean; width: number; height: number }
  | { kind: 'animated'; bytes: Uint8Array; url: string; video: boolean; width: number; height: number }

// The size of an MP4's picture, turned upright as Chromium plays it.
function videoSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const done = (): void => { video.onloadedmetadata = video.onerror = null; video.removeAttribute('src'); video.load() }
    video.muted = true; video.preload = 'metadata'
    video.onloadedmetadata = () => { const size = { width: video.videoWidth, height: video.videoHeight }; done(); if (size.width && size.height) resolve(size); else reject(new Error('size')) }
    video.onerror = () => { done(); reject(new Error('video')) }
    video.src = url
  })
}

// MediaEditorScreen StickerAction / iOS MorseStickerEditor's destination step: «즐겨찾기», one of the sets this
// account made («내 팩에 추가»), or a new set whose name is asked for (StickerPackEditTitleController).
type Destination = { kind: 'favorites' } | { kind: 'pack'; pack: StickerPack } | { kind: 'new'; title: string }
function DestinationBox({ accountUid, close, choose }: { accountUid: string; close(): void; choose(value: Destination): void }) {
  const [packs, setPacks] = useState<StickerPack[] | null>(null)
  const [naming, setNaming] = useState(false), [title, setTitle] = useState('')
  const [failure, setFailure] = useState('')
  useEffect(() => {
    let alive = true
    void window.morse.ownedStickerPacks(accountUid).then(value => { if (alive) setPacks(value) })
      .catch(reason => { if (alive) { setPacks([]); setFailure(errorText(reason, tr('내 스티커팩을 불러오지 못했습니다.'))) } })
    return () => { alive = false }
  }, [accountUid])
  const pick = (value: Destination): void => { choose(value); close() }
  return <Box title={tr('스티커 저장 위치')} width={360} onClose={close} buttons={naming ? <>
    <button className="button flat" onClick={() => setNaming(false)}>{tr('취소')}</button>
    <button className="button flat" data-autofocus disabled={!title.trim()} onClick={() => pick({ kind: 'new', title: title.trim() })}>{tr('만들기')}</button>
  </> : <button className="button flat" onClick={close}>{tr('취소')}</button>}>
    {naming ? <label className="field"><span>{tr('새 스티커팩 이름')}</span>
      <input autoFocus maxLength={maxStickerPackTitle} value={title} onChange={event => setTitle(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && title.trim() && !event.nativeEvent.isComposing) pick({ kind: 'new', title: title.trim() }) }} />
    </label> : <div className="sticker-destinations">
      <button type="button" className="sticker-destination" onClick={() => pick({ kind: 'favorites' })}><Star size={20} /><span>{tr('즐겨찾기')}</span></button>
      {packs === null ? <div className="sticker-destination-loading" role="status"><Spinner size={18} /></div>
        : packs.map(pack => <button key={pack.id} type="button" className="sticker-destination" disabled={pack.items.length >= maxStickerPackItems} onClick={() => pick({ kind: 'pack', pack })}>
          <Package size={20} /><span className="ellipsis">{pack.title}</span><small>{tr('스티커 {0}개', [pack.items.length])}</small>
        </button>)}
      <button type="button" className="sticker-destination" onClick={() => setNaming(true)}><Plus size={20} /><span>{tr('새 스티커팩')}</span></button>
      {failure && <p className="box-error" role="alert">{failure}</p>}
    </div>}
  </Box>
}
function chooseDestination(accountUid: string): Promise<Destination | null> {
  return new Promise(resolve => {
    let chosen: Destination | null = null
    controller.showLayer(close => <DestinationBox accountUid={accountUid} close={close} choose={value => { chosen = value }} />, { onClose: () => resolve(chosen) })
  })
}

// iOS MorseStickerEditor: a picture cropped to a square and drawn at 512px with its transparency, «배경 제거» through
// Vision, «원본 복원», and «저장» / «저장 후 전송». A GIF or MP4 is cropped the same way by the Mac media helper, every
// frame kept; where the helper is not available it is kept as it is, as iOS keeps it.
function StickerEditor({ accountUid, close, done }: { accountUid: string; close(): void; done(sticker: StickerItem | null): void }) {
  const [source, setSource] = useState<Source | null>(null), [still, setStill] = useState<Source | null>(null)
  const [zoom, setZoom] = useState(1), [x, setX] = useState(50), [y, setY] = useState(50)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.click() }, [])
  // Every preview address stays until the editor closes, so «원본 복원» can show the original again.
  const urls = useRef<string[]>([])
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url) }, [])
  const objectURL = (blob: Blob): string => { const url = URL.createObjectURL(blob); urls.current.push(url); return url }
  async function pick(file: File | undefined): Promise<void> {
    if (!file) { if (!source) close(); return }
    setError('')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kind = stickerKind(bytes)
    try {
      if (kind === 'gif' || kind === 'mp4') {
        if (bytes.length > maxStickerBytes) { setError(tr('10MB 이하 파일을 선택해 주세요.')); return }
        const url = objectURL(new Blob([bytes], { type: kind === 'gif' ? 'image/gif' : 'video/mp4' }))
        let size: { width: number; height: number }
        if (kind === 'gif') { const first = await createImageBitmap(new Blob([bytes], { type: 'image/gif' })); size = { width: first.width, height: first.height }; first.close() }
        else size = await videoSize(url)
        setSource({ kind: 'animated', bytes, url, video: kind === 'mp4', ...size })
      } else {
        const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' })
        const next: Source = { kind: 'still', bitmap, url: objectURL(new Blob([bytes])), original: bytes, cut: false, width: bitmap.width, height: bitmap.height }
        setSource(next); setStill(next)
      }
      setZoom(1); setX(50); setY(50)
    } catch { setError(tr('이 사진 파일을 열지 못했습니다. 다른 사진을 선택해 주세요.')) }
  }
  async function cutout(): Promise<void> {
    if (!source || source.kind !== 'still' || busy) return
    setBusy(true); setError('')
    try {
      const png = await window.morse.stickerCutout(accountUid, source.original)
      const copy = new Uint8Array(png)
      const bitmap = await createImageBitmap(new Blob([copy], { type: 'image/png' }))
      setSource({ kind: 'still', bitmap, url: objectURL(new Blob([copy], { type: 'image/png' })), original: source.original, cut: true, width: bitmap.width, height: bitmap.height })
    } catch (reason) { setError(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.'))) }
    finally { setBusy(false) }
  }
  const frame = 280
  const cropSide = source ? Math.min(source.width, source.height) / zoom : 0
  const scale = cropSide ? frame / cropSide : 0
  // The chosen square in the source's pixels.
  const square = source ? { x: (source.width - cropSide) * x / 100, y: (source.height - cropSide) * y / 100, size: cropSide } : null
  function drag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!source || busy) return
    const target = event.currentTarget
    const spanX = (source.width - cropSide) * scale, spanY = (source.height - cropSide) * scale
    let lastX = event.clientX, lastY = event.clientY
    target.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent): void => {
      if (spanX > 0) setX(value => Math.max(0, Math.min(100, value - (next.clientX - lastX) / spanX * 100)))
      if (spanY > 0) setY(value => Math.max(0, Math.min(100, value - (next.clientY - lastY) / spanY * 100)))
      lastX = next.clientX; lastY = next.clientY
    }
    const end = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
  }
  async function finish(send: boolean): Promise<void> {
    if (!source || !square || busy) return
    setBusy(true); setError('')
    try {
      let bytes: Uint8Array
      if (source.kind === 'animated') {
        const cropped = await window.morse.stickerCropAnimated(accountUid, source.bytes, source.video ? 'mp4' : 'gif', square)
        bytes = cropped ? new Uint8Array(cropped) : source.bytes
      } else {
        const canvas = new OffscreenCanvas(stickerSidePx, stickerSidePx), context = canvas.getContext('2d')
        if (!context) throw new Error(tr('처리하지 못했습니다. 다시 시도해 주세요.'))
        context.drawImage(source.bitmap, square.x, square.y, square.size, square.size, 0, 0, stickerSidePx, stickerSidePx)
        bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
      }
      if (bytes.length > maxStickerBytes) throw new Error(tr('10MB 이하 파일을 선택해 주세요.'))
      const destination = await chooseDestination(accountUid)
      if (!destination) { setBusy(false); return }
      if (destination.kind !== 'favorites') {
        const pack = destination.kind === 'pack' ? destination.pack : await window.morse.createStickerPack(accountUid, destination.title)
        await window.morse.addStickerToPack(accountUid, pack.id, bytes)
        controller.toast(tr('«{0}» 스티커팩에 추가했습니다.', [pack.title]))
        if (!send) { done(null); close(); return }
      }
      // A sticker is sent from this device's library, so one that goes out is kept there too.
      const id = await window.morse.addSticker(accountUid, bytes)
      const kind = stickerKind(bytes)!
      if (destination.kind === 'favorites') controller.toast(tr('스티커를 저장했습니다.'))
      done(send ? { id, kind, size: bytes.length, url: `morse://app/__sticker/${id}` } : null); close()
    } catch (reason) { setError(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.'))); setBusy(false) }
  }
  return <Box title={tr('스티커 만들기')} width={frame + 44} onClose={busy ? undefined : close} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={!source || busy} onClick={() => { void finish(false) }}>{tr('저장')}</button>
    <button className="button flat" data-autofocus disabled={!source || busy} onClick={() => { void finish(true) }}>{busy && <Spinner size={14} />}{tr('저장 후 전송')}</button>
  </>}>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,video/mp4" onChange={event => { void pick(event.target.files?.[0]); event.target.value = '' }} />
    {!source ? <button type="button" className="button secondary block" onClick={() => input.current?.click()}>{tr('사진 선택')}</button>
      : <>
        {source.kind === 'animated' && source.video
          ? <div className="crop-frame square sticker-crop sticker-crop-video" role="img" aria-label={tr('끌어서 스티커 위치 조정')} onPointerDown={drag} style={{ width: frame, height: frame }}>
            <video src={source.url} autoPlay loop muted playsInline style={{
              width: source.width * scale, height: source.height * scale,
              left: -(source.width - cropSide) * x / 100 * scale, top: -(source.height - cropSide) * y / 100 * scale
            }} />
          </div>
          : <div className="crop-frame square sticker-crop" role="img" aria-label={tr('끌어서 스티커 위치 조정')} onPointerDown={drag} style={{
            width: frame, height: frame, backgroundImage: `url("${source.url}")`,
            backgroundSize: `${source.width / cropSide * 100}% ${source.height / cropSide * 100}%`, backgroundPosition: `${x}% ${y}%`
          }} />}
        <label className="crop-zoom"><span>{tr('확대')}</span><input type="range" min={1} max={3} step={0.01} value={zoom} disabled={busy} onChange={event => setZoom(Number(event.target.value))} /></label>
        <div className="sticker-editor-actions">
          {source.kind === 'still' && (source.cut ? <button type="button" className="button secondary" disabled={busy} onClick={() => { if (still) setSource(still) }}>{tr('원본 복원')}</button>
            : <button type="button" className="button secondary" disabled={busy} onClick={() => { void cutout() }}>{tr('배경 제거')}</button>)}
          <button type="button" className="button flat" disabled={busy} onClick={() => input.current?.click()}>{tr('다른 사진')}</button>
        </div>
      </>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showStickerEditor(accountUid: string, done: (sticker: StickerItem | null) => void): void {
  let settled = false
  const settle = (value: StickerItem | null): void => { if (!settled) { settled = true; done(value) } }
  controller.showLayer(close => <StickerEditor accountUid={accountUid} close={close} done={settle} />, { onClose: () => settle(null) })
}
