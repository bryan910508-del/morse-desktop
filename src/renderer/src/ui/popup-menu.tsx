import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { useShortcut } from '../app/shortcuts'

export interface MenuAction { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect(): void }
export type MenuEntry = MenuAction | 'separator' | null | false | undefined
interface MenuRequest { id: number; x: number; y: number; entries: MenuEntry[]; header?: ReactNode; onClose?(): void }

let current: MenuRequest | null = null, sequence = 0
const listeners = new Set<() => void>()
function change(next: MenuRequest | null): void {
  const previous = current
  current = next
  for (const listener of [...listeners]) listener()
  if (previous && previous !== next) previous.onClose?.()
}
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

// Ui::PopupMenu: a single in-window menu. Opening another replaces it.
export const popupMenu = {
  open(point: { x: number; y: number }, entries: MenuEntry[], options: { header?: ReactNode; onClose?(): void } = {}): void {
    if (!entries.some(entry => entry && entry !== 'separator')) return
    change({ id: ++sequence, x: point.x, y: point.y, entries, ...options })
  },
  close(): void { if (current) change(null) },
  get isOpen(): boolean { return current !== null }
}

export function pointFor(event: { clientX: number; clientY: number } | null, element?: Element | null): { x: number; y: number } {
  if (event && (event.clientX || event.clientY)) return { x: event.clientX, y: event.clientY }
  const bounds = element?.getBoundingClientRect()
  return bounds ? { x: bounds.left + Math.min(18, bounds.width / 2), y: bounds.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

export function usePopupMenuOpen(): boolean { return useSyncExternalStore(subscribe, () => current !== null) }

export function MenuHost() {
  const request = useSyncExternalStore(subscribe, () => current)
  const element = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  useShortcut(200, command => {
    if (!current) return false
    if (command === 'back') popupMenu.close()
    return true
  })
  useLayoutEffect(() => {
    setPosition(null)
    if (!request || !element.current) return
    const { width, height } = element.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(request.x, window.innerWidth - width - 8))
    const top = request.y + height + 8 > window.innerHeight ? Math.max(8, request.y - height) : request.y
    setPosition({ left, top })
  }, [request])
  useEffect(() => {
    if (!request) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.current?.focus({ preventScroll: true })
    const outside = (event: MouseEvent): void => { if (!element.current?.contains(event.target as Node)) popupMenu.close() }
    const dismiss = (): void => popupMenu.close()
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('mousedown', outside, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      if (previous?.isConnected && !current) previous.focus({ preventScroll: true })
    }
  }, [request])
  if (!request) return null
  const entries = request.entries.filter((entry): entry is MenuAction | 'separator' => Boolean(entry))
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !element.current) return
    event.preventDefault()
    const items = [...element.current.querySelectorAll<HTMLButtonElement>('button[role=menuitem]:not(:disabled)')]
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : (index <= 0 ? items.length - 1 : index - 1)
    items[next]!.focus()
  }
  return <div ref={element} className="popup-menu" role="menu" tabIndex={-1} onKeyDown={move} onContextMenu={event => event.preventDefault()}
    style={position ? { left: position.left, top: position.top } : { left: request.x, top: request.y, visibility: 'hidden' }}>
    {request.header && <div className="popup-menu-header">{request.header}</div>}
    {entries.map((entry, index) => entry === 'separator' ? <hr key={`separator-${index}`} /> :
      <button key={`${entry.label}-${index}`} type="button" role="menuitem" className={entry.danger ? 'danger' : undefined} disabled={entry.disabled}
        onClick={() => { popupMenu.close(); entry.onSelect() }}>{entry.icon}<span>{entry.label}</span></button>)}
  </div>
}
