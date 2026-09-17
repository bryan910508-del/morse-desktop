import type { DialogSummary } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'

// Models.ChatFolder stored at users/{uid}/folders/{id}.
export interface ChatFolder {
  id: string
  name: string
  emoji: string
  chatIds: string[]
  excludeChatIds: string[]
  pinnedChatIds: string[]
  excludeMuted: boolean
  excludeRead: boolean
  excludeArchived: boolean
  includeContacts: boolean
  includeNonContacts: boolean
  includeGroups: boolean
  includeChannels: boolean
  order: number
}
export const maxFolderChats = 1000
export const maxFolders = 200
const listKeys = ['chatIds', 'excludeChatIds', 'pinnedChatIds'] as const
const flagKeys = ['excludeMuted', 'excludeRead', 'excludeArchived', 'includeContacts', 'includeNonContacts', 'includeGroups', 'includeChannels'] as const
const folderKeys: readonly string[] = ['id', 'name', 'emoji', 'order', ...listKeys, ...flagKeys]

function folderChatIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > maxFolderChats) throw new Error(tr('폴더에 넣을 채팅을 확인해 주세요.'))
  return [...new Set(raw.map(identifier))]
}
export function chatFolderInput(raw: unknown): ChatFolder {
  const value = object(raw)
  if (Object.keys(value).some(key => !folderKeys.includes(key))) throw new Error(tr('폴더 정보를 확인해 주세요.'))
  const name = typeof value.name === 'string' ? value.name.trim() : '', emoji = typeof value.emoji === 'string' ? value.emoji : ''
  if (!name || name.length > 512 || emoji.length > 32 || !Number.isInteger(value.order) || (value.order as number) < 0 || (value.order as number) > 10000) throw new Error(tr('폴더 이름을 확인해 주세요.'))
  const folder = { id: identifier(value.id), name, emoji, order: value.order as number } as ChatFolder
  for (const key of listKeys) folder[key] = folderChatIds(value[key])
  for (const key of flagKeys) {
    if (typeof value[key] !== 'boolean') throw new Error(tr('폴더 설정을 확인해 주세요.'))
    folder[key] = value[key] as boolean
  }
  return folder
}
export function chatFolderOrder(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > maxFolders) throw new Error(tr('폴더 순서를 확인해 주세요.'))
  const ids = raw.map(identifier)
  if (new Set(ids).size !== ids.length) throw new Error(tr('폴더 순서를 확인해 주세요.'))
  return ids
}

const leadingEmoji = /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*)/u
// FolderEditView.parseEmojiAndName: "💼 직장" -> emoji 💼, name 직장; an emoji alone keeps it as the name.
export function splitFolderName(input: string): { emoji: string; name: string } {
  const trimmed = input.trim(), emoji = leadingEmoji.exec(trimmed)?.[0] ?? ''
  if (!emoji) return { emoji: '', name: trimmed }
  const rest = trimmed.slice(emoji.length).trim()
  return { emoji, name: rest || emoji }
}
// FolderEditView.init: emoji and name shown as one field.
export function folderEditName(folder: ChatFolder): string {
  const name = folder.name.trim()
  return !folder.emoji || name.startsWith(folder.emoji) ? name : `${folder.emoji} ${name}`
}
// ChatListView.displayFolderName: the name without a repeated leading emoji.
export function folderPlainName(folder: ChatFolder): string {
  const name = folder.name.trim()
  return folder.emoji && name.startsWith(folder.emoji) ? name.slice(folder.emoji.length).trim() : name
}
export function folderTitle(folder: ChatFolder): string { return [folder.emoji, folderPlainName(folder)].filter(Boolean).join(' ') || tr('폴더') }

// MorseChatListFolderPredicate.contains
export function folderContains(dialog: DialogSummary, folder: ChatFolder, context: { uid: string; contacts: ReadonlySet<string> }, unread: number): boolean {
  if (folder.chatIds.includes(dialog.id)) return true
  if (folder.excludeChatIds.includes(dialog.id)) return false
  if (folder.excludeMuted && dialog.muted) return false
  if (folder.excludeRead && unread <= 0) return false
  if (folder.excludeArchived && dialog.archived) return false
  if (dialog.discussion) return folder.includeChannels
  if (dialog.kind === 'group') return folder.includeGroups
  const partner = dialog.participantUids.find(uid => uid !== context.uid)
  return partner && context.contacts.has(partner) ? folder.includeContacts : folder.includeNonContacts
}
