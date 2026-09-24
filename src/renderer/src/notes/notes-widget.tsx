import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bookmark, Pin, Plus, Search, X } from 'lucide-react'
import { notePageSearch } from '../../../shared/space-note-search'
import { searchFold, searchText } from '../../../shared/search'
import { desktop, useDesktop } from '../app/store'
import { controller, useUi } from '../app/ui'
import { dialogTime, errorText, positionTime } from '../app/format'
import { Spinner } from '../ui/controls'
import { adoptNotesRequest, openNotesList, useNotesRequest } from './notes-state'
import { showNewNoteBox } from './new-note-box'
import { waitFor } from '../app/contacts'
import '../styles/notes.css'
import { tr } from '../../../shared/i18n'

// Left column for Morse space notes, laid out like Dialogs::Widget.
export function NotesWidget({ accountUid }: { accountUid: string }) {
  const requestId = useNotesRequest(accountUid)
  const snapshot = useDesktop(state => { const value = state?.spaceNotes; return value && requestId && value.requestId === requestId ? value : null })
  const selected = useUi(state => state.noteId)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Set<string> | null>(null)
  const [paging, setPaging] = useState(false), [opening, setOpening] = useState(false)
  const openChat = useUi(state => state.chatId)
  const listId = snapshot?.status === 'ready' ? snapshot.requestId : null, revision = snapshot?.status === 'ready' ? snapshot.revision : null
  useEffect(() => {
    setHits(null)
    if (!searchText(query) || !listId || !revision) return
    let request
    try { request = notePageSearch({ requestId: listId, revision, query }) } catch { return }
    let alive = true
    const timer = setTimeout(() => {
      void window.morse.searchNotePage(accountUid, request).then(result => { if (alive) setHits(new Set(result.hits.map(hit => hit.id))) }).catch(() => {})
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [accountUid, query, listId, revision])
  const rows = useMemo(() => {
    if (snapshot?.status !== 'ready') return []
    const needle = searchFold(query)
    return snapshot.rows.filter(row => !needle || (hits ? hits.has(row.id) : searchFold(`${row.title} ${row.preview}`).includes(needle)))
      .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || (positionTime(b.updated) ?? 0) - (positionTime(a.updated) ?? 0))
  }, [snapshot, query, hits])
  // Saved Messages: the server makes chats/memo_{uid} once, and it opens here instead of standing in the
  // chat list beside the notes, which is what iOS does with its `.memo` row (openNotesHub).
  const savedId = useDesktop(state => state?.dialogs.find(dialog => dialog.id === `memo_${accountUid}`)?.id ?? null)
  const savedPreview = useDesktop(state => state?.dialogs.find(dialog => dialog.id === `memo_${accountUid}`)?.preview ?? '')
  const openSaved = async (): Promise<void> => {
    if (opening) return
    if (savedId) { controller.openSavedMessages(savedId); return }
    setOpening(true)
    try {
      const chatId = await window.morse.prepareMemoChat(accountUid)
      await waitFor(() => desktop.value?.dialogs.some(dialog => dialog.id === chatId) ? true : null, 15000, tr('저장한 메시지를 여는 데 시간이 걸리고 있습니다. 잠시 후 다시 눌러 주세요.'))
      controller.openSavedMessages(chatId)
    } catch (reason) { controller.toast(errorText(reason, tr('저장한 메시지를 열지 못했습니다.')), 'error') }
    finally { setOpening(false) }
  }
  async function older(): Promise<void> {
    const older = snapshot?.page.older
    if (!snapshot?.requestId || !older || paging) return
    const next = crypto.randomUUID()
    setPaging(true)
    try { await window.morse.pageSpaceNotes(accountUid, { requestId: snapshot.requestId, nextRequestId: next, direction: 'older', noteId: older.noteId, version: older.version }); adoptNotesRequest(accountUid, next) }
    catch (reason) { controller.toast(errorText(reason, tr('이전 노트를 불러오지 못했습니다.')), 'error') }
    finally { setPaging(false) }
  }
  return <div className="dialogs-widget notes-widget">
    <div className="top-bar dialogs-top">
      <button className="icon-button" aria-label={tr('대화 목록으로')} onClick={() => controller.showChats()}><ArrowLeft size={20} /></button>
      <strong className="notes-title">{tr('노트')}</strong>
      <button className="icon-button" aria-label={tr('새 노트')} onClick={() => showNewNoteBox(accountUid)}><Plus size={20} /></button>
    </div>
    {/* The notes screen holds both: the messages kept for oneself, and the notes. */}
    <button type="button" className={`note-row saved-messages${openChat && openChat === savedId ? ' active' : ''}`} onClick={() => { void openSaved() }} disabled={opening}>
      <span className="note-row-line"><span className="saved-messages-icon">{opening ? <Spinner size={16} /> : <Bookmark size={16} />}</span><strong className="ellipsis">{tr('저장한 메시지')}</strong></span>
      <span className="note-row-preview ellipsis">{savedPreview || tr('나에게 보낸 메시지가 여기에 모입니다')}</span>
    </button>
    <div className="section-label">{tr('노트')}</div>
    <div className="notes-search">
      <label className="search-field"><Search size={16} /><input value={query} maxLength={200} placeholder={tr('제목·본문 검색')} onChange={event => setQuery(event.target.value)} />
        {query && <button className="icon-button small" aria-label={tr('검색어 지우기')} onClick={() => setQuery('')}><X size={16} /></button>}</label>
    </div>
    <div className="dialogs-scroll">
      {!snapshot || snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="dialogs-empty" role="status"><Spinner size={22} /></div>
        : snapshot.status !== 'ready' ? <div className="dialogs-empty" role="status"><p>{snapshot.message || tr('노트를 불러오지 못했습니다.')}</p><button className="button secondary" onClick={() => { void openNotesList(accountUid).catch(() => {}) }}>{tr('다시 불러오기')}</button></div>
          : !rows.length ? <div className="dialogs-empty">{query ? <p>{tr('‘{0}’에 맞는 노트가 없습니다.', [query])}</p> : <><strong>{tr('아직 노트가 없습니다')}</strong><button className="button secondary" onClick={() => showNewNoteBox(accountUid)}>{tr('새 노트 쓰기')}</button></>}</div>
            : <>
              {rows.map(row => {
                const time = positionTime(row.updated)
                return <button key={row.id} type="button" className={`note-row${selected === row.id ? ' active' : ''}`} onClick={() => controller.openNote(row.id)}>
                  <span className="note-row-line"><strong className="ellipsis">{row.title.trim() || row.preview.trim() || tr('제목 없는 노트')}</strong>{row.pinned === true && <Pin size={13} className="note-row-pin" aria-label={tr('고정됨')} />}<time>{dialogTime(time)}</time></span>
                  <span className="note-row-preview ellipsis">{row.preview || tr('내용 없음')}</span>
                </button>
              })}
              {snapshot.page.older && !query && <div className="notes-more"><button className="button flat" disabled={paging} onClick={() => { void older() }}>{paging && <Spinner size={14} />}{tr('이전 노트 더 보기')}</button></div>}
            </>}
    </div>
  </div>
}
