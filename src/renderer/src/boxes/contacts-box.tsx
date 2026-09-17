import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Heart, Link2, MessageCircle, Search, Star, Trash2, UserPlus } from 'lucide-react'
import { showInviteBox } from './invite-box'
import { publicMorseId } from '../../../shared/contacts'
import { searchFold } from '../../../shared/search'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { deleteContactByUid, openContactChat, waitFor } from '../app/contacts'
import { loadCloseFriends, setCloseFriend, useCloseFriends } from '../app/close-friends'
import { AvatarScope } from '../ui/avatar'
import { Spinner, TextField } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { ContactAvatar, useContactList } from './peer-picker'
import { usePresence } from '../app/presence'
import { tr } from '../../../shared/i18n'

// ContactListView: a contact's last seen under the name, else the name it was saved from.
function ContactStatus({ uid, original }: { uid: string; original: string | null }) {
  const presence = usePresence(uid)
  if (presence) return <small className={`ellipsis${presence.online ? ' online' : ''}`}>{presence.text}</small>
  return original ? <small className="ellipsis">{original}</small> : null
}

function AddContactBox({ accountUid, initial, close }: { accountUid: string; initial: string; close(): void }) {
  const [value, setValue] = useState(initial)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const snapshot = useDesktop(state => state?.contactSearch ?? null)
  const search = requestId && snapshot?.requestId === requestId ? snapshot : null
  useEffect(() => () => { if (requestId) void window.morse.closeContactSearch(accountUid, requestId).catch(() => {}) }, [accountUid, requestId])
  async function find(): Promise<void> {
    let id: string
    try { id = publicMorseId(value) } catch (reason) { setError(errorText(reason, tr('Morse ID를 확인해 주세요.'))); return }
    setError('')
    const next = crypto.randomUUID()
    setRequestId(next)
    try { await window.morse.searchContact(accountUid, next, id) } catch (reason) { setError(errorText(reason, tr('사용자를 찾지 못했습니다.'))) }
  }
  async function add(): Promise<void> {
    if (!requestId) return
    try { await trackWrite(window.morse.addContact(accountUid, requestId)) } catch (reason) { setError(errorText(reason, tr('연락처에 추가하지 못했습니다.'))) }
  }
  async function message(uid: string): Promise<void> {
    try {
      await waitFor(() => desktop.value?.contacts?.items.some(item => item.uid === uid) ? true : null, 10000, tr('연락처 목록에 반영되지 않았습니다. 잠시 후 다시 시도해 주세요.'))
      close(); await openContactChat(accountUid, uid)
    } catch (reason) { setError(errorText(reason, tr('대화를 열지 못했습니다.'))) }
  }
  const added = search?.outcome === 'added' || search?.outcome === 'exists'
  return <Box title={tr('연락처 추가')} width={380} buttons={<>
    <button className="button flat" onClick={close}>{tr('닫기')}</button>
    {search?.status === 'ready' && search.result && !added
      ? <button className="button flat" disabled={search.adding} onClick={() => { void add() }}>{search.adding && <Spinner size={14} />}{tr('추가')}</button>
      : added && search?.result ? <button className="button flat" onClick={() => { void message(search.result!.uid) }}>{tr('메시지 보내기')}</button>
        : <button className="button flat" disabled={search?.status === 'loading' || !value.trim()} onClick={() => { void find() }}>{tr('찾기')}</button>}
  </>}>
    <p className="box-note">{tr('상대의 8자리 Morse ID로 찾습니다.')}</p>
    <TextField label="Morse ID" value={value} onChange={next => { setValue(next); setRequestId(null); setError('') }} maxLength={9} placeholder="@abcd2345" autoFocus onSubmit={() => { void find() }} />
    {search?.status === 'loading' && <div className="empty-state"><Spinner size={20} /></div>}
    {search?.status === 'ready' && search.result && <div className="contact-found">
      <strong>{search.result.displayName}</strong>
      <span>{search.outcome === 'added' ? tr('연락처에 추가했습니다.') : search.outcome === 'exists' ? tr('이미 연락처에 있습니다.') : search.outcome === 'none' ? tr('연락처에 추가할 수 있습니다.') : search.message}</span>
    </div>}
    {(search?.status === 'empty' || search?.status === 'error') && <p className="box-note">{search.message}</p>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showAddContactBox(accountUid: string, initial = ''): void {
  controller.showLayer(close => <AddContactBox accountUid={accountUid} initial={initial} close={close} />)
}

function ContactsBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const contacts = useContactList()
  const closeFriends = useCloseFriends(accountUid)
  const [query, setQuery] = useState(''), [showArchived, setShowArchived] = useState(false)
  useEffect(() => { void loadCloseFriends(accountUid).catch(() => {}) }, [accountUid])
  // iOS ContactListView: favourites first, then every contact; archived ones sit in their own folder.
  const matched = useMemo(() => contacts.items.filter(item => !query || searchFold(item.displayName).includes(searchFold(query))), [contacts.items, query])
  const archivedCount = contacts.items.filter(item => item.archived).length
  const rows = matched.filter(item => showArchived ? item.archived : !item.archived)
  const favorites = showArchived || query ? [] : rows.filter(item => item.favorite)
  const others = showArchived || query ? rows : rows.filter(item => !item.favorite)
  const flag = (uid: string, patch: { favorite?: boolean; archived?: boolean }): void => {
    void window.morse.setContactFlags(accountUid, uid, patch).catch(reason => controller.toast(errorText(reason, tr('변경하지 못했습니다.')), 'error'))
  }
  const openMenu = (uid: string, name: string, point: { x: number; y: number }): void => { const current = contacts.items.find(item => item.uid === uid); popupMenu.open(point, [
    { label: tr('메시지 보내기'), icon: <MessageCircle size={18} />, onSelect: () => { close(); void openContactChat(accountUid, uid) } },
    { label: current?.favorite ? tr('즐겨찾기 해제') : tr('즐겨찾기'), icon: <Heart size={18} />, onSelect: () => flag(uid, { favorite: !current?.favorite }) },
    { label: current?.archived ? tr('복원') : tr('보관'), icon: current?.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />, onSelect: () => flag(uid, { archived: !current?.archived }) },
    closeFriends ? { label: closeFriends.has(uid) ? tr('친한 친구에서 빼기') : tr('친한 친구에 추가'), icon: <Star size={18} />, onSelect: () => { void setCloseFriend(accountUid, uid, !closeFriends.has(uid)) } } : null,
    'separator',
    { label: tr('연락처 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => {
      void confirmBox({ title: tr('연락처 삭제'), text: tr('{0}님을 연락처에서 삭제할까요? 대화 기록은 유지됩니다.', [name]), confirm: tr('삭제'), danger: true }).then(ok => { if (ok) void deleteContactByUid(accountUid, uid, name) })
    } }
  ]) }
  const row = (contact: typeof rows[number]) => <button key={contact.uid} type="button" className="peer-row" onClick={() => { close(); void openContactChat(accountUid, contact.uid) }}
    onContextMenu={event => { event.preventDefault(); openMenu(contact.uid, contact.displayName, pointFor(event, event.currentTarget)) }}>
    <ContactAvatar contact={contact} />
    <span className="peer-row-text"><strong className="ellipsis">{contact.displayName}</strong><ContactStatus uid={contact.uid} original={contact.originalName && contact.originalName !== contact.displayName ? contact.originalName : null} /></span>
    {contact.favorite && <Heart size={15} className="peer-row-star" aria-label={tr('즐겨찾기')} />}
    {closeFriends?.has(contact.uid) && <Star size={16} className="peer-row-star" aria-label={tr('친한 친구')} />}
  </button>
  return <Box title={showArchived ? tr('보관된 연락처') : tr('연락처')} width={400} className="contacts-box" onClose={close} buttons={<>
    {showArchived ? <button className="button flat" onClick={() => setShowArchived(false)}>{tr('모든 연락처')}</button>
      : <>
        <button className="button flat" onClick={() => showInviteBox(accountUid)}><Link2 size={18} />{tr('친구 초대')}</button>
        <button className="button flat" onClick={() => showAddContactBox(accountUid)}><UserPlus size={18} />{tr('연락처 추가')}</button>
      </>}
    <button className="button flat" onClick={close}>{tr('닫기')}</button>
  </>}>
    <label className="search-field"><Search size={16} /><input value={query} maxLength={200} placeholder={tr('연락처 검색')} data-autofocus onChange={event => setQuery(event.target.value)} /></label>
    <AvatarScope accountUid={accountUid} enabled surface="contacts">
      <div className="peer-list tall">
        {contacts.status !== 'ready' ? <div className="empty-state">{contacts.status === 'error' ? contacts.message || tr('연락처를 불러오지 못했습니다.') : <Spinner size={22} />}</div>
          : !rows.length ? <div className="empty-state">{query ? tr('검색 결과가 없습니다.') : showArchived ? tr('보관된 연락처가 없어요') : tr('아직 연락처가 없습니다. Morse ID로 친구를 추가해 보세요.')}</div>
            : <>
              {favorites.length > 0 && <><div className="section-label">{tr('즐겨찾기')}</div>{favorites.map(row)}<div className="section-label">{tr('모든 연락처')}</div></>}
              {others.map(row)}
            </>}
        {!showArchived && !query && archivedCount > 0 && <button type="button" className="peer-row archive-row" onClick={() => setShowArchived(true)}>
          <span className="avatar avatar-archive" style={{ width: 40, height: 40 }}><Archive size={20} /></span>
          <span className="peer-row-text"><strong>{tr('보관된 연락처')}</strong><small>{tr('{0}명', [archivedCount])}</small></span>
        </button>}
      </div>
    </AvatarScope>
  </Box>
}

export function showContactsBox(accountUid: string): void {
  controller.showLayer(close => <ContactsBox accountUid={accountUid} close={close} />)
}
