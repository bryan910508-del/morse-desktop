import { createElement, useSyncExternalStore } from 'react'
import { Languages } from 'lucide-react'
import type { ChatMessage } from '../../../shared/model'
import { menuTranslatable, serverTranslationBatch, translationAvailable, translationMessage, type TranslationResult, type TranslationRoute } from '../../../shared/translation'
import type { MenuEntry } from '../ui/popup-menu'
import { controller } from './ui'
import { tr } from '../../../shared/i18n'

// Per-message translations shown in history: iOS keeps the translated text on the message and
// shows it instead of the original — manual ones always, automatic ones while "전체번역" is on.
export type TranslationState =
  | { status: 'loading'; manual: boolean; source: string }
  | { status: 'shown'; manual: boolean; source: string; text: string }

const states = new Map<string, TranslationState>()
const dismissed = new Set<string>(), skipped = new Set<string>(), queued = new Set<string>()
const listeners = new Set<() => void>()
const queue: (() => Promise<void>)[] = []
let running = 0, notInstalledShown = false
// B343: rooms whose automatic translation the server's rate limit stopped (RATE_LIMITED) until «전체번역» is turned again.
const limitedRooms = new Set<string>()
// AutoTranslateConcurrencyBox: automatic requests run a couple at a time.
const autoLimit = 2

const keyOf = (accountUid: string, chatId: string, messageId: string): string => `${accountUid}\n${chatId}\n${messageId}`
function emit(): void { for (const listener of listeners) listener() }
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useTranslation(accountUid: string, chatId: string, messageId: string): TranslationState | null {
  const get = (): TranslationState | null => states.get(keyOf(accountUid, chatId, messageId)) ?? null
  // The same reading for markup drawn outside a window (a unit test's renderToStaticMarkup).
  return useSyncExternalStore(subscribe, get, get)
}
export function translationShown(accountUid: string, chatId: string, messageId: string, source: string, auto: boolean): boolean {
  const state = states.get(keyOf(accountUid, chatId, messageId))
  return state?.status === 'shown' && state.source === source && (state.manual || auto)
}

function report(result: TranslationResult, manual: boolean): void {
  if (result.status === 'translated') return
  if (result.status === 'not-installed') {
    if (!manual && notInstalledShown) return
    notInstalledShown = true
    controller.toast(translationMessage(result), 'error', { label: tr('설정 열기'), run: () => { void window.morse.openTranslationSettings().catch(() => {}) } })
    return
  }
  if (manual) controller.toast(translationMessage(result), result.status === 'same-language' ? 'default' : 'error')
}
// One message's answer: shown, or let go (an automatic one is not asked again until the text changes).
function settle(key: string, source: string, result: TranslationResult): { manual: boolean } | null {
  const current = states.get(key)
  if (!current || current.source !== source || current.status !== 'loading') return null
  if (result.status === 'translated') states.set(key, { status: 'shown', manual: current.manual, source, text: result.text })
  else { states.delete(key); if (!current.manual) skipped.add(key) }
  return { manual: current.manual }
}

async function run(accountUid: string, chatId: string, message: ChatMessage, manual: boolean): Promise<void> {
  const key = keyOf(accountUid, chatId, message.id), source = message.text
  const previous = states.get(key)
  if (previous && previous.source === source) {
    if (manual && !previous.manual) { states.set(key, { ...previous, manual: true }); emit() }
    return
  }
  states.set(key, { status: 'loading', manual, source }); emit()
  let result: TranslationResult
  try { result = await window.morse.translateMessage(accountUid, chatId, message.id) } catch { result = { status: 'failed' } }
  const settled = settle(key, source, result)
  if (!settled) return
  emit()
  report(result, settled.manual)
}

// Message menu «번역»: translate, or show the original again when the translation is on screen.
export function toggleTranslation(accountUid: string, chatId: string, message: ChatMessage, auto: boolean): Promise<void> {
  const key = keyOf(accountUid, chatId, message.id)
  if (translationShown(accountUid, chatId, message.id, message.text, auto)) {
    states.delete(key); dismissed.add(key); emit()
    return Promise.resolve()
  }
  dismissed.delete(key); skipped.delete(key)
  return run(accountUid, chatId, message, true)
}

// B343b: the message menu's «번역» / «원문 보기», one for a chat and a 1:1 inquiry room alike (the chat's path, B343·B356) —
// tdesktop offers it in any room, for any sender (history_view_context_menu.cpp:1901-1909). `room` is the translation
// key: a chat's id, or an inquiry room's inquiryQueueChatId (shared/translation.ts translationRoom). On this device's
// route the language gate decides first; the server's route offers it and answers «same language» itself.
export async function translationMenuEntry(accountUid: string, room: string, message: ChatMessage, roomKind: string | undefined,
  route: TranslationRoute | undefined, auto: boolean): Promise<MenuEntry> {
  if (!menuTranslatable(message, roomKind) || !translationAvailable(route)) return null
  const shown = translationShown(accountUid, room, message.id, message.text, auto)
  if (!shown && !await offerTranslation(accountUid, room, message.id)) return null
  return { label: shown ? tr('원문 보기') : tr('번역'), icon: createElement(Languages, { size: 18 }), onSelect: () => { void toggleTranslation(accountUid, room, message, auto) } }
}
// The menu offers «번역» only for text in another language; a slow answer leaves it out.
export async function offerTranslation(accountUid: string, chatId: string, messageId: string): Promise<boolean> {
  try {
    return await Promise.race([window.morse.translationGate(accountUid, chatId, messageId), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 800))])
  } catch { return false }
}

function pump(): void {
  while (running < autoLimit && queue.length) {
    const job = queue.shift()!
    running++
    void job().catch(() => {}).finally(() => { running--; pump() })
  }
}
// "전체번역": received text on screen in another language is translated as it appears. B343: on the server's route the
// messages on screen go together, up to 20 in a request (tdesktop TranslateTracker::requestSome bunches what is visible,
// history_view_translate_tracker.cpp:273-306), and the server judges the language.
export function autoTranslate(accountUid: string, chatId: string, messages: ChatMessage[], server = false): void {
  if (server) { autoTranslateOnServer(accountUid, chatId, messages); return }
  for (const message of messages) {
    const key = keyOf(accountUid, chatId, message.id)
    if (dismissed.has(key) || skipped.has(key) || queued.has(key) || states.get(key)?.source === message.text) continue
    queued.add(key)
    queue.push(async () => {
      try {
        const differs = await window.morse.translationGate(accountUid, chatId, message.id).catch(() => false)
        if (!differs) { skipped.add(key); return }
        await run(accountUid, chatId, message, false)
      } finally { queued.delete(key) }
    })
  }
  pump()
}
function autoTranslateOnServer(accountUid: string, chatId: string, messages: ChatMessage[]): void {
  const room = `${accountUid}\n${chatId}`
  if (limitedRooms.has(room)) return
  const fresh = messages.filter(message => {
    const key = keyOf(accountUid, chatId, message.id)
    return !dismissed.has(key) && !skipped.has(key) && !queued.has(key) && states.get(key)?.source !== message.text
  })
  for (let start = 0; start < fresh.length; start += serverTranslationBatch) {
    const batch = fresh.slice(start, start + serverTranslationBatch).map(message => ({ id: message.id, key: keyOf(accountUid, chatId, message.id), source: message.text }))
    for (const item of batch) { queued.add(item.key); states.set(item.key, { status: 'loading', manual: false, source: item.source }) }
    emit()
    queue.push(async () => {
      try {
        let results: Record<string, TranslationResult> = {}
        if (!limitedRooms.has(room)) {
          try { results = await window.morse.translateMessages(accountUid, chatId, batch.map(item => item.id)) } catch { results = {} }
        }
        let limited = false
        for (const item of batch) {
          const result = results[item.id] ?? { status: 'failed' as const }
          if (result.status === 'rate-limited') limited = true
          settle(item.key, item.source, result)
        }
        emit()
        // The server's rate: automatic translation stops in this room, said once (a press of «번역» still asks).
        if (limited && !limitedRooms.has(room)) { limitedRooms.add(room); report({ status: 'rate-limited' }, true) }
      } finally { for (const item of batch) queued.delete(item.key) }
    })
  }
  pump()
}
export function resetAutoTranslation(): void { skipped.clear(); limitedRooms.clear(); notInstalledShown = false }
