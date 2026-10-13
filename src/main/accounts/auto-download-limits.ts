import type { AutoDownloadLimits, AutoDownloadSource } from '../../shared/auto-download'
import { autoDownloadLimit } from '../../shared/auto-download'

// B360: the person's automatic download limits, reached by a loader through the account's credentials — as every loader
// reaches the account's file cache (mediaCacheFor) and tdesktop's loaders read Core::App().settings().autoDownload().
// The session registers how to read them now (the preferences can change while it runs).
const limits = new WeakMap<object, () => AutoDownloadLimits>()
export function registerAutoDownload(credentials: object, read: () => AutoDownloadLimits): void { limits.set(credentials, read) }
// Bytes allowed for this source, 0 when off; `fallback` where no account registered (a loader used on its own).
export function autoDownloadFor(credentials: object, source: AutoDownloadSource, fallback: number): number {
  const read = limits.get(credentials)
  if (!read) return fallback
  try { return autoDownloadLimit({ autoDownloadPhotos: read() }, source) } catch { return fallback }
}
