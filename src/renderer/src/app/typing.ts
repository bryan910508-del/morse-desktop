import { useEffect, useRef, useState } from 'react'
import { useDesktop } from './store'
import { usePowerSaving } from './power-saving'
import { tr } from '../../../shared/i18n'

// The header's «입력 중...» for the open chat, gone when its 8 seconds run out or power saving turns it off.
export function useTyping(chatId: string): boolean {
  const hidden = usePowerSaving().effective('disableTypingIndicators')
  const until = useDesktop(snapshot => snapshot?.typing?.chatId === chatId && !hidden ? snapshot.typing.until : 0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = setTimeout(() => setNow(Date.now()), until - Date.now() + 20)
    return () => clearTimeout(timer)
  }, [until, now])
  return until > Math.max(now, Date.now())
}

// The chat list row's typing line (Dialogs::Ui row send actions): «입력 중...» in a 1:1 chat, and who is typing in a
// group, until the last watcher's 8 seconds run out.
export function useListTyping(chatId: string, group: boolean): string {
  const hidden = usePowerSaving().effective('disableTypingIndicators')
  const entry = useDesktop(snapshot => hidden ? undefined : snapshot?.listTyping?.[chatId])
  const [now, setNow] = useState(() => Date.now())
  const until = entry?.until ?? 0
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = setTimeout(() => setNow(Date.now()), until - Date.now() + 20)
    return () => clearTimeout(timer)
  }, [until, now])
  if (!entry || until <= Math.max(now, Date.now())) return ''
  if (!group) return tr('입력 중...')
  return entry.names.length === 1 ? tr('{0}님이 입력 중...', [entry.names[0]]) : tr('{0}명이 입력 중...', [entry.names.length])
}

// The composer tells the main process whether its person is typing: the field has focus and text in it.
// Like iOS, a report follows a change of the text; the main process repeats "typing" at most every 5 seconds.
export function useTypingReport(accountUid: string, chatId: string, typing: boolean, text: string): void {
  const last = useRef(false)
  useEffect(() => {
    if (typing) { last.current = true; void window.morse.reportTyping(accountUid, chatId, true).catch(() => {}) }
    else if (last.current) { last.current = false; void window.morse.reportTyping(accountUid, chatId, false).catch(() => {}) }
  }, [accountUid, chatId, typing, text])
  useEffect(() => () => { if (last.current) { last.current = false; void window.morse.reportTyping(accountUid, chatId, false).catch(() => {}) } }, [accountUid, chatId])
}
