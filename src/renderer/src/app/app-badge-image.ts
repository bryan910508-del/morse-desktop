import { appBadgeBox, appBadgeLayer, appSmallCounterLayer } from '../../../shared/app-badge'

// B348: the Windows taskbar overlay's picture, drawn as tdesktop's Window::GenerateCounterLayer draws it
// (window/main_window.cpp:274-347): a rounded box at the bottom right with the count in it. Colours are this app's
// own badge (--accent, grey --swipe-mute for muted, dialogs.css:56-57); tdesktop's trayCounterBg/BgMute/Fg live in
// lib_ui's palette, which the reference copy does not have.
// B348b: the tray icon is the logo with the small counter on it (tdesktop ImageIconWithCounter smallIcon →
// WithSmallCounter, tray_win.cpp:104-157).
export async function drawAppBadge(count: number, muted: boolean, pixels: number, target: 'taskbar' | 'tray' = 'taskbar'): Promise<string> {
  const layer = target === 'tray' ? appSmallCounterLayer(pixels, count) : appBadgeLayer(pixels, count)
  // tdesktop's style::font{ d.font, 0, 0 }: no flags, the regular weight.
  const font = `400 ${layer.font}px Pretendard, "Segoe UI", sans-serif`
  try { await document.fonts.load(font, layer.text) } catch { /* the fallback font draws it */ }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = layer.size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas')
  if (target === 'tray') {
    const logo = new Image()
    logo.src = '/morse.png'
    await logo.decode()
    context.imageSmoothingQuality = 'high'
    context.drawImage(logo, 0, 0, layer.size, layer.size)
  }
  context.font = font
  const metrics = context.measureText(layer.text)
  const box = appBadgeBox(layer, metrics.width, metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent)
  const style = getComputedStyle(document.documentElement)
  context.fillStyle = (muted ? style.getPropertyValue('--swipe-mute') : style.getPropertyValue('--accent')).trim() || (muted ? '#94A3B8' : '#007AFF')
  context.beginPath()
  context.roundRect(box.x, box.y, box.width, box.height, Math.min(layer.radius, box.height / 2))
  context.fill()
  context.fillStyle = '#fff'
  context.textBaseline = 'alphabetic'
  context.fillText(layer.text, box.textX, box.textY)
  return canvas.toDataURL('image/png')
}
