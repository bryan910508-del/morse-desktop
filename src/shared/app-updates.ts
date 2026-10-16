// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
// Core::UpdateChecker states as Telegram Desktop shows them in Settings › Version and updates.
export interface AppUpdateSnapshot {
  // A release build that knows where its updates are published.
  available: boolean
  status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  version: string | null
  // 0…1 while downloading.
  progress: number
}
// Core::UpdateChecker::State::Ready: the new version is downloaded and a restart installs it. Only then is «Morse 업데이트»
// offered outside Settings (tdesktop dialogs_widget.cpp:2632-2648, intro_widget.cpp:316-336).
export const updateReady = (update: AppUpdateSnapshot | null | undefined): boolean => update?.available === true && update.status === 'ready'
// app_config/desktop (main/platform/app-version-gate.ts): below its minimum this version may not run — the whole window
// says so and offers the update; the document's words in the app's language, or none (the app's own).
export interface AppVersionGateSnapshot { blocked: boolean; message: string | null; storeUrl: string }
