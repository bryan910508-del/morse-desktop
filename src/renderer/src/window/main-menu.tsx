import { useState, type ReactNode } from 'react'
import { ChevronDown, Moon } from 'lucide-react'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { useShortcut } from '../app/shortcuts'
import { Avatar } from '../ui/avatar'
import { Switch } from '../ui/controls'
import { mainMenuItems } from './main-menu-items'
import { AccountsList } from './accounts-list'
import { tr } from '../../../shared/i18n'

export function MainMenuItem({ icon, label, onClick, separatorBefore }: { icon: ReactNode; label: string; onClick(): void; separatorBefore?: boolean }) {
  return <>
    {separatorBefore && <div className="main-menu-separator" role="separator" />}
    <button type="button" className="main-menu-item" onClick={() => { controller.setMainMenu(false); onClick() }}>{icon}<span>{label}</span></button>
  </>
}

// Window::MainMenu: cover with the account and night mode, then actions.
export function MainMenu({ accountUid }: { accountUid: string }) {
  const profile = useDesktop(snapshot => snapshot?.selfProfile ?? null)
  const account = useDesktop(snapshot => snapshot?.accounts.find(item => item.uid === snapshot.activeAccountUid) ?? null)
  const theme = useDesktop(snapshot => snapshot?.preferences.theme ?? 'system')
  const systemDark = useDesktop(snapshot => snapshot?.systemDark ?? true)
  const appVersion = useDesktop(snapshot => snapshot?.appVersion ?? '')
  // MainMenu::toggleAccounts: the account list opens from the cover and starts closed.
  const [accounts, setAccounts] = useState(false)
  useShortcut(150, command => { if (command === 'back') { controller.setMainMenu(false); return true } return false })
  const dark = theme === 'dark' || theme === 'black' || (theme === 'system' && systemDark)
  const name = profile?.profile?.displayName || account?.displayName || 'Morse'
  const userId = profile?.profile?.userId || account?.userId || ''
  return <div className="main-menu-layer" onMouseDown={event => { if (event.target === event.currentTarget) controller.setMainMenu(false) }}>
    <nav className="main-menu" aria-label={tr('메인 메뉴')}>
      {/* tdesktop keeps the menu below the macOS title bar, so the window buttons never cover the photo. */}
      <header className="main-menu-cover">
        <button type="button" className="main-menu-userpic" aria-expanded={accounts} aria-label={tr('계정 목록')} onClick={() => setAccounts(value => !value)}>
          <Avatar name={name} url={profile?.photo.status === 'ready' ? profile.photo.url : null} size={48} />
        </button>
        <div className="main-menu-account"><strong className="ellipsis">{name}</strong>{userId && <span className="ellipsis">@{userId}</span>}</div>
        <button type="button" className={`main-menu-accounts-toggle${accounts ? ' open' : ''}`} aria-expanded={accounts} aria-label={tr('계정 목록')} title={tr('계정 목록')} onClick={() => setAccounts(value => !value)}><ChevronDown size={20} /></button>
      </header>
      {accounts && <AccountsList variant="menu" onDone={() => controller.setMainMenu(false)} />}
      <div className="main-menu-items">
        {mainMenuItems(accountUid).map(item => <MainMenuItem key={item.label} {...item} />)}
        <label className="main-menu-item main-menu-night-row"><Moon size={20} /><span>{tr('야간 모드')}</span><Switch checked={dark} label={tr('야간 모드')} onChange={value => { void window.morse.updatePreferences({ theme: value ? 'dark' : 'light' }).catch(() => controller.toast(tr('테마를 바꾸지 못했습니다.'), 'error')) }} /></label>
      </div>
      <footer className="main-menu-footer">Morse Desktop {appVersion}</footer>
    </nav>
  </div>
}
