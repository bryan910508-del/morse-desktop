import { captureProblem, repeatedProblem, type CaptureMedia } from '../../../shared/capture-problem'
import { deviceDeniedText, deviceRefusalFrom, type DeviceKind } from '../../../shared/device-access'
import { confirmBox } from '../ui/layers'
import { tr } from '../../../shared/i18n'
import { desktop } from './store'
import { errorText } from './format'

// What a recorder that could not start says (capture-problem.ts): a device's failure in words of what to check, any
// other error as before; the same words again within a second are not shown a second time (undefined).
let last: { text: string; at: number } | null = null
export function captureMessage(reason: unknown, media: CaptureMedia, fallback: string): string | undefined {
  // B487b: the system refused a device — every way into recording shows the same box, with the way to its settings
  // (tdesktop requestPermissionOrFail's Denied). A «no» to the system's question just now says nothing more.
  const refusal = deviceRefusalFrom(reason)
  if (refusal) {
    if (refusal.kind === 'denied') void deviceDenied(media, refusal.devices[0]!)
    return undefined
  }
  const text = captureProblem(reason, media, desktop.value?.platform ?? '') ?? errorText(reason, fallback)
  const now = Date.now()
  if (repeatedProblem(last, text, now)) return undefined
  last = { text, at: now }
  return text
}
let lastBox: { text: string; at: number } | null = null
async function deviceDenied(media: CaptureMedia, device: DeviceKind): Promise<void> {
  const text = deviceDeniedText(media), now = Date.now()
  if (repeatedProblem(lastBox, text, now)) return
  lastBox = { text, at: now }
  if (await confirmBox({ text, confirm: tr('설정 열기'), cancel: tr('취소') })) await window.morse.openDeviceSettings(device).catch(() => {})
}
