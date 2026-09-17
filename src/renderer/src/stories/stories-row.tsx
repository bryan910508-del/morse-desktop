import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { ContactSummary } from '../../../shared/contacts'
import { maxStoryBarPeers, type StoryBarEntry } from '../../../shared/story-bar'
import { useDesktop } from '../app/store'
import { Avatar, AvatarScope } from '../ui/avatar'
import { ContactAvatar } from '../boxes/peer-picker'
import { showOwnStoryViewer } from './own-story-viewer'
import { showStoryComposer } from './story-composer'
import { showStoryViewer } from './story-viewer'
import '../styles/stories.css'
import { tr } from '../../../shared/i18n'

const noContacts: ContactSummary[] = []

// Dialogs::Stories: add story, my stories, then contacts with active stories (unseen first).
export function StoriesRow({ accountUid }: { accountUid: string }) {
  const contacts = useDesktop(state => state?.contacts?.status === 'ready' ? state.contacts.items : noContacts)
  const dialogs = useDesktop(state => state?.dialogs)
  const self = useDesktop(state => state?.selfProfile ?? null)
  const peers = useMemo(() => {
    const known = new Set(contacts.map(contact => contact.uid)), order: string[] = []
    for (const dialog of dialogs ?? []) {
      if (dialog.kind !== 'direct') continue
      const peer = dialog.participantUids.find(uid => uid !== accountUid)
      if (peer && known.has(peer) && !order.includes(peer)) order.push(peer)
    }
    for (const contact of contacts) if (!order.includes(contact.uid)) order.push(contact.uid)
    return order.slice(0, maxStoryBarPeers)
  }, [contacts, dialogs, accountUid])
  const key = peers.join(',')
  const [entries, setEntries] = useState<StoryBarEntry[]>([])
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    const load = (force: boolean): void => {
      if (document.hidden) return
      void window.morse.storyBar(accountUid, peers, force).then(result => { if (alive) setEntries(result.entries) }).catch(() => {})
    }
    load(reload > 0)
    const timer = setInterval(() => load(false), 60000)
    const visibility = (): void => { if (!document.hidden) load(false) }
    document.addEventListener('visibilitychange', visibility)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [accountUid, key, reload])
  const byUid = useMemo(() => new Map(contacts.map(contact => [contact.uid, contact])), [contacts])
  const mine = entries.find(entry => entry.uid === accountUid) ?? null
  const rows = entries.filter(entry => entry.uid !== accountUid && byUid.has(entry.uid))
    .sort((a, b) => Number(b.unseen > 0) - Number(a.unseen > 0) || b.latestAt - a.latestAt)
  if (!rows.length && !mine) return null
  const order = rows.map(entry => entry.uid)
  const refresh = (): void => setReload(value => value + 1)
  return <AvatarScope accountUid={accountUid} enabled surface="contacts">
    <div className="stories-row" role="list" aria-label={tr('스토리')}>
      <button type="button" role="listitem" className="story-peer add" aria-label={tr('스토리 올리기')} onClick={() => showStoryComposer(accountUid, refresh)}>
        <span className="story-ring"><span className="story-add-icon"><Plus size={22} /></span></span>
        <span className="story-peer-name ellipsis">{tr('스토리 추가')}</span>
      </button>
      {mine && <button type="button" role="listitem" className="story-peer own" aria-label={tr('내 스토리')} onClick={() => showOwnStoryViewer(accountUid, refresh)}>
        <span className="story-ring"><Avatar name={self?.profile?.displayName || tr('나')} url={self?.photo.status === 'ready' ? self.photo.url : null} size={42} /></span>
        <span className="story-peer-name ellipsis">{tr('내 스토리')}</span>
      </button>}
      {rows.map((entry, index) => {
        const contact = byUid.get(entry.uid)!
        return <button key={entry.uid} type="button" role="listitem" className={`story-peer${entry.unseen ? ' unseen' : ''}`}
          aria-label={tr('{0} 스토리{1}', [contact.displayName, entry.unseen ? tr(', 새 스토리 있음') : ''])}
          onClick={() => showStoryViewer(accountUid, order, index, refresh)}>
          <span className="story-ring"><ContactAvatar contact={contact} size={42} /></span>
          <span className="story-peer-name ellipsis">{contact.displayName}</span>
        </button>
      })}
    </div>
  </AvatarScope>
}
