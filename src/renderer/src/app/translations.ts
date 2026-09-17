import { useSyncExternalStore } from 'react'
import type { ChatMessage } from '../../../shared/model'
import { translationMessage, type TranslationResult } from '../../../shared/translation'
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
// AutoTranslateConcurrencyBox: automatic requests run a couple at a time.
const autoLimit = 2

const keyOf = (accountUid: string, chatId: string, messageId: string): string => `${accountUid}\n${chatId}\n${messageId}`
function emit(): void { for (const listener of listeners) listener() }
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useTranslation(accountUid: string, chatId: string, messageId: string): TranslationState | null {
  return useSyncExternalStore(subscribe, () => states.get(keyOf(accountUid, chatId, messageId)) ?? null)
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
  const current = states.get(key)
  if (!current || current.source !== source || current.status !== 'loading') return
  if (result.status === 'translated') states.set(key, { status: 'shown', manual: current.manual, source, text: result.text })
  else { states.delete(key); if (!current.manual) skipped.add(key) }
  emit()
  report(result, current.manual)
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
// "전체번역": received text on screen in another language is translated as it appears.
export function autoTranslate(accountUid: string, chatId: string, messages: ChatMessage[]): void {
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
export function resetAutoTranslation(): void { skipped.clear(); notInstalledShown = false }
