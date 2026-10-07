import type { AuthPhase } from '../../../shared/auth'

// B193: what the entry screen shows while no account is open. At start the saved accounts reconnect by themselves, and
// the screen says so — from the moment the app begins reading them (starting) until the first is in the window: through
// the read itself, each account's first «signed-out» before its restore begins, its restore and connection, and its
// «signed-in» before its session is open. Only then, with none of them coming, the sign-in form (with its QR). Until
// 0.241.14 only «restoring» and «connecting» held the screen, so the QR form showed in each gap — three or four flashes
// after the passcode. tdesktop shows the intro only once the account has no session (window_controller.cpp:170-216).
export interface EntryInput {
  starting: boolean
  hasActive: boolean
  adding: boolean
  busy: boolean
  manual: boolean
  saved: readonly { phase: AuthPhase }[]
}
export function reconnectingAtStart({ starting, hasActive, adding, busy, manual, saved }: EntryInput): boolean {
  if (hasActive || adding || busy || manual) return false
  return starting || saved.some(state => state.phase === 'restoring' || state.phase === 'connecting' || state.phase === 'signed-in')
}
