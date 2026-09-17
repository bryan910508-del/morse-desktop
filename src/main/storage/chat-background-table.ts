import type Database from 'better-sqlite3-multiple-ciphers'
import { chatBackground, chatBackgroundEdit, sameBackground, type ChatBackgroundEdit, type ChatBackgroundRecord } from '../../shared/chat-background'
import { identifier } from '../../shared/validation'
import { backgroundImageInfo, maxAccountBackgroundBytes } from '../../shared/background-photo-bytes'
import { backgroundPhotoId } from '../../shared/chat-background'
import { backgroundStorageRemoval, type BackgroundStorageRecord, type BackgroundStorageRemoval } from '../../shared/background-storage'
import { maxBackgroundPhotoBytes } from '../../shared/background-photo-bytes'
import { tr } from '../../shared/i18n'

export type ChatBackgroundCommand = { kind: 'chat-background'; chatId: string } |
  { kind: 'background-storage-list' } |
  { kind: 'background-storage-remove'; removal: BackgroundStorageRemoval } |
  { kind: 'chat-background-save'; chatId: string; edit: ChatBackgroundEdit; photo?: Uint8Array } |
  { kind: 'chat-background-photo'; chatId: string; photoId: string }

function read(db: Database.Database, chatId: string): ChatBackgroundRecord {
  const row = db.prepare('SELECT value,version FROM chat_backgrounds WHERE chat_id=?').get(chatId) as { value: string | null; version: string } | undefined
  return row ? { value: row.value === null ? null : chatBackground(JSON.parse(row.value)), version: identifier(row.version) } : { value: null, version: '' }
}
export function executeChatBackground(db: Database.Database, command: ChatBackgroundCommand): ChatBackgroundRecord | BackgroundStorageRecord[] | Uint8Array | null {
  if (command.kind === 'background-storage-list') {
    const rows = db.prepare(`SELECT p.chat_id AS chatId,p.id AS photoId,length(p.data) AS bytes,b.value,b.version
      FROM chat_background_photos p LEFT JOIN chat_backgrounds b ON b.chat_id=p.chat_id ORDER BY p.chat_id LIMIT 10001`).all() as Array<BackgroundStorageRecord & { value: string | null }>
    if (rows.length > 10000) throw new Error(tr('배경 목록 한도를 확인해 주세요.'))
    return rows.map(row => {
      const value = row.value === null ? null : chatBackground(JSON.parse(row.value))
      if (value?.preset !== 'photo' || value.photoId !== row.photoId || !Number.isSafeInteger(row.bytes) || row.bytes < 24 || row.bytes > maxBackgroundPhotoBytes) throw new Error(tr('배경 사진 기록을 확인하지 못했습니다.'))
      return { chatId: identifier(row.chatId), version: identifier(row.version), photoId: backgroundPhotoId(row.photoId), bytes: row.bytes }
    })
  }
  if (command.kind === 'background-storage-remove') {
    const removal = backgroundStorageRemoval(command.removal)
    return db.transaction(() => {
      const previous = read(db, removal.chatId)
      if (previous.version !== removal.version || previous.value?.preset !== 'photo' || previous.value.photoId !== removal.photoId) {
        throw Object.assign(new Error('Background changed'), { deliveryCode: 'conflict' })
      }
      const deleted = db.prepare('DELETE FROM chat_background_photos WHERE chat_id=? AND id=?').run(removal.chatId, removal.photoId)
      if (deleted.changes !== 1) throw Object.assign(new Error('Background photo missing'), { deliveryCode: 'conflict' })
      db.prepare('UPDATE chat_backgrounds SET value=NULL,version=? WHERE chat_id=?').run(removal.operationId, removal.chatId)
      return { value: null, version: removal.operationId } satisfies ChatBackgroundRecord
    })()
  }
  const chatId = identifier(command.chatId)
  if (command.kind === 'chat-background') return read(db, chatId)
  if (command.kind === 'chat-background-photo') {
    const id = backgroundPhotoId(command.photoId), current = read(db, chatId).value
    if (current?.preset !== 'photo' || current.photoId !== id) return null
    const row = db.prepare('SELECT data FROM chat_background_photos WHERE chat_id=? AND id=?').get(chatId, id) as { data: Buffer } | undefined
    return row?.data ?? null
  }
  const edit = chatBackgroundEdit(command.edit)
  return db.transaction(() => {
    const previous = read(db, chatId)
    if (previous.version === edit.operationId && sameBackground(previous.value, edit.value)) return previous
    if (previous.version === edit.operationId || previous.version !== edit.expectedVersion) {
      throw Object.assign(new Error('Background changed'), { deliveryCode: 'conflict' })
    }
    if (!previous.version && (db.prepare('SELECT COUNT(*) AS count FROM chat_backgrounds').get() as { count: number }).count >= 10000) {
      throw Object.assign(new Error('Background capacity'), { deliveryCode: 'capacity' })
    }
    if (edit.value?.preset === 'photo') {
      if (command.photo) {
        backgroundImageInfo(command.photo, true)
        const used = (db.prepare('SELECT COALESCE(SUM(length(data)),0) AS bytes FROM chat_background_photos WHERE chat_id<>?').get(chatId) as { bytes: number }).bytes
        if (used + command.photo.byteLength > maxAccountBackgroundBytes) throw Object.assign(new Error('Background photo capacity'), { deliveryCode: 'capacity' })
        db.prepare('INSERT INTO chat_background_photos(chat_id,id,data) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET id=excluded.id,data=excluded.data')
          .run(chatId, edit.value.photoId, Buffer.from(command.photo))
      } else if (!db.prepare('SELECT 1 FROM chat_background_photos WHERE chat_id=? AND id=?').get(chatId, edit.value.photoId)) {
        throw Object.assign(new Error('Background photo missing'), { deliveryCode: 'conflict' })
      }
    } else {
      db.prepare('DELETE FROM chat_background_photos WHERE chat_id=?').run(chatId)
    }
    // Reset keeps a versioned inheritance tombstone, so a stale save cannot
    // resurrect an override after the user has chosen the device default.
    db.prepare(`INSERT INTO chat_backgrounds(chat_id,value,version) VALUES(?,?,?)
      ON CONFLICT(chat_id) DO UPDATE SET value=excluded.value,version=excluded.version`)
      .run(chatId, edit.value === null ? null : JSON.stringify(edit.value), edit.operationId)
    return { value: edit.value, version: edit.operationId }
  })()
}
