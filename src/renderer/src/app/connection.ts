import { useEffect, useState } from 'react'
import type { ConnectionState } from '../../../shared/model'
import { useDesktop } from './store'

// Window::ConnectionState: Telegram shows «Connecting...» only once the state has lasted a moment
// (kConnectingStateDelay, 1 s), so a connection that comes straight back says nothing. Being connected, and an
// account that must sign in again, are shown at once.
const delay = 1000

// A15-5: what is shown is the message server's socket; the account works without it (sends and reads take the callables),
// as Telegram's title says «Connecting...» without stopping the window.
export function useShownConnection(): ConnectionState {
  const connection = useDesktop(snapshot => snapshot?.socket ?? 'offline')
  const [shown, setShown] = useState<ConnectionState>(connection)
  useEffect(() => {
    if (connection === 'ready' || connection === 'rejected') { setShown(connection); return }
    const timer = setTimeout(() => setShown(connection), delay)
    return () => clearTimeout(timer)
  }, [connection])
  return shown
}
