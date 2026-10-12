import { useEffect, useRef, useState } from 'react'

// B301: what a media viewer tells the window — that it is open (its zoom keys are its own: main lets them through and
// keeps the View menu from zooming the page) and whether it fills the screen. tdesktop's viewer fills the screen and
// keeps the choice (mediaViewPosition, media_view_overlay_widget.cpp:1137-1182); here it is kept per device.
const storageKey = 'morse.viewerFullScreen'
export function rememberedFullScreen(): boolean {
  try { return localStorage.getItem(storageKey) === '1' } catch { return false }
}
function remember(on: boolean): void {
  try { localStorage.setItem(storageKey, on ? '1' : '0') } catch { /* per-viewer convenience only */ }
}
let openViewers = 0
export function useViewerWindow(): { fullScreen: boolean; toggleFullScreen(): void } {
  const [fullScreen, setFullScreen] = useState(rememberedFullScreen)
  const current = useRef(fullScreen); current.current = fullScreen
  useEffect(() => {
    openViewers++
    void window.morse.viewerState(true, current.current).catch(() => {})
    return () => { openViewers--; void window.morse.viewerState(openViewers > 0, false).catch(() => {}) }
  }, [])
  const toggleFullScreen = (): void => {
    const next = !current.current
    current.current = next
    remember(next); setFullScreen(next)
    void window.morse.viewerState(true, next).catch(() => {})
  }
  return { fullScreen, toggleFullScreen }
}
