import { useMemo, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import type { ContactSummary } from '../../../shared/contacts'
import { searchFold } from '../../../shared/search'
import { useDesktop } from '../app/store'
import { AvatarScope } from '../ui/avatar'
import { RoundCheck, Spinner } from '../ui/controls'
import { ContactAvatar } from '../ui/user-avatar'
import { tr } from '../../../shared/i18n'

const noContacts: ContactSummary[] = []

export { ContactAvatar } from '../ui/user-avatar'

export function useContactList(): { status: 'loading' | 'ready' | 'error'; items: ContactSummary[]; message: string } {
  const status = useDesktop(state => state?.contacts?.status ?? 'loading')
  const items = useDesktop(state => state?.contacts?.items ?? noContacts)
  const message = useDesktop(state => state?.contacts?.message ?? '')
  return { status, items, message }
}

// PeerListBox content: search, selected chips and a contact list with round checks.
export function PeerPicker({ accountUid, selected, onToggle, exclude, max, disabled, chips = true, trailing }: {
  accountUid: string; selected: string[]; onToggle(uid: string): void; exclude?: ReadonlySet<string>; max?: number; disabled?: boolean; chips?: boolean
  trailing?(contact: ContactSummary): ReactNode
}) {
  const contacts = useContactList()
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(contacts.items.map(item => [item.uid, item])), [contacts.items])
  const rows = useMemo(() => contacts.items.filter(item => !exclude?.has(item.uid) && (!query || searchFold(item.displayName).includes(searchFold(query)))), [contacts.items, exclude, query])
  const full = max !== undefined && selected.length >= max
  return <div className="peer-picker">
    <label className="search-field"><Search size={16} /><input value={query} maxLength={200} placeholder={tr('이름으로 찾기')} data-autofocus onChange={event => setQuery(event.target.value)} /></label>
    {chips && selected.length > 0 && <div className="peer-chips">{selected.map(uid => <button key={uid} type="button" className="peer-chip" disabled={disabled} onClick={() => onToggle(uid)}>
      <span className="ellipsis">{byId.get(uid)?.displayName ?? tr('선택한 사용자')}</span><X size={12} />
    </button>)}</div>}
    <AvatarScope accountUid={accountUid} enabled surface="contacts">
      <div className="peer-list">
        {contacts.status !== 'ready' ? <div className="empty-state">{contacts.status === 'error' ? contacts.message || tr('연락처를 불러오지 못했습니다.') : <Spinner size={22} />}</div>
          : !rows.length ? <div className="empty-state">{query ? tr('검색 결과가 없습니다.') : tr('선택할 수 있는 연락처가 없습니다.')}</div>
            : rows.map(contact => {
              const checked = selected.includes(contact.uid)
              return <button key={contact.uid} type="button" className="peer-row" aria-pressed={checked} disabled={disabled || (!checked && full)} onClick={() => onToggle(contact.uid)}>
                <ContactAvatar contact={contact} />
                <span className="peer-row-text"><strong className="ellipsis">{contact.displayName}</strong>{contact.originalName && contact.originalName !== contact.displayName && <small className="ellipsis">{contact.originalName}</small>}</span>
                {trailing?.(contact)}
                <RoundCheck checked={checked} />
              </button>
            })}
      </div>
    </AvatarScope>
  </div>
}
