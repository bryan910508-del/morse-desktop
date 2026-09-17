import { tr } from '../../../shared/i18n'

// iOS PhotoMarkupEditorView / VideoMarkupEditorView: yellow, red, white and blue pens in the S/M/L/XL widths 4, 8, 14 and
// 20 points, yellow and M to start with. Both desktop editors paint with them.
export const markupPens = [{ name: tr('노란색'), color: '#FFCC00' }, { name: tr('빨간색'), color: '#FF3B30' }, { name: tr('흰색'), color: '#FFFFFF' }, { name: tr('파란색'), color: '#007AFF' }]
export const markupWidths = [{ label: 'S', width: 4 }, { label: 'M', width: 8 }, { label: 'L', width: 14 }, { label: 'XL', width: 20 }]
export interface MarkupPoint { x: number; y: number }
export interface MarkupStroke { color: string; width: number; points: MarkupPoint[] }

// A stroke as round-capped segments; `from` redraws only the newest segment while the pointer moves.
export function drawMarkupStroke(context: CanvasRenderingContext2D, stroke: MarkupStroke, from = 0): void {
  const points = stroke.points
  if (!points.length) return
  context.strokeStyle = stroke.color; context.fillStyle = stroke.color
  context.lineWidth = stroke.width; context.lineCap = 'round'; context.lineJoin = 'round'
  if (points.length === 1) {
    context.beginPath(); context.arc(points[0]!.x, points[0]!.y, stroke.width / 2, 0, Math.PI * 2); context.fill(); return
  }
  context.beginPath()
  const start = Math.max(0, from - 1)
  context.moveTo(points[start]!.x, points[start]!.y)
  for (let index = start + 1; index < points.length; index++) context.lineTo(points[index]!.x, points[index]!.y)
  context.stroke()
}

export function MarkupPenPicker({ pen, width, onPen, onWidth }: { pen: string; width: number; onPen(color: string): void; onWidth(width: number): void }) {
  return <>
    <span className="photo-editor-pens">{markupPens.map(option => <button key={option.color} type="button" className={pen === option.color ? 'selected' : undefined}
      aria-label={option.name} aria-pressed={pen === option.color} onClick={() => onPen(option.color)}><span style={{ background: option.color }} /></button>)}</span>
    <span className="photo-editor-widths">{markupWidths.map(option => <button key={option.label} type="button" className={width === option.width ? 'selected' : undefined}
      aria-label={tr('펜 굵기 {0}', [option.label])} aria-pressed={width === option.width} onClick={() => onWidth(option.width)}>{option.label}</button>)}</span>
  </>
}
