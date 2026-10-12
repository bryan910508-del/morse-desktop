import { useRef } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { controller, type PersonTarget } from '../app/ui'
import { tr } from '../../../shared/i18n'
import { SwipeBack, useSwipe } from '../history/use-swipe'
import { ContactProfile } from './info-panel'

// B266 — tdesktop Info::Memento(peer) for a user (info_memento.cpp:41-48): one panel for any person, contact or not, over
// whatever is open. Back returns to the panel it opened over (the comments, the chat's info…); close shuts it.
export function PersonPanel({ accountUid, person }: { accountUid: string; person: PersonTarget }) {
  const panel = useRef<HTMLElement>(null)
  // B58 (Telegram info_content_widget.cpp:596-614): fingers right over the panel go back a step.
  const swipe = useSwipe(panel, { enabled: () => true, resolve: direction => direction === 'right-to-left' ? 'back' : null, finish: () => controller.closePerson(true) })
  return <section ref={panel} className="side-panel" aria-label={tr('정보')}>
    <SwipeBack frames={swipe} />
    <header className="top-bar">
      {person.back && <button className="icon-button" aria-label={tr('뒤로')} onClick={() => controller.closePerson(true)}><ArrowLeft size={20} /></button>}
      <strong className="side-title">{tr('정보')}</strong>
      <button className="icon-button" aria-label={tr('정보 닫기')} onClick={() => controller.closePerson(false)}><X size={20} /></button>
    </header>
    <div className="side-panel-body">
      <ContactProfile key={person.uid} accountUid={accountUid} uid={person.uid} hint={person.hint} fromChat={false} />
    </div>
  </section>
}
