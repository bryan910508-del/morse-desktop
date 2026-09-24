import { useEffect, useState } from 'react'
import { Check, Timer, TimerOff } from 'lucide-react'
import type { DialogSummary } from '../../../shared/model'
import { autoDeleteOptions } from '../../../shared/chat-auto-delete'
import { loadAutoDeleteDefault, setAutoDeleteDefault, useAutoDeleteDefault } from '../app/auto-delete-default'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
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
// ChatRoomAutoDeleteSheet: one chat's policy. The server trigger tells the other participants.
function ChatAutoDeleteBox({ accountUid, dialog, close }: { accountUid: string; dialog: DialogSummary; close(): void }) {
  const [seconds, setSeconds] = useState(dialog.autoDeleteSeconds ?? 0)
  function save(): void {
    close()
    void trackWrite(window.morse.setChatAutoDelete(accountUid, dialog.id, seconds)).then(result => {
      if (result === 'unconfirmed') controller.toast(tr('자동 삭제 설정 결과를 확인하지 못했습니다. 잠시 후 대화 정보를 확인해 주세요.'), 'error')
    }, reason => controller.toast(errorText(reason, tr('자동 삭제 설정을 저장할 수 없어요. 연결을 확인해 주세요.')), 'error'))
  }
  return <Box title={tr('이 대화의 자동 삭제')} width={400} onClose={close} className="auto-delete-box" buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" onClick={save}>{tr('저장')}</button>
  </>}>
    <p className="box-note">{tr('저장하면 참여자 모두에게 같은 알림이 표시돼요.')}</p>
    <DurationList value={seconds} onChange={setSeconds} />
  </Box>
}

// The same sheet for a 1:1 inquiry room: the policy lives on the room document, as a chat's does on the chat.
function InquiryAutoDeleteBox({ accountUid, request, initial, close }: {
  accountUid: string; request: { requestId: string; inquiryId: string }; initial: { seconds: number }; close(): void
}) {
  const [seconds, setSeconds] = useState(initial.seconds)
  function save(): void {
    close()
    void trackWrite(window.morse.setInquiryAutoDelete(accountUid, { ...request, seconds }))
      .catch(reason => controller.toast(errorText(reason, tr('자동 삭제 설정을 저장할 수 없어요. 연결을 확인해 주세요.')), 'error'))
  }
  return <Box title={tr('이 문의의 자동 삭제')} width={400} onClose={close} className="auto-delete-box" buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" onClick={save}>{tr('저장')}</button>
  </>}>
    <p className="box-note">{tr('저장하면 참여자 모두에게 같은 알림이 표시돼요.')}</p>
    <DurationList value={seconds} onChange={setSeconds} />
  </Box>
}

// AutoDeleteSettingsView: the account's default for new chats, shared by its devices.
function AutoDeleteDefaultsBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const seconds = useAutoDeleteDefault(accountUid)
  useEffect(() => { void loadAutoDeleteDefault(accountUid).catch(() => {}) }, [accountUid])
  if (seconds === null) return null
  return <Box title={tr('자동 삭제 메시지')} width={400} onClose={close} className="auto-delete-box" buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <div className="section-label">{tr('새 채팅 기본값')}</div>
    <DurationList value={seconds} onChange={value => { void setAutoDeleteDefault(accountUid, value) }} />
    <p className="box-note">{tr('이 설정은 새로 만드는 채팅에만 적용돼요. 이 계정의 다른 기기에도 함께 적용돼요.')}</p>
  </Box>
}

export function showChatAutoDeleteBox(accountUid: string, dialog: DialogSummary): void {
  controller.showLayer(close => <ChatAutoDeleteBox accountUid={accountUid} dialog={dialog} close={close} />)
}
export function showInquiryAutoDeleteBox(accountUid: string, request: { requestId: string; inquiryId: string }, initial: { seconds: number }): void {
  controller.showLayer(close => <InquiryAutoDeleteBox accountUid={accountUid} request={request} initial={initial} close={close} />)
}
export function showAutoDeleteDefaultsBox(accountUid: string): void {
  controller.showLayer(close => <AutoDeleteDefaultsBox accountUid={accountUid} close={close} />)
}
