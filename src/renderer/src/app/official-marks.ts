import { useEffect, useState, type RefObject } from 'react'
import type { OfficialKind, PeopleSurface } from '../../../shared/model'
import { useDesktop } from './store'

const none: Record<string, OfficialKind> = {}

// B178 §2-5: the official marks of the people a screen shows on rows of its own — read by main with the contacts' own
// public-profile reader while they are shown (contacts.ts showPeople), and let go when the screen goes.
export function useOfficialMarks(accountUid: string, surface: PeopleSurface, uids: readonly string[]): Record<string, OfficialKind> {
  const key = [...uids].sort().join(',')
  useEffect(() => {
    const shown = key ? key.split(',') : []
    void window.morse.showPeople(accountUid, surface, shown).catch(() => {})
    return () => { void window.morse.showPeople(accountUid, surface, []).catch(() => {}) }
  }, [accountUid, surface, key])
  return useDesktop(state => state?.contacts?.marks ?? none)
}
// The uids of a list's rows on screen (rows carry data-uid) — a group's members or a channel's subscribers may run to
// thousands, and only those seen are read (B178 §2-5).
export function useRowsOnScreen(root: RefObject<HTMLElement | null>, rows: unknown): string[] {
  const [onScreen, setOnScreen] = useState<string[]>([])
  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const seen = new Set<string>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const uid = (entry.target as HTMLElement).dataset.uid; if (uid) { if (entry.isIntersecting) seen.add(uid); else seen.delete(uid) } }
      setOnScreen([...seen])
    })
    for (const row of element.querySelectorAll<HTMLElement>('[data-uid]')) observer.observe(row)
    return () => observer.disconnect()
  }, [rows])
  return onScreen
}
