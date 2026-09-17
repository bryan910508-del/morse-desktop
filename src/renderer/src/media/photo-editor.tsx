import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Pencil, Redo2, RotateCw, Undo2 } from 'lucide-react'
import { controller } from '../app/ui'
import { useShortcut } from '../app/shortcuts'
import { errorText } from '../app/format'
import { Spinner } from '../ui/controls'
import { tr } from '../../../shared/i18n'
import { drawMarkupStroke, markupPens, MarkupPenPicker, type MarkupStroke } from './markup-pens'
import { dragCrop, flipped, orientationMatrix, orientedSize, pixelRect, rectToOriented, rectToPicture, rotated, toPicture, wholePicture,
  type CropHandle, type Orientation, type Point, type Rect, type Size } from './photo-edit-geometry'

// Editor::PhotoEditor (tdesktop editor/photo_editor.cpp): a picture in the send box can be rotated, flipped and
// cropped, and painted on in a second mode with undo and redo. The paint controls wear iOS PhotoMarkupEditorView's
// identity: yellow, red, white and blue pens in the S/M/L/XL widths 4, 8, 14 and 20.
const maxPixels = 64_000_000
// replace-attachment-image takes a JPEG under 10 MB.
const maxBytes = 10 * 1024 * 1024 - 1
type Stroke = MarkupStroke
interface Drag { pointer: number; kind: 'crop'; handle: CropHandle; start: Rect; from: Point }
interface Paint { pointer: number; kind: 'paint'; stroke: Stroke }
const drawStroke = drawMarkupStroke

function FlipIcon({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v18" strokeDasharray="2 3" /><path d="M9 7 3 17h6z" /><path d="m15 7 6 10h-6z" />
  </svg>
}

async function encode(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  for (const quality of [0.92, 0.85, 0.75]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) break
    if (blob.size <= maxBytes) return new Uint8Array(await blob.arrayBuffer())
  }
  throw new Error(tr('편집한 사진이 너무 큽니다.'))
}

function PhotoEditor({ source, close, apply }: { source: string; close(): void; apply(bytes: Uint8Array): Promise<void> }) {
  const [picture, setPicture] = useState<ImageBitmap | null>(null)
  const [failure, setFailure] = useState('')
  const [orientation, setOrientation] = useState<Orientation>({ angle: 0, flipped: false })
  const [crop, setCrop] = useState<Rect | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [redo, setRedo] = useState<Stroke[]>([])
  const [mode, setMode] = useState<'transform' | 'paint'>('transform')
  const [paintEntry, setPaintEntry] = useState<Stroke[]>([])
  const [pen, setPen] = useState(markupPens[0]!.color)
  const [width, setWidth] = useState(8)
  const [saving, setSaving] = useState(false)
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 })
  const root = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const base = useRef<HTMLCanvasElement | null>(null)
  const action = useRef<Drag | Paint | null>(null)
  const frame = useRef(0)

  useEffect(() => {
    let alive = true, loaded: ImageBitmap | null = null
    void (async () => {
      const response = await fetch(source, { cache: 'no-store' })
      if (!response.ok) throw new Error(tr('사진을 불러오지 못했습니다.'))
      loaded = await createImageBitmap(await response.blob(), { imageOrientation: 'from-image' })
      if (loaded.width * loaded.height > maxPixels) throw new Error(tr('편집하기에 너무 큰 사진입니다.'))
      if (!alive) { loaded.close(); return }
      const layer = document.createElement('canvas')
      layer.width = loaded.width; layer.height = loaded.height
      layer.getContext('2d')!.drawImage(loaded, 0, 0)
      base.current = layer
      setCrop(wholePicture(loaded)); setPicture(loaded)
    })().catch(reason => { loaded?.close(); if (alive) setFailure(errorText(reason, tr('사진을 불러오지 못했습니다.'))) })
    return () => { alive = false; loaded?.close(); base.current = null }
  }, [source])
  useEffect(() => { root.current?.focus() }, [])
  useLayoutEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setStage({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const size: Size | null = picture ? { width: picture.width, height: picture.height } : null
  // The picture fills the stage with a margin for the crop handles.
  const view = size ? (() => {
    const oriented = orientedSize(size, orientation.angle)
    const scale = Math.min((stage.width - 48) / oriented.width, (stage.height - 48) / oriented.height)
    return { oriented, scale, x: (stage.width - oriented.width * scale) / 2, y: (stage.height - oriented.height * scale) / 2 }
  })() : null

  function repaintBase(list: Stroke[]): void {
    const layer = base.current
    if (!layer || !picture) return
    const context = layer.getContext('2d')!
    context.clearRect(0, 0, layer.width, layer.height); context.drawImage(picture, 0, 0)
    for (const stroke of list) drawStroke(context, stroke)
  }
  function draw(): void {
    const element = canvas.current, layer = base.current
    if (!element || !layer || !size || !view || !crop || view.scale <= 0) return
    const ratio = window.devicePixelRatio || 1
    if (element.width !== Math.round(stage.width * ratio) || element.height !== Math.round(stage.height * ratio)) {
      element.width = Math.round(stage.width * ratio); element.height = Math.round(stage.height * ratio)
    }
    const context = element.getContext('2d')!
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, element.width, element.height)
    context.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.x, ratio * view.y)
    context.save(); context.transform(...orientationMatrix(size, orientation)); context.imageSmoothingQuality = 'high'; context.drawImage(layer, 0, 0); context.restore()
    const frameRect = rectToOriented(crop, size, orientation), line = 1 / view.scale
    context.fillStyle = 'rgb(0 0 0 / .55)'
    context.beginPath(); context.rect(0, 0, view.oriented.width, view.oriented.height)
    context.rect(frameRect.x, frameRect.y, frameRect.width, frameRect.height); context.fill('evenodd')
    if (mode !== 'transform') return
    context.strokeStyle = 'rgb(255 255 255 / .9)'; context.lineWidth = line
    context.strokeRect(frameRect.x, frameRect.y, frameRect.width, frameRect.height)
    context.strokeStyle = 'rgb(255 255 255 / .35)'
    context.beginPath()
    for (const part of [1, 2]) {
      context.moveTo(frameRect.x + frameRect.width * part / 3, frameRect.y); context.lineTo(frameRect.x + frameRect.width * part / 3, frameRect.y + frameRect.height)
      context.moveTo(frameRect.x, frameRect.y + frameRect.height * part / 3); context.lineTo(frameRect.x + frameRect.width, frameRect.y + frameRect.height * part / 3)
    }
    context.stroke()
    context.fillStyle = '#fff'
    const knob = 8 / view.scale
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      context.fillRect(frameRect.x + frameRect.width * x - knob / 2, frameRect.y + frameRect.height * y - knob / 2, knob, knob)
    }
  }
  useEffect(draw)
  function requestDraw(): void {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(draw)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  function orientedPoint(event: ReactPointerEvent): Point | null {
    const element = canvas.current
    if (!element || !view) return null
    const bounds = element.getBoundingClientRect()
    return { x: (event.clientX - bounds.left - view.x) / view.scale, y: (event.clientY - bounds.top - view.y) / view.scale }
  }
  function handleAt(point: Point): CropHandle | null {
    if (!size || !view || !crop) return null
    const frameRect = rectToOriented(crop, size, orientation), reach = 14 / view.scale
    const near = (value: number, edge: number): boolean => Math.abs(value - edge) <= reach
    const insideX = point.x >= frameRect.x - reach && point.x <= frameRect.x + frameRect.width + reach
    const insideY = point.y >= frameRect.y - reach && point.y <= frameRect.y + frameRect.height + reach
    if (!insideX || !insideY) return null
    const vertical = near(point.y, frameRect.y) ? 'n' : near(point.y, frameRect.y + frameRect.height) ? 's' : ''
    const horizontal = near(point.x, frameRect.x) ? 'w' : near(point.x, frameRect.x + frameRect.width) ? 'e' : ''
    return (vertical + horizontal || 'move') as CropHandle
  }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (saving || action.current || event.button !== 0 || !size || !view || !crop) return
    const point = orientedPoint(event)
    if (!point) return
    if (mode === 'transform') {
      const handle = handleAt(point)
      if (!handle) return
      action.current = { pointer: event.pointerId, kind: 'crop', handle, start: rectToOriented(crop, size, orientation), from: point }
    } else {
      const stroke: Stroke = { color: pen, width: width / view.scale, points: [toPicture(point, size, orientation)] }
      action.current = { pointer: event.pointerId, kind: 'paint', stroke }
      const layer = base.current
      if (layer) drawStroke(layer.getContext('2d')!, stroke)
      requestDraw()
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const current = action.current, point = orientedPoint(event)
    if (!point || !size || !view) return
    if (!current) {
      if (mode === 'transform') {
        const handle = handleAt(point)
        event.currentTarget.style.cursor = !handle ? 'default' : handle === 'move' ? 'move' : `${handle}-resize`
      } else event.currentTarget.style.cursor = 'crosshair'
      return
    }
    if (current.pointer !== event.pointerId) return
    if (current.kind === 'crop') {
      const next = dragCrop(current.start, current.handle, point.x - current.from.x, point.y - current.from.y, view.oriented, 48 / view.scale)
      setCrop(rectToPicture(next, size, orientation))
      return
    }
    const picturePoint = toPicture(point, size, orientation), last = current.stroke.points.at(-1)!
    if (Math.hypot(picturePoint.x - last.x, picturePoint.y - last.y) < current.stroke.width / 4) return
    current.stroke.points.push(picturePoint)
    const layer = base.current
    if (layer) drawStroke(layer.getContext('2d')!, current.stroke, current.stroke.points.length - 1)
    requestDraw()
  }
  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const current = action.current
    if (!current || current.pointer !== event.pointerId) return
    action.current = null
    if (current.kind === 'paint') { setStrokes(list => [...list, current.stroke]); setRedo([]) }
  }

  function undo(): void {
    if (mode !== 'paint' || !strokes.length || action.current) return
    const next = strokes.slice(0, -1)
    setRedo(list => [...list, strokes.at(-1)!]); setStrokes(next); repaintBase(next)
  }
  function redoStroke(): void {
    if (mode !== 'paint' || !redo.length || action.current) return
    const next = [...strokes, redo.at(-1)!]
    setRedo(list => list.slice(0, -1)); setStrokes(next); repaintBase(next)
  }
  function enterPaint(): void { setPaintEntry(strokes); setRedo([]); setMode('paint') }
  function leavePaint(keep: boolean): void {
    if (!keep) { setStrokes(paintEntry); repaintBase(paintEntry) }
    setRedo([]); setMode('transform')
  }
  async function finish(): Promise<void> {
    if (saving || !picture || !size || !crop || !base.current) return
    const whole = crop.x === 0 && crop.y === 0 && crop.width === size.width && crop.height === size.height
    if (whole && !strokes.length && orientation.angle === 0 && !orientation.flipped) { close(); return }
    setSaving(true); setFailure('')
    const output = document.createElement('canvas')
    try {
      const region = rectToOriented(pixelRect(crop, size), size, orientation)
      output.width = Math.round(region.width); output.height = Math.round(region.height)
      const context = output.getContext('2d')!
      // A JPEG has no transparency; a transparent PNG goes out on white.
      context.fillStyle = '#fff'; context.fillRect(0, 0, output.width, output.height)
      context.setTransform(1, 0, 0, 1, -region.x, -region.y)
      context.transform(...orientationMatrix(size, orientation))
      context.drawImage(base.current, 0, 0)
      const bytes = await encode(output)
      try { await apply(bytes) } finally { bytes.fill(0) }
      close()
    } catch (reason) { setFailure(errorText(reason, tr('편집한 사진을 적용하지 못했습니다.'))); setSaving(false) }
    finally { output.width = 0; output.height = 0 }
  }
  useShortcut(140, command => {
    if (command !== 'back') return false
    if (!saving) { if (mode === 'paint') leavePaint(false); else close() }
    return true
  })

  const turn = (change: (value: Orientation) => Orientation): void => { if (!saving && !action.current) setOrientation(change) }
  return <div ref={root} className="photo-editor" role="dialog" aria-modal="true" aria-label={tr('사진 편집')} tabIndex={-1}
    onKeyDown={event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redoStroke(); else undo()
    }}>
    <div ref={stageRef} className="photo-editor-stage">
      {!picture && !failure && <Spinner size={34} />}
      {picture && <canvas ref={canvas} className="photo-editor-canvas" style={{ width: stage.width, height: stage.height }}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />}
    </div>
    {failure && <p className="photo-editor-error" role="alert">{failure}</p>}
    <div className="photo-editor-bar">
      <button type="button" className="photo-editor-text" disabled={saving} onClick={() => { if (mode === 'paint') leavePaint(false); else close() }}>{tr('취소')}</button>
      {mode === 'transform' ? <div className="photo-editor-tools">
        <button type="button" disabled={!picture || saving} aria-label={tr('회전')} title={tr('회전')} onClick={() => turn(rotated)}><RotateCw size={22} /></button>
        <button type="button" disabled={!picture || saving} aria-label={tr('좌우 반전')} title={tr('좌우 반전')} onClick={() => turn(flipped)}><FlipIcon /></button>
        <button type="button" disabled={!picture || saving} aria-label={tr('그리기')} title={tr('그리기')} onClick={enterPaint}><Pencil size={22} /></button>
      </div> : <div className="photo-editor-tools">
        <button type="button" disabled={!strokes.length} aria-label={tr('되돌리기')} title={tr('되돌리기')} onClick={undo}><Undo2 size={22} /></button>
        <button type="button" disabled={!redo.length} aria-label={tr('다시 실행')} title={tr('다시 실행')} onClick={redoStroke}><Redo2 size={22} /></button>
        <MarkupPenPicker pen={pen} width={width} onPen={setPen} onWidth={setWidth} />
      </div>}
      <button type="button" className="photo-editor-done" disabled={!picture || saving} onClick={() => { if (mode === 'paint') leavePaint(true); else void finish() }}>
        {saving ? <Spinner size={14} /> : null}{tr('완료')}
      </button>
    </div>
  </div>
}

export function showPhotoEditor(source: string, apply: (bytes: Uint8Array) => Promise<void>): void {
  controller.showLayer(close => <PhotoEditor source={source} close={close} apply={apply} />, { dismissible: false })
}
