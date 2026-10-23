import type { CaptureMedia } from '../../shared/capture-problem'
import { devicesFor, deviceRefusalMessage, type DeviceKind, type DeviceStatus } from '../../shared/device-access'

// B487b: the one gate a recording passes before the window opens a microphone or a camera, in the shape Telegram
// Desktop gives a call (Calls::Instance::requestPermissionOrFail): granted goes on; not yet decided asks the system,
// and a «no» there ends quietly; refused or restricted by the system ends with the refusal the window shows with its
// «설정 열기» (shared/device-access.ts). Every device is read first, so a refused one is said before anything is asked.
// macOS and Windows both answer the status (Electron systemPreferences.getMediaAccessStatus — on Windows the privacy
// switch for desktop apps); only macOS asks.
export interface DeviceSystem {
  platform: string
  status(device: DeviceKind): DeviceStatus
  ask(device: DeviceKind): Promise<boolean>
}
export async function deviceAccess(media: CaptureMedia, system: DeviceSystem): Promise<void> {
  if (system.platform !== 'darwin' && system.platform !== 'win32') return
  const devices = devicesFor(media)
  const statuses = devices.map(device => [device, system.status(device)] as const)
  const denied = statuses.filter(([, status]) => status === 'denied' || status === 'restricted').map(([device]) => device)
  if (denied.length) throw new Error(deviceRefusalMessage({ kind: 'denied', devices: denied }))
  if (system.platform !== 'darwin') return
  for (const [device, status] of statuses) {
    if (status !== 'not-determined') continue
    if (!(await system.ask(device))) throw new Error(deviceRefusalMessage({ kind: 'declined', devices: [device] }))
  }
}
