import { useEffect, useState } from 'react'
import { Copy, Link, UserPlus } from 'lucide-react'
import type { InviteCreator, InviteLink } from '../../../shared/account-tools'
import { controller } from '../app/ui'
import { errorText, fullTime } from '../app/format'
import { copyText } from '../app/clipboard'
import { Spinner } from '../ui/controls'
import { Box } from '../ui/layers'
import { showAddContactBox } from './contacts-box'
import { UserAvatar } from '../ui/user-avatar'
import { tr } from '../../../shared/i18n'

// InviteLinkView / InviteAcceptView: make a one-time link, or open a received link and add its maker.
function InviteBox({ accountUid, initialLink, close }: { accountUid: string; initialLink?: string; close(): void }) {
  const [link, setLink] = useState<InviteLink | null>(null), [creating, setCreating] = useState(false)
  const [input, setInput] = useState(initialLink ?? ''), [opening, setOpening] = useState(false)
  const [creator, setCreator] = useState<InviteCreator | null>(null), [error, setError] = useState('')
  async function create(): Promise<void> {
    if (creating) return
    setCreating(true); setError('')
    try { setLink(await window.morse.createInviteLink(accountUid)) }
    catch (reason) { setError(errorText(reason, tr('초대 링크를 만들지 못했습니다.'))) }
    finally { setCreating(false) }
  }
  async function open(): Promise<void> {
    if (opening || !input.trim()) return
    setOpening(true); setError(''); setCreator(null)
    try { setCreator(await window.morse.useInviteLink(accountUid, input)) }
    catch (reason) { setError(errorText(reason, tr('초대 링크를 열지 못했습니다.'))) }
    finally { setOpening(false) }
  }
  // An invite address pressed in a message is opened at once (iOS router.acceptInvite).
  useEffect(() => { if (initialLink) void open() }, [])
  return <Box title={tr('친구 초대')} width={420} onClose={close} className="invite-box">
    <div className="section-label">{tr('내 초대 링크')}</div>
    {link ? <div className="invite-link-card">
      <span className="selectable ellipsis">{link.url}</span>
      <button className="button secondary" onClick={() => controller.toast(copyText(link.url) ? tr('초대 링크를 복사했습니다.') : tr('초대 링크를 복사하지 못했습니다.'), 'default')}><Copy size={16} />{tr('복사')}</button>
    </div> : <button className="button secondary block" disabled={creating} onClick={() => { void create() }}>{creating ? <Spinner size={14} /> : <Link size={16} />}{tr('초대 링크 만들기')}</button>}
    {link && <p className="box-note">{tr('한 번 사용할 수 있고 {0}까지 유효해요.', [fullTime(link.expiresAt)])}</p>}
    <div className="section-label">{tr('받은 초대 링크 열기')}</div>
    <form className="invite-open" onSubmit={event => { event.preventDefault(); void open() }}>
      <input className="invite-input" value={input} maxLength={2048} placeholder={tr('초대 링크 붙여넣기')} onChange={event => setInput(event.target.value)} />
      <button className="button secondary" type="submit" disabled={opening || !input.trim()}>{opening ? <Spinner size={14} /> : tr('열기')}</button>
    </form>
    {creator && <div className="invite-creator">
      <UserAvatar uid={creator.uid} name={creator.displayName || creator.userId} size={56} />
      <strong className="selectable">{creator.displayName || tr('이름 없음')}</strong>
      {creator.userId && <span>@{creator.userId}</span>}
      {creator.bio && <p className="selectable">{creator.bio}</p>}
      {creator.userId && <button className="button primary" onClick={() => { close(); showAddContactBox(accountUid, creator.userId) }}><UserPlus size={16} />{tr('연락처에 추가')}</button>}
    </div>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showInviteBox(accountUid: string, initialLink?: string): void {
  controller.showLayer(close => <InviteBox accountUid={accountUid} initialLink={initialLink} close={close} />)
}
