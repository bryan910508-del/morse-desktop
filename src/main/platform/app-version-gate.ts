// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { releaseSourceURL } from '../../shared/app-release'
import type { AppVersionGateSnapshot } from '../../shared/app-updates'

// The lowest version that may run, from app_config/desktop — the same fields iOS (AppVersionService) and Android
// (AppVersionRequirement.kt, app_config/android) read: minVersion, currentVersion, storeUrl, updateMessage{language}.
// Below minVersion the app is blocked (Telegram's help.appUpdate can_not_skip, which Telegram Android shows; tdesktop
// has no such document and answers an outdated client with an «Update» box, Core::UpdateApplication — the block's
// button does what that does). Below currentVersion nothing is shown: the updater is asked to check now, and its own
// «Morse 업데이트» follows, as tdesktop's does. A failed or malformed read keeps the last decision; nothing is stored.
export interface AppVersionRequirement { minVersion: string; currentVersion: string | null; storeUrl: string; messages: Record<string, string> }
export const releasesURL = `${releaseSourceURL}/releases/latest`
// Read again at most every 12 hours otherwise (Android REFRESH_INTERVAL_MS).
export const versionGateRefreshMs = 12 * 3600 * 1000

const versionPattern = /^\d+(\.\d+)*$/
// iOS compareVersions: dot segments compared as numbers; a missing segment counts as 0.
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(part => Number(part) || 0), right = b.split('.').map(part => Number(part) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const l = left[index] ?? 0, r = right[index] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

type Value = { stringValue?: unknown; mapValue?: { fields?: Record<string, Value> } }
// A Firestore document's fields (REST or gRPC, the same value names); only a valid minimum is required.
export function versionRequirement(document: { fields?: unknown } | null): AppVersionRequirement | null {
  const fields = document?.fields && typeof document.fields === 'object' ? document.fields as Record<string, Value> : null
  const text = (value: Value | undefined): string | null => typeof value?.stringValue === 'string' ? value.stringValue : null
  const version = (value: Value | undefined): string | null => { const raw = text(value); return raw !== null && versionPattern.test(raw) ? raw : null }
  const minVersion = version(fields?.minVersion)
  if (!fields || !minVersion) return null
  let storeUrl = releasesURL
  try { const url = new URL(text(fields.storeUrl) ?? ''); if (url.protocol === 'https:' && url.hostname) storeUrl = url.href } catch { /* the release page */ }
  // iOS takes the whole map as text or none of it.
  const entries = Object.entries(fields.updateMessage?.mapValue?.fields ?? {})
  const messages = entries.every(([, value]) => typeof value?.stringValue === 'string')
    ? Object.fromEntries(entries.map(([key, value]) => [key, String(value.stringValue).slice(0, 1000)])) : {}
  return { minVersion, currentVersion: version(fields.currentVersion), storeUrl, messages }
}

export class AppVersionGate {
  private requirement: AppVersionRequirement | null = null
  private readAt = 0
  private reading: Promise<void> | null = null
  private asked: string | null = null
  constructor(private readonly installed: string, private readonly changed: () => void, private readonly newer: () => void,
    private readonly now: () => number = Date.now) {}

  snapshot(language: string): AppVersionGateSnapshot {
    const requirement = this.requirement
    if (!requirement || compareVersions(this.installed, requirement.minVersion) >= 0) return { blocked: false, message: null, storeUrl: releasesURL }
    // iOS order: the app language, then ko, then en; none — the app's own words.
    const message = requirement.messages[language] ?? requirement.messages.ko ?? requirement.messages.en ?? null
    return { blocked: true, message, storeUrl: requirement.storeUrl }
  }
  // At start, when an account opens or the network is back (`force`), and otherwise at most every 12 hours.
  refresh(read: () => Promise<{ fields?: unknown } | null>, force = false): Promise<void> {
    if (this.reading) return this.reading
    if (!force && this.readAt && this.now() - this.readAt < versionGateRefreshMs) return Promise.resolve()
    this.reading = (async () => {
      try {
        const parsed = versionRequirement(await read())
        if (!parsed) return
        this.readAt = this.now()
        const was = JSON.stringify(this.requirement)
        this.requirement = parsed
        if (JSON.stringify(parsed) !== was) this.changed()
        if (parsed.currentVersion && compareVersions(this.installed, parsed.currentVersion) < 0 && this.asked !== parsed.currentVersion) {
          this.asked = parsed.currentVersion
          this.newer()
        }
      } catch { /* the last decision stays */ }
      finally { this.reading = null }
    })()
    return this.reading
  }
}
