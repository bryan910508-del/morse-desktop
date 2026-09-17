import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { ChatMessage } from '../../../shared/model'
import type { ForwardProgress, ForwardTarget } from '../../../shared/forward'
import { maxForwardTargets } from '../../../shared/forward'
import { searchFold } from '../../../shared/search'
import { controller } from '../app/ui'
import { useDesktopEvent } from '../app/store'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Box } from '../ui/layers'
import { RoundCheck, Spinner } from '../ui/controls'
import { DialogAvatar } from '../ui/user-avatar'
import { tr } from '../../../shared/i18n'

// ShareBox: pick up to 10 chats; messages are re-sent as the user's own.
function ShareBox({ accountUid, messages, close }: { accountUid: string; messages: ChatMessage[]; close(): void }) {
  const first = messages[0]!
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [operationId] = useState(() => crypto.randomUUID())
  const [progress, setProgress] = useState<ForwardProgress | null>(null)
  const media = messages.some(message => message.kind !== 'text')
  useDesktopEvent(event => { if (event.type === 'forward-progress' && event.accountUid === accountUid && event.progress.operationId === operationId) setProgress(event.progress) })
  useEffect(() => {
    let current = true
    void window.morse.forwardTargets(accountUid, { chatId: first.chatId, messageId: first.id, version: first.version })
      .then(list => { if (current) setTargets(list) }).catch(reason => { if (current) { setTargets([]); setError(errorText(reason, tr('전달할 대화를 불러오지 못했습니다.'))) } })
    return () => { current = false }
  }, [accountUid, first.chatId, first.id, first.version])
  const shown = useMemo(() => (targets ?? []).filter(target => !query || searchFold(target.title).includes(searchFold(query))), [targets, query])
  const toggle = (chatId: string): void => setSelected(current => current.includes(chatId) ? current.filter(id => id !== chatId) : current.length < maxForwardTargets ? [...current, chatId] : current)
  async function submit(): Promise<void> {
    if (busy || !selected.length) return
    setBusy(true); setError('')
    try {
      if (messages.length > 1) {
        await trackWrite(window.morse.forwardBatch(accountUid, { id: operationId, sources: messages.map(message => ({ chatId: message.chatId, messageId: message.id, version: message.version })),
          targets: selected.map(chatId => ({ chatId, messageIds: messages.map(() => crypto.randomUUID()) })) }))
      } else {
        const request = { id: operationId, source: { chatId: first.chatId, messageId: first.id, version: first.version }, targets: selected.map(chatId => ({ chatId, messageId: crypto.randomUUID() })) }
        await trackWrite(media ? window.morse.forwardMedia(accountUid, request) : window.morse.forwardText(accountUid, request))
      }
      controller.toast(selected.length === 1 ? tr('메시지를 전달했습니다.') : tr('{0}개 대화에 전달했습니다.', [selected.length]))
      close()
    } catch (reason) { setError(errorText(reason, tr('메시지를 전달하지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  const cancel = (): void => {
    if (busy && media) void window.morse.cancelForward(accountUid, operationId).catch(() => {})
    close()
  }
  return <Box title={messages.length > 1 ? tr('메시지 {0}개 전달', [messages.length]) : tr('전달')} width={400} className="share-box" buttons={<>
    <button className="button flat" onClick={cancel}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || !selected.length} onClick={() => { void submit() }}>{busy && <Spinner size={14} />}{selected.length ? tr('전달 ({0})', [selected.length]) : tr('전달')}</button>
  </>}>
    <label className="search-field"><Search size={16} /><input value={query} placeholder={tr('대화 검색')} data-autofocus onChange={event => setQuery(event.target.value)} /></label>
    <div className="peer-list" aria-busy={targets === null}>
      {targets === null ? <div className="empty-state"><Spinner size={22} /></div> : !shown.length ? <div className="empty-state">{query ? tr('검색 결과가 없습니다.') : tr('전달할 수 있는 대화가 없습니다.')}</div>
        : shown.map(target => {
          const checked = selected.includes(target.chatId)
          return <button key={target.chatId} type="button" className="peer-row" aria-pressed={checked} disabled={busy || (!checked && selected.length >= maxForwardTargets)} onClick={() => toggle(target.chatId)}>
            <DialogAvatar chatId={target.chatId} name={target.title} size={42} />
            <span className="peer-row-text"><strong className="ellipsis">{target.title}</strong><small>{target.kind === 'group' ? tr('그룹', [], 'kind') : tr('개인 대화')}</small></span>
            <RoundCheck checked={checked} />
          </button>
        })}
    </div>
    {busy && progress && <p className="box-note" role="status">{progress.phase === 'saving' ? tr('전달 내용을 저장하고 있습니다…') : tr('첨부 준비 중 {0} / {1}', [progress.current, progress.count])}</p>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showShareBox(accountUid: string, messages: ChatMessage[]): void {
  if (!messages.length) return
  controller.showLayer(close => <ShareBox accountUid={accountUid} messages={messages} close={close} />)
}
