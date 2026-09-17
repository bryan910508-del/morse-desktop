import { useState } from 'react'
import { desktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { waitFor } from '../app/contacts'
import { runJournal } from '../app/channel-publish'
import { retainChannels } from '../app/channel-visibility'
import { Spinner, TextField } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// Telegram "New Channel": name and description, created in one step.
function ChannelCreateBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [name, setName] = useState(''), [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function create(): Promise<void> {
    if (busy || !name.trim()) return
    setBusy(true); setError('')
    const id = crypto.randomUUID()
    try {
      const result = await runJournal({
        current: () => desktop.value?.channelCreation ?? null,
        refresh: () => window.morse.refreshChannelCreation(accountUid),
        action: action => window.morse.channelCreationAction(accountUid, action),
        prepare: requestId => window.morse.prepareChannelCreation(accountUid, { id: requestId, name, description })
      }, {
        waiting: tr('이전 채널 만들기 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 채널을 만들 수 없습니다. 프로필과 연결을 확인해 주세요.'),
        rejected: tr('채널을 만들지 못했습니다. 이름과 연결을 확인해 주세요.')
      }, id)
      close()
      if (result !== 'done') { controller.toast(tr('채널 생성 결과를 확인하고 있습니다. 잠시 후 채널 목록을 확인해 주세요.')); return }
      controller.toast(tr('채널을 만들었습니다.'))
      const release = retainChannels(accountUid)
      try {
        await waitFor(() => desktop.value?.channels?.items.some(item => item.id === id && item.status === 'ready') ? true : null, 20000)
        controller.openChannel(id)
      } catch { controller.showChats('channels') }
      finally { release() }
    } catch (reason) { setError(errorText(reason, tr('채널을 만들지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={tr('새 채널')} width={400} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || !name.trim()} onClick={() => { void create() }}>{busy && <Spinner size={14} />}{tr('만들기')}</button>
  </>}>
    <TextField label={tr('채널 이름')} value={name} onChange={setName} maxLength={50} counter autoFocus disabled={busy} onSubmit={() => { void create() }} />
    <TextField label={tr('소개 (선택)')} value={description} onChange={setDescription} maxLength={500} multiline rows={4} counter disabled={busy} />
    <p className="box-note">{tr('사진과 커버는 채널을 만든 뒤 채널 정보에서 바꿀 수 있습니다.')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showChannelCreateBox(accountUid: string): void {
  controller.showLayer(close => <ChannelCreateBox accountUid={accountUid} close={close} />)
}
