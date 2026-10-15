import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { ContactSummary } from '../../../shared/contacts'
import type { DialogSummary } from '../../../shared/model'
import { maxStoryBarPeers, mergeStoryBar, type StoryBarEntry, type StoryBarResult } from '../../../shared/story-bar'
import { useDesktop } from '../app/store'
import { Avatar, AvatarScope, PeerAvatar } from '../ui/avatar'
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
  // B408 S2 (review 10-15, the three apps alike — iOS ChatListView.userStoryPartnerIds): the row is this account's
  // contacts and the other side of each 1:1 or secret chat; whose stories this account may see is the server's (main's
  // storyFeed). The chats first, as they are ordered, then the contacts.
  const partners = useMemo(() => {
    const byPeer = new Map<string, DialogSummary>()
    for (const dialog of dialogs ?? []) {
      if (dialog.kind !== 'direct' && dialog.kind !== 'secret') continue
      const peer = dialog.participantUids.find(uid => uid !== accountUid)
      if (peer && !byPeer.has(peer)) byPeer.set(peer, dialog)
    }
    return byPeer
  }, [dialogs, accountUid])
  const peers = useMemo(() => {
    const order: string[] = [...partners.keys()]
    for (const contact of contacts) if (!order.includes(contact.uid)) order.push(contact.uid)
    return order.slice(0, maxStoryBarPeers)
  }, [contacts, partners])
  const key = peers.join(',')
  const [entries, setEntries] = useState<StoryBarEntry[]>([])
  const [reload, setReload] = useState(0)
  // B277 ②: main listens to the row's people and says when it changes; asking only names them (and listens again to
  // a list the server refused, after a press or the connection back).
  useEffect(() => {
    let alive = true
    const apply = (result: StoryBarResult): void => { if (alive) setEntries(previous => mergeStoryBar(previous, result)) }
    const stop = window.morse.onEvent(event => { if (event.type === 'story-bar-changed' && event.accountUid === accountUid) apply(event.result) })
    void window.morse.storyBar(accountUid, peers, reload > 0).then(apply).catch(() => {})
    return () => { alive = false; stop() }
  }, [accountUid, key, reload])
  // The connection is back: a list the server refused while it was gone is listened to again.
  const connection = useDesktop(snapshot => snapshot?.connection ?? 'offline')
  const wasReady = useRef(connection === 'ready')
  useEffect(() => {
    if (connection === 'ready' && !wasReady.current) setReload(value => value + 1)
    wasReady.current = connection === 'ready'
  }, [connection])
  // B416 B: while the row is on screen in a visible window, main fetches its to-open stories ahead (story-preloader.ts;
  // tdesktop turns its preloading on while the chat list exists, dialogs_inner_widget.cpp:587).
  useEffect(() => {
    const say = (shown: boolean): void => { void window.morse.setStoryRowShown(accountUid, shown).catch(() => {}) }
    const visibility = (): void => say(!document.hidden)
    say(!document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => { document.removeEventListener('visibilitychange', visibility); say(false) }
  }, [accountUid])
  const byUid = useMemo(() => new Map(contacts.map(contact => [contact.uid, contact])), [contacts])
  const mine = entries.find(entry => entry.uid === accountUid) ?? null
  const rows = entries.filter(entry => entry.uid !== accountUid && (byUid.has(entry.uid) || partners.has(entry.uid)))
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
        // A contact by its contact entry; someone met only in a chat by that chat's name and picture.
        const contact = byUid.get(entry.uid), dialog = partners.get(entry.uid)
        const name = contact?.displayName ?? dialog?.title ?? ''
        return <button key={entry.uid} type="button" role="listitem" className={`story-peer${entry.unseen ? ' unseen' : ''}`}
          aria-label={tr('{0} 스토리{1}', [name, entry.unseen ? tr(', 새 스토리 있음') : ''])}
          onClick={() => showStoryViewer(accountUid, order, index, refresh)}>
          <span className="story-ring">{contact ? <ContactAvatar contact={contact} size={42} />
            : <PeerAvatar id={dialog!.id} name={name} image={dialog!.kind === 'secret' ? null : dialog!.avatar} size={42} surface="dialogs" />}</span>
          <span className="story-peer-name ellipsis">{name}</span>
        </button>
      })}
    </div>
  </AvatarScope>
}
