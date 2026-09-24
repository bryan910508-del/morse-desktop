import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Search } from 'lucide-react'
import type { ChatMessage } from '../../../shared/model'
import type { ForwardProgress, ForwardTarget } from '../../../shared/forward'
import type { InquiryForwardRoom } from '../../../shared/channel-inquiries'
import { maxForwardTargets } from '../../../shared/forward'
import { searchFold } from '../../../shared/search'
import { controller } from '../app/ui'
import { desktop, useDesktopEvent } from '../app/store'
import { waitFor } from '../app/contacts'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Box } from '../ui/layers'
import { RoundCheck, Spinner } from '../ui/controls'
import { DialogAvatar } from '../ui/user-avatar'
import { Avatar } from '../ui/avatar'
import { tr } from '../../../shared/i18n'

// Where the messages come from: a chat, or an open inquiry room, which the queue names by its client id.
export type ShareOrigin = { kind: 'chat' } | { kind: 'inquiry'; inquiryId: string }
const sourceChatId = (message: ChatMessage, origin: ShareOrigin): string => origin.kind === 'inquiry' ? `sub_inq_${origin.inquiryId}` : message.chatId

// ShareBox: pick up to 10 chats; messages are re-sent as the user's own.
function ShareBox({ accountUid, messages, origin, close }: { accountUid: string; messages: ChatMessage[]; origin: ShareOrigin; close(): void }) {
  const first = messages[0]!
  const inquiry = origin.kind === 'inquiry'
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null)
  const [rooms, setRooms] = useState<InquiryForwardRoom[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [operationId] = useState(() => crypto.randomUUID())
  const [progress, setProgress] = useState<ForwardProgress | null>(null)
  const media = messages.some(message => message.kind !== 'text')
  useDesktopEvent(event => { if (event.type === 'forward-progress' && event.accountUid === accountUid && event.progress.operationId === operationId) setProgress(event.progress) })
  useEffect(() => {
    let current = true
    const source = { chatId: sourceChatId(first, origin), messageId: first.id, version: first.version }
    void (inquiry ? window.morse.inquiryForwardTargets(accountUid, source) : window.morse.forwardTargets(accountUid, source))
      .then(list => { if (current) setTargets(list) }).catch(reason => { if (current) { setTargets([]); setError(errorText(reason, tr('전달할 대화를 불러오지 못했습니다.'))) } })
    // A 1:1 inquiry room takes a forwarded message too; a room that cannot be listed simply is not offered.
    void window.morse.inquiryForwardRooms(accountUid, source).then(list => { if (current) setRooms(list) }).catch(() => { if (current) setRooms([]) })
    return () => { current = false }
  }, [accountUid, first.chatId, first.id, first.version, inquiry])
  const shown = useMemo(() => (targets ?? []).filter(target => !query || searchFold(target.title).includes(searchFold(query))), [targets, query])
  const shownRooms = useMemo(() => rooms.filter(room => !query || searchFold(room.title).includes(searchFold(query))), [rooms, query])
  // peerListPartitionRows(isSelf): Saved Messages leads the whole list, above the inquiry rooms as well.
  const saved = useMemo(() => shown.find(target => target.chatId.startsWith('memo_')) ?? null, [shown])
  const others = useMemo(() => shown.filter(target => target !== saved), [shown, saved])
  const chosen = selected.length + selectedRooms.length
  const toggle = (chatId: string): void => setSelected(current => current.includes(chatId) ? current.filter(id => id !== chatId)
    : chosen < maxForwardTargets ? [...current, chatId] : current)
  const toggleRoom = (inquiryId: string): void => setSelectedRooms(current => current.includes(inquiryId) ? current.filter(id => id !== inquiryId)
    : chosen < maxForwardTargets ? [...current, inquiryId] : current)
  async function submit(): Promise<void> {
    if (busy || !chosen) return
    setBusy(true); setError('')
    try {
      if (selected.length) await forwardToChats()
      if (selectedRooms.length) {
        // A room is sent to, not queued for: each message goes in on its own, in the order it was picked.
        for (const [index, message] of messages.entries()) {
          await trackWrite(window.morse.forwardToInquiries(accountUid, { id: `${operationId}-${index}`,
            source: { chatId: sourceChatId(message, origin), messageId: message.id, version: message.version }, inquiryIds: selectedRooms }))
        }
      }
      controller.toast(chosen === 1 ? tr('메시지를 전달했습니다.') : tr('{0}개 대화에 전달했습니다.', [chosen]))
      close()
    } catch (reason) { setError(errorText(reason, tr('메시지를 전달하지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  // The chats go through the delivery queue, as every forward into a chat does.
  async function forwardToChats(): Promise<void> {
    // Saved Messages is offered before its room exists, as Telegram's list always holds it; the room
    // the server makes on first use is made here, the way the notes screen makes it before opening.
    const savedId = `memo_${accountUid}`
    if (selected.includes(savedId) && !desktop.value?.dialogs.some(dialog => dialog.id === savedId)) {
      await window.morse.prepareMemoChat(accountUid)
      await waitFor(() => desktop.value?.dialogs.some(dialog => dialog.id === savedId) ? true : null, 15000,
        tr('저장한 메시지를 준비하는 데 시간이 걸리고 있습니다. 잠시 후 다시 시도해 주세요.'))
    }
    if (messages.length > 1) {
      const batch = { id: operationId, sources: messages.map(message => ({ chatId: sourceChatId(message, origin), messageId: message.id, version: message.version })),
        targets: selected.map(chatId => ({ chatId, messageIds: messages.map(() => crypto.randomUUID()) })) }
      await trackWrite(inquiry ? window.morse.forwardInquiryBatch(accountUid, batch) : window.morse.forwardBatch(accountUid, batch))
    } else {
      const request = { id: operationId, source: { chatId: sourceChatId(first, origin), messageId: first.id, version: first.version }, targets: selected.map(chatId => ({ chatId, messageId: crypto.randomUUID() })) }
      await trackWrite(inquiry ? (media ? window.morse.forwardInquiryMedia(accountUid, request) : window.morse.forwardInquiryText(accountUid, request))
        : media ? window.morse.forwardMedia(accountUid, request) : window.morse.forwardText(accountUid, request))
    }
  }
  const cancel = (): void => {
    if (busy && media) void window.morse.cancelForward(accountUid, operationId).catch(() => {})
    close()
  }
  return <Box title={messages.length > 1 ? tr('메시지 {0}개 전달', [messages.length]) : tr('전달')} width={400} className="share-box" buttons={<>
    <button className="button flat" onClick={cancel}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || !chosen} onClick={() => { void submit() }}>{busy && <Spinner size={14} />}{chosen ? tr('전달 ({0})', [chosen]) : tr('전달')}</button>
  </>}>
    <label className="search-field"><Search size={16} /><input value={query} placeholder={tr('대화 검색')} data-autofocus onChange={event => setQuery(event.target.value)} /></label>
    <div className="peer-list" aria-busy={targets === null}>
      {targets === null ? <div className="empty-state"><Spinner size={22} /></div> : !shown.length && !shownRooms.length ? <div className="empty-state">{query ? tr('검색 결과가 없습니다.') : tr('전달할 수 있는 대화가 없습니다.')}</div>
        : <>{saved && <button type="button" className="peer-row" aria-pressed={selected.includes(saved.chatId)} disabled={busy || (!selected.includes(saved.chatId) && chosen >= maxForwardTargets)} onClick={() => toggle(saved.chatId)}>
          <span className="avatar avatar-saved" style={{ width: 42, height: 42 }} aria-hidden="true"><Bookmark size={20} /></span>
          <span className="peer-row-text"><strong className="ellipsis">{saved.title}</strong><small>{tr('나만 볼 수 있어요')}</small></span>
          <RoundCheck checked={selected.includes(saved.chatId)} />
        </button>}
        {shownRooms.map(room => {
          const checked = selectedRooms.includes(room.inquiryId)
          return <button key={room.inquiryId} type="button" className="peer-row" aria-pressed={checked} disabled={busy || (!checked && chosen >= maxForwardTargets)} onClick={() => toggleRoom(room.inquiryId)}>
            <Avatar name={room.title} size={42} />
            <span className="peer-row-text"><strong className="ellipsis">{room.title}</strong><small>{tr('1:1 문의')}</small></span>
            <RoundCheck checked={checked} />
          </button>
        })}
        {others.map(target => {
          const checked = selected.includes(target.chatId)
          return <button key={target.chatId} type="button" className="peer-row" aria-pressed={checked} disabled={busy || (!checked && chosen >= maxForwardTargets)} onClick={() => toggle(target.chatId)}>
            <DialogAvatar chatId={target.chatId} name={target.title} size={42} />
            <span className="peer-row-text"><strong className="ellipsis">{target.title}</strong><small>{target.kind === 'group' ? tr('그룹', [], 'kind') : tr('개인 대화')}</small></span>
            <RoundCheck checked={checked} />
          </button>
        })}</>}
    </div>
    {busy && progress && <p className="box-note" role="status">{progress.phase === 'saving' ? tr('전달 내용을 저장하고 있습니다…') : tr('첨부 준비 중 {0} / {1}', [progress.current, progress.count])}</p>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showShareBox(accountUid: string, messages: ChatMessage[], origin: ShareOrigin = { kind: 'chat' }): void {
  if (!messages.length) return
  controller.showLayer(close => <ShareBox accountUid={accountUid} messages={messages} origin={origin} close={close} />)
}
