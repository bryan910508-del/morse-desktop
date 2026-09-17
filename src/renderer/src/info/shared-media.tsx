import { useEffect, useRef, useState } from 'react'
import { File as FileIcon, Link as LinkIcon } from 'lucide-react'
import type { SearchSnapshot, SharedMediaFilter } from '../../../shared/search'
import { positionMilliseconds } from '../../../shared/model'
import { useDesktopEvent } from '../app/store'
import { dialogTime, duration as formatDuration, errorText } from '../app/format'
import { openLink } from '../app/links'
import { Spinner } from '../ui/controls'
import { MediaTile } from '../history/message'
import { showMediaViewer } from '../media/media-viewer'
import { tr } from '../../../shared/i18n'

const tabs: { id: SharedMediaFilter; label: string }[] = [{ id: 'media', label: tr('미디어') }, { id: 'files', label: tr('파일') }, { id: 'links', label: tr('링크') }]
const empty: Record<SharedMediaFilter, string> = { media: tr('주고받은 사진이나 동영상이 없습니다.'), files: tr('주고받은 파일이 없습니다.'), links: tr('주고받은 링크가 없습니다.') }

// Telegram's Shared Media and iOS ProfileView tabs: the room's recent photos and videos, files and links, read in
// the same bounded pages as a search, opened in place.
export function SharedMedia({ accountUid, chatId }: { accountUid: string; chatId: string }) {
  const [filter, setFilter] = useState<SharedMediaFilter>('media')
  const [value, setValue] = useState<SearchSnapshot | null>(null)
  const [error, setError] = useState('')
  const active = useRef<string | null>(null), revision = useRef(-1)
  const apply = (next: SearchSnapshot): void => { if (next.id === active.current && next.revision > revision.current) { revision.current = next.revision; setValue(next) } }
  useDesktopEvent(event => { if (event.type === 'search-changed' && event.accountUid === accountUid && event.chatId === chatId) apply(event.search) })
  useEffect(() => {
    const id = crypto.randomUUID()
    active.current = id; revision.current = -1; setValue(null); setError('')
    void window.morse.sharedMedia(accountUid, chatId, id, filter).then(apply).catch(reason => { if (active.current === id) setError(errorText(reason, tr('목록을 불러오지 못했습니다.'))) })
    return () => { active.current = null; void window.morse.closeSearch(accountUid, chatId, id).catch(() => {}) }
  }, [accountUid, chatId, filter])
  async function more(): Promise<void> {
    const id = active.current
    if (!id || value?.status !== 'ready') return
    setValue(current => current && { ...current, status: 'loading' })
    try { apply(await window.morse.moreSearch(accountUid, chatId, id)) }
    catch (reason) { if (active.current === id) setError(errorText(reason, tr('더 불러오지 못했습니다.'))) }
  }
  const hits = (value?.hits ?? []).filter(hit => hit.message)
  const open = (hitIndex: number, index: number): void => {
    const message = hits[hitIndex]?.message
    if (message) showMediaViewer(accountUid, chatId, message, index, hits[hitIndex]!.sender)
  }
  return <div className="shared-media">
    <div className="shared-media-tabs" role="tablist">{tabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={filter === tab.id}
      className={filter === tab.id ? 'active' : undefined} onClick={() => setFilter(tab.id)}>{tab.label}</button>)}</div>
    {error && <p className="box-error side-note" role="alert">{error}</p>}
    {filter === 'media' && <div className="shared-media-grid">{hits.flatMap((hit, hitIndex) => (hit.message!.attachments ?? []).filter(part => !part.blind).map(part =>
      <MediaTile key={`${hit.id}:${part.index}`} accountUid={accountUid} chatId={chatId} message={hit.message!} part={part} single={false} ratio={null}
        label={part.kind === 'video' && hit.message!.mediaMetadata?.videoDuration !== undefined ? formatDuration(hit.message!.mediaMetadata.videoDuration) : ''}
        onOpen={(_message, index) => open(hitIndex, index)} />))}</div>}
    {filter === 'files' && <div className="shared-media-list">{hits.flatMap((hit, hitIndex) => (hit.message!.attachments ?? []).filter(part => !part.blind).map(part =>
      <button key={`${hit.id}:${part.index}`} type="button" className="shared-media-row" disabled={!part.available} onClick={() => open(hitIndex, part.index)}>
        <span className="shared-media-icon"><FileIcon size={20} /></span>
        <span className="shared-media-text"><strong className="ellipsis">{part.name}</strong><small>{hit.sender} · {dialogTime(positionMilliseconds(hit.position))}</small></span>
      </button>))}</div>}
    {filter === 'links' && <div className="shared-media-list">{hits.map(hit => {
      let host = hit.snippet
      try { host = new URL(hit.snippet).host } catch { /* shown as written */ }
      const text = hit.message!.kind === 'text' ? hit.message!.text : hit.message!.caption ?? ''
      return <button key={hit.id} type="button" className="shared-media-row" onClick={() => { void openLink(accountUid, hit.snippet) }}>
        <span className="shared-media-icon link"><LinkIcon size={20} /></span>
        <span className="shared-media-text"><strong className="ellipsis">{host}</strong><small className="ellipsis">{text.replace(/\s+/g, ' ')}</small><small className="ellipsis link">{hit.snippet}</small></span>
      </button>
    })}</div>}
    {value?.status === 'loading' && <div className="side-note"><Spinner size={18} /></div>}
    {value?.status === 'ready' && !hits.length && !value.hasMore && <p className="side-note">{empty[filter]}</p>}
    {value?.status === 'ready' && value.hasMore && !value.limited && <button type="button" className="button flat block" onClick={() => { void more() }}>{tr('더 오래된 항목 보기')}</button>}
    {value?.limited && <p className="side-note">{tr('최근 항목까지만 보여 줍니다.')}</p>}
  </div>
}

