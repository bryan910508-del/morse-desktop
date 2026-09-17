import { useRef, useState } from 'react'
import { desktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { runJournal } from '../app/channel-publish'
import { Spinner, TextField } from '../ui/controls'
import { Box } from '../ui/layers'
import { reloadNotes } from './notes-state'
import { tr } from '../../../shared/i18n'

function NewNoteBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [draftId] = useState(() => crypto.randomUUID())
  const [title, setTitle] = useState(''), [body, setBody] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const draftRevision = useRef<string | null>(null)
  async function create(): Promise<void> {
    if (busy || (!title.trim() && !body.trim())) return
    setBusy(true); setError('')
    const id = crypto.randomUUID()
    try {
      const revision = crypto.randomUUID()
      const record = await trackWrite(window.morse.saveNoteDraft(accountUid, { id: draftId, title, body, pinned: false, expected: draftRevision.current, revision }))
      draftRevision.current = record.revision
      if (record.revision !== revision) throw new Error(tr('노트 초안을 저장하지 못했습니다.'))
      const result = await runJournal({
        current: () => desktop.value?.noteCreation ?? null,
        refresh: () => window.morse.refreshNoteCreation(accountUid),
        action: action => window.morse.noteCreationAction(accountUid, action),
        prepare: requestId => window.morse.prepareNoteCreation(accountUid, { id: requestId, draftId, draftRevision: revision, title, body, pinned: false })
      }, {
        waiting: tr('이전 노트 저장 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 노트를 저장할 수 없습니다. 연결을 확인해 주세요.'),
        rejected: tr('노트를 저장하지 못했습니다. 작성한 내용은 이 기기에 남아 있습니다.')
      }, id)
      close()
      controller.toast(result === 'done' ? tr('노트를 만들었습니다.') : tr('노트 저장 결과를 확인하고 있습니다.'))
      await reloadNotes(accountUid, id)
    } catch (reason) { setError(errorText(reason, tr('노트를 만들지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={tr('새 노트')} width={480} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || (!title.trim() && !body.trim())} onClick={() => { void create() }}>{busy && <Spinner size={14} />}{tr('저장')}</button>
  </>}>
    <TextField label={tr('제목')} value={title} onChange={setTitle} maxLength={200} autoFocus disabled={busy} />
    <TextField label={tr('내용')} value={body} onChange={setBody} maxLength={120000} multiline rows={10} disabled={busy} />
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showNewNoteBox(accountUid: string): void {
  controller.showLayer(close => <NewNoteBox accountUid={accountUid} close={close} />)
}
