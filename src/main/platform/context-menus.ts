import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { ContextMenuAction, ContextMenuResult } from '../../shared/context-menu'
import { tr } from '../../shared/i18n'

export interface ContextMenuItem {
  label?: string
  role?: MenuItemConstructorOptions['role']
  type?: 'separator'
  enabled?: boolean
  choose?(): ContextMenuAction | null
}
interface Owner {
  uid: string | null; id: string; window: BrowserWindow; menu: Menu | null
  valid(): boolean
  finish(result: ContextMenuResult | null, error?: unknown): void
}
export class NativeContextMenus {
  private current: Owner | null = null
  constructor(private readonly changed: () => void) {}
  get open(): boolean { return this.current !== null }
  prune(): void {
    try { if (this.current && !this.current.valid()) this.close() }
    catch { this.close() }
  }
  close(uid?: string, id?: string): void {
    const owner = this.current
    if (!owner || (uid !== undefined && (owner.uid !== uid || owner.id !== id))) return
    owner.finish(null)
    try { owner.menu?.closePopup(owner.window) } catch { /* already destroyed */ }
  }
  show(window: BrowserWindow, uid: string | null, id: string, valid: () => boolean,
    items: () => Promise<ContextMenuItem[]> | ContextMenuItem[], point?: { x: number; y: number }): Promise<ContextMenuResult | null> {
    this.close()
    if (!valid()) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      const owner: Owner = { uid, id, window, menu: null, valid, finish: (result, error) => {
        if (this.current !== owner) return
        this.current = null
        if (error) reject(error); else resolve(result)
        this.changed()
      } }
      this.current = owner; this.changed()
      const active = (): boolean => this.current === owner && owner.valid()
      void Promise.resolve().then(() => active() ? items() : []).then(entries => {
        if (!active()) { owner.finish(null); return }
        if (!entries.length) { owner.finish(null); return }
        const menu = Menu.buildFromTemplate(entries.map(entry => ({
          label: entry.label, role: entry.role, type: entry.type, enabled: entry.enabled,
          ...(entry.choose ? { click: () => {
            try {
              if (!active()) { this.prune(); return }
              const action = entry.choose!()
              owner.finish(action ? { id, action } : null)
            } catch { owner.finish(null, new Error(tr('메뉴 작업을 처리하지 못했습니다. 최신 대상을 다시 선택해 주세요.'))) }
          } } : {})
        })))
        owner.menu = menu
        const zoom = window.webContents.getZoomFactor(), { width, height } = window.getContentBounds()
        menu.popup({ window, frame: window.webContents.mainFrame,
          ...(point ? { x: Math.max(0, Math.min(width - 1, Math.round(point.x * zoom))), y: Math.max(0, Math.min(height - 1, Math.round(point.y * zoom))) } : {}),
          callback: () => owner.finish(null) })
      }).catch(() => owner.finish(null, new Error(tr('메뉴를 열지 못했습니다. 최신 대상을 다시 선택해 주세요.'))))
    })
  }
}
