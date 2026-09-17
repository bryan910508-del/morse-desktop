import { Check, Plus } from 'lucide-react'
import type { AccountAuthState } from '../../../shared/auth'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Avatar } from '../ui/avatar'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

const noStates: AccountAuthState[] = []

// boxes/premium_limits_box AccountsLimitBox with Morse's limits (iOS settings.accountLimit).
function AccountsLimitBox({ max, close }: { max: number; close(): void }) {
  return <Box title={tr('계정 한도에 도달했어요')} width={360} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('확인')}</button>}>
    {max < 4 && <p className="box-text">{tr('프리미엄에서 계정 4개까지 사용할 수 있어요')}</p>}
  </Box>
}
export function showAccountsLimit(max: number): void { controller.showLayer(close => <AccountsLimitBox max={max} close={close} />) }

// Window::MainMenu accounts and Settings::Information AccountsList: every account on this
// device with its unread count; choosing one shows it, then "계정 추가".
export function AccountsList({ variant, onDone }: { variant: 'menu' | 'settings'; onDone?(): void }) {
  const states = useDesktop(snapshot => snapshot?.accountStates ?? noStates)
  const max = useDesktop(snapshot => snapshot?.maxAccounts ?? 2)
  async function run(action: () => Promise<void>, fallback: string): Promise<void> {
    onDone?.()
    try { await action() } catch (reason) { controller.toast(errorText(reason, fallback), 'error') }
  }
  function choose(state: AccountAuthState): void {
    if (state.active) { onDone?.(); return }
    if (!state.connected) void run(() => window.morse.authentication.restoreSignIn(state.uid), tr('계정을 다시 연결하지 못했습니다.'))
    else void run(() => window.morse.authentication.switchAccount(state.uid), tr('계정을 전환하지 못했습니다.'))
  }
  function add(): void {
    if (states.length >= max) { onDone?.(); showAccountsLimit(max); return }
    void run(() => window.morse.authentication.addAccount(), tr('계정 추가를 시작하지 못했습니다.'))
  }
  return <div className={`accounts-list ${variant}`}>
    {states.map(state => <button key={state.uid} type="button" className={`accounts-row${state.active ? ' active' : ''}`} onClick={() => choose(state)}>
      <Avatar name={state.displayName || state.userId || '?'} url={state.photo} size={variant === 'menu' ? 36 : 42} />
      <span className="accounts-row-text">
        <strong className="ellipsis">{state.displayName || tr('이름 없음')}</strong>
        <small className={`ellipsis${!state.connected && state.phase === 'error' ? ' error' : ''}`}>{state.connected ? (state.userId ? `@${state.userId}` : '') : state.phase === 'restoring' || state.phase === 'connecting' ? tr('연결하는 중…') : state.message || tr('연결되지 않음')}</small>
      </span>
      {state.active ? <Check size={18} className="accounts-row-check" aria-label={tr('현재 계정')} />
        : state.unread > 0 ? <span className="accounts-row-badge" aria-label={tr('읽지 않은 메시지 {0}개', [state.unread])}>{state.unread > 999 ? '999+' : state.unread}</span> : null}
    </button>)}
    <button type="button" className="accounts-row add" onClick={add}>
      <span className="accounts-row-add"><Plus size={20} /></span>
      <span className="accounts-row-text"><strong>{tr('계정 추가')}</strong></span>
    </button>
  </div>
}
