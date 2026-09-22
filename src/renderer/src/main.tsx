import { Component, useEffect, useLayoutEffect, type PropsWithChildren } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/window.css'
import './styles/dialogs.css'
import './styles/history.css'
import './styles/info.css'
import './styles/auth.css'
import { desktop, useDesktop } from './app/store'
import { installShortcuts } from './app/shortcuts'
import { openInquiries } from './channels/channel-ui'
import { flushDrafts } from './app/drafts'
import { controller } from './app/ui'
import { preventFileDropNavigation } from './app/drop'
import { MainWindow } from './window/main-window'
import { openLink } from './app/links'
import { language, tr } from '../../shared/i18n'

function takeOpenLink(): void {
  void window.morse.takeOpenLink().then(url => {
    const uid = desktop.value?.activeAccountUid
    if (url && uid) void openLink(uid, url)
  }).catch(() => {})
}

// A notification of another account opens its chat after the window switches to that account.
let pendingNotificationChat: { accountUid: string; chatId: string; at: number } | null = null

class ErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render() {
    return this.state.failed ? <div className="boot"><img src="/morse.png" alt="" /><h1>{tr('화면을 불러오지 못했습니다')}</h1><p>{tr('앱을 다시 열어 주세요.')}</p></div> : this.props.children
  }
}

function useAppearance(): void {
  const theme = useDesktop(snapshot => snapshot?.preferences.theme ?? 'system')
  const systemDark = useDesktop(snapshot => snapshot?.systemDark ?? true)
  const fontSize = useDesktop(snapshot => snapshot?.preferences.messageFontSize ?? 14)
  const platform = useDesktop(snapshot => snapshot?.platform ?? 'unsupported')
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme === 'black' ? 'black' : theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light'
    root.dataset.platform = platform
    root.style.setProperty('--message-font-size', `${fontSize}px`)
  }, [theme, systemDark, fontSize, platform])
}

function App() {
  const ready = useDesktop(snapshot => snapshot !== null)
  const failure = useDesktop(() => desktop.failure)
  const platform = useDesktop(snapshot => snapshot?.platform ?? 'unsupported')
  const account = useDesktop(snapshot => snapshot?.activeAccountUid ?? null)
  useAppearance()
  useEffect(() => installShortcuts(platform), [platform])
  useEffect(() => {
    controller.resetAccount()
    const pending = pendingNotificationChat
    if (pending && pending.accountUid === account) { pendingNotificationChat = null; if (Date.now() - pending.at < 15000) controller.openChat(pending.chatId) }
  }, [account])
  // A morse:// or talky:// link opens like the same link pressed in a message, once an account is open.
  useEffect(() => { if (ready && account) takeOpenLink() }, [ready, account])
  useEffect(() => desktop.on(event => {
    if (event.type === 'prepare-close') {
      void flushDrafts().then(() => true, () => false).then(ok => window.morse.completeClose(event.requestId, ok)).catch(() => {})
    } else if (event.type === 'error') controller.toast(event.message, 'error')
    else if (event.type === 'attachment-preparing' && event.active) controller.toast(tr('동영상을 압축하고 있어요…'))
    else if (event.type === 'open-link' && desktop.value?.activeAccountUid) takeOpenLink()
    else if (event.type === 'full-screen') document.documentElement.dataset.fullScreen = String(event.value)
    else if (event.type === 'open-notification-chat') {
      if (desktop.value?.activeAccountUid === event.accountUid) controller.openChat(event.chatId)
      else pendingNotificationChat = { accountUid: event.accountUid, chatId: event.chatId, at: Date.now() }
    }
    // A 1:1 inquiry room opens beside its channel, the way its row in the list opens it.
    else if (event.type === 'open-notification-inquiry') {
      if (desktop.value?.activeAccountUid === event.accountUid) { controller.openChannel(event.channelId); openInquiries(event.channelId, event.inquiryId) }
    }
  }), [])
  if (!ready) return <div className="boot"><img src="/morse.png" alt="" />{failure ? <p>{failure}</p> : <span className="spinner" style={{ width: 22, height: 22 }} />}</div>
  return <MainWindow />
}

preventFileDropNavigation()
desktop.start()
document.documentElement.lang = language()
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
