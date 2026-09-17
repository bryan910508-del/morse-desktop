import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Pause, Pencil, Play, Redo2, Undo2 } from 'lucide-react'
import { controller } from '../app/ui'
import { useShortcut } from '../app/shortcuts'
import { duration as formatDuration, errorText } from '../app/format'
import { Spinner } from '../ui/controls'
import type { VideoSendPreset } from '../../../shared/photo-quality'
import { tr } from '../../../shared/i18n'
import { drawMarkupStroke, markupPens, MarkupPenPicker, type MarkupStroke } from './markup-pens'

// Editor::VideoEditor (tdesktop editor/video): the part of a picked video to send, chosen on a timeline of
// frames with two handles (VideoModifications from/till), and its quality (video_editor_quality). The file
// is cut again from the picked original each time, so a second edit can widen the part again. The
// qualities are the three iOS VideoSendQuality choices the settings already offer.
// strokes: iOS VideoMarkupEditorView's drawing over the whole part, kept in fractions of the picture (x, y and the
// pen width against its width) so it can be drawn again at the video's own size.
export interface VideoEditValue { start: number; end: number; preset: VideoSendPreset; strokes?: MarkupStroke[] }
const qualities: { preset: VideoSendPreset; label: string; detail: string }[] = [
  { preset: '960x540', label: tr('자동'), detail: '480p' }, { preset: '1280x720', label: tr('원본'), detail: '720p' }, { preset: 'medium', label: tr('압축'), detail: '360p' }
]
const minimumLength = 0.5
const frameCount = 8

function useFrames(source: string, duration: number): string[] {
  const [frames, setFrames] = useState<string[]>([])
  useEffect(() => {
    if (!duration) return
    let alive = true
    const video = document.createElement('video'), found: string[] = []
    video.muted = true; video.preload = 'auto'; video.src = source
    const shoot = (index: number): void => {
      if (!alive || index >= frameCount) { video.removeAttribute('src'); video.load(); return }
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas'), scale = 72 / Math.max(1, video.videoHeight)
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = 72
          canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
          found[index] = canvas.toDataURL('image/jpeg', 0.6)
          if (alive) setFrames([...found])
        } catch { /* A frame that cannot be drawn leaves its slot dark. */ }
        shoot(index + 1)
      }
      video.currentTime = Math.min(duration - 0.05, (index + 0.5) * duration / frameCount)
    }
    video.onloadeddata = () => shoot(0)
    return () => { alive = false; video.onseeked = video.onloadeddata = null; video.removeAttribute('src'); video.load() }
  }, [source, duration])
  return frames
}

function VideoEditor({ source, initial, preferred, close, apply }: { source: string; initial: VideoEditValue | null; preferred: VideoSendPreset; close(): void; apply(value: VideoEditValue, overlay: Uint8Array | null): Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [preset, setPreset] = useState<VideoSendPreset>(initial?.preset ?? preferred)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const drag = useRef<{ pointer: number; handle: 'start' | 'end' } | null>(null)
  const frames = useFrames(source, duration)
  const stage = useRef<HTMLDivElement>(null)
  const sketch = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [strokes, setStrokes] = useState<MarkupStroke[]>(initial?.strokes ?? [])
  const [redo, setRedo] = useState<MarkupStroke[]>([])
  const [entry, setEntry] = useState<MarkupStroke[]>([])
  const [pen, setPen] = useState(markupPens[0]!.color)
  const [penWidth, setPenWidth] = useState(8)
  const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const stroke = useRef<{ pointer: number; value: MarkupStroke } | null>(null)
  // The drawing layer covers exactly the picture the video element shows.
  useLayoutEffect(() => {
    const element = video.current, box = stage.current
    if (!element || !box) return
    const measure = (): void => {
      const outer = box.getBoundingClientRect(), inner = element.getBoundingClientRect()
      setFrame(inner.width && inner.height ? { left: inner.left - outer.left, top: inner.top - outer.top, width: inner.width, height: inner.height } : null)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(box); observer.observe(element)
    element.addEventListener('loadedmetadata', measure)
    measure()
    return () => { observer.disconnect(); element.removeEventListener('loadedmetadata', measure) }
  }, [])
  function paint(list: MarkupStroke[], current: MarkupStroke | null = null): void {
    const canvas = sketch.current
    if (!canvas || !frame) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(frame.width * ratio); canvas.height = Math.round(frame.height * ratio)
    const context = canvas.getContext('2d')!
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    for (const item of current ? [...list, current] : list) drawMarkupStroke(context, scaled(item, frame.width, frame.height))
  }
  useEffect(() => paint(strokes), [strokes, frame])

  useEffect(() => {
    const element = video.current
    if (!element) return
    element.onloadedmetadata = () => {
      const length = element.duration
      if (!Number.isFinite(length) || length < minimumLength) { setFailure(tr('편집할 수 없는 동영상입니다.')); return }
      setDuration(length)
      const start = initial ? Math.min(initial.start, length - minimumLength) : 0
      setRange({ start, end: initial ? Math.min(length, Math.max(start + minimumLength, initial.end)) : length })
      element.currentTime = start
    }
    element.onerror = () => setFailure(tr('동영상을 불러오지 못했습니다.'))
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) element.onloadedmetadata(new Event('loadedmetadata'))
    return () => { element.onloadedmetadata = element.onerror = null }
  }, [initial])
  useEffect(() => {
    const element = video.current
    if (!element || !range) return
    // Playback stays inside the chosen part and starts over at its beginning.
    const update = (): void => {
      setTime(element.currentTime)
      if (element.currentTime >= range.end) { element.pause(); element.currentTime = range.start }
    }
    element.addEventListener('timeupdate', update)
    const state = (): void => setPlaying(!element.paused)
    element.addEventListener('play', state); element.addEventListener('pause', state)
    return () => { element.removeEventListener('timeupdate', update); element.removeEventListener('play', state); element.removeEventListener('pause', state) }
  }, [range])

  function toggle(): void {
    const element = video.current
    if (!element || !range || saving || drawing) return
    if (element.paused) {
      if (element.currentTime < range.start || element.currentTime >= range.end - 0.05) element.currentTime = range.start
      void element.play().catch(() => {})
    } else element.pause()
  }
  function at(event: ReactPointerEvent): number {
    const bounds = track.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))) * duration
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!range || saving || event.button !== 0) return
    const value = at(event)
    const handle = Math.abs(value - range.start) <= Math.abs(value - range.end) ? 'start' : 'end'
    drag.current = { pointer: event.pointerId, handle }
    event.currentTarget.setPointerCapture(event.pointerId)
    move(value, handle)
  }
  function move(value: number, handle: 'start' | 'end'): void {
    if (!range) return
    const next = handle === 'start' ? { start: Math.max(0, Math.min(value, range.end - minimumLength)), end: range.end }
      : { start: range.start, end: Math.min(duration, Math.max(value, range.start + minimumLength)) }
    setRange(next)
    const element = video.current
    if (element) { element.pause(); element.currentTime = handle === 'start' ? next.start : Math.max(next.start, next.end - 0.05) }
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (current?.pointer === event.pointerId) move(at(event), current.handle)
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointer === event.pointerId) drag.current = null
  }
  function sketchPoint(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))) }
  }
  function sketchDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!drawing || !frame || event.button !== 0 || stroke.current) return
    stroke.current = { pointer: event.pointerId, value: { color: pen, width: penWidth / frame.width, points: [sketchPoint(event)] } }
    event.currentTarget.setPointerCapture(event.pointerId)
    paint(strokes, stroke.current.value)
  }
  function sketchMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const current = stroke.current
    if (!current || current.pointer !== event.pointerId || !frame) return
    const point = sketchPoint(event), last = current.value.points.at(-1)!
    if (Math.hypot((point.x - last.x) * frame.width, (point.y - last.y) * frame.height) < 2) return
    current.value.points.push(point)
    paint(strokes, current.value)
  }
  function sketchUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const current = stroke.current
    if (!current || current.pointer !== event.pointerId) return
    stroke.current = null
    setStrokes(list => [...list, current.value]); setRedo([])
  }
  function undoStroke(): void {
    if (!drawing || !strokes.length || stroke.current) return
    setRedo(list => [...list, strokes.at(-1)!]); setStrokes(strokes.slice(0, -1))
  }
  function redoStroke(): void {
    if (!drawing || !redo.length || stroke.current) return
    setStrokes([...strokes, redo.at(-1)!]); setRedo(redo.slice(0, -1))
  }
  function startDrawing(): void { video.current?.pause(); setEntry(strokes); setRedo([]); setDrawing(true) }
  function stopDrawing(keep: boolean): void { if (!keep) setStrokes(entry); setRedo([]); setDrawing(false) }
  // MorseVideoMarkupExporter: the drawing as a picture at the video's upright size (Chromium reports videoWidth and
  // videoHeight upright), which the Mac helper lays over every frame.
  async function overlayPicture(): Promise<Uint8Array | null> {
    const element = video.current
    if (!strokes.length || !element?.videoWidth || !element.videoHeight) return null
    const canvas = document.createElement('canvas')
    canvas.width = element.videoWidth; canvas.height = element.videoHeight
    const context = canvas.getContext('2d')!
    for (const item of strokes) drawMarkupStroke(context, scaled(item, canvas.width, canvas.height))
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    canvas.width = canvas.height = 0
    if (!blob) throw new Error(tr('그림을 준비하지 못했습니다.'))
    return new Uint8Array(await blob.arrayBuffer())
  }
  async function finish(): Promise<void> {
    if (!range || saving) return
    const whole = range.start <= 0.01 && range.end >= duration - 0.01
    if (whole && preset === (initial?.preset ?? preferred) && !initial && !strokes.length) { close(); return }
    video.current?.pause()
    setSaving(true); setFailure('')
    try {
      await apply({ start: Math.round(range.start * 1000) / 1000, end: Math.round(range.end * 1000) / 1000, preset, strokes }, await overlayPicture())
      close()
    } catch (reason) { setFailure(errorText(reason, tr('동영상을 편집하지 못했습니다.'))); setSaving(false) }
  }
  useShortcut(140, command => {
    if (command !== 'back') return false
    if (!saving) { if (drawing) stopDrawing(false); else close() }
    return true
  })

  const left = range && duration ? 100 * range.start / duration : 0, right = range && duration ? 100 * range.end / duration : 100
  return <div className="video-editor" role="dialog" aria-modal="true" aria-label={tr('동영상 편집')} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === ' ' && event.target === event.currentTarget) { event.preventDefault(); toggle() }
      if (drawing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redoStroke(); else undoStroke() }
    }}>
    <div ref={stage} className="video-editor-stage" onClick={toggle}>
      <video ref={video} src={source} playsInline preload="auto" />
      {frame && <canvas ref={sketch} className={`video-editor-sketch${drawing ? ' active' : ''}`} style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
        onClick={event => event.stopPropagation()} onPointerDown={sketchDown} onPointerMove={sketchMove} onPointerUp={sketchUp} onPointerCancel={sketchUp} />}
      {!duration && !failure && <Spinner size={34} />}
      {duration > 0 && !playing && !saving && !drawing && <span className="video-editor-play" aria-hidden="true"><Play size={30} /></span>}
    </div>
    {failure && <p className="photo-editor-error" role="alert">{failure}</p>}
    <div className="video-editor-timeline">
      <button type="button" className="video-editor-toggle" disabled={!range || saving} aria-label={playing ? tr('일시 정지') : tr('재생')} onClick={toggle}>
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div ref={track} className="video-editor-track" role="slider" aria-label={tr('보낼 구간')} aria-valuemin={0} aria-valuemax={Math.round(duration)}
        aria-valuetext={range ? `${formatDuration(Math.round(range.start))} – ${formatDuration(Math.round(range.end))}` : ''}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        <div className="video-editor-frames">{Array.from({ length: frameCount }, (_, index) => frames[index]
          ? <img key={index} src={frames[index]} alt="" draggable={false} /> : <span key={index} />)}</div>
        <span className="video-editor-shade" style={{ left: 0, width: `${left}%` }} />
        <span className="video-editor-shade" style={{ left: `${right}%`, right: 0 }} />
        <span className="video-editor-window" style={{ left: `${left}%`, width: `${right - left}%` }}><i /><i /></span>
        {duration > 0 && <span className="video-editor-playhead" style={{ left: `${100 * time / duration}%` }} />}
      </div>
    </div>
    <div className="video-editor-times">
      <span>{formatDuration(Math.round(range?.start ?? 0))}</span>
      <strong>{tr('보낼 길이 {0}', [formatDuration(Math.round(range ? range.end - range.start : 0))])}</strong>
      <span>{formatDuration(Math.round(range?.end ?? 0))}</span>
    </div>
    <div className="photo-editor-bar">
      <button type="button" className="photo-editor-text" disabled={saving} onClick={() => { if (drawing) stopDrawing(false); else close() }}>{tr('취소')}</button>
      {drawing ? <div className="photo-editor-tools">
        <button type="button" disabled={!strokes.length} aria-label={tr('되돌리기')} title={tr('되돌리기')} onClick={undoStroke}><Undo2 size={22} /></button>
        <button type="button" disabled={!redo.length} aria-label={tr('다시 실행')} title={tr('다시 실행')} onClick={redoStroke}><Redo2 size={22} /></button>
        <MarkupPenPicker pen={pen} width={penWidth} onPen={setPen} onWidth={setPenWidth} />
      </div> : <div className="photo-editor-tools">
        <button type="button" disabled={!range || saving} aria-label={tr('그리기')} title={tr('그리기')} onClick={startDrawing}><Pencil size={22} /></button>
        <span className="video-editor-qualities" role="radiogroup" aria-label={tr('영상 화질')}>{qualities.map(option =>
          <button key={option.preset} type="button" role="radio" aria-checked={preset === option.preset} className={preset === option.preset ? 'selected' : undefined}
            disabled={saving} onClick={() => setPreset(option.preset)}>{option.label}<small>{option.detail}</small></button>)}</span>
      </div>}
      <button type="button" className="photo-editor-done" disabled={!range || saving} onClick={() => { if (drawing) stopDrawing(true); else void finish() }}>
        {saving ? <><Spinner size={14} />{tr('준비 중')}</> : tr('완료')}
      </button>
    </div>
  </div>
}

function scaled(stroke: MarkupStroke, width: number, height: number): MarkupStroke {
  return { color: stroke.color, width: stroke.width * width, points: stroke.points.map(point => ({ x: point.x * width, y: point.y * height })) }
}

export function showVideoEditor(source: string, initial: VideoEditValue | null, preferred: VideoSendPreset, apply: (value: VideoEditValue, overlay: Uint8Array | null) => Promise<void>): void {
  controller.showLayer(close => <VideoEditor source={source} initial={initial} preferred={preferred} close={close} apply={apply} />, { dismissible: false })
}
