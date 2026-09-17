import { useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { DialogSummary } from '../../../shared/model'
import { desktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { waitFor } from '../app/contacts'
import { Spinner, TextField } from '../ui/controls'
import { Box } from '../ui/layers'
import { PeerPicker } from './peer-picker'
import { tr } from '../../../shared/i18n'

const toggle = (list: string[], uid: string): string[] => list.includes(uid) ? list.filter(item => item !== uid) : [...list, uid]

// Telegram "New Group": choose members, then name the group.
function CreateGroupBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [step, setStep] = useState<'members' | 'name'>('members')
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const self = useMemo(() => new Set([accountUid]), [accountUid])
  async function create(): Promise<void> {
    if (busy || !name.trim() || !selected.length) return
    const chatId = crypto.randomUUID()
    setBusy(true); setError('')
    try {
      const result = await trackWrite(window.morse.createGroup(accountUid, { chatId, name, participantUids: selected }))
      close()
      if (result === 'unconfirmed') controller.toast(tr('그룹 생성 결과를 아직 확인하지 못했습니다. 잠시 후 대화 목록을 확인해 주세요.'))
      void waitFor(() => desktop.value?.dialogs.some(dialog => dialog.id === chatId) ? true : null, 20000).then(() => controller.openChat(chatId)).catch(() => {})
    } catch (reason) { setError(errorText(reason, tr('그룹을 만들지 못했습니다.'))); setBusy(false) }
  }
  if (step === 'members') return <Box title={<>{tr('새 그룹')}{' '}<small className="box-title-count">{selected.length} / 99</small></>} width={400} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={!selected.length} onClick={() => setStep('name')}>{tr('다음')}</button>
  </>}>
    <PeerPicker accountUid={accountUid} selected={selected} exclude={self} max={99} onToggle={uid => setSelected(list => toggle(list, uid))} />
  </Box>
  return <Box title={<span className="box-title-back"><button className="icon-button small" aria-label={tr('참여자 선택으로')} disabled={busy} onClick={() => setStep('members')}><ArrowLeft size={18} /></button>{tr('새 그룹')}</span>} width={400} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || !name.trim()} onClick={() => { void create() }}>{busy && <Spinner size={14} />}{tr('만들기')}</button>
  </>}>
    <TextField label={tr('그룹 이름')} value={name} onChange={setName} maxLength={50} counter autoFocus disabled={busy} onSubmit={() => { void create() }} />
    <p className="box-note">{tr('참여자 {0}명과 함께 그룹을 만듭니다.', [selected.length])}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showCreateGroupBox(accountUid: string): void {
  controller.showLayer(close => <CreateGroupBox accountUid={accountUid} close={close} />)
}

function AddMembersBox({ accountUid, dialog, close }: { accountUid: string; dialog: DialogSummary; close(): void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const exclude = useMemo(() => new Set(dialog.participantUids), [dialog.participantUids])
  // A group holds at most 100 participants; one request adds 1–99 (groupMembersRequest).
  const max = Math.min(99, Math.max(0, 100 - dialog.participantUids.length))
  async function submit(): Promise<void> {
    if (busy || !selected.length) return
    setBusy(true); setError('')
    try {
      const result = await trackWrite(window.morse.addGroupMembers(accountUid, { id: crypto.randomUUID(), chatId: dialog.id, version: dialog.version, title: dialog.title, addUids: selected }))
      close()
      controller.toast(result === 'done' ? tr('{0}명을 그룹에 추가했습니다.', [selected.length]) : tr('참여자 추가 결과를 아직 확인하지 못했습니다. 잠시 후 참여자 목록을 확인해 주세요.'))
    } catch (reason) { setError(errorText(reason, tr('참여자를 추가하지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={<>{tr('참여자 추가')}{' '}<small className="box-title-count">{selected.length} / {max}</small></>} width={400} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || !selected.length} onClick={() => { void submit() }}>{busy && <Spinner size={14} />}{tr('추가')}</button>
  </>}>
    <PeerPicker accountUid={accountUid} selected={selected} exclude={exclude} max={max} disabled={busy} onToggle={uid => setSelected(list => toggle(list, uid))} />
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showAddMembersBox(accountUid: string, dialog: DialogSummary): void {
  controller.showLayer(close => <AddMembersBox accountUid={accountUid} dialog={dialog} close={close} />)
}
