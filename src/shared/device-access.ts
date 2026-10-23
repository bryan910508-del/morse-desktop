import { tr } from './i18n'
import type { CaptureMedia } from './capture-problem'

// B487b: what a recording needs from the system, and what is said when the system has refused it. Telegram Desktop asks
// before a call (Calls::Instance::requestPermissionOrFail): granted goes on, not yet asked asks the system, refused
// shows its words and a «Settings» button that opens the system's page for that device. A recording here goes through
// the same kind of gate in main before it opens anything (platform/device-access.ts), and every way in reads the
// answer here. The words mean what iOS and Android say (Android permission_denied_*, B487b).
export type DeviceKind = 'microphone' | 'camera'
export type DeviceStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

// A video message needs the microphone and the camera, asked in that order (tdesktop requestPermissionsOrFail).
export function devicesFor(media: CaptureMedia): DeviceKind[] {
  return media === 'video' ? ['microphone', 'camera'] : ['microphone']
}

// What crosses from main to the window: an invoke error keeps only its message, so the refusal is a fixed word in it.
// «denied» is the system's standing refusal (the box with «설정 열기»); «declined» is a person saying no to the
// system's question just now, which closes the recorder and says nothing more.
export type DeviceRefusal = { kind: 'denied' | 'declined'; devices: DeviceKind[] }
const refusalPattern = /device-(denied|declined):((?:microphone|camera)(?:,(?:microphone|camera))?)/
export function deviceRefusalMessage(refusal: DeviceRefusal): string {
  return `device-${refusal.kind}:${refusal.devices.join(',')}`
}
export function deviceRefusalFrom(error: unknown): DeviceRefusal | null {
  const match = error instanceof Error ? refusalPattern.exec(error.message) : null
  if (!match) return null
  return { kind: match[1] === 'denied' ? 'denied' : 'declined', devices: [...new Set(match[2]!.split(','))] as DeviceKind[] }
}

// The one place the refusal is worded. A video message names both devices whichever was refused, as Android does
// (PermissionNoCameraMicVideo): the person allows both on the same visit.
export function deviceDeniedText(media: CaptureMedia): string {
  return media === 'video'
    ? tr('영상 메시지를 보내려면 카메라와 마이크 접근이 필요해요. 설정에서 카메라와 마이크를 허용해 주세요.')
    : tr('음성 메시지를 보내려면 마이크 접근이 필요해요. 설정에서 마이크를 허용해 주세요.')
}

// The system's page for one device (tdesktop OpenSystemSettingsForPermission). Only main opens it.
export function deviceSettingsAddress(device: DeviceKind, platform: string): string | null {
  if (platform === 'darwin') return device === 'microphone'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
  if (platform === 'win32') return device === 'microphone' ? 'ms-settings:privacy-microphone' : 'ms-settings:privacy-webcam'
  return null
}
