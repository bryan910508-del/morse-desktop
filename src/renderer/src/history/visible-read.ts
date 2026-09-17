import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ChatMessage, HistorySnapshot } from '../../../shared/model'
import { compareReadCursor, readCursor, type ReadCursor } from '../../../shared/read-receipts'
import { tr } from '../../../shared/i18n'

interface Display { accountUid: string; chatId: string; history: HistorySnapshot; enabled: boolean }

// A message is read only when its bubble bottom is actually visible in the
// focused window. The newest such message is sent once; main merges cursors.
export function useVisibleRead(scroll: RefObject<HTMLDivElement | null>, display: Display): string {
  const committed = useRef(display)
  const schedule = useRef<(() => void) | null>(null)
  const [error, setError] = useState('')
  useLayoutEffect(() => { committed.current = display; schedule.current?.() })
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    let disposed = false, busy = false, failed = false, frame = 0, second = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let accepted: ReadCursor | null = null
    const cancel = (): void => { clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(second) }
    const allowed = (): boolean => !disposed && !failed && committed.current.enabled && committed.current.history.status === 'ready' && document.visibilityState === 'visible' && document.hasFocus()
    const observe = (): void => {
      if (!allowed() || busy) return
      const view = committed.current, viewport = element.getBoundingClientRect()
      const top = Math.max(0, viewport.top), bottom = Math.min(window.innerHeight, viewport.bottom)
      if (element.clientHeight <= 0 || bottom <= top) return
      const byId = new Map<string, ChatMessage>(view.history.messages.map(message => [message.id, message]))
      let candidate: ChatMessage | undefined
      for (const row of element.querySelectorAll<HTMLElement>('[data-message-id]')) {
        const message = byId.get(row.dataset.messageId ?? '')
        if (!message || !message.readEligible || message.senderId === view.accountUid) continue
        const bubble = row.querySelector<HTMLElement>('.bubble')
        if (!bubble) continue
        const bounds = bubble.getBoundingClientRect()
        if (bounds.height <= 0 || bounds.bottom > bottom || bounds.bottom <= top + 1) continue
        const left = Math.max(viewport.left, bounds.left, 0), right = Math.min(viewport.right, bounds.right, window.innerWidth)
        if (right <= left) continue
        const hit = document.elementFromPoint((left + right) / 2, bounds.bottom - 2)
        if (!hit || !bubble.contains(hit)) continue
        if (!candidate || compareReadCursor(readCursor(message.position), readCursor(candidate.position)) > 0) candidate = message
      }
      if (!candidate || (accepted && compareReadCursor(readCursor(candidate.position), accepted) <= 0)) return
      const target = readCursor(candidate.position)
      busy = true
      void window.morse.markVisibleRead(view.accountUid, view.chatId, view.history.revision, candidate.id).then(saved => {
        if (saved && !disposed && (!accepted || compareReadCursor(target, accepted) > 0)) accepted = target
      }).catch(() => { if (!disposed) { failed = true; setError(tr('읽음 위치를 저장하지 못했습니다. 앱을 다시 열어 주세요.')) } })
        .finally(() => { busy = false; if (!disposed && !failed) queue(800) })
    }
    const queue = (delay = 180): void => {
      cancel()
      if (!allowed()) return
      timer = setTimeout(() => { frame = requestAnimationFrame(() => { second = requestAnimationFrame(observe) }) }, delay)
    }
    const changed = (): void => queue()
    schedule.current = changed
    const resize = new ResizeObserver(changed)
    resize.observe(element)
    element.addEventListener('scroll', changed, { passive: true })
    window.addEventListener('focus', changed); window.addEventListener('blur', cancel)
    window.addEventListener('resize', changed); document.addEventListener('visibilitychange', changed)
    queue()
    return () => {
      disposed = true; cancel(); schedule.current = null; resize.disconnect()
      element.removeEventListener('scroll', changed)
      window.removeEventListener('focus', changed); window.removeEventListener('blur', cancel)
      window.removeEventListener('resize', changed); document.removeEventListener('visibilitychange', changed)
    }
  }, [scroll, display.accountUid, display.chatId])
  return error
}
