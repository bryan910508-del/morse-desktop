import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { identifier } from '../../shared/validation'
import { backgroundPhotoId, type ChatBackgroundRecord } from '../../shared/chat-background'
import { maxAccountBackgroundBytes, maxBackgroundPhotoBytes } from '../../shared/background-photo-bytes'
import type { BackgroundStorageRecord, BackgroundStorageSnapshot, BackgroundStorageRemoval } from '../../shared/background-storage'
import type { ChatBackgroundCommand } from '../storage/chat-background-table'
import { locale, tr } from '../../shared/i18n'

interface Source { validate(): void; title(chatId: string): string | null }
export class BackgroundStorage {
  private inventory: { value: BackgroundStorageSnapshot; source: Source; deadline: number } | null = null
  private job: Promise<ChatBackgroundRecord> | null = null
  private closed = false
  private revision = 0
  constructor(private readonly store: <T>(command: ChatBackgroundCommand, validate: () => void) => Promise<T>, private readonly source: () => Source) {}
  invalidate(): void { this.revision++; this.inventory = null }
  async list(): Promise<BackgroundStorageSnapshot> {
    if (this.closed || this.job) throw new Error(tr('진행 중인 배경 저장을 먼저 마쳐 주세요.'))
    this.invalidate()
    const source = this.source(), revision = this.revision
    const validate = (): void => {
      source.validate()
      if (this.closed || this.job || revision !== this.revision) throw new Error(tr('배경 목록을 다시 불러와 주세요.'))
    }
    const rows = await this.store<BackgroundStorageRecord[]>({ kind: 'background-storage-list' }, validate)
    validate()
    if (rows.length > 10000 || new Set(rows.map(row => row.chatId)).size !== rows.length) throw new Error(tr('배경 목록을 확인하지 못했습니다.'))
    const items = rows.map(row => {
      identifier(row.chatId); identifier(row.version); backgroundPhotoId(row.photoId)
      if (!Number.isSafeInteger(row.bytes) || row.bytes < 24 || row.bytes > maxBackgroundPhotoBytes) throw new Error(tr('배경 용량을 확인하지 못했습니다.'))
      const title = source.title(row.chatId)
      return { ...row, listed: title !== null, title: title ?? '' }
    }).sort((a, b) => Number(a.listed) - Number(b.listed) || a.title.localeCompare(b.title, locale()) || a.chatId.localeCompare(b.chatId))
    const value = { token: randomUUID(), items, bytes: items.reduce((sum, row) => sum + row.bytes, 0), limit: maxAccountBackgroundBytes }
    this.inventory = { value, source, deadline: performance.now() + 5 * 60_000 }
    return value
  }
  async write(operation: () => Promise<ChatBackgroundRecord>): Promise<ChatBackgroundRecord> {
    if (this.closed || this.job) throw new Error(tr('진행 중인 배경 저장을 먼저 마쳐 주세요.'))
    const task = Promise.resolve().then(operation)
    this.job = task
    try { return await task } finally { this.invalidate(); if (this.job === task) this.job = null }
  }
  remove(removal: BackgroundStorageRemoval): Promise<ChatBackgroundRecord> {
    const inventory = this.inventory, item = inventory?.value.items.find(row => row.chatId === removal.chatId)
    const validate = (): void => {
      if (this.closed || !inventory || this.inventory !== inventory || inventory.value.token !== removal.token || inventory.deadline <= performance.now() ||
        !item || item.version !== removal.version || item.photoId !== removal.photoId) throw new Error(tr('배경이 변경되었습니다. 목록을 다시 불러온 뒤 확인해 주세요.'))
      inventory.source.validate()
      if (inventory.source.title(removal.chatId) !== (item.listed ? item.title : null)) throw new Error(tr('대화 목록이 변경되었습니다. 정리 대상을 다시 확인해 주세요.'))
    }
    validate()
    return this.write(async () => {
      const result = await this.store<ChatBackgroundRecord>({ kind: 'background-storage-remove', removal }, validate)
      if (result.value !== null || result.version !== removal.operationId) throw new Error(tr('배경 정리 결과를 확인하지 못했습니다.'))
      return result
    })
  }
  async close(): Promise<void> { this.closed = true; this.invalidate(); await this.job?.catch(() => {}) }
}
