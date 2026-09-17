import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppUpdater } from 'electron-updater'
import type { AppUpdateSnapshot } from '../../shared/app-updates'

// Telegram Desktop Core::UpdateChecker: a check at start and then every 8 hours plus up to 8 more at random
// (UpdateDelayConstPart / UpdateDelayRandPart), the new version downloaded in the background, and «Update
// Telegram» offered once it is ready; restarting installs it. Morse reads its releases from GitHub through
// electron-updater, which verifies the downloaded file against the release's published hash and, on macOS,
// against the app's own code signature.
const delayConst = 8 * 3600 * 1000, delayRandom = 8 * 3600 * 1000

export class AppUpdates {
  private updater: AppUpdater | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private value: AppUpdateSnapshot
  private installing = false
  constructor(private readonly changed: () => void) {
    // Only a packaged release carries app-update.yml, written by electron-builder from its publish settings.
    const available = app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32') && existsSync(join(process.resourcesPath, 'app-update.yml'))
    this.value = { available, status: 'idle', version: null, progress: 0 }
  }
  get snapshot(): AppUpdateSnapshot { return { ...this.value } }
  get requested(): boolean { return this.installing }
  private set(patch: Partial<AppUpdateSnapshot>): void { this.value = { ...this.value, ...patch }; this.changed() }
  start(): void {
    if (!this.value.available || this.updater) return
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    this.updater = autoUpdater
    autoUpdater.logger = null
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => { if (this.value.status !== 'ready') this.set({ status: 'checking' }) })
    autoUpdater.on('update-not-available', () => { if (this.value.status !== 'ready') this.set({ status: 'latest', progress: 0 }) })
    autoUpdater.on('update-available', info => this.set({ status: 'downloading', version: info.version, progress: 0 }))
    autoUpdater.on('download-progress', progress => this.set({ status: 'downloading', progress: Math.max(0, Math.min(1, progress.percent / 100)) }))
    autoUpdater.on('update-downloaded', info => this.set({ status: 'ready', version: info.version, progress: 1 }))
    autoUpdater.on('error', () => { if (this.value.status !== 'ready') this.set({ status: 'error', progress: 0 }) })
    this.check()
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.check() }, delayConst + Math.floor(Math.random() * delayRandom))
  }
  // Settings › «업데이트 확인» and the periodic check.
  check(): void {
    if (!this.updater || this.value.status === 'ready' || this.value.status === 'downloading') return
    this.schedule()
    void this.updater.checkForUpdates().catch(() => { if (this.value.status !== 'ready') this.set({ status: 'error', progress: 0 }) })
  }
  // «Morse 업데이트»: the normal quit (drafts saved, accounts closed) ends by installing the update.
  request(): boolean {
    if (this.value.status !== 'ready') return false
    this.installing = true
    return true
  }
  install(): void { this.updater?.quitAndInstall(true, true) }
  close(): void { if (this.timer) clearTimeout(this.timer); this.timer = null }
}
