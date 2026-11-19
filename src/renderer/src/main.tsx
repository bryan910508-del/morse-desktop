import { Component, useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react'
import { accountShown, notificationArrived, type NotificationTarget, type PendingNotification } from './app/notification-open'
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
import { flushDrafts } from './app/drafts'
import { controller } from './app/ui'
import { preventFileDropNavigation } from './app/drop'
import { MainWindow } from './window/main-window'
import { openLink } from './app/links'
import { language, tr } from '../../shared/i18n'
import { useChannelOperationNotices } from './channels/channel-operations'
import { installTapRecorder } from './app/tap-recorder'
import { drawAppBadge } from './app/app-badge-image'
import { showProblemReportBox } from './settings/problem-report-box'
import { accountSettled, CrashNotice, crashNoticeWait } from './app/crash-notice'

function takeOpenLink(): void {
  void window.morse.takeOpenLink().then(url => {
    const uid = desktop.value?.activeAccountUid
    if (url && uid) void openLink(uid, url)
  }).catch(() => {})
}

// A notification of another account opens its chat or inquiry room after the window switches to that account.
let pendingNotification: PendingNotification | null = null
function openNotificationTarget(target: NotificationTarget | null): void {
  if (target?.kind === 'chat') { if (target.messageId) controller.openChatAt(target.chatId, target.messageId); else controller.openChat(target.chatId) }
  else if (target?.kind === 'inquiry') controller.openInquiryRoom(target.channelId, target.inquiryId)
  else if (target?.kind === 'channel') controller.openChannel(target.channelId)
}

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
  // A change to a channel post or comment the server refused is told once, wherever the person is.
  useChannelOperationNotices(account)
  useEffect(() => installShortcuts(platform), [platform])
  useEffect(() => {
    controller.resetAccount()
    const next = accountShown(pendingNotification, account, Date.now())
    pendingNotification = next.pending; openNotificationTarget(next.open)
  }, [account])
  // A morse:// or talky:// link opens like the same link pressed in a message, once an account is open.
  useEffect(() => { if (ready && account) takeOpenLink() }, [ready, account])
  // 0.241.36: the last run ended without quitting — said once, with the logs folder for an inquiry (tdesktop asks at
  // the next launch too, core/crash_report_window.cpp; nothing is sent from here).
  // F-ST-004 B (contract §7-1 2): the notice offers «문제 보고» (R12); the box opens only when pressed. Signed out,
  // there is no support chat to send to, so the logs folder stays the action. Shown once the account state is known,
  // or after crashNoticeWait at most (crash-notice.ts).
  const settled = useDesktop(snapshot => accountSettled(snapshot))
  const [expired, setExpired] = useState(false)
  useEffect(() => { if (!ready) return; const timer = setTimeout(() => setExpired(true), crashNoticeWait); return () => clearTimeout(timer) }, [ready])
  const crashNotice = useRef<CrashNotice | null>(null)
  crashNotice.current ??= new CrashNotice(() => window.morse.takeCrashNotice(), () => desktop.value?.activeAccountUid ?? null, action => {
    controller.toast(tr('지난번에 Morse가 예기치 않게 종료됐어요.'), 'default', action === 'report'
      ? { label: tr('문제 보고'), run: () => { const now = desktop.value?.activeAccountUid; if (now) showProblemReportBox(now) } }
      : { label: tr('기록 폴더 열기'), run: () => { void window.morse.openLogsFolder().catch(() => {}) } })
  })
  useEffect(() => { crashNotice.current?.update({ ready, settled, expired }) }, [ready, settled, expired])
  useEffect(() => desktop.on(event => {
    if (event.type === 'prepare-close') {
      void flushDrafts().then(() => true, () => false).then(ok => window.morse.completeClose(event.requestId, ok)).catch(() => {})
    } else if (event.type === 'error') controller.toast(event.message, 'error')
    else if (event.type === 'attachment-preparing' && event.active) controller.toast(tr('동영상을 압축하고 있어요…'))
    else if (event.type === 'open-link' && desktop.value?.activeAccountUid) takeOpenLink()
    else if (event.type === 'full-screen') document.documentElement.dataset.fullScreen = String(event.value)
    // B348: the Windows taskbar overlay is drawn here and handed back to the main process.
    // B348: a picture that could not be drawn is told by its error's name (badge-check.log), not dropped here.
    else if (event.type === 'draw-app-badge') void drawAppBadge(event.count, event.muted, event.pixels, event.target).then(url => window.morse.appBadgeDrawn(event.key, url),
      reason => window.morse.appBadgeFailed(event.key, reason instanceof Error ? reason.name : typeof reason)).catch(() => {})
    else if (event.type === 'open-notification-chat' || event.type === 'open-notification-inquiry' || event.type === 'open-notification-channel') {
      // A 1:1 inquiry room opens the way its row in the list opens it; an approved join request opens its channel (B515).
      const target: NotificationTarget = event.type === 'open-notification-chat' ? { kind: 'chat', chatId: event.chatId, ...event.messageId ? { messageId: event.messageId } : {} }
        : event.type === 'open-notification-channel' ? { kind: 'channel', channelId: event.channelId } : { kind: 'inquiry', channelId: event.channelId, inquiryId: event.inquiryId }
      const next = notificationArrived(desktop.value?.activeAccountUid ?? null, event.accountUid, target, Date.now())
      if (next.pending) pendingNotification = next.pending
      openNotificationTarget(next.open)
    }
  }), [])
  if (!ready) return <div className="boot"><img src="/morse.png" alt="" />{failure ? <p>{failure}</p> : <span className="spinner" style={{ width: 22, height: 22 }} />}</div>
  return <MainWindow />
}

preventFileDropNavigation()
installTapRecorder(lost => { void window.morse.recordLostTap(lost).catch(() => {}) })
desktop.start()
document.documentElement.lang = language()
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
