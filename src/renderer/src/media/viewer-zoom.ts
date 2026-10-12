// B301: zooming a picture in the media viewer, as tdesktop's OverlayWidget does it (media_view_overlay_widget.cpp):
// a level z is the scale z+1 when z ≥ 0 and 1/(1−z) when z < 0, one step at a time from 1/8 to 8 (kMaxZoomLevel, :204),
// with «fit to the screen» (kZoomToScreenLevel, :205) put in where a step passes it; the picture is zoomed around the
// pointer and kept from leaving the screen (snapXY). The level only — the drawing is the viewer's.
export const maxZoomLevel = 7
export const zoomToScreenLevel = 1024
export const pinchZoomStep = 0.25
export interface Size { width: number; height: number }
export interface Placed { level: number; x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export const scaleOf = (z: number): number => z >= 0 ? z + 1 : 1 / (1 - z)
const value = (level: number, full: number): number => level === zoomToScreenLevel ? full : level

// countZoomFor (:2792-2802): the level, a fraction, at which the whole picture fits the area.
export function fitLevel(natural: Size, area: Size): number {
  let result = area.width / natural.width
  if (natural.height * result > area.height) result = area.height / natural.height
  return result >= 1 ? result - 1 : 1 - 1 / result
}

function sized(natural: Size, level: number, full: number): Size {
  const scale = scaleOf(value(level, full))
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) }
}

// snapXY (:8079-8093): a picture smaller than the area stays centred; a larger one never shows the area's edge inside it.
export function snapped(placed: Placed, area: Size): Placed {
  const centreX = (area.width - placed.width) / 2, centreY = (area.height - placed.height) / 2
  const xmin = Math.min(area.width - placed.width, centreX), xmax = Math.max(0, centreX)
  const ymin = Math.min(area.height - placed.height, centreY), ymax = Math.max(0, centreY)
  return { ...placed, x: Math.min(xmax, Math.max(xmin, placed.x)), y: Math.min(ymax, Math.max(ymin, placed.y)) }
}

// Opening (:2812-2829): fitted when larger than the area, at its own size otherwise; centred.
export function opened(natural: Size, area: Size): Placed {
  const level = natural.width > area.width || natural.height > area.height ? zoomToScreenLevel : 0
  const size = sized(natural, level, fitLevel(natural, area))
  return { level, ...size, x: (area.width - size.width) / 2, y: (area.height - size.height) / 2 }
}

// zoomIn / zoomOut (:2915-2947).
export function levelIn(level: number, full: number): number {
  if (level === zoomToScreenLevel) return Math.ceil(full) <= maxZoomLevel ? Math.ceil(full) : level
  if (level < full && (level + 1 > full || (full > maxZoomLevel && level === maxZoomLevel))) return zoomToScreenLevel
  return level < maxZoomLevel ? level + 1 : level
}
export function levelOut(level: number, full: number): number {
  if (level === zoomToScreenLevel) return Math.floor(full) >= -maxZoomLevel ? Math.floor(full) : level
  if (level > full && (level - 1 < full || (full < -maxZoomLevel && level === -maxZoomLevel))) return zoomToScreenLevel
  return level > -maxZoomLevel ? level - 1 : level
}
// zoomReset (:2949-2980): its own size and the fit, back and forth.
export function levelReset(level: number, full: number): number {
  if (level !== 0) return 0
  const whole = Math.round(full)
  return Math.floor(full) === Math.ceil(full) && whole >= -maxZoomLevel && whole <= maxZoomLevel ? whole : zoomToScreenLevel
}

// zoomUpdate (:2982-2991) and setZoomLevel (:7605-7649): never under a pixel; zoomed around the anchor (the pointer, or
// the centre), then snapped.
export function zoomed(placed: Placed, level: number, natural: Size, area: Size, anchor: Point = { x: area.width / 2, y: area.height / 2 }): Placed {
  let next = level
  if (next !== zoomToScreenLevel) while ((next < 0 && 1 - next > placed.width) || 1 - next > placed.height) next++
  if (next === placed.level) return placed
  const full = fitLevel(natural, area)
  const before = scaleOf(value(placed.level, full)), after = scaleOf(value(next, full))
  const size = sized(natural, next, full)
  const x = (placed.x - anchor.x) / before * after + anchor.x
  const y = (placed.y - anchor.y) / before * after + anchor.y
  return snapped({ level: next, ...size, x: Math.round(x), y: Math.round(y) }, area)
}
export const zoomIn = (placed: Placed, natural: Size, area: Size, anchor?: Point): Placed => zoomed(placed, levelIn(placed.level, fitLevel(natural, area)), natural, area, anchor)
export const zoomOut = (placed: Placed, natural: Size, area: Size, anchor?: Point): Placed => zoomed(placed, levelOut(placed.level, fitLevel(natural, area)), natural, area, anchor)
// zoomReset centres the picture first, then zooms around the centre.
export function zoomReset(placed: Placed, natural: Size, area: Size): Placed {
  const centred = { ...placed, x: (area.width - placed.width) / 2, y: (area.height - placed.height) / 2 }
  return zoomed(centred, levelReset(placed.level, fitLevel(natural, area)), natural, area)
}

// The area changed (the window resized, full screen): a fitted picture fits again; any other keeps its size, snapped.
export function resized(placed: Placed, natural: Size, area: Size): Placed {
  if (placed.level !== zoomToScreenLevel) return snapped(placed, area)
  const size = sized(natural, placed.level, fitLevel(natural, area))
  return { ...placed, ...size, x: (area.width - size.width) / 2, y: (area.height - size.height) / 2 }
}

// Dragging (:8216-8234): the picture follows the pointer, snapped.
export const dragged = (start: Placed, dx: number, dy: number, area: Size): Placed => snapped({ ...start, x: start.x + dx, y: start.y + dy }, area)

// What one wheel event with Ctrl/⌘ asks for. Chromium sends a trackpad pinch as such a wheel with small deltas (its scale
// is e^(−deltaY/100)); tdesktop steps once every 0.25 of a pinch (handleNativeGesture, :7568-7599, kPinchZoomStep) and
// once a mouse-wheel notch (:7487-7517). Returns the steps (+ in, − out) and what is left over.
export function wheelSteps(deltaY: number, carried: { pinch: number; wheel: number }): { steps: number; pinch: number; wheel: number } {
  if (Math.abs(deltaY) >= 50) {
    let wheel = carried.wheel + deltaY, steps = 0
    while (Math.abs(wheel) >= 100) { steps += wheel < 0 ? 1 : -1; wheel += wheel < 0 ? 100 : -100 }
    return { steps, pinch: 0, wheel }
  }
  let pinch = carried.pinch - deltaY / 100, steps = 0
  while (pinch >= pinchZoomStep) { pinch -= pinchZoomStep; steps++ }
  while (pinch <= -pinchZoomStep) { pinch += pinchZoomStep; steps-- }
  return { steps, pinch, wheel: 0 }
}
