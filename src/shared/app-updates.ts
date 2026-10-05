// Core::UpdateChecker states as Telegram Desktop shows them in Settings › Version and updates.
export interface AppUpdateSnapshot {
  // A release build that knows where its updates are published.
  available: boolean
  status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  version: string | null
  // 0…1 while downloading.
  progress: number
}
// app_config/desktop (main/platform/app-version-gate.ts): below its minimum this version may not run — the whole window
// says so and offers the update; the document's words in the app's language, or none (the app's own).
export interface AppVersionGateSnapshot { blocked: boolean; message: string | null; storeUrl: string }
