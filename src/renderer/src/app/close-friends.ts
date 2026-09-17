import { useSyncExternalStore } from 'react'
import { controller } from './ui'
import { errorText } from './format'
import { tr } from '../../../shared/i18n'

let state: { accountUid: string; members: Set<string> } | null = null
let loading: { accountUid: string; task: Promise<void> } | null = null
const listeners = new Set<() => void>()
const emit = (): void => { for (const listener of [...listeners]) listener() }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function loadCloseFriends(accountUid: string, force = false): Promise<void> {
  if (!force && state?.accountUid === accountUid) return Promise.resolve()
  if (loading?.accountUid === accountUid) return loading.task
  const task = window.morse.closeFriendList(accountUid).then(list => { state = { accountUid, members: new Set(list) }; emit() })
    .finally(() => { if (loading?.task === task) loading = null })
  loading = { accountUid, task }
  return task
}

export function useCloseFriends(accountUid: string): Set<string> | null {
  const value = useSyncExternalStore(subscribe, () => state)
  return value?.accountUid === accountUid ? value.members : null
}

// Optimistic membership toggle; the single write is reverted on failure.
export async function setCloseFriend(accountUid: string, uid: string, add: boolean): Promise<void> {
  const before = state?.accountUid === accountUid ? state.members : null
  if (before) {
    const next = new Set(before)
    if (add) next.add(uid); else next.delete(uid)
    state = { accountUid, members: next }; emit()
  }
  try { await window.morse.setCloseFriend(accountUid, uid, add) }
  catch (reason) {
    if (state?.accountUid === accountUid) {
      const reverted = new Set(state.members)
      if (add) reverted.delete(uid); else reverted.add(uid)
      state = { accountUid, members: reverted }; emit()
    }
    controller.toast(errorText(reason, tr('친한 친구를 변경하지 못했습니다.')), 'error')
  }
}
