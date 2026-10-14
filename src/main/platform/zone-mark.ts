// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

// B377: tdesktop PostprocessDownloaded (platform/win/file_utilities_win.cpp:305-321): a file a person received and that
// now lies outside the app as plain bytes is marked as coming from the Internet zone, so Windows asks before running it
// and Office opens it in Protected View — unless Group Policy says not to keep zone information
// (ShouldSaveZoneInformation, :120-141: HKCU …\Policies\Attachments SaveZoneInformation = 1). Nothing else is marked:
// the sealed media cache never leaves the app as a file.
const zone = '[ZoneTransfer]\r\nZoneId=3\r\n'
const policyKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Attachments'

// `reg query … /v SaveZoneInformation` prints «SaveZoneInformation    REG_DWORD    0x1». No key, no value, another type or
// a failed read keep Windows' default, which keeps the zone (tdesktop :127-138).
export function zonePolicyAllows(output: string): boolean {
  const line = output.split(/\r?\n/).find(row => /^\s*SaveZoneInformation\s+REG_DWORD\s+/i.test(row))
  if (!line) return true
  return Number.parseInt(line.trim().split(/\s+/).at(-1) ?? '', 16) !== 1
}

export interface ZoneMarkDeps { platform: string; policy(): Promise<string>; write(path: string, data: string): Promise<void> }
const system: ZoneMarkDeps = {
  platform: process.platform,
  policy: () => new Promise(resolve => execFile('reg', ['query', policyKey, '/v', 'SaveZoneInformation'], { timeout: 8000, windowsHide: true },
    (error, stdout) => resolve(error ? '' : String(stdout)))),
  // The zone lives in the file's alternate data stream, as tdesktop writes it.
  write: (path, data) => writeFile(`${path}:Zone.Identifier`, data)
}
// The policy is read once per run. A file system without alternate streams (FAT, some network shares) keeps the file
// unmarked, quietly, as tdesktop's CreateFile failure does (:314-316).
export function zoneMarker(deps: ZoneMarkDeps = system): (path: string) => Promise<void> {
  let allowed: Promise<boolean> | null = null
  return async path => {
    if (deps.platform !== 'win32') return
    allowed ??= deps.policy().then(zonePolicyAllows, () => true)
    if (!await allowed) return
    try { await deps.write(path, zone) } catch { /* Left unmarked. */ }
  }
}
export const markDownloaded = zoneMarker()
