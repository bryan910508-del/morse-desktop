import { useEffect, useRef } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import { controller, useUi } from '../app/ui'
import { ChannelHome } from './channel-home'
import { tr } from '../../../shared/i18n'

// The left column of the channels section. Telegram keeps channels out of the chat list's folder
// strip, and iOS gives them their own tab (ChannelFeedView) with its own search that opens
// ChannelExplorePane; this column is that tab.
export function ChannelsWidget({ accountUid }: { accountUid: string }) {
  const query = useUi(state => state.dialogsQuery)
  const searchFocus = useUi(state => state.searchFocus)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { if (searchFocus) { search.current?.focus(); search.current?.select() } }, [searchFocus])
  return <div className="dialogs channels-widget" aria-label={tr('채널')}>
    <div className="top-bar">
      <button className="icon-button" aria-label={tr('대화 목록으로')} onClick={() => controller.showChats()}><ArrowLeft size={20} /></button>
      <label className="search-field">
        <Search size={17} />
        <input ref={search} value={query} placeholder={tr('채널 이름·키워드 검색')} aria-label={tr('채널 검색')} maxLength={200} data-region-focus
          onChange={event => controller.setQuery(event.target.value)}
          onFocus={() => controller.setChannelExplore(true)}
          onKeyDown={event => { if (event.key === 'Escape') { controller.setQuery(''); controller.setChannelExplore(false); search.current?.blur() } }} />
        {query && <button className="icon-button small" aria-label={tr('검색어 지우기')} onClick={() => { controller.setQuery(''); search.current?.focus() }}><X size={16} /></button>}
      </label>
    </div>
    <ChannelHome accountUid={accountUid} query={query} />
  </div>
}
