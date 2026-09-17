import { useState } from 'react'
import { eventAlarmOptions, eventFireAt, eventMessageText, maxEventTitle, type EventAlarm } from '../../../shared/chat-event'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Box } from '../ui/layers'
import { TextField } from '../ui/controls'
import { tr } from '../../../shared/i18n'

const pad = (value: number): string => String(value).padStart(2, '0')
function localInput(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// iOS event sheet "일정 만들기": title, start time from now, reminder. It sends
// "📅 제목\nM월 d일 a h:mm" and keeps the reminder on this device.
function EventBox({ accountUid, chatId, close }: { accountUid: string; chatId: string; close(): void }) {
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(() => { const next = new Date(Date.now() + 60 * 60 * 1000); next.setMinutes(0, 0, 0); return localInput(next.getTime()) })
  const [alarm, setAlarm] = useState<EventAlarm>('none')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (): Promise<void> => {
    const name = title.trim(), at = new Date(start).getTime()
    if (!name) { setError(tr('일정 제목을 입력해 주세요.')); return }
    if (!Number.isFinite(at) || at <= Date.now()) { setError(tr('지금 이후의 시간을 골라 주세요.')); return }
    setBusy(true)
    const id = crypto.randomUUID()
    try {
      await trackWrite(window.morse.sendText(accountUid, chatId, eventMessageText(name, at), id))
      const fireAt = eventFireAt(at, alarm)
      if (fireAt !== null && fireAt > Date.now() + 2000) {
        await window.morse.scheduleEventReminder(accountUid, { id, chatId, title: name, eventStart: at, fireAt })
          .catch(reason => controller.toast(errorText(reason, tr('일정 알림을 저장하지 못했습니다.')), 'error'))
      }
      close()
    } catch (reason) { setError(errorText(reason, tr('일정을 보내지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={tr('일정 만들기')} width={380} onClose={close} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || !title.trim()} onClick={() => { void send() }}>{tr('보내기')}</button>
  </>}>
    <TextField label={tr('일정 제목')} value={title} maxLength={maxEventTitle} placeholder={tr('일정 제목')} autoFocus invalid={Boolean(error)} onChange={value => { setTitle(value); setError('') }} onSubmit={() => { void send() }} />
    <label className="event-field"><span>{tr('시작', [], 'field')}</span>
      <input className="text-input" type="datetime-local" value={start} min={localInput(Date.now())} onChange={event => { setStart(event.target.value); setError('') }} />
    </label>
    <label className="event-field"><span>{tr('알림')}</span>
      <select className="text-input" value={alarm} onChange={event => setAlarm(event.target.value as EventAlarm)}>
        {eventAlarmOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
    <p className="box-note">{tr('알림은 이 Mac에서 Morse가 켜져 있을 때 울려요.')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}
export function showEventBox(accountUid: string, chatId: string): void {
  controller.showLayer(close => <EventBox accountUid={accountUid} chatId={chatId} close={close} />)
}
