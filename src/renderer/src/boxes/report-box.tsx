import { useState } from 'react'
import { contentReportCategories, maxReportExtra, userReportCategories, type ReportTarget } from '../../../shared/reports'
import type { BlockTarget } from '../../../shared/account-tools'
import { setBlocked } from '../app/blocked-users'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Spinner, Switch } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// iOS UserReportView and ChannelReportView: a reason, an optional description, and for a person the choice to
// block them as well (on by default).
function ReportBox({ accountUid, target, title, block, initialExtra, close }: { accountUid: string; target: ReportTarget; title: string; block: BlockTarget | null; initialExtra: string; close(): void }) {
  const user = target.type === 'user'
  const [category, setCategory] = useState(''), [extra, setExtra] = useState(initialExtra), [alsoBlock, setAlsoBlock] = useState(true)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(): Promise<void> {
    if (!category || busy) return
    setBusy(true); setError('')
    try {
      await window.morse.report(accountUid, { target, category, extra })
      if (user && block && alsoBlock) await setBlocked(accountUid, block, true).catch(() => {})
      controller.toast(tr('신고가 접수됐어요')); close()
    } catch (reason) { setError(errorText(reason, tr('신고 실패: 다시 시도해 주세요.'))) }
    finally { setBusy(false) }
  }
  return <Box title={title} width={420} onClose={busy ? undefined : close} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat danger" disabled={!category || busy} onClick={() => { void submit() }}>{busy ? <><Spinner size={14} />{tr('제출 중...')}</> : tr('신고 제출')}</button>
  </>}>
    <div className="section-label">{user ? tr('어떤 문제가 있나요?') : tr('어떤 점이 문제인가요?')}</div>
    {(user ? userReportCategories : contentReportCategories).map(item => <label key={item.id} className="settings-radio">
      <input type="radio" name="report-category" checked={category === item.id} disabled={busy} onChange={() => setCategory(item.id)} />
      <span>{item.title}{'detail' in item && <small>{(item as { detail: string }).detail}</small>}</span>
    </label>)}
    <label className="field"><span>{tr('추가 설명 (선택)')}</span><textarea rows={3} maxLength={maxReportExtra} value={extra} disabled={busy}
      placeholder={user ? tr('자세한 상황을 알려주시면 처리에 도움돼요.') : tr('상세한 사유를 적어주시면 처리에 도움돼요.')} onChange={event => setExtra(event.target.value)} /></label>
    {user && block && <label className="settings-toggle"><span className="settings-toggle-text"><span>{tr('이 사용자 차단')}</span><small>{tr('신고와 함께 차단해요')}</small></span>
      <Switch label={tr('이 사용자 차단')} checked={alsoBlock} disabled={busy} onChange={setAlsoBlock} /></label>}
    <p className="box-note">{user ? tr('검토 후 적절한 조치를 취할게요.\n긴급 신고(아동 안전, 폭력 위협)는 1시간 이내 처리해요.\n허위 신고 시 이용에 제한이 있을 수 있어요.') : tr('검토 후 적절한 조치를 취할게요.\n허위 신고 시 이용에 제한이 있을 수 있어요.')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

// `initialExtra`: 신고 대상을 가리키는 좌표를 미리 적어 둔다. 메시지 신고가 그렇다 — 신고되는 것은 보낸
// 사람이고(규칙의 신고 종류에 message 가 없다), 어느 메시지인지는 설명에 적혀야 검토할 수 있다.
export function showReportBox(accountUid: string, target: ReportTarget, title: string, block: BlockTarget | null = null, initialExtra = ''): void {
  controller.showLayer(close => <ReportBox accountUid={accountUid} target={target} title={title} block={block} initialExtra={initialExtra} close={close} />)
}
