import { reconnectingAtStart } from '../auth/entry-screen'
import type { AccountAuthState, AuthenticationSnapshot } from '../../../shared/auth'

// F-ST-004 §7-1 2 (R12), 0.241.53 pre-release line 3: the «Morse ended unexpectedly» notice offers «문제 보고» when an
// account is open. It used to be decided at the window's first state, before the saved accounts were restored, so a
// signed-in person got «기록 폴더 열기» (reports/desktop/2026-11-06-0.241.53-prerelease.md §3). It now waits until the
// account state is known — an account is open, or none is still coming back (the entry screen's own rule,
// entry-screen.ts reconnectingAtStart) — or at most `crashNoticeWait`, so the notice is never lost. tdesktop asks at the
// next launch too (core/crash_report_window.cpp); here the report needs the account's support chat.
export const crashNoticeWait = 10000
export type CrashNoticeAction = 'report' | 'logs'

export interface AccountState { activeAccountUid: string | null; authentication?: Pick<AuthenticationSnapshot, 'starting'> | null; accountStates?: readonly Pick<AccountAuthState, 'phase'>[] }
export function accountSettled(state: AccountState | null): boolean {
  if (!state) return false
  if (state.activeAccountUid) return true
  return !reconnectingAtStart({ starting: state.authentication?.starting === true, hasActive: false, adding: false, busy: false, manual: false, saved: state.accountStates ?? [] })
}

// Asks main once (its answer is true only once), at the moment the notice can be shown; the action follows the account
// open then.
export class CrashNotice {
  private asked = false
  constructor(private readonly take: () => Promise<boolean>, private readonly activeUid: () => string | null, private readonly show: (action: CrashNoticeAction) => void) {}
  update(state: { ready: boolean; settled: boolean; expired: boolean }): void {
    if (this.asked || !state.ready || (!state.settled && !state.expired)) return
    this.asked = true
    void this.take().then(crashed => { if (crashed) this.show(this.activeUid() ? 'report' : 'logs') }, () => {})
  }
}
