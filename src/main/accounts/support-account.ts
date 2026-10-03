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
