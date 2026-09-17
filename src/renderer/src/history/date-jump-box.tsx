import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Box } from '../ui/layers'
import { locale, tr } from '../../../shared/i18n'

// Sunday first, named in the app's language (1 January 2023 was a Sunday).
const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale(), { weekday: 'narrow' }).format(new Date(2023, 0, 1 + index)))
const monthTitle = new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long' })

// Telegram's CalendarBox (a press on a date in the history) and iOS DateJumpOverlay: pick a day, and the chat
// opens at its first message; a day after the last message opens the newest messages.
function DateJumpBox({ accountUid, chatId, initial, close }: { accountUid: string; chatId: string; initial: number; close(): void }) {
  const start = new Date(initial)
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const first = month.getDay(), days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array.from({ length: first }, () => 0), ...Array.from({ length: days }, (_, index) => index + 1)]
  const canNext = new Date(month.getFullYear(), month.getMonth() + 1, 1) <= today
  const pick = (day: number): void => {
    const at = new Date(month.getFullYear(), month.getMonth(), day).getTime()
    close()
    void window.morse.jumpDate(accountUid, chatId, at).catch(reason => controller.toast(errorText(reason, tr('그 날짜로 이동하지 못했습니다.')), 'error'))
  }
  return <Box title={tr('날짜로 이동')} width={340} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('취소')}</button>}>
    <div className="date-jump-head">
      <button type="button" className="icon-button small" aria-label={tr('이전 달')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
      <strong>{monthTitle.format(month)}</strong>
      <button type="button" className="icon-button small" aria-label={tr('다음 달')} disabled={!canNext} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
    </div>
    <div className="date-jump-grid">
      {weekdays.map((day, index) => <span key={index} className="date-jump-weekday">{day}</span>)}
      {cells.map((day, index) => {
        if (!day) return <span key={`e${index}`} />
        const date = new Date(month.getFullYear(), month.getMonth(), day)
        const selected = date.getFullYear() === start.getFullYear() && date.getMonth() === start.getMonth() && day === start.getDate()
        return <button key={day} type="button" className={`date-jump-day${selected ? ' selected' : ''}${date.getTime() === today.getTime() ? ' today' : ''}`}
          disabled={date > today} onClick={() => pick(day)}>{day}</button>
      })}
    </div>
  </Box>
}

export function showDateJumpBox(accountUid: string, chatId: string, initial: number): void {
  controller.showLayer(close => <DateJumpBox accountUid={accountUid} chatId={chatId} initial={initial} close={close} />)
}
