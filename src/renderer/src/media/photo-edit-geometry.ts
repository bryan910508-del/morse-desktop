// Geometry of tdesktop's Editor::PhotoModifications: the crop rectangle and the paint strokes live in the
// picture's own pixels, and the picture is flipped and rotated by a quarter turn for display and export
// (ImageModified: paint → crop → transform). Here a flip always mirrors what is on screen, so a flip after a
// rotation turns the angle the other way.
export type Angle = 0 | 90 | 180 | 270
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Orientation { angle: Angle; flipped: boolean }
// a, b, c, d, e, f as CanvasRenderingContext2D.setTransform takes them: X = a·x + c·y + e, Y = b·x + d·y + f.
export type Matrix = [number, number, number, number, number, number]

export function orientedSize(size: Size, angle: Angle): Size {
  return angle === 90 || angle === 270 ? { width: size.height, height: size.width } : { ...size }
}
export function rotated(orientation: Orientation): Orientation {
  return { ...orientation, angle: ((orientation.angle + 90) % 360) as Angle }
}
export function flipped(orientation: Orientation): Orientation {
  return { angle: ((360 - orientation.angle) % 360) as Angle, flipped: !orientation.flipped }
}
// The picture's pixel → the displayed (oriented) picture's pixel.
export function orientationMatrix(size: Size, { angle, flipped }: Orientation): Matrix {
  const fx = flipped ? -1 : 1, ex = flipped ? size.width : 0, w = size.width, h = size.height
  if (angle === 90) return [0, fx, -1, 0, h, ex]
  if (angle === 180) return [-fx, 0, 0, -1, w - ex, h]
  if (angle === 270) return [0, -fx, 1, 0, 0, w - ex]
  return [fx, 0, 0, 1, ex, 0]
}
export function toOriented(point: Point, size: Size, orientation: Orientation): Point {
  const [a, b, c, d, e, f] = orientationMatrix(size, orientation)
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}
export function toPicture(point: Point, size: Size, orientation: Orientation): Point {
  const [a, b, c, d, e, f] = orientationMatrix(size, orientation)
  // Quarter turns and mirrors: the inverse of the linear part is its transpose.
  const x = point.x - e, y = point.y - f
  return { x: a * x + b * y, y: c * x + d * y }
}
function bounds(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}
export function rectToOriented(rect: Rect, size: Size, orientation: Orientation): Rect {
  return bounds(toOriented({ x: rect.x, y: rect.y }, size, orientation), toOriented({ x: rect.x + rect.width, y: rect.y + rect.height }, size, orientation))
}
export function rectToPicture(rect: Rect, size: Size, orientation: Orientation): Rect {
  return bounds(toPicture({ x: rect.x, y: rect.y }, size, orientation), toPicture({ x: rect.x + rect.width, y: rect.y + rect.height }, size, orientation))
}

// Editor::Crop: a handle moves its edges, the inside moves the whole frame, and the frame stays inside the
// picture and no smaller than the minimum.
export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export function dragCrop(start: Rect, handle: CropHandle, dx: number, dy: number, area: Size, minimum: number): Rect {
  const min = Math.min(minimum, area.width, area.height)
  if (handle === 'move') {
    return { ...start, x: Math.max(0, Math.min(area.width - start.width, start.x + dx)), y: Math.max(0, Math.min(area.height - start.height, start.y + dy)) }
  }
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height
  if (handle.includes('w')) left = Math.max(0, Math.min(right - min, left + dx))
  if (handle.includes('e')) right = Math.min(area.width, Math.max(left + min, right + dx))
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - min, top + dy))
  if (handle.includes('s')) bottom = Math.min(area.height, Math.max(top + min, bottom + dy))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
export function wholePicture(size: Size): Rect { return { x: 0, y: 0, width: size.width, height: size.height } }
// Whole pixels for export, never outside the picture.
export function pixelRect(rect: Rect, size: Size): Rect {
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x))), y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)))
  return { x, y, width: Math.max(1, Math.min(size.width - x, Math.round(rect.width))), height: Math.max(1, Math.min(size.height - y, Math.round(rect.height))) }
}
