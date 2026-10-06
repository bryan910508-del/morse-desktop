import { useEffect } from 'react'
import type { OfficialKind } from '../../../shared/model'
import { useDesktop } from './store'

const none: Record<string, OfficialKind> = {}

// B178 §2-5: the official marks of the people a screen shows on rows of its own — read by main with the contacts' own
// public-profile reader while they are shown (contacts.ts showPeople), and let go when the screen goes.
export function useOfficialMarks(accountUid: string, surface: 'members' | 'blocked' | 'lookup', uids: readonly string[]): Record<string, OfficialKind> {
  const key = [...uids].sort().join(',')
  useEffect(() => {
    const shown = key ? key.split(',') : []
    void window.morse.showPeople(accountUid, surface, shown).catch(() => {})
    return () => { void window.morse.showPeople(accountUid, surface, []).catch(() => {}) }
  }, [accountUid, surface, key])
  return useDesktop(state => state?.contacts?.marks ?? none)
}
