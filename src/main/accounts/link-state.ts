import type { LinkState, ReadStatus } from '../../shared/model'

// B100 (user rule «확인 후 권장대로»; Telegram's title says what its update connection does — tdesktop
// window/window_connecting_widget.cpp:307-345, Connecting / Waiting from the main DC's state, and iOS shows
// Waiting for network / Connecting / Updating, ChatListController.swift:7200-7213): Morse receives its updates through
// the chat list's Firestore listen, so that is what the list and the chat title speak of — no network, the listen
// dropped or stopped, or the first catch-up since the account opened. The message server's socket is not part of it:
// sends go by the callables without it (A15).
export function linkState(networkDown: boolean, status: ReadStatus, listCurrent: boolean, listEverCurrent: boolean): LinkState {
  if (networkDown) return 'waiting-network'
  if (status === 'ready' && listCurrent) return 'ready'
  return listEverCurrent ? 'connecting' : 'updating'
}

// A chat list stopped by an error listens again after 5 s, doubling to a minute (and at once when the network is back).
export function listRetryDelay(attempt: number): number { return Math.min(60000, 5000 * 2 ** Math.max(0, attempt)) }
