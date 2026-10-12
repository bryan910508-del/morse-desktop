import type { FileState } from '../../../shared/media'

// F2: what each file bubble on screen knows of its file, for the message menu — tdesktop shows «Show in Folder» only for
// a file that is here (history_view_context_menu.cpp, lng_context_show_in_folder).
const states = new Map<string, FileState['state']>()
export const fileKey = (chatId: string, messageId: string, index: number): string => `${chatId}\n${messageId}\n${index}`
export function setFileState(key: string, state: FileState['state'] | null): void { if (state) states.set(key, state); else states.delete(key) }
export function fileReady(chatId: string, messageId: string, index: number): boolean { return states.get(fileKey(chatId, messageId, index)) === 'ready' }
