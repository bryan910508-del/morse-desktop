import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { searchFold } from '../../../shared/search'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Avatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// iOS PostLikersView: «좋아요 N», searchable by name or @id.
function PostLikersBox({ accountUid, channelId, postId, close }: { accountUid: string; channelId: string; postId: string; close(): void }) {
  const [requestId] = useState(() => crypto.randomUUID()), [query, setQuery] = useState(''), [error, setError] = useState('')
  const value = useDesktop(snapshot => snapshot?.postLikers?.requestId === requestId ? snapshot.postLikers : null)
  useEffect(() => {
    void window.morse.openPostLikers(accountUid, { requestId, channelId, postId }).catch(reason => setError(errorText(reason, tr('목록을 불러오지 못했어요.'))))
    return () => { void window.morse.closePostLikers(accountUid, requestId).catch(() => {}) }
  }, [accountUid, requestId, channelId, postId])
  const items = (value?.items ?? []).filter(item => !query || searchFold(item.name).includes(searchFold(query)) || searchFold(item.handle).includes(searchFold(query)))
  return <Box title={tr('좋아요 {0}', [value?.items.length ?? '']).trim()} width={380} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <label className="search-field"><Search size={16} /><input value={query} maxLength={100} placeholder={tr('검색')} onChange={event => setQuery(event.target.value)} /></label>
    {error ? <p className="box-error" role="alert">{error}</p> : !value || value.status === 'loading' ? <div className="empty-state"><Spinner size={20} /></div>
      : <div className="peer-list">{items.map(item => <div key={item.uid} className="peer-row static">
        <Avatar name={item.name} url={item.photo?.status === 'ready' ? item.photo.url : null} size={40} />
        <span className="peer-row-text"><strong className="ellipsis">{item.name}</strong>{item.handle && <small>@{item.handle}</small>}</span>
      </div>)}</div>}
    {value?.partial && <p className="box-note">{tr('일부 사용자 정보를 불러오지 못했어요.')}</p>}
  </Box>
}

export function showPostLikers(accountUid: string, channelId: string, postId: string): void {
  controller.showLayer(close => <PostLikersBox accountUid={accountUid} channelId={channelId} postId={postId} close={close} />)
}
