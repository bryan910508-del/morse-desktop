import type { ContactProfileSnapshot } from '../../../shared/contacts'
import { desktop } from './store'
import { controller } from './ui'
import { errorText } from './format'
import { trackWrite } from './drafts'
import { tr } from '../../../shared/i18n'

// Resolves once a selector over the renderer mirror yields a value.
export function waitFor<T>(select: () => T | null | undefined, timeout = 10000, message = tr('정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (): void => { done = true; unsubscribe(); clearTimeout(timer) }
    const check = (): void => {
      if (done) return
      const value = select()
      if (value !== null && value !== undefined) { finish(); resolve(value) }
    }
    const unsubscribe = desktop.subscribe(check)
    const timer = setTimeout(() => { if (!done) { finish(); reject(new Error(message)) } }, timeout)
    check()
  })
}

// Main keeps a single selected contact profile. A short action that borrows the
// selection notifies open profile views so they can select their peer again.
const released = new Set<() => void>()
export function onContactProfileReleased(listener: () => void): () => void {
  released.add(listener)
  return () => { released.delete(listener) }
}

export async function withContactProfile<T>(accountUid: string, uid: string, work: (requestId: string, profile: ContactProfileSnapshot) => Promise<T>): Promise<T> {
  const requestId = crypto.randomUUID()
  try {
    await window.morse.openContactProfile(accountUid, uid, requestId)
    const profile = await waitFor(() => {
      const current = desktop.value?.contacts?.profile
      return current?.requestId === requestId && current.status !== 'loading' ? current : null
    }, 10000, tr('연락처 프로필을 불러오지 못했습니다.'))
    if (profile.status !== 'ready') throw new Error(profile.message || tr('연락처 프로필을 확인할 수 없습니다.'))
    return await work(requestId, profile)
  } finally { await releaseContactProfile(accountUid, requestId) }
}

export async function releaseContactProfile(accountUid: string, requestId: string): Promise<void> {
  await window.morse.closeContactProfile(accountUid, requestId).catch(() => {})
  for (const listener of [...released]) listener()
}

export async function openContactChat(accountUid: string, uid: string): Promise<void> {
  try { controller.openChat(await withContactProfile(accountUid, uid, requestId => window.morse.startContactChat(accountUid, requestId))) }
  catch (reason) { controller.toast(errorText(reason, tr('대화를 열지 못했습니다.')), 'error') }
}

// Contacts::deleteContact with the main process' 5 second grace: the request is only
// sent when the undo toast expires, and the selected profile must stay open until then.
export async function deleteContact(accountUid: string, requestId: string, version: string, name: string): Promise<void> {
  const operationId = crypto.randomUUID()
  controller.toast(tr('{0}님을 연락처에서 삭제합니다.', [name]), 'default', { label: tr('되돌리기'), run: () => {
    void window.morse.undoContactDelete(accountUid, operationId)
      .then(cancelled => controller.toast(cancelled ? tr('연락처 삭제를 되돌렸습니다.') : tr('되돌리기 시간이 지났습니다.')))
      .catch(() => controller.toast(tr('되돌리기 결과를 확인하지 못했습니다. 연락처 목록을 확인해 주세요.'), 'error'))
  } })
  try {
    await trackWrite(window.morse.deleteContact(accountUid, requestId, operationId, version))
    const result = await waitFor(() => {
      const mutation = desktop.value?.contacts?.mutation
      return mutation?.requestId === requestId && mutation.kind === 'delete' && !mutation.busy ? mutation : null
    }, 5000).catch(() => null)
    if (result?.outcome === 'rejected' || result?.outcome === 'uncertain') controller.toast(result.message, 'error')
  } catch (reason) { controller.toast(errorText(reason, tr('연락처를 삭제하지 못했습니다.')), 'error') }
}

export async function deleteContactByUid(accountUid: string, uid: string, name: string): Promise<void> {
  try { await withContactProfile(accountUid, uid, (requestId, profile) => deleteContact(accountUid, requestId, profile.contactVersion, name)) }
  catch (reason) { controller.toast(errorText(reason, tr('연락처를 삭제하지 못했습니다.')), 'error') }
}
