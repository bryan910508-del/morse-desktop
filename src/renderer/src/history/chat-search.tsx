import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { SearchSnapshot } from '../../../shared/search'
import { positionMilliseconds } from '../../../shared/model'
import { searchQuery } from '../../../shared/search'
import { controller } from '../app/ui'
import { useDesktopEvent } from '../app/store'
import { dialogTime, errorText } from '../app/format'
import { Spinner } from '../ui/controls'
import { tr } from '../../../shared/i18n'

const kinds = { text: '', image: tr('사진'), video: tr('동영상'), voice: tr('음성 메시지'), file: tr('파일'), sticker: tr('스티커'), location: tr('위치'), event: tr('일정'), channelPost: tr('채널 게시물'), unsupported: '' }

// Search in chat: results listed beside the history; selecting jumps there.
export function ChatSearchPanel({ accountUid, chatId }: { accountUid: string; chatId: string }) {
  const [query, setQuery] = useState('')
  const [value, setValue] = useState<SearchSnapshot | null>(null)
  const [error, setError] = useState('')
  const [jumping, setJumping] = useState<string | null>(null)
  const active = useRef<string | null>(null), revision = useRef(-1), input = useRef<HTMLInputElement>(null)
  const apply = (next: SearchSnapshot): void => { if (next.id === active.current && next.revision > revision.current) { revision.current = next.revision; setValue(next) } }
  useDesktopEvent(event => { if (event.type === 'search-changed' && event.accountUid === accountUid && event.chatId === chatId) apply(event.search) })
  const cancel = (): void => {
    const id = active.current; active.current = null; revision.current = -1
    if (id) void window.morse.closeSearch(accountUid, chatId, id).catch(() => {})
  }
  useEffect(() => { input.current?.focus(); return cancel }, [accountUid, chatId])
  async function start(): Promise<void> {
    let text: string
    try { text = searchQuery(query) } catch { return }
    cancel(); setError('')
    const id = crypto.randomUUID(); active.current = id
    setValue({ id, query: text, revision: -1, status: 'loading', hits: [], scanned: 0, hasMore: true, limited: false, message: '' })
    try { apply(await window.morse.searchMessages(accountUid, chatId, id, text)) }
    catch (reason) { if (active.current === id) { setValue(null); setError(errorText(reason, tr('검색하지 못했습니다.'))) } }
  }
  async function more(): Promise<void> {
    const id = active.current
    if (!id || value?.status !== 'ready') return
    setValue(current => current && { ...current, status: 'loading' })
    try { apply(await window.morse.moreSearch(accountUid, chatId, id)) }
    catch (reason) { if (active.current === id) setError(errorText(reason, tr('검색을 이어가지 못했습니다.'))) }
  }
  async function jump(messageId: string): Promise<void> {
    const id = active.current
    if (!id || jumping) return
    setJumping(messageId)
    try { await window.morse.jumpSearch(accountUid, chatId, id, messageId) }
    catch (reason) { controller.toast(errorText(reason, tr('메시지로 이동하지 못했습니다.')), 'error') }
    finally { setJumping(null) }
  }
  return <section className="side-panel" aria-label={tr('대화 안 검색')}>
    <header className="top-bar">
      <form className="search-field side-search" onSubmit={event => { event.preventDefault(); void start() }}>
        <Search size={16} />
        <input ref={input} value={query} maxLength={200} placeholder={tr('대화에서 검색')} data-region-focus onChange={event => { setQuery(event.target.value); if (!event.target.value) { cancel(); setValue(null) } }} />
      </form>
      <button className="icon-button" aria-label={tr('검색 닫기')} onClick={() => controller.setRight(null)}><X size={20} /></button>
    </header>
    <div className="side-panel-body">
      {error && <p className="box-error side-note" role="alert">{error}</p>}
      {!value ? <div className="empty-state">{tr('검색어를 입력하고 Enter를 누르세요.')}</div> : <>
        <p className="side-note" role="status">{value.status === 'loading' ? tr('검색 중…') : tr('결과 {0}개', [value.hits.length])}{value.limited ? tr(' · 표시 한도에 도달했습니다') : ''}</p>
        {value.hits.map(hit => <button key={hit.id} type="button" className="search-hit" disabled={jumping !== null} onClick={() => { void jump(hit.id) }}>
          <span className="search-hit-line"><strong className="ellipsis">{hit.sender}</strong><time>{dialogTime(positionMilliseconds(hit.position))}</time></span>
          <span className="search-hit-text ellipsis">{kinds[hit.kind] ? `${kinds[hit.kind]} · ` : ''}{hit.snippet}</span>
        </button>)}
        {value.status === 'loading' && <div className="empty-state"><Spinner size={20} /></div>}
        {value.status === 'ready' && value.hasMore && !value.limited && <button className="button flat block" onClick={() => { void more() }}>{tr('이전 기록 더 검색')}</button>}
        {value.status === 'ready' && !value.hits.length && !value.hasMore && <div className="empty-state">{tr('결과가 없습니다.')}</div>}
      </>}
    </div>
  </section>
}
