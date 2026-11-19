// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { documents, stringField, type FirestoreDocument } from '../network/firestore-values'

// B86 · §25 (Telegram asks the server who answers support, help.getSupport — tdesktop settings_main.cpp:1192): the
// account «채팅으로 문의하기» opens a chat with is the server's word, app_config/support.uid, not a constant in the app.
// No value — or one that is not a user id — means chat support is not offered now.
export const supportConfigPath = `${documents}/app_config/support`
export function supportUidOf(doc: FirestoreDocument | null | undefined): string | null {
  if (!doc) return null
  const uid = stringField(doc.fields ?? {}, 'uid', 160).trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : null
}

// F-ST-004 §2-3: a «문제 보고» goes only into this account's 1:1 with support. Main decides it from what it knows — never
// from the chat the window names: the pair's own room id (directChatId), a listed 1:1 of exactly these two, or a new 1:1
// not made yet whose peer is support.
export interface SupportTargetFacts {
  chatId: string; uid: string; supportUid: string | null
  dialog?: { kind: string; participantUids: readonly string[] } | null
  pendingPeer?: string | null
}
export function supportTarget(facts: SupportTargetFacts, pairId: (a: string, b: string) => string): 'support' | 'unavailable' | 'other' {
  const { chatId, uid, supportUid } = facts
  if (!supportUid || supportUid === uid) return 'unavailable'
  if (chatId === pairId(uid, supportUid)) return 'support'
  const dialog = facts.dialog
  if (dialog && dialog.kind === 'direct' && dialog.participantUids.length === 2 && dialog.participantUids.includes(uid) && dialog.participantUids.includes(supportUid)) return 'support'
  if (!dialog && facts.pendingPeer === supportUid) return 'support'
  return 'other'
}

