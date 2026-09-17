import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sourceText } from '../../shared/i18n'

// Local diagnostics for recording voice messages in a chat or a channel inquiry: which step a
// recording reached and a fixed code for why it stopped (no error text, no microphone data).
// No uid, chat, inquiry, message id or recording content is written.
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordVoiceStep(step: string, detail = ''): void {
  if (written >= 400) return
  const short = detail.slice(0, 120)
  written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: short })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'voice-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 128 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}

// Every refusal in the recording path is one of a few fixed messages; the log keeps only which one.
const codes: [string, string][] = [
  ['현재 문의 창에서', 'window-not-focused-or-locked'], ['현재 대화 창에서', 'window-not-focused-or-locked'],
  ['현재 음성 녹음을 먼저 닫아', 'another-recording-open'], ['문의를 다시 열어', 'inquiry-not-open'], ['문의를 다시 선택', 'inquiry-not-open'],
  ['계정 연결을 확인', 'not-connected'], ['계정이 변경', 'account-changed'], ['마이크 접근을 허용', 'macos-refused-microphone'],
  ['마이크 권한을 먼저', 'grant-not-ready'], ['녹음 준비 상태가 다릅니다', 'grant-not-reserved'], ['음성 녹음이 종료되었거나', 'grant-gone'],
  ['녹음 상태를 다시', 'not-recording'], ['M4A 형식', 'not-m4a'], ['녹음 크기', 'recording-size'], ['업로드', 'upload'],
  ['음성 메시지를 보내지 못했습니다', 'send-callable'], ['0.5초에서 60초', 'duration'], ['음성 파형', 'waveform'], ['보관한 음성', 'saved-draft-open'],
  ['현재 대화를 확인', 'chat-not-open'], ['화면 잠금', 'locked'], ['카메라 접근을 허용', 'macos-refused-camera'], ['영상 메시지의 형식', 'not-mp4'],
  ['영상 메시지를 보내지 못했습니다', 'send-callable'], ['0.5초에서 60초 사이의 영상', 'duration'], ['첫 텍스트 메시지를 보낸 뒤', 'chat-not-started'], ['현재 첨부를 보내거나', 'attachment-open'],
  ['대화를 다시 선택', 'chat-not-open']
]
export function voiceErrorCode(error: unknown): string {
  // The fixed messages are matched in Korean, whatever language they were shown in.
  const message = error instanceof Error ? sourceText(error.message) : ''
  return codes.find(([part]) => message.includes(part))?.[1] ?? 'other'
}
// Steps the recording bar reports from the renderer, where the microphone itself is opened.
const rendererSteps = new Set(['recorder-unsupported', 'begin-failed', 'mic-open-failed', 'activate-failed', 'recording-started', 'recorder-error',
  'size-limit', 'grant-revoked', 'too-short', 'send-failed', 'sent', 'unconfirmed', 'cancelled'])
const errorNames = new Set(['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'SecurityError', 'OverconstrainedError', 'TypeError', 'Error'])
export function recordRendererVoiceStep(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return
  const { surface, step, name } = raw as Record<string, unknown>
  if ((surface !== 'chat' && surface !== 'inquiry') || typeof step !== 'string' || !rendererSteps.has(step)) return
  recordVoiceStep(`${surface}-renderer`, typeof name === 'string' && errorNames.has(name) ? `${step} ${name}` : step)
}
