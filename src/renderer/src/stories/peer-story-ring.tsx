import { useEffect, useState, type ReactNode } from 'react'
import type { StoryBarEntry } from '../../../shared/story-bar'
import { useDesktop } from '../app/store'
import { showStoryViewer } from './story-viewer'
import { tr } from '../../../shared/i18n'

// B408 S2: one person's active stories, as the stories row counts them (main's feed and read marks), kept current as
// the row changes. tdesktop draws the same state on a peer's userpic anywhere it is shown (PeerData::hasActiveStories,
// hasUnreadStories; HistoryView::TopBarWidget paints the ring and a press opens the peer's stories).
export function usePeerStoryEntry(accountUid: string, peerUid: string | null): StoryBarEntry | null {
  const [entry, setEntry] = useState<StoryBarEntry | null>(null)
  const connection = useDesktop(snapshot => snapshot?.connection ?? 'offline')
  useEffect(() => {
    setEntry(null)
    if (!peerUid) return
    let alive = true
    const read = (): void => { void window.morse.peerStoryEntry(accountUid, peerUid).then(value => { if (alive) setEntry(value) }).catch(() => {}) }
    const stop = window.morse.onEvent(event => { if (event.type === 'story-bar-changed' && event.accountUid === accountUid) read() })
    read()
    return () => { alive = false; stop() }
  }, [accountUid, peerUid, connection === 'ready'])
  return entry
}

// The picture with its ring; a press opens their stories (and, when they end, the screen it was opened from again).
export function PeerStoryRing({ accountUid, peerUid, name, entry, children }: { accountUid: string; peerUid: string; name: string; entry: StoryBarEntry; children: ReactNode }) {
  return <button type="button" className={`peer-story-avatar${entry.unseen ? ' unseen' : ''}`}
    aria-label={tr('{0} 스토리{1}', [name, entry.unseen ? tr(', 새 스토리 있음') : ''])} onClick={() => showStoryViewer(accountUid, [peerUid], 0)}>
    <span className="peer-story-ring">{children}</span>
  </button>
}
