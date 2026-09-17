import { useSyncExternalStore } from 'react'
import type { ChatFolder } from '../../../shared/chat-folders'
import { trackWrite } from './drafts'
import { errorText } from './format'
import { controller } from './ui'
import { tr } from '../../../shared/i18n'

type WriteResult = 'done' | 'unconfirmed'
let state: { accountUid: string; folders: ChatFolder[] } | null = null
let chain: Promise<unknown> = Promise.resolve(), waiting = 0
const listeners = new Set<() => void>()
const noFolders: ChatFolder[] = []

function publish(accountUid: string, folders: ChatFolder[]): void {
  state = { accountUid, folders: [...folders].sort((a, b) => a.order - b.order) }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
function current(accountUid: string): ChatFolder[] { return state?.accountUid === accountUid ? state.folders : noFolders }
export function useChatFolders(accountUid: string): ChatFolder[] {
  return useSyncExternalStore(subscribe, () => current(accountUid))
}

// users/{uid}/folders as last read. A read that lands while local changes are still saving is ignored.
export async function loadChatFolders(accountUid: string): Promise<ChatFolder[]> {
  const folders = await window.morse.chatFolders(accountUid)
  if (!waiting) publish(accountUid, folders)
  return current(accountUid)
}

// The folders as the server has them now, followed live. While a change made here is still being
// saved, the list keeps showing that change; the read after the saves settles it.
export function receiveChatFolders(accountUid: string, folders: ChatFolder[]): void {
  if (!waiting) publish(accountUid, folders)
}

// The change shows at once; saves run one after another, then the server list replaces the local one.
function write(accountUid: string, next: ChatFolder[], work: () => Promise<WriteResult>, failure: string): Promise<boolean> {
  publish(accountUid, next)
  waiting++
  const job = chain.then(() => trackWrite(work())).then(result => {
    if (result === 'unconfirmed') controller.toast(tr('폴더 저장 결과를 확인하지 못했습니다. 폴더 목록을 다시 확인해 주세요.'), 'error')
    return result === 'done'
  }, reason => { controller.toast(errorText(reason, failure), 'error'); return false })
  chain = job.finally(async () => { if (--waiting === 0) await loadChatFolders(accountUid).catch(() => {}) })
  return job
}
export function saveChatFolder(accountUid: string, folder: ChatFolder, create: boolean): Promise<boolean> {
  const list = current(accountUid)
  return write(accountUid, create ? [...list, folder] : list.map(item => item.id === folder.id ? folder : item),
    () => window.morse.saveChatFolder(accountUid, folder, create), tr('폴더를 저장하지 못했습니다.'))
}
export function deleteChatFolder(accountUid: string, folderId: string): Promise<boolean> {
  return write(accountUid, current(accountUid).filter(item => item.id !== folderId), () => window.morse.deleteChatFolder(accountUid, folderId), tr('폴더를 삭제하지 못했습니다.'))
}
export function reorderChatFolders(accountUid: string, folderIds: string[]): Promise<boolean> {
  const byId = new Map(current(accountUid).map(item => [item.id, item]))
  const next = folderIds.flatMap((id, order) => { const item = byId.get(id); return item ? [{ ...item, order }] : [] })
  return write(accountUid, next, () => window.morse.reorderChatFolders(accountUid, folderIds), tr('폴더 순서를 저장하지 못했습니다.'))
}
// AppState.toggleChatInFolder
export function toggleChatInFolder(accountUid: string, folder: ChatFolder, chatId: string): Promise<boolean> {
  const chatIds = folder.chatIds.includes(chatId) ? folder.chatIds.filter(id => id !== chatId) : [...folder.chatIds, chatId]
  return saveChatFolder(accountUid, { ...folder, chatIds }, false)
}
// AppState.toggleChatPinnedInFolder: a newly pinned chat goes first.
export function toggleChatPinnedInFolder(accountUid: string, folder: ChatFolder, chatId: string): Promise<boolean> {
  const pinnedChatIds = folder.pinnedChatIds.includes(chatId) ? folder.pinnedChatIds.filter(id => id !== chatId) : [chatId, ...folder.pinnedChatIds]
  return saveChatFolder(accountUid, { ...folder, pinnedChatIds }, false)
}
