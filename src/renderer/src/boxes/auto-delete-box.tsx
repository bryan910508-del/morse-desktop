import { useState } from 'react'
import { Check, Timer, TimerOff } from 'lucide-react'
import type { DialogSummary, Preferences } from '../../../shared/model'
import { autoDeleteOptions } from '../../../shared/chat-auto-delete'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Switch } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

function DurationList({ value, onChange }: { value: number; onChange(seconds: number): void }) {
  return <div className="auto-delete-options" role="radiogroup">{autoDeleteOptions.map(option => <button key={option.seconds} type="button" role="radio"
    aria-checked={value === option.seconds} className="auto-delete-option" onClick={() => onChange(option.seconds)}>
    <span className={`auto-delete-icon${option.seconds ? ' on' : ''}`}>{option.seconds ? <Timer size={16} /> : <TimerOff size={16} />}</span>
    <span className="auto-delete-text"><span>{option.label}</span><small>{option.detail}</small></span>
    {value === option.seconds && <Check size={18} className="auto-delete-check" />}
  </button>)}</div>
}
function MyOnlyToggle({ checked, onChange }: { checked: boolean; onChange(value: boolean): void }) {
  return <label className="settings-toggle">
    <span className="settings-toggle-text"><span>{tr('내 메시지에만 적용')}</span><small>{tr('받은 메시지는 보존')}</small></span>
    <Switch label={tr('내 메시지에만 적용')} checked={checked} onChange={onChange} />
  </label>
}

// ChatRoomAutoDeleteSheet: one chat's policy. The server trigger tells the other participants.
function ChatAutoDeleteBox({ accountUid, dialog, close }: { accountUid: string; dialog: DialogSummary; close(): void }) {
  const [seconds, setSeconds] = useState(dialog.autoDeleteSeconds ?? 0)
  const [myOnly, setMyOnly] = useState(Boolean(dialog.autoDeleteSeconds && dialog.autoDeleteMyOnly))
  function save(): void {
    close()
    void trackWrite(window.morse.setChatAutoDelete(accountUid, dialog.id, seconds, seconds > 0 && myOnly)).then(result => {
      if (result === 'unconfirmed') controller.toast(tr('자동 삭제 설정 결과를 확인하지 못했습니다. 잠시 후 대화 정보를 확인해 주세요.'), 'error')
    }, reason => controller.toast(errorText(reason, tr('자동 삭제 설정을 저장할 수 없어요. 연결을 확인해 주세요.')), 'error'))
  }
  return <Box title={tr('이 대화의 자동 삭제')} width={400} onClose={close} className="auto-delete-box" buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" onClick={save}>{tr('저장')}</button>
  </>}>
    <p className="box-note">{tr('저장하면 참여자 모두에게 같은 알림이 표시돼요.')}</p>
    <DurationList value={seconds} onChange={value => { setSeconds(value); if (!value) setMyOnly(false) }} />
    {seconds > 0 && <MyOnlyToggle checked={myOnly} onChange={setMyOnly} />}
  </Box>
}

// The same sheet for a 1:1 inquiry room: the policy lives on the room document, as a chat's does on the chat.
function InquiryAutoDeleteBox({ accountUid, request, initial, close }: {
  accountUid: string; request: { requestId: string; inquiryId: string }; initial: { seconds: number; myOnly: boolean }; close(): void
}) {
  const [seconds, setSeconds] = useState(initial.seconds)
  const [myOnly, setMyOnly] = useState(initial.seconds > 0 && initial.myOnly)
  function save(): void {
    close()
    void trackWrite(window.morse.setInquiryAutoDelete(accountUid, { ...request, seconds, myOnly: seconds > 0 && myOnly }))
      .catch(reason => controller.toast(errorText(reason, tr('자동 삭제 설정을 저장할 수 없어요. 연결을 확인해 주세요.')), 'error'))
  }
  return <Box title={tr('이 문의의 자동 삭제')} width={400} onClose={close} className="auto-delete-box" buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" onClick={save}>{tr('저장')}</button>
  </>}>
    <p className="box-note">{tr('저장하면 참여자 모두에게 같은 알림이 표시돼요.')}</p>
    <DurationList value={seconds} onChange={value => { setSeconds(value); if (!value) setMyOnly(false) }} />
    {seconds > 0 && <MyOnlyToggle checked={myOnly} onChange={setMyOnly} />}
  </Box>
}

function updatePreferences(patch: Partial<Preferences>): void {
  void window.morse.updatePreferences(patch).then(next => desktop.replace(next)).catch(reason => controller.toast(errorText(reason, tr('설정을 저장하지 못했습니다.')), 'error'))
}
// AutoDeleteSettingsView: the default for chats created from this device.
function AutoDeleteDefaultsBox({ close }: { close(): void }) {
  const preferences = useDesktop(state => state?.preferences ?? null)
  if (!preferences) return null
  return <Box title={tr('자동 삭제 메시지')} width={400} onClose={close} className="auto-delete-box" buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <div className="section-label">{tr('새 채팅 기본값')}</div>
    <DurationList value={preferences.autoDeleteDefaultSeconds} onChange={value => updatePreferences({ autoDeleteDefaultSeconds: value })} />
    {preferences.autoDeleteDefaultSeconds > 0 && <>
      <div className="section-label">{tr('적용 범위')}</div>
      <MyOnlyToggle checked={preferences.autoDeleteOnlyMyMessages} onChange={value => updatePreferences({ autoDeleteOnlyMyMessages: value })} />
    </>}
    <p className="box-note">{tr('이 설정은 새로 만드는 채팅에만 적용돼요. 기존 채팅은 채팅방에서 개별 설정 가능해요.')}</p>
  </Box>
}

export function showChatAutoDeleteBox(accountUid: string, dialog: DialogSummary): void {
  controller.showLayer(close => <ChatAutoDeleteBox accountUid={accountUid} dialog={dialog} close={close} />)
}
export function showInquiryAutoDeleteBox(accountUid: string, request: { requestId: string; inquiryId: string }, initial: { seconds: number; myOnly: boolean }): void {
  controller.showLayer(close => <InquiryAutoDeleteBox accountUid={accountUid} request={request} initial={initial} close={close} />)
}
export function showAutoDeleteDefaultsBox(): void {
  controller.showLayer(close => <AutoDeleteDefaultsBox close={close} />)
}
