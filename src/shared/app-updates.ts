// Core::UpdateChecker states as Telegram Desktop shows them in Settings › Version and updates.
export interface AppUpdateSnapshot {
  // A release build that knows where its updates are published.
  available: boolean
  status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  version: string | null
  // 0…1 while downloading.
  progress: number
}
