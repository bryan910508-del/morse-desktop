import { tr } from './i18n'
export type ShortcutPlatform = 'macOS' | 'Windows' | 'unsupported'
interface Binding { key: string; code?: string; primary?: boolean; shift?: boolean }
interface Definition { label: string; group: '탐색' | '대화' | '화면'; binding: Binding }
export const shortcuts = {
  'find-dialog': { label: tr('대화 찾기'), group: '탐색', binding: { key: 'K', code: 'KeyK', primary: true } },
  'find-message': { label: tr('대화 안 검색'), group: '대화', binding: { key: 'F', code: 'KeyF', primary: true } },
  'previous-dialog': { label: tr('이전 대화'), group: '대화', binding: { key: 'PageUp', primary: true } },
  'next-dialog': { label: tr('다음 대화'), group: '대화', binding: { key: 'PageDown', primary: true } },
  'focus-composer': { label: tr('메시지 작성창으로'), group: '대화', binding: { key: 'M', code: 'KeyM', primary: true, shift: true } },
  'show-chats': { label: tr('대화 화면'), group: '화면', binding: { key: '1', code: 'Digit1', primary: true } },
  'show-contacts': { label: tr('연락처 화면'), group: '화면', binding: { key: '2', code: 'Digit2', primary: true } },
  'show-channels': { label: tr('채널 화면'), group: '화면', binding: { key: '3', code: 'Digit3', primary: true } },
  'show-settings': { label: tr('설정'), group: '화면', binding: { key: ',', code: 'Comma', primary: true } },
  'next-region': { label: tr('다음 화면 영역으로'), group: '탐색', binding: { key: 'F6' } },
  'previous-region': { label: tr('이전 화면 영역으로'), group: '탐색', binding: { key: 'F6', shift: true } },
  'show-shortcuts': { label: tr('키보드 단축키 보기'), group: '탐색', binding: { key: 'F1' } },
  'back': { label: tr('열린 패널 닫기 / 대화 목록으로'), group: '탐색', binding: { key: 'Escape' } }
} as const satisfies Record<string, Definition>
export type ShortcutCommand = keyof typeof shortcuts
export const shortcutCommands = Object.keys(shortcuts) as ShortcutCommand[]
export interface ShortcutInput {
  key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean
  isComposing?: boolean; keyCode?: number; repeat?: boolean
}
export function composingKey(input: Pick<ShortcutInput, 'key' | 'isComposing' | 'keyCode'>): boolean {
  return Boolean(input.isComposing || input.keyCode === 229 || ['Process', 'Dead', 'Unidentified'].includes(input.key))
}
// Raw matching also lets main suppress only this application's menu accelerators.
// Composition/repeat checks belong to the dispatcher, before any command executes.
export function shortcutFor(input: ShortcutInput, platform: ShortcutPlatform): ShortcutCommand | null {
  if (platform === 'unsupported' || input.altKey) return null
  for (const command of shortcutCommands) {
    const binding: Binding = shortcuts[command].binding
    const primary = Boolean(binding.primary)
    if (input.ctrlKey !== (primary && platform === 'Windows') || input.metaKey !== (primary && platform === 'macOS') || input.shiftKey !== Boolean(binding.shift)) continue
    if (input.key.toLowerCase() === binding.key.toLowerCase()) return command
    // Preserve Latin keyboard layouts, while allowing the same letter position
    // when an input source produces Hangul or another non-Latin character.
    if (binding.code && input.code === binding.code && /^[^\x00-\x7f]$/u.test(input.key)) return command
  }
  return null
}
export function shortcutAccelerator(command: ShortcutCommand, platform: ShortcutPlatform): string {
  const binding: Binding = shortcuts[command].binding
  return [binding.primary ? platform === 'macOS' ? 'Command' : 'Control' : '', binding.shift ? 'Shift' : '', binding.key].filter(Boolean).join('+')
}
export function shortcutLabel(command: ShortcutCommand, platform: ShortcutPlatform): string {
  const binding: Binding = shortcuts[command].binding
  return [binding.primary ? platform === 'macOS' ? '⌘' : 'Ctrl' : '', binding.shift ? 'Shift' : '', binding.key === 'Escape' ? 'Esc' : binding.key].filter(Boolean).join(' + ')
}
export function sendsOnEnter(input: ShortcutInput, platform: ShortcutPlatform, enterToSend: boolean): boolean {
  if (composingKey(input) || input.key !== 'Enter' || input.altKey || input.shiftKey) return false
  const primary = platform === 'macOS' ? input.metaKey && !input.ctrlKey : platform === 'Windows' && input.ctrlKey && !input.metaKey
  return Boolean(primary || (enterToSend && !input.ctrlKey && !input.metaKey))
}
