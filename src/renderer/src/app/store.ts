import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { DataBatch, DesktopEvent, DesktopSnapshot, DialogSummary } from '../../../shared/model'
import { tr } from '../../../shared/i18n'

type Listener = () => void

// Renderer mirror of the main Data session. Change batches replace only the
// slices and dialog rows that changed, so unrelated views keep their object
// identity and do not re-render (Telegram Desktop Data::Changes semantics).
class DesktopStore {
  private current: DesktopSnapshot | null = null
  private readonly listeners = new Set<Listener>()
  private readonly events = new Set<(event: DesktopEvent) => void>()
  private resyncing: Promise<void> | null = null
  private started = false
  failure = ''

  start(): void {
    if (this.started) return
    this.started = true
    window.morse.onEvent(event => {
      if (event.type === 'data') this.apply(event.batch)
      for (const listener of [...this.events]) listener(event)
    })
    void this.resync()
  }
  get value(): DesktopSnapshot | null { return this.current }
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  on(listener: (event: DesktopEvent) => void): () => void {
    this.events.add(listener)
    return () => { this.events.delete(listener) }
  }
  private notify(): void { for (const listener of [...this.listeners]) listener() }
  replace(next: DesktopSnapshot): void {
    if (this.current && this.current.revision >= next.revision) return
    this.current = next; this.failure = ''; this.notify()
  }
  resync(): Promise<void> {
    this.resyncing ??= window.morse.snapshot().then(next => {
      if (!this.current || next.revision >= this.current.revision) { this.current = next; this.failure = ''; this.notify() }
    }).catch(() => {
      this.failure = tr('앱 정보를 읽지 못했습니다. 앱을 다시 열어 주세요.'); this.notify()
    }).finally(() => { this.resyncing = null })
    return this.resyncing
  }
  private apply(batch: DataBatch): void {
    const current = this.current
    if (!current || current.revision !== batch.base) {
      if (!current || batch.revision > current.revision) void this.resync()
      return
    }
    let dialogs = current.dialogs
    if (batch.dialogs) {
      const rows = new Map<string, DialogSummary>(current.dialogs.map(dialog => [dialog.id, dialog]))
      for (const id of batch.dialogs.remove) rows.delete(id)
      for (const dialog of batch.dialogs.upsert) rows.set(dialog.id, dialog)
      dialogs = batch.dialogs.order.flatMap(id => { const row = rows.get(id); return row ? [row] : [] })
    }
    this.current = { ...current, ...batch.fields, dialogs, revision: batch.revision }
    this.notify()
  }
}

export const desktop = new DesktopStore()

// A chat by id: a row of the list, or a dialog that is open without being listed (DesktopSnapshot.openDialogs).
export function dialogById(snapshot: DesktopSnapshot | null | undefined, chatId: string | null | undefined): DialogSummary | null {
  if (!snapshot || !chatId) return null
  return snapshot.dialogs.find(item => item.id === chatId) ?? snapshot.openDialogs.find(item => item.id === chatId) ?? null
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.keys(a as object), right = Object.keys(b as object)
  return left.length === right.length && left.every(key => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

export function useDesktop<T>(select: (snapshot: DesktopSnapshot | null) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ source: DesktopSnapshot | null; select: typeof select; value: T } | null>(null)
  const get = useCallback((): T => {
    const source = desktop.value, cached = cache.current
    if (cached && cached.source === source && cached.select === select) return cached.value
    const value = select(source)
    if (cached && equal(cached.value, value)) { cache.current = { source, select, value: cached.value }; return cached.value }
    cache.current = { source, select, value }
    return value
  }, [select, equal])
  return useSyncExternalStore(desktop.subscribe, get)
}

export function useDesktopEvent(listener: (event: DesktopEvent) => void): void {
  const latest = useRef(listener); latest.current = listener
  useEffect(() => desktop.on(event => latest.current(event)), [])
}
