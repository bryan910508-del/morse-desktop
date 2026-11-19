import { useState } from 'react'
import { Clock } from 'lucide-react'
import { maxScheduleAheadMs, type DeferredItem } from '../../../shared/deferred-send'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Box, confirmBox } from '../ui/layers'
import { locale, tr } from '../../../shared/i18n'

const pad = (value: number): string => String(value).padStart(2, '0')
function localInput(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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

// N-36 (contracts/N-36-scheduled-messages-list.md): the queued messages of a room, in a box titled as Telegram's
// scheduled messages section (TI «Scheduled Messages», ChatController.swift:10717). Under a head for each day («{날짜} 예약»)
// or «상대가 접속하면 전송», a row is the text's first line and its state; pressing it offers what the state allows (§1-3).
// Finished ones (sent, cancelled) are not listed: a sent message is in the chat.
export interface DeferredActions { drop(item: DeferredItem): Promise<void>; retry?(item: DeferredItem): Promise<void> }
const dayFormat = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' })
const timeFormat = new Intl.DateTimeFormat(locale(), { timeStyle: 'short' })
export function deferredStateText(item: DeferredItem): string {
  return item.status === 'failed' ? tr('보내지 못했어요') : item.status === 'checking' ? tr('확인 중') : tr('대기 중')
}
export function deferredHead(item: DeferredItem): string {
  return item.kind === 'online' ? tr('상대가 접속하면 전송') : item.scheduledAt ? tr('{0} 예약', [dayFormat.format(item.scheduledAt)]) : tr('예약 전송')
}
const firstLine = (text: string): string => text.split('\n').find(line => line.trim())?.trim() ?? ''

function DeferredRow({ item, actions }: { item: DeferredItem; actions: DeferredActions }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const cancel = async (): Promise<void> => {
    if (!await confirmBox({ title: tr('예약된 메시지'), text: tr('아직 대기 중인 메시지만 취소할 수 있어요. 이미 보냈다면 취소로 지워지지 않아요.'), confirm: tr('취소'), cancel: tr('닫기'), danger: true })) return
    setBusy(true)
    try { await actions.drop(item); controller.toast(tr('예약이 취소됐어요')) }
    catch (reason) { controller.toast(errorText(reason, tr('예약을 취소하지 못했어요')), 'error'); setBusy(false) }
  }
  const retry = async (): Promise<void> => {
    if (!actions.retry) return
    setBusy(true)
    try { await actions.retry(item) }
    catch (reason) { controller.toast(errorText(reason, tr('메시지를 보내지 못했어요.')), 'error') }
    finally { setBusy(false) }
  }
  const when = item.kind === 'scheduled' && item.scheduledAt ? `${timeFormat.format(item.scheduledAt)} · ` : ''
  return <div className={`deferred-row${open ? ' open' : ''}`}>
    <button type="button" className="deferred-row-main" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <strong className="ellipsis">{firstLine(item.text) || tr('메시지')}</strong>
      <small className={item.status === 'failed' ? 'error' : undefined}>{when}{deferredStateText(item)}</small>
    </button>
    {open && <div className="deferred-row-actions">
      {item.retry && actions.retry && <button type="button" className="button flat" disabled={busy} onClick={() => { void retry() }}>{tr('다시 시도', [], 'deferred')}</button>}
      <button type="button" className="button flat danger" disabled={busy} onClick={() => { void cancel() }}>{tr('취소')}</button>
    </div>}
  </div>
}
function DeferredListBox({ useItems, actions, close }: { useItems(): DeferredItem[]; actions: DeferredActions; close(): void }) {
  const items = useItems()
  const groups: { head: string; items: DeferredItem[] }[] = []
  for (const item of items) {
    const head = deferredHead(item), last = groups.at(-1)
    if (last?.head === head) last.items.push(item); else groups.push({ head, items: [item] })
  }
  return <Box title={tr('예약된 메시지')} width={420} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    {items.length ? <div className="deferred-list">{groups.map(group => <section key={group.head} className="deferred-group">
      <div className="section-label">{group.head}</div>
      {group.items.map(item => <DeferredRow key={`${item.kind}:${item.id}`} item={item} actions={actions} />)}
    </section>)}</div>
      : <div className="empty-state">{tr('예약된 메시지가 없어요')}</div>}
  </Box>
}
export function showDeferredList(useItems: () => DeferredItem[], actions: DeferredActions): void {
  controller.showLayer(close => <DeferredListBox useItems={useItems} actions={actions} close={close} />)
}

// TI's scheduled messages button in the input panel: shown only while the room has something queued, nothing is typed
// and nothing is being forwarded (ChatInterfaceInputContexts.swift:210 `isTextEmpty && hasScheduledMessages && !hasForward`;
// pressed, ChatTextInputPanelNode.swift:6020-6021). A dot marks a message that could not be sent.
export function DeferredButton({ items, open }: { items: readonly DeferredItem[]; open(): void }) {
  if (!items.length) return null
  const failed = items.some(item => item.status === 'failed')
  return <button type="button" className="icon-button compose-deferred" aria-label={failed ? tr('예약된 메시지 · 보내지 못한 메시지가 있어요') : tr('예약된 메시지')}
    title={tr('예약된 메시지')} onClick={open}>
    <Clock size={22} aria-hidden="true" />
    {failed && <span className="compose-deferred-dot" aria-hidden="true" />}
  </button>
}
export const chatDeferredItems = (chatId: string) => (): DeferredItem[] =>
  useDesktop(snapshot => snapshot?.deferredMessages?.chatId === chatId ? snapshot.deferredMessages.items : null) ?? noItems
const noItems: DeferredItem[] = []
export function chatDeferredActions(accountUid: string, chatId: string): DeferredActions {
  return {
    drop: async item => { await trackWrite(window.morse.cancelDeferred(accountUid, chatId, item.kind, item.id)) },
    retry: async item => { await trackWrite(window.morse.retryDeferred(accountUid, chatId, item.kind, item.id)) }
  }
}
