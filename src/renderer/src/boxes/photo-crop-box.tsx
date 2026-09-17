import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { backgroundImageInfo } from '../../../shared/background-photo-bytes'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Box } from '../ui/layers'
import { Spinner } from '../ui/controls'
import { prepareBackgroundPhoto } from '../photos/prepare-background-photo'
import { cropProfilePhoto } from '../photos/prepare-profile-photo'
import { tr } from '../../../shared/i18n'

interface Prepared { bytes: Uint8Array; preview: string; width: number; height: number }

function dataURL(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(tr('사진을 표시하지 못했습니다.')))
    reader.onerror = () => reject(new Error(tr('사진을 표시하지 못했습니다.')))
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
  })
}

function CropBox({ source, shape, title, done }: { source: Prepared; shape: 'square' | 'cover'; title: string; done(result: Uint8Array | null): void }) {
  const [zoom, setZoom] = useState(1), [x, setX] = useState(50), [y, setY] = useState(50)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const abort = useRef(new AbortController())
  useEffect(() => () => abort.current.abort(), [])
  // Same crop rectangle as profile-photo-worker: offset = (size - crop) * position.
  const ratio = shape === 'cover' ? 8 / 3 : 1
  const frameWidth = shape === 'cover' ? 384 : 280, frameHeight = Math.round(frameWidth / ratio)
  const cropWidth = Math.min(source.width, source.height * ratio) / zoom, cropHeight = cropWidth / ratio
  function drag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (busy) return
    const target = event.currentTarget, scale = frameWidth / cropWidth
    const spanX = (source.width - cropWidth) * scale, spanY = (source.height - cropHeight) * scale
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
  async function confirm(): Promise<void> {
    setBusy(true); setError('')
    try { done(await cropProfilePhoto(new Uint8Array(source.bytes), { x, y, zoom }, abort.current.signal, shape)) }
    catch (reason) { setError(errorText(reason, tr('사진을 준비하지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={title} width={frameWidth + 44} buttons={<>
    <button className="button flat" disabled={busy} onClick={() => done(null)}>{tr('취소')}</button>
    <button className="button flat" data-autofocus disabled={busy} onClick={() => { void confirm() }}>{busy && <Spinner size={14} />}{tr('완료')}</button>
  </>}>
    <div className={`crop-frame ${shape}`} role="img" aria-label={tr('끌어서 사진 위치 조정')} onPointerDown={drag} style={{
      width: frameWidth, height: frameHeight, backgroundImage: `url("${source.preview}")`,
      backgroundSize: `${source.width / cropWidth * 100}% ${source.height / cropHeight * 100}%`, backgroundPosition: `${x}% ${y}%`
    }} />
    <label className="crop-zoom"><span>{tr('확대')}</span><input type="range" min={1} max={3} step={0.01} value={zoom} disabled={busy} onChange={event => setZoom(Number(event.target.value))} /></label>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

// Telegram's photo editor step. The picked bytes are normalized first (and zeroed by
// prepareBackgroundPhoto); square output feeds profile/group photos, 8:3 channel covers.
export async function cropPhoto(picked: Uint8Array, shape: 'square' | 'cover', title: string): Promise<Uint8Array | null> {
  const bytes = await prepareBackgroundPhoto(picked, new AbortController().signal)
  try {
    const info = backgroundImageInfo(bytes, true), preview = await dataURL(bytes)
    const source = { bytes, preview, width: info.width, height: info.height }
    return await new Promise(resolve => {
      let settled = false
      const settle = (value: Uint8Array | null): void => { if (!settled) { settled = true; resolve(value) } else value?.fill(0) }
      controller.showLayer(close => <CropBox source={source} shape={shape} title={title} done={value => { settle(value); close() }} />, { onClose: () => settle(null) })
    })
  } finally { bytes.fill(0) }
}
