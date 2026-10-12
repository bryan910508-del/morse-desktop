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
// B283: Windows and Linux have no menu bar in the window, as tdesktop builds a menu only on macOS (core/sandbox.cpp:119-121
// → platform/mac/global_menu_mac.mm). What the menu's roles gave there — closing, minimizing and quitting, zoom and full
// screen — is kept as shortcuts of the window itself, as tdesktop's Close (Ctrl+W, Ctrl+F4), Minimize (Ctrl+M) and
// Quit (Ctrl+Q) are (core/shortcuts.cpp:481-485). macOS keeps its menu, and these keys with it.
export function applicationMenuShown(platform: ShortcutPlatform): boolean { return platform === 'macOS' }
export type WindowCommand = 'close-window' | 'minimize-window' | 'quit' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'toggle-full-screen'
// B301: while a media viewer is open its zoom keys are the viewer's (viewerZoomKey), not the window's.
export function windowShortcutFor(input: ShortcutInput, platform: ShortcutPlatform, viewerOpen = false): WindowCommand | null {
  if (platform !== 'Windows' || input.altKey || input.metaKey || composingKey(input)) return null
  if (viewerOpen && viewerZoomKey(input)) return null
  if (!input.ctrlKey) return input.key === 'F11' && !input.shiftKey ? 'toggle-full-screen' : null
  // A letter by its place on the keyboard as well, so a Hangul input source keeps it (shortcutFor does the same).
  const letter = (code: string, key: string): boolean => input.code === code || input.key.toLowerCase() === key
  if (!input.shiftKey) {
    if (letter('KeyW', 'w') || input.key === 'F4') return 'close-window'
    if (letter('KeyM', 'm')) return 'minimize-window'
    if (letter('KeyQ', 'q')) return 'quit'
    if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') return 'zoom-reset'
  }
  if (input.key === '=' || input.key === '+' || input.code === 'Equal' || input.code === 'NumpadAdd') return 'zoom-in'
  if (input.key === '-' || input.code === 'Minus' || input.code === 'NumpadSubtract') return 'zoom-out'
  return null
}
// B301: the keys tdesktop's media viewer zooms a picture with — Ctrl (⌘ on macOS) with + = * ] in, − _ out, and 0 between
// its own size and the fit (media_view_overlay_widget.cpp:7459-7467, 8742-8744). The viewer takes them while it is open.
export type ViewerZoomKey = 'in' | 'out' | 'reset'
export function viewerZoomKey(input: ShortcutInput): ViewerZoomKey | null {
  if ((!input.ctrlKey && !input.metaKey) || input.altKey || composingKey(input)) return null
  if (['+', '=', '*', ']'].includes(input.key) || ['Equal', 'NumpadAdd', 'NumpadMultiply', 'BracketRight'].includes(input.code ?? '')) return 'in'
  if (['-', '_'].includes(input.key) || ['Minus', 'NumpadSubtract'].includes(input.code ?? '')) return 'out'
  if (!input.shiftKey && (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0')) return 'reset'
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
