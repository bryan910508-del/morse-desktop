import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { DialogSummary } from '../../../shared/model'
import { peerBarShown, peerBarWorthAsking, type PeerBarFacts } from '../../../shared/peer-bar'
import { loadBlockedUsers, setBlocked, useBlockedUsers } from '../app/blocked-users'
import { trackWrite } from '../app/drafts'
import { errorText } from '../app/format'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { Switch } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// B52 (Telegram R-64): the bar over a 1:1 a stranger opened — «차단 · 연락처 추가 · ×» (shared/peer-bar.ts).
export function PeerBar({ accountUid, dialog }: { accountUid: string; dialog: DialogSummary }) {
  const peerUid = dialog.kind === 'direct' ? dialog.participantUids.find(uid => uid !== accountUid) ?? null : null
  const contact = useDesktop(state => peerUid && state?.contacts ? state.contacts.items.some(item => item.uid === peerUid) : null)
  const blockedUsers = useBlockedUsers(accountUid)
  const [hidden, setHidden] = useState<{ peer: string; value: boolean } | null>(null)
  const [adding, setAdding] = useState(false)
  const facts: PeerBarFacts = { accountUid, chatId: dialog.id, kind: dialog.kind, createdBy: dialog.createdBy, peerUid, peerDeleted: dialog.peerDeleted, contact,
    blocked: blockedUsers ? blockedUsers.some(user => user.uid === peerUid) : null, hidden: hidden && hidden.peer === peerUid ? hidden.value : null }
  const worth = peerBarWorthAsking(facts)
  useEffect(() => { if (worth && blockedUsers === null) void loadBlockedUsers(accountUid).catch(() => []) }, [accountUid, worth, blockedUsers])
  // The setting is read once per person and chat opened; a failed read leaves the bar out rather than guessing.
  useEffect(() => {
    if (!peerUid || !worth || hidden?.peer === peerUid) return
    let alive = true
    void window.morse.peerBarHidden(accountUid, peerUid).then(value => { if (alive) setHidden({ peer: peerUid, value }) }).catch(() => {})
    return () => { alive = false }
  }, [accountUid, peerUid, worth])
  if (!peerUid || !peerBarShown(facts)) return null
  const name = dialog.title
  async function add(): Promise<void> {
    if (adding) return
    setAdding(true)
    try {
      const result = await trackWrite(window.morse.addChatContact(accountUid, { id: crypto.randomUUID(), chatId: dialog.id, uid: peerUid! }))
      controller.toast(result.outcome === 'added' ? tr('{0}님을 연락처에 추가했습니다.', [name]) : result.outcome === 'exists' ? tr('이미 연락처에 있습니다.') : result.message, result.outcome === 'rejected' ? 'error' : 'default')
    } catch (reason) { controller.toast(errorText(reason, tr('연락처에 추가하지 못했습니다.')), 'error') }
    finally { setAdding(false) }
  }
  function close(): void {
    setHidden({ peer: peerUid!, value: true })
    void trackWrite(window.morse.hidePeerBar(accountUid, peerUid!)).catch(reason => controller.toast(errorText(reason, tr('설정을 저장하지 못했습니다.')), 'error'))
  }
  return <div className="peer-bar" role="region" aria-label={tr('연락처에 없는 사용자')}>
    <button type="button" className="peer-bar-action danger" onClick={() => showPeerBlockBox(accountUid, dialog, peerUid!)}>{tr('차단')}</button>
    <button type="button" className="peer-bar-action" disabled={adding} onClick={() => { void add() }}>{tr('연락처 추가')}</button>
    <button type="button" className="icon-button small peer-bar-close" aria-label={tr('닫기')} onClick={close}><X size={18} /></button>
  </div>
}

// Telegram's block box from that bar: block, with «report spam» and «delete this chat» both ticked.
function PeerBlockBox({ accountUid, dialog, peerUid, close }: { accountUid: string; dialog: DialogSummary; peerUid: string; close(): void }) {
  const [report, setReport] = useState(true), [remove, setRemove] = useState(true), [busy, setBusy] = useState(false)
  async function confirm(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      if (report) await trackWrite(window.morse.report(accountUid, { target: { type: 'user', targetId: peerUid }, category: 'spam', extra: '' }))
      await setBlocked(accountUid, { uid: peerUid, userId: '', displayName: dialog.title }, true)
      if (remove) {
        controller.closeChat()
        await trackWrite(window.morse.deleteChat(accountUid, dialog.id, false))
      }
      controller.toast(report ? tr('신고하고 차단했습니다.') : tr('차단했습니다.'))
      close()
    } catch (reason) { controller.toast(errorText(reason, tr('차단하지 못했습니다.')), 'error'); setBusy(false) }
  }
  return <Box title={tr('사용자 차단')} width={380} onClose={busy ? undefined : close} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat danger" disabled={busy} data-autofocus onClick={() => { void confirm() }}>{tr('차단')}</button>
  </>}>
    <p className="box-text">{tr('{0}님을 차단할까요? 설정 → 개인정보에서 언제든 해제할 수 있어요.', [dialog.title])}</p>
    <label className="settings-toggle"><span className="settings-toggle-text"><span>{tr('스팸으로 신고')}</span></span>
      <Switch label={tr('스팸으로 신고')} checked={report} disabled={busy} onChange={setReport} /></label>
    <label className="settings-toggle"><span className="settings-toggle-text"><span>{tr('이 대화 삭제')}</span></span>
      <Switch label={tr('이 대화 삭제')} checked={remove} disabled={busy} onChange={setRemove} /></label>
  </Box>
}
export function showPeerBlockBox(accountUid: string, dialog: DialogSummary, peerUid: string): void {
  controller.showLayer(close => <PeerBlockBox accountUid={accountUid} dialog={dialog} peerUid={peerUid} close={close} />)
}
