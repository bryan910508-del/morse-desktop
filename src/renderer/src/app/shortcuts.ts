import { useLayoutEffect, useRef } from 'react'
import { composingKey, shortcutFor, type ShortcutCommand, type ShortcutPlatform } from '../../../shared/shortcuts'

type Handler = (command: ShortcutCommand) => boolean
const handlers = new Set<{ priority: number; handle: Handler }>()
let composing = false

// Highest priority wins: popup menu (200) → layers (100) → panels → window.
export function useShortcut(priority: number, handle: Handler): void {
  const latest = useRef(handle); latest.current = handle
  useLayoutEffect(() => {
    const owner = { priority, handle: (command: ShortcutCommand) => latest.current(command) }
    handlers.add(owner)
    return () => { handlers.delete(owner) }
  }, [priority])
}

export function dispatchShortcut(command: ShortcutCommand, fromMenu = false): boolean {
  if (composing || (!fromMenu && !document.hasFocus())) return false
  for (const owner of [...handlers].sort((a, b) => b.priority - a.priority)) if (owner.handle(command)) return true
  return false
}

export function installShortcuts(platform: ShortcutPlatform): () => void {
  const start = (): void => { composing = true }
  const end = (): void => { composing = false }
  const key = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || composing || composingKey(event)) return
    const command = shortcutFor(event, platform)
    if (!command) return
    if (event.repeat && command !== 'previous-dialog' && command !== 'next-dialog') { event.preventDefault(); return }
    if (dispatchShortcut(command)) { event.preventDefault(); event.stopPropagation() }
  }
  window.addEventListener('compositionstart', start, true)
  window.addEventListener('compositionend', end, true)
  window.addEventListener('blur', end)
  window.addEventListener('keydown', key)
  const unsubscribe = window.morse.onEvent(event => { if (event.type === 'shortcut') dispatchShortcut(event.command, true) })
  return () => {
    unsubscribe(); end()
    window.removeEventListener('compositionstart', start, true)
    window.removeEventListener('compositionend', end, true)
    window.removeEventListener('blur', end)
    window.removeEventListener('keydown', key)
  }
}
