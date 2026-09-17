import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, EllipsisVertical, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react'
import type { NoteEditDraft } from '../../../shared/space-note-edit-drafts'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText, fullTime, positionTime } from '../app/format'
import { draftFlushers, trackWrite } from '../app/drafts'
import { runJournal } from '../app/channel-publish'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { reloadNotes, useNotesRequest } from './notes-state'
import '../styles/notes.css'
import { tr } from '../../../shared/i18n'

// A space note: edits are kept as a device draft while typing and sent to the
// server with Save (⌘/Ctrl+S) through the durable note save journal.
export function NoteEditor({ accountUid, noteId, oneColumn, leftmost }: { accountUid: string; noteId: string; oneColumn: boolean; leftmost: boolean }) {
  const requestId = useNotesRequest(accountUid)
  const list = useDesktop(state => { const value = state?.spaceNotes; return value && requestId && value.requestId === requestId && value.status === 'ready' ? value : null })
  const row = list?.rows.find(item => item.id === noteId) ?? null
  const note = list?.selected?.id === noteId ? list.selected : null
  const [title, setTitle] = useState(''), [body, setBody] = useState('')
  const [loaded, setLoaded] = useState<string | null>(null), [stale, setStale] = useState(false), [changed, setChanged] = useState(false)
  const [saving, setSaving] = useState(false), [busy, setBusy] = useState(false)
  const draft = useRef<{ revision: string; value: NoteEditDraft } | null>(null)
  const latest = useRef({ title: '', body: '' }), dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const noteRef = useRef(note), requestRef = useRef(requestId)
  noteRef.current = note; requestRef.current = requestId

  const queue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const task = chain.current.then(work, work)
    chain.current = task.catch(() => {})
    return trackWrite(task)
  }, [])

  useEffect(() => {
    if (!list || !row || !requestId || list.selected?.id === noteId) return
    void window.morse.selectSpaceNote(accountUid, { requestId, noteId, version: row.version }).catch(reason => controller.toast(errorText(reason, tr('노트를 열지 못했습니다.')), 'error'))
  }, [list?.requestId, row?.version, list?.selected?.id])

  useEffect(() => {
    if (!note || loaded === note.version) return
    let alive = true
    const apply = (value: { title: string; body: string }, record: { revision: string; value: NoteEditDraft } | null): void => {
      draft.current = record; latest.current = value; dirty.current = false
      setTitle(value.title); setBody(value.body)
      setStale(Boolean(record && record.value.baseVersion !== note.version))
      setChanged(Boolean(record && (record.value.title !== record.value.baseTitle || record.value.body !== record.value.baseBody)))
      setLoaded(note.version)
    }
    void window.morse.readNoteEditDraft(accountUid, { noteId }).then(record => {
      if (!alive) return
      if (record.draft && record.revision) apply({ title: record.draft.title, body: record.draft.body }, { revision: record.revision, value: record.draft })
      else apply({ title: note.title, body: note.body }, null)
    }).catch(() => { if (alive) apply({ title: note.title, body: note.body }, null) })
    return () => { alive = false }
  }, [note?.version])

  const flush = useCallback((): Promise<void> => queue(async () => {
    clearTimeout(timer.current)
    const current = noteRef.current, list = requestRef.current
    if (!dirty.current || !current) return
    dirty.current = false
    const content = latest.current
    try {
      if (!draft.current) {
        if (!list) throw new Error(tr('노트 목록을 다시 불러와 주세요.'))
        const started = await window.morse.startNoteEditDraft(accountUid, { noteId, requestId: list, version: current.version })
        if (!started.draft || !started.revision) throw new Error(tr('편집을 시작하지 못했습니다.'))
        draft.current = { revision: started.revision, value: started.draft }
      }
      const revision = crypto.randomUUID()
      const record = await window.morse.saveNoteEditDraft(accountUid, { noteId, expected: draft.current.revision, revision, draft: { ...draft.current.value, title: content.title, body: content.body } })
      if (record.revision !== revision || !record.draft) throw new Error(tr('편집 내용을 저장하지 못했습니다.'))
      draft.current = { revision, value: record.draft }
    } catch (error) { dirty.current = true; throw error }
  }), [accountUid, noteId, queue])

  useEffect(() => {
    draftFlushers.add(flush)
    return () => { draftFlushers.delete(flush); void flush().catch(() => {}) }
  }, [flush])

  function change(next: { title?: string; body?: string }): void {
    latest.current = { ...latest.current, ...next }; dirty.current = true
    if (next.title !== undefined) setTitle(next.title)
    if (next.body !== undefined) setBody(next.body)
    setChanged(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(reason => controller.toast(errorText(reason, tr('편집 내용을 기기에 저장하지 못했습니다.')), 'error')) }, 400)
  }

  async function save(): Promise<void> {
    if (saving || stale || !noteRef.current) return
    setSaving(true)
    try {
      await flush()
      const value = draft.current
      if (!value || (value.value.title === value.value.baseTitle && value.value.body === value.value.baseBody)) { setChanged(false); return }
      const result = await runJournal({
        current: () => desktop.value?.noteTextSave ?? null,
        refresh: () => window.morse.refreshNoteTextSave(accountUid),
        action: action => window.morse.noteTextSaveAction(accountUid, action),
        prepare: id => window.morse.prepareNoteTextSave(accountUid, { id, noteId, draftRevision: value.revision, draft: value.value })
      }, {
        waiting: tr('이전 노트 저장 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 노트를 저장할 수 없습니다. 연결을 확인해 주세요.'),
        rejected: tr('노트를 저장하지 못했습니다. 편집 내용은 이 기기에 남아 있습니다.')
      })
      if (result !== 'done') { controller.toast(tr('저장 결과를 확인하고 있습니다.')); return }
      draft.current = null; setChanged(false); setLoaded(null)
      controller.toast(tr('노트를 저장했습니다.'))
      await reloadNotes(accountUid, noteId)
    } catch (reason) { controller.toast(errorText(reason, tr('노트를 저장하지 못했습니다.')), 'error') }
    finally { setSaving(false) }
  }

  async function keepMine(): Promise<void> {
    if (busy || !draft.current) return
    setBusy(true)
    const id = crypto.randomUUID()
    try {
      await flush()
      const current = draft.current!
      const comparison = await window.morse.compareNoteEditDraft(accountUid, { id, noteId, draftRevision: current.revision })
      if (!comparison.current) throw new Error(comparison.message || tr('현재 노트를 확인하지 못했습니다.'))
      const revision = crypto.randomUUID()
      const record = await trackWrite(window.morse.rebaseNoteEditDraft(accountUid, { id, noteId, draftRevision: current.revision, revision, draft: current.value, current: comparison.current, mode: 'keep-input' }))
      if (!record.draft || record.revision !== revision) throw new Error(tr('편집 기준을 바꾸지 못했습니다.'))
      draft.current = { revision, value: record.draft }
      latest.current = { title: record.draft.title, body: record.draft.body }
      setTitle(record.draft.title); setBody(record.draft.body); setStale(false)
      setChanged(record.draft.title !== record.draft.baseTitle || record.draft.body !== record.draft.baseBody)
    } catch (reason) { controller.toast(errorText(reason, tr('내 편집을 유지하지 못했습니다.')), 'error') }
    finally { void window.morse.closeNoteEditComparison(accountUid, id).catch(() => {}); setBusy(false) }
  }

  async function discard(ask = true): Promise<void> {
    if (ask && !await confirmBox({ title: tr('변경 버리기'), text: tr('저장하지 않은 변경을 버리고 서버에 저장된 내용을 볼까요?'), confirm: tr('버리기'), danger: true })) return
    await queue(async () => {
      clearTimeout(timer.current); dirty.current = false
      const value = draft.current
      if (value) { await window.morse.saveNoteEditDraft(accountUid, { noteId, expected: value.revision, revision: crypto.randomUUID(), draft: null }); draft.current = null }
    }).catch(reason => controller.toast(errorText(reason, tr('변경을 버리지 못했습니다.')), 'error'))
    const current = noteRef.current
    if (current) { latest.current = { title: current.title, body: current.body }; setTitle(current.title); setBody(current.body) }
    setChanged(false); setStale(false)
  }

  async function togglePin(): Promise<void> {
    const current = noteRef.current, list = requestRef.current
    if (!current || current.pinned === null || busy || !list) return
    setBusy(true)
    try {
      await flush()
      const result = await trackWrite(window.morse.setSpaceNotePin(accountUid, { id: crypto.randomUUID(), requestId: list, noteId, version: current.version, pinned: current.pinned, desired: !current.pinned }))
      if (result.outcome !== 'saved') { controller.toast(result.message, result.outcome === 'rejected' ? 'error' : 'default'); return }
      controller.toast(current.pinned ? tr('고정을 해제했습니다.') : tr('노트를 고정했습니다.'))
      await reloadNotes(accountUid, noteId)
    } catch (reason) { controller.toast(errorText(reason, tr('고정 상태를 바꾸지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }

  async function remove(): Promise<void> {
    const current = noteRef.current, list = requestRef.current
    if (!current || busy || !list) return
    if (!await confirmBox({ title: tr('노트 삭제'), text: tr('이 노트를 삭제할까요? 저장하지 않은 변경도 함께 사라집니다.'), confirm: tr('삭제'), danger: true })) return
    setBusy(true)
    try {
      await discard(false)
      const result = await runJournal({
        current: () => desktop.value?.noteRemoval ?? null,
        refresh: () => window.morse.refreshNoteRemoval(accountUid),
        action: action => window.morse.noteRemovalAction(accountUid, action),
        prepare: id => window.morse.prepareNoteRemoval(accountUid, { id, requestId: list, noteId, version: current.version })
      }, {
        waiting: tr('이전 노트 삭제 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 이 노트를 삭제할 수 없습니다.'),
        rejected: tr('노트를 삭제하지 못했습니다.')
      })
      controller.toast(result === 'done' ? tr('노트를 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다.'))
      controller.openNote(null)
      await reloadNotes(accountUid)
    } catch (reason) { controller.toast(errorText(reason, tr('노트를 삭제하지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }

  const openMenu = (point: { x: number; y: number }): void => {
    const current = noteRef.current
    popupMenu.open(point, [
      { label: current?.pinned ? tr('고정 해제') : tr('고정'), icon: current?.pinned ? <PinOff size={18} /> : <Pin size={18} />, disabled: !current || current.pinned === null || busy, onSelect: () => { void togglePin() } },
      changed ? { label: tr('변경 버리기'), icon: <RotateCcw size={18} />, onSelect: () => { void discard() } } : null,
      'separator',
      { label: tr('노트 삭제'), icon: <Trash2 size={18} />, danger: true, disabled: !current || busy, onSelect: () => { void remove() } }
    ])
  }

  const updated = note ? positionTime(note.updated) : null
  const status = saving ? tr('저장 중…') : changed ? tr('저장하지 않은 변경이 있습니다') : updated !== null ? tr('{0} 수정', [fullTime(updated)]) : ''
  return <section className="note-editor" aria-label={tr('노트')} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
  }}>
    <header className={`top-bar${leftmost ? ' leftmost' : ''}`}>
      {oneColumn && <button className="icon-button" aria-label={tr('노트 목록으로')} onClick={() => controller.openNote(null)}><ArrowLeft size={20} /></button>}
      <span className="top-bar-title"><strong className="ellipsis">{title.trim() || tr('제목 없는 노트')}</strong><span className="ellipsis">{status}</span></span>
      <button className="button flat" disabled={!changed || saving || stale || !loaded} onClick={() => { void save() }}>{saving && <Spinner size={14} />}{tr('저장')}</button>
      <button className="icon-button" aria-label={tr('노트 메뉴')} disabled={!note} onClick={event => openMenu(pointFor(event, event.currentTarget))}>{busy ? <Spinner size={18} /> : <EllipsisVertical size={20} />}</button>
    </header>
    {stale && <div className="note-editor-bar" role="status">
      <span>{tr('다른 곳에서 이 노트가 바뀌었습니다. 내 편집을 어떻게 할까요?')}</span>
      <button className="button flat" disabled={busy} onClick={() => { void keepMine() }}>{tr('내 편집 유지')}</button>
      <button className="button flat" disabled={busy} onClick={() => { void discard() }}>{tr('저장된 내용 보기')}</button>
    </div>}
    {!list ? <div className="empty-main"><Spinner size={24} /></div>
      : !row ? <div className="empty-main"><span className="service-pill">{tr('노트를 찾을 수 없습니다')}</span></div>
        : !note || loaded !== note.version ? <div className="empty-main"><Spinner size={24} /></div>
          : <div className="note-editor-body">
            <input className="note-editor-title" value={title} maxLength={200} placeholder={tr('제목')} aria-label={tr('노트 제목')} onChange={event => change({ title: event.target.value })} />
            <textarea className="note-editor-text" value={body} maxLength={120000} placeholder={tr('내용을 입력하세요')} aria-label={tr('노트 내용')} onChange={event => change({ body: event.target.value })} />
            {note.created && <p className="note-editor-meta">{tr('{0} 작성', [fullTime(positionTime(note.created) ?? 0)])}</p>}
          </div>}
  </section>
}
