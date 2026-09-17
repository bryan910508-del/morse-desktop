import { tr } from './i18n'
// boxes/auto_lock_box.cpp kOptions; the custom time entry is not offered on Morse Desktop.
export const autoLockChoices = [60, 300, 3600, 18000] as const
export type PasscodeResult = 'correct' | 'wrong' | 'flood' | 'empty'
export interface AppLockSnapshot {
  enabled: boolean
  locked: boolean
  autoLock: number
  systemUnlock: 'none' | 'touch-id'
  systemUnlockEnabled: boolean
  systemUnlockAllowed: boolean
}
export interface AppLockBridge {
  unlock(passcode: string): Promise<PasscodeResult>
  systemUnlock(): Promise<boolean>
  lock(): Promise<void>
  check(passcode: string): Promise<PasscodeResult>
  create(passcode: string): Promise<void>
  change(passcode: string): Promise<'saved' | 'same'>
  remove(): Promise<void>
  setAutoLock(seconds: number): Promise<void>
  setSystemUnlock(enabled: boolean): Promise<void>
  signOut(): Promise<void>
}
export function passcodeInput(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 256) throw new Error(tr('암호를 다시 입력해 주세요.'))
  return raw
}
export function autoLockValue(raw: unknown): number {
  if (typeof raw !== 'number' || !(autoLockChoices as readonly number[]).includes(raw)) throw new Error(tr('자동 잠금 시간을 다시 선택해 주세요.'))
  return raw
}
export function autoLockLabel(seconds: number): string { return seconds % 3600 ? tr('{0}분', [Math.round(seconds / 60)]) : tr('{0}시간', [seconds / 3600]) }
