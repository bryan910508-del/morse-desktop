import { tr } from './i18n'

// Windows PC check 9 (user 10-14 17:3x, no microphone connected): pressing record showed Chromium's own words,
// «Requested device not found», twice. tdesktop never shows a device error as it is: a recording that cannot start says
// «Could not start audio recording. Please check your microphone.» (lng_record_audio_problem; video: lng_record_video_
// problem — history/history_widget.cpp:1378-1392, history_view_compose_controls.cpp:4523-4527). Here each kind of device
// failure says what to check, on the platform it happens on: Windows has no permission prompt for a desktop app, only
// Settings › Privacy › Microphone (and Camera). Errors that are not the device's (the app's own) are left as they are.
export type CaptureMedia = 'audio' | 'video'
const notFound = new Set(['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'])
const refused = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError'])
const busy = new Set(['NotReadableError', 'AbortError', 'TrackStartError'])
function deviceErrorName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || typeof (error as { name?: unknown }).name !== 'string') return null
  const name = (error as { name: string }).name
  if (notFound.has(name) || refused.has(name) || busy.has(name)) return name
  return typeof DOMException !== 'undefined' && error instanceof DOMException ? name : null
}
export function captureProblem(error: unknown, media: CaptureMedia, platform: string): string | null {
  const name = deviceErrorName(error)
  if (name === null) return null
  const windows = platform === 'Windows' || platform === 'win32'
  if (notFound.has(name)) {
    if (media === 'audio') return windows
      ? tr('마이크를 찾을 수 없어요. 마이크가 연결돼 있는지, Windows 설정 › 개인 정보 및 보안 › 마이크에서 데스크톱 앱의 마이크 사용이 켜져 있는지 확인해 주세요.')
      : tr('마이크를 찾을 수 없어요. 마이크가 연결돼 있는지 확인해 주세요.')
    return windows
      ? tr('카메라나 마이크를 찾을 수 없어요. 연결돼 있는지, Windows 설정 › 개인 정보 및 보안 › 카메라·마이크에서 데스크톱 앱의 사용이 켜져 있는지 확인해 주세요.')
      : tr('카메라나 마이크를 찾을 수 없어요. 연결돼 있는지 확인해 주세요.')
  }
  if (refused.has(name)) {
    if (media === 'audio') return windows ? tr('Windows 설정 › 개인 정보 및 보안 › 마이크에서 데스크톱 앱의 마이크 사용을 켜 주세요.') : tr('시스템 설정에서 Morse의 마이크 접근을 허용해 주세요.')
    return windows ? tr('Windows 설정 › 개인 정보 및 보안 › 카메라·마이크에서 데스크톱 앱의 사용을 켜 주세요.') : tr('시스템 설정에서 Morse의 카메라 접근을 허용해 주세요.')
  }
  if (busy.has(name)) return media === 'audio'
    ? tr('다른 앱이 마이크를 쓰고 있거나 마이크를 시작하지 못했어요. 다른 앱을 닫고 다시 시도해 주세요.')
    : tr('다른 앱이 카메라나 마이크를 쓰고 있거나 시작하지 못했어요. 다른 앱을 닫고 다시 시도해 주세요.')
  return media === 'audio' ? tr('녹음을 시작하지 못했어요. 마이크를 확인해 주세요.') : tr('녹화를 시작하지 못했어요. 카메라를 확인해 주세요.')
}
// The same words twice within a second are one problem (a press that opened the recorder twice): shown once.
export function repeatedProblem(previous: { text: string; at: number } | null, text: string, now: number): boolean {
  return previous !== null && previous.text === text && now - previous.at < 1000
}
