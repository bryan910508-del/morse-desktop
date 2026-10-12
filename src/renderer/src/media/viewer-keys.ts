import { useEffect } from 'react'

// B301: the keys tdesktop's media viewer puts a video full screen with — Ctrl+F (media_view_overlay_widget.cpp:8739-8741)
// and Ctrl/Alt+Enter (:7325-7329); ⌘ on macOS. Esc leaves the full screen (:7385-7386) before it would close the viewer.
interface Key { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }
export function videoFullScreenKey(event: Key): boolean {
  if (event.shiftKey) return false
  if (event.key === 'Enter') return event.ctrlKey || event.metaKey || event.altKey
  return (event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyF' || event.key.toLowerCase() === 'f')
}
// The video in full screen, or out of it; a double-click on a video with its own controls does the same in Chromium.
export function toggleVideoFullScreen(video: HTMLElement | null, doc: Pick<Document, 'fullscreenElement' | 'exitFullscreen'> = document): void {
  if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {})
  else if (video) void video.requestFullscreen().catch(() => {})
}
// While a video is full screen the keyboard is on the page's body, outside the viewer, and after it the same (Phase1:
// Ctrl+Enter did nothing in either). While full screen its own keys take it out again, from anywhere on the page; when
// it ends, the viewer takes the keyboard back.
export function useFocusAfterFullScreen(root: { current: HTMLElement | null }): void {
  useEffect(() => {
    const back = (): void => { if (!document.fullscreenElement && root.current && !root.current.contains(document.activeElement)) root.current.focus({ preventScroll: true }) }
    const key = (event: KeyboardEvent): void => {
      if (!document.fullscreenElement || !videoFullScreenKey(event)) return
      event.preventDefault(); event.stopPropagation()
      void document.exitFullscreen().catch(() => {})
    }
    document.addEventListener('fullscreenchange', back)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('fullscreenchange', back); document.removeEventListener('keydown', key, true) }
  }, [root])
}
// Esc while the video is full screen leaves the full screen only (true: handled, the viewer stays open). Chromium ends
// an element's full screen on Esc itself and then hands the same Esc to the page (Phase1: it closed the viewer too), so
// an Esc just after the full screen ended is that one, and is taken as well.
let leftAt = Number.NEGATIVE_INFINITY, watching = false
export const escapeAfterFullScreenMs = 600
export function noteFullScreenLeft(at: number): void { leftAt = at }
function watch(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) noteFullScreenLeft(performance.now()) })
}
export function leaveFullScreenOnEscape(key: string, doc: Pick<Document, 'fullscreenElement' | 'exitFullscreen'> = document, now = typeof performance === 'undefined' ? 0 : performance.now()): boolean {
  watch()
  if (key !== 'Escape') return false
  if (doc.fullscreenElement) { void doc.exitFullscreen().catch(() => {}); return true }
  return now - leftAt < escapeAfterFullScreenMs
}
