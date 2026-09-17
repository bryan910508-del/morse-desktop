import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordRendererVoiceStep, recordVoiceStep, voiceErrorCode } from '../../src/main/platform/voice-diagnostics'

// voice-check.log says which step a recording reached and a fixed code for why it stopped. It never
// holds error text, ids or anything the renderer sends beyond the listed steps and error names.
const file = join(tmpdir(), 'voice-check.log')

test('a refusal is written as its code, never as its message', () => {
  assert.equal(voiceErrorCode(new Error('시스템 설정에서 Morse의 마이크 접근을 허용해 주세요.')), 'macos-refused-microphone')
  assert.equal(voiceErrorCode(new Error('문의를 다시 열어 주세요.')), 'inquiry-not-open')
  assert.equal(voiceErrorCode(new Error('음성 녹음이 종료되었거나 대화가 변경되었습니다.')), 'grant-gone')
  assert.equal(voiceErrorCode(new Error('사진 업로드 권한을 확인하지 못했습니다. channel1_user9')), 'upload')
  assert.equal(voiceErrorCode(new Error('something about user abc123')), 'other')
  assert.equal(voiceErrorCode('not an error'), 'other')
})

test('only listed renderer steps and error names reach the log', async () => {
  await rm(file, { force: true })
  recordRendererVoiceStep({ surface: 'inquiry', step: 'mic-open-failed', name: 'NotAllowedError' })
  recordRendererVoiceStep({ surface: 'inquiry', step: 'mic-open-failed', name: 'uid-abc123' })
  recordRendererVoiceStep({ surface: 'inquiry', step: 'free text from the page' })
  recordRendererVoiceStep({ surface: 'someone', step: 'sent' })
  recordRendererVoiceStep('sent')
  recordVoiceStep('inquiry-begin', 'ok')
  await new Promise(resolve => setTimeout(resolve, 200))
  const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { step: string; detail: string })
  assert.deepEqual(lines.map(line => [line.step, line.detail]), [
    ['inquiry-renderer', 'mic-open-failed NotAllowedError'],
    ['inquiry-renderer', 'mic-open-failed'],
    ['inquiry-begin', 'ok']
  ])
  await rm(file, { force: true })
})
