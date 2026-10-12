import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { viewerZoomKey, type ShortcutInput } from '../../../shared/shortcuts'
import { dragged, opened, resized, wheelSteps, zoomIn, zoomOut, zoomReset, type Placed, type Point, type Size } from './viewer-zoom'

// B301: a picture in the media viewer that zooms and pans as tdesktop's OverlayWidget does (viewer-zoom.ts): Ctrl/⌘ with
// the wheel or a trackpad pinch around the pointer, Ctrl/⌘ with + − 0 around the centre, the middle button between its
// own size and the fit, a drag to move a picture larger than the screen. The three viewers (a chat's, a channel post's,
// a profile's) draw their pictures with it. `key` is the viewer's own keydown, so its other keys stay its.
export interface ZoomImageHandle { key(event: ShortcutInput & { preventDefault(): void; stopPropagation(): void }): boolean }

export const ZoomImage = forwardRef<ZoomImageHandle, { src: string; alt: string; className?: string; onError?(): void; onBackground?(): void }>(function ZoomImage({ src, alt, className, onError, onBackground }, handle) {
  const canvas = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState<Size | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [placed, setPlaced] = useState<Placed | null>(null)
  const [dragging, setDragging] = useState(false)
  const latest = useRef({ area, natural, placed }); latest.current = { area, natural, placed }
  const carried = useRef({ pinch: 0, wheel: 0 })
  const drag = useRef<{ id: number; x: number; y: number; start: Placed; moved: boolean } | null>(null)

  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    const measure = (): void => setArea({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // A new size of the area (the window resized, or full screen): a fitted picture fits again.
  useEffect(() => {
    const { natural: size, placed: current } = latest.current
    if (!area || !size) return
    setPlaced(current ? resized(current, size, area) : opened(size, area))
  }, [area?.width, area?.height])

  const apply = (change: (placed: Placed, natural: Size, area: Size) => Placed): boolean => {
    const { area: box, natural: size, placed: current } = latest.current
    if (!box || !size || !current) return false
    // Several steps of one wheel event build on each other before the next render.
    const next = change(current, size, box)
    latest.current = { ...latest.current, placed: next }
    setPlaced(next)
    return true
  }
  const anchorOf = (clientX: number, clientY: number): Point => {
    const bounds = canvas.current!.getBoundingClientRect()
    return { x: clientX - bounds.left, y: clientY - bounds.top }
  }
  // A wheel with Ctrl/⌘ — or a trackpad pinch, which Chromium sends as one — zooms; it is not passive, so the page itself
  // never zooms under the viewer.
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const wheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const result = wheelSteps(event.deltaY, carried.current)
      carried.current = { pinch: result.pinch, wheel: result.wheel }
      const anchor = anchorOf(event.clientX, event.clientY)
      for (let step = 0; step < Math.abs(result.steps); step++) apply((current, size, box) => result.steps > 0 ? zoomIn(current, size, box, anchor) : zoomOut(current, size, box, anchor))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  useImperativeHandle(handle, () => ({
    key: event => {
      const kind = viewerZoomKey(event)
      if (!kind) return false
      event.preventDefault(); event.stopPropagation()
      apply(kind === 'in' ? zoomIn : kind === 'out' ? zoomOut : zoomReset)
      return true
    }
  }), [])

  const larger = Boolean(placed && area && (placed.width > area.width || placed.height > area.height))
  return <div ref={canvas} className="media-viewer-canvas" onMouseDown={event => { if (event.target === event.currentTarget) onBackground?.() }}>
    <img src={src} alt={alt} draggable={false} className={`media-viewer-zoom${className ? ` ${className}` : ''}`}
      style={placed ? { left: placed.x, top: placed.y, width: placed.width, height: placed.height, cursor: dragging ? 'grabbing' : larger ? 'grab' : undefined } : { visibility: 'hidden' }}
      onLoad={event => {
        const image = event.currentTarget, size = { width: image.naturalWidth || 1, height: image.naturalHeight || 1 }
        setNatural(size); carried.current = { pinch: 0, wheel: 0 }
        if (latest.current.area) setPlaced(opened(size, latest.current.area))
      }}
      onError={onError}
      onPointerDown={event => {
        // tdesktop's middle button: its own size and the fit, back and forth (:8046-8047).
        if (event.button === 1) { event.preventDefault(); apply(zoomReset); return }
        if (event.button !== 0 || !latest.current.placed) return
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: latest.current.placed, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const state = drag.current, box = latest.current.area
        if (!state || state.id !== event.pointerId || !box) return
        const dx = event.clientX - state.x, dy = event.clientY - state.y
        if (!state.moved && Math.hypot(dx, dy) < 4) return
        if (!state.moved) { state.moved = true; setDragging(true) }
        setPlaced(dragged(state.start, dx, dy, box))
      }}
      onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = null; setDragging(false) } }}
      onPointerCancel={() => { drag.current = null; setDragging(false) }} />
  </div>
})
