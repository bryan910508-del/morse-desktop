import { useEffect, useState } from 'react'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Box } from '../ui/layers'
import { Toggle } from './settings-box'
import { tr } from '../../../shared/i18n'
import type { ProblemReportPreview } from '../../../shared/model'

// F-ST-004 B (contracts/F-ST-004-problem-report.md §7): what is kept on this device about crashes, shown exactly as it will
// be sent, then sent to the support chat only after the person agrees. tdesktop's crash report window shows the report
// before sending too (core/crash_report_window.cpp:478, :780-793) but includes the username by default (:220-223); here
// the account line is off until turned on, and nothing opens by itself.
function ProblemReportBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [includeAccount, setIncludeAccount] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [preview, setPreview] = useState<ProblemReportPreview | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    setFailed('')
    void window.morse.problemReportPreview(accountUid, includeAccount)
      .then(next => { if (live) setPreview(next) })
      .catch(reason => { if (live) setFailed(errorText(reason, tr('보내지 못했어요. 잠시 후 다시 시도해 주세요.'))) })
    return () => { live = false }
  }, [accountUid, includeAccount])
  const empty = preview !== null && preview.count === 0
  const limited = preview !== null && preview.sentToday >= preview.perDay
  const ready = preview !== null && !empty && !limited && agreed && !busy
  async function send(): Promise<void> {
    if (!ready || !preview) return
    setBusy(true)
    try {
      // The report goes in the support chat (§7-1): that chat is opened first, as «채팅으로 문의하기» does.
      const chatId = await window.morse.openSupportChat(accountUid)
      controller.closeAllLayers(); controller.openChat(chatId)
      await window.morse.sendProblemReport(accountUid, chatId, preview.token)
      controller.toast(tr('고객 센터에 보냈어요'))
    } catch (reason) {
      controller.toast(errorText(reason, tr('보내지 못했어요. 잠시 후 다시 시도해 주세요.')), 'error')
    } finally { setBusy(false) }
  }
  return <Box title={tr('문제 보고')} width={520} onClose={close} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button" disabled={!ready} onClick={() => { void send() }}>{tr('보내기')}</button>
  </>}>
    <p className="box-text">{tr('이 기기에 남은 오류 기록이에요. 메시지 내용과 계정 · 대화 식별 번호는 지워져 있어요. 보내기 전에 아래 내용을 확인해 주세요.')}</p>
    <p className="box-text">{tr('고객 센터 대화로 보내므로 고객 센터는 보낸 계정을 볼 수 있어요.')}</p>
    {failed && <p className="settings-note">{failed}</p>}
    {empty ? <p className="settings-note">{tr('보낼 오류 기록이 없어요')}</p> : <>
      <div className="section-label">{tr('보낼 내용')}</div>
      <textarea className="problem-report-view" readOnly spellCheck={false} aria-label={tr('보낼 내용')} value={preview?.text ?? ''} />
    </>}
    <Toggle label={tr('계정 정보 포함')} detail={preview && !preview.hasMorseId ? tr('Morse ID를 만들면 넣을 수 있어요') : tr('켜면 파일 안에 내 Morse ID가 함께 적혀요')}
      checked={includeAccount && Boolean(preview?.hasMorseId)} disabled={!preview?.hasMorseId || empty} onChange={value => { setIncludeAccount(value); setAgreed(false) }} />
    <label className="settings-radio">
      <input type="checkbox" checked={agreed} disabled={empty || limited} onChange={event => setAgreed(event.target.checked)} />
      <span>{tr('위 내용을 고객 센터에 보내는 데 동의해요')}</span>
    </label>
    {limited && <p className="settings-note">{tr('오늘은 더 보낼 수 없어요. 내일 다시 시도해 주세요.')}</p>}
    {/* The crash notice used to open the logs folder; the folder stays one press away here. */}
    <button type="button" className="intro-link" onClick={() => { void window.morse.openLogsFolder().catch(() => {}) }}>{tr('기록 폴더 열기')}</button>
  </Box>
}

export function showProblemReportBox(accountUid: string): void {
  controller.showLayer(close => <ProblemReportBox accountUid={accountUid} close={close} />)
}
