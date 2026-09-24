import { useSyncExternalStore } from 'react'
import { controller } from './ui'
import { errorText } from './format'
import { tr } from '../../../shared/i18n'

// The account's default for new chats — users/{uid}/private/chatSettings, so every device signed into that account
// sees the same value (iOS MorseAccountAutoDeleteDefault; Telegram keeps its own with
// messages.get/setDefaultHistoryTTL). One value at a time, loaded on demand and dropped when the account changes.
let state: { accountUid: string; seconds: number } | null = null
let loading: { accountUid: string; task: Promise<void> } | null = null
const listeners = new Set<() => void>()
const emit = (): void => { for (const listener of [...listeners]) listener() }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function loadAutoDeleteDefault(accountUid: string, force = false): Promise<void> {
  if (!force && state?.accountUid === accountUid) return Promise.resolve()
  if (loading?.accountUid === accountUid) return loading.task
  const task = window.morse.accountAutoDeleteDefault(accountUid).then(seconds => { state = { accountUid, seconds }; emit() })
    .finally(() => { if (loading?.task === task) loading = null })
  loading = { accountUid, task }
  return task
}

export function useAutoDeleteDefault(accountUid: string): number | null {
  const value = useSyncExternalStore(subscribe, () => state)
  return value?.accountUid === accountUid ? value.seconds : null
}

// Optimistic, as the iOS row is: the choice shows at once and is put back if the write fails.
export async function setAutoDeleteDefault(accountUid: string, seconds: number): Promise<void> {
  const before = state?.accountUid === accountUid ? state.seconds : null
  state = { accountUid, seconds }; emit()
  try { await window.morse.setAccountAutoDeleteDefault(accountUid, seconds) }
  catch (reason) {
    if (before !== null) { state = { accountUid, seconds: before }; emit() }
    controller.toast(errorText(reason, tr('자동 삭제 설정을 저장하지 못했습니다.')), 'error')
  }
}
