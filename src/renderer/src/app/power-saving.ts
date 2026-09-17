import { useEffect, useSyncExternalStore } from 'react'
import type { Preferences } from '../../../shared/model'
import { desktop, useDesktop } from './store'

// iOS MorsePowerSaving: power saving is on when «항상 켜기» is on, or «배터리 부족 시 자동» is on and the battery is at
// 20% or less without charging (Chromium's Battery Status API gives the level on a Mac); while it is on, every
// option counts as on.
interface BatteryLike extends EventTarget { level: number; charging: boolean }
let low = false
const listeners = new Set<() => void>()
let started = false
function start(): void {
  if (started) return
  started = true
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery
  if (!getBattery) return
  void getBattery.call(navigator).then(battery => {
    const update = (): void => {
      const next = battery.level <= 0.2 && !battery.charging
      if (next !== low) { low = next; for (const listener of [...listeners]) listener() }
    }
    battery.addEventListener('levelchange', update); battery.addEventListener('chargingchange', update); update()
  }).catch(() => {})
}
function useLowBattery(): boolean {
  start()
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => low)
}
export function powerSavingActive(preferences: Preferences | undefined, lowBattery = low): boolean {
  return Boolean(preferences && (preferences.powerSavingAlwaysOn || (preferences.powerSavingAuto && lowBattery)))
}
export type PowerSavingOption = 'compressMediaUploads' | 'reduceMessageAnimations' | 'disableTypingIndicators'
export function effectivePowerSaving(option: PowerSavingOption): boolean {
  start()
  const preferences = desktop.value?.preferences
  return powerSavingActive(preferences) || Boolean(preferences?.[option])
}
export function usePowerSaving(): { active: boolean; lowBattery: boolean; effective(option: PowerSavingOption): boolean } {
  const lowBattery = useLowBattery()
  const preferences = useDesktop(snapshot => snapshot?.preferences)
  const active = powerSavingActive(preferences ?? undefined, lowBattery)
  return { active, lowBattery, effective: option => active || Boolean(preferences?.[option]) }
}
// The main process compresses picked videos, so it is told whether «업로드 자동 압축» applies now.
export function usePowerSavingReport(): void {
  const compress = usePowerSaving().effective('compressMediaUploads')
  useEffect(() => { void window.morse.setPowerSavingState(compress).catch(() => {}) }, [compress])
}
// «메시지 애니메이션 줄이기»: transitions and animations stop across the window.
export function useReducedMotion(): void {
  const { effective } = usePowerSaving()
  const reduce = effective('reduceMessageAnimations')
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', reduce) }, [reduce])
}
