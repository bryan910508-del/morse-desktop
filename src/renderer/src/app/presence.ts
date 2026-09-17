import { useEffect, useState } from 'react'
import { presenceChangeIn, presenceText, type PresenceText } from '../../../shared/presence'
import { useDesktop } from './store'

// A person's last seen line, redrawn when its wording changes ("방금 전" → "1분 전" → …).
export function usePresence(uid: string | null | undefined): PresenceText | null {
  const value = useDesktop(snapshot => uid ? snapshot?.presence?.[uid] ?? null : null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!value) return
    const wait = presenceChangeIn(value, Date.now())
    if (wait === null) return
    const timer = setTimeout(() => setNow(Date.now()), wait)
    return () => clearTimeout(timer)
  }, [value, now])
  return value ? presenceText(value, Math.max(now, Date.now())) : null
}
