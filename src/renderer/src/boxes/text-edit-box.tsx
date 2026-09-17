import { useState } from 'react'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Spinner, TextField } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

export interface TextEditResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }

// Ui::InputField box used for names, bios and descriptions.
export function TextEditBox({ title, label, initial, maxLength, multiline, allowEmpty = multiline, note, close, save }: {
  title: string; label: string; initial: string; maxLength: number; multiline?: boolean; allowEmpty?: boolean; note?: string; close(): void; save(value: string): Promise<TextEditResult>
}) {
  const [value, setValue] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(): Promise<void> {
    if (busy || (!allowEmpty && !value.trim())) return
    if (value.trim() === initial.trim()) { close(); return }
    setBusy(true); setError('')
    try {
      const result = await trackWrite(save(value))
      if (result.outcome === 'rejected') { setError(result.message); setBusy(false) }
      else { if (result.outcome === 'uncertain') controller.toast(result.message); close() }
    } catch (reason) { setError(errorText(reason, tr('저장하지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={title} width={400} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || (!allowEmpty && !value.trim())} onClick={() => { void submit() }}>{busy && <Spinner size={14} />}{tr('저장')}</button>
  </>}>
    <TextField label={label} value={value} onChange={setValue} maxLength={maxLength} multiline={multiline} rows={multiline ? 6 : undefined} counter autoFocus disabled={busy} onSubmit={() => { void submit() }} />
    {note && <p className="box-note">{note}</p>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showTextEditBox(options: Omit<Parameters<typeof TextEditBox>[0], 'close'>): void {
  controller.showLayer(close => <TextEditBox {...options} close={close} />)
}
