import { useSyncExternalStore } from 'react'
import type { BlockTarget, BlockedUser } from '../../../shared/account-tools'
import { trackWrite } from './drafts'

// users/{uid}/blocked as last read for the signed-in account.
let state: { accountUid: string; users: BlockedUser[] } | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export async function loadBlockedUsers(accountUid: string): Promise<BlockedUser[]> {
  const users = await window.morse.blockedUsers(accountUid)
  state = { accountUid, users }
  for (const listener of [...listeners]) listener()
  return users
}
export function useBlockedUsers(accountUid: string): BlockedUser[] | null {
  return useSyncExternalStore(subscribe, () => state?.accountUid === accountUid ? state.users : null)
}
export async function setBlocked(accountUid: string, target: BlockTarget, blocked: boolean): Promise<void> {
  await trackWrite(window.morse.setBlockedUser(accountUid, target, blocked))
  await loadBlockedUsers(accountUid).catch(() => [])
}
