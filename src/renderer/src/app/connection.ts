import { useEffect, useState } from 'react'
import type { LinkState } from '../../../shared/model'
import { tr } from '../../../shared/i18n'
import { useDesktop } from './store'

// Window::ConnectionState: Telegram shows «Connecting...» only once the state has lasted a moment
// (kConnectingStateDelay, 1 s), so a connection that comes straight back says nothing. Being connected is shown at once.
const delay = 1000

// B100: what is shown is the way updates arrive and the network (LinkState, main/accounts/link-state.ts), as Telegram's
// title says what its update connection does; the message server's socket alone is not shown — sends go without it.
export function useShownConnection(): LinkState {
  const link = useDesktop(snapshot => snapshot?.link ?? 'ready')
  const [shown, setShown] = useState<LinkState>(link)
  useEffect(() => {
    if (link === 'ready') { setShown(link); return }
    const timer = setTimeout(() => setShown(link), delay)
    return () => clearTimeout(timer)
  }, [link])
  return shown
}

// Telegram: Waiting for network… / Connecting… / Updating… (iOS ChatListController.swift:7200-7213).
export function linkLabel(link: LinkState): string {
  return link === 'waiting-network' ? tr('네트워크 대기 중') : link === 'connecting' ? tr('연결 중…') : link === 'updating' ? tr('업데이트 중…') : ''
}
