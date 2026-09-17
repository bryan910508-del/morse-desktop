import { useState } from 'react'
import { Clock } from 'lucide-react'
import { maxScheduleAheadMs, type DeferredItem } from '../../../shared/deferred-send'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Box } from '../ui/layers'
import { locale, tr } from '../../../shared/i18n'

const pad = (value: number): string => String(value).padStart(2, '0')
function localInput(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const whenFormat = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' })

// SchedulePickerView (iOS "예약 전송"): a date and time from now to a year ahead.
function ScheduleBox({ close, onPick }: { close(): void; onPick(at: number): void }) {
  const [value, setValue] = useState(() => { const next = new Date(Date.now() + 60 * 60 * 1000); next.setSeconds(0, 0); return localInput(next.getTime()) })
  const [error, setError] = useState('')
  const confirm = (): void => {
    const at = new Date(value).getTime()
    if (!Number.isFinite(at) || at <= Date.now() + 30 * 1000 || at > Date.now() + maxScheduleAheadMs) { setError(tr('지금 이후 1년 안의 시간을 골라 주세요.')); return }
    close(); onPick(at)
  }
  return <Box title={tr('예약 전송')} width={360} onClose={close} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" onClick={confirm}>{tr('완료')}</button>
  </>}>
    <p className="box-note">{tr('원하는 시간에 자동으로 전송돼요')}</p>
    <input className="text-input schedule-input" type="datetime-local" value={value} min={localInput(Date.now() + 60 * 1000)} max={localInput(Date.now() + maxScheduleAheadMs)}
      onChange={event => { setValue(event.target.value); setError('') }} data-autofocus />
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}
export function showScheduleBox(onPick: (at: number) => void): void {
  controller.showLayer(close => <ScheduleBox close={close} onPick={onPick} />)
}

function DeferredRow({ accountUid, chatId, item }: { accountUid: string; chatId: string; item: DeferredItem }) {
  const [busy, setBusy] = useState(false)
  const cancel = async (): Promise<void> => {
    setBusy(true)
    try { await trackWrite(window.morse.cancelDeferred(accountUid, chatId, item.kind, item.id)); controller.toast(tr('예약이 취소됐어요')) }
    catch (reason) { controller.toast(errorText(reason, tr('예약 취소에 실패했어요')), 'error'); setBusy(false) }
  }
  const when = item.failed ? tr('보내지 못했어요') : item.kind === 'online' ? tr('상대방이 접속하면 전송돼요') : item.scheduledAt ? whenFormat.format(item.scheduledAt) : tr('예약 시간 확인 중')
  return <div className="deferred-row">
    <span className="deferred-row-text"><strong className="ellipsis">{item.text || tr('메시지')}</strong><small className={item.failed ? 'error' : undefined}>{when}</small></span>
    <button type="button" className="button flat danger" disabled={busy} onClick={() => { void cancel() }}>{item.failed ? tr('삭제') : tr('취소')}</button>
  </div>
}
function DeferredListBox({ accountUid, chatId, close }: { accountUid: string; chatId: string; close(): void }) {
  const items = useDesktop(snapshot => snapshot?.deferredMessages?.chatId === chatId ? snapshot.deferredMessages.items : null) ?? []
  return <Box title={tr('예약된 메시지')} width={420} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    {items.length ? <div className="deferred-list">{items.map(item => <DeferredRow key={`${item.kind}:${item.id}`} accountUid={accountUid} chatId={chatId} item={item} />)}</div>
      : <div className="empty-state">{tr('예약된 메시지가 없어요')}</div>}
  </Box>
}

// Telegram's scheduled messages entry: queued messages of this chat, opened from a bar under the header.
export function DeferredBar({ accountUid, chatId }: { accountUid: string; chatId: string }) {
  const items = useDesktop(snapshot => snapshot?.deferredMessages?.chatId === chatId ? snapshot.deferredMessages.items : null) ?? []
  if (!items.length) return null
  const scheduled = items.filter(item => item.kind === 'scheduled').length, online = items.length - scheduled
  return <button type="button" className="deferred-bar" onClick={() => controller.showLayer(close => <DeferredListBox accountUid={accountUid} chatId={chatId} close={close} />)}>
    <Clock size={16} aria-hidden="true" />
    <span className="ellipsis">{[scheduled ? tr('예약된 메시지 {0}개', [scheduled]) : '', online ? tr('온라인시 보내기 {0}개', [online]) : ''].filter(Boolean).join(' · ')}</span>
    {items.some(item => item.failed) && <small className="error">{tr('보내지 못한 메시지가 있어요')}</small>}
  </button>
}
