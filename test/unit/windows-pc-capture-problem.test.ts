import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { captureProblem, repeatedProblem } from '../../src/shared/capture-problem'
import en from '../../src/shared/i18n/en.json'
import ru from '../../src/shared/i18n/ru.json'

// Windows PC check 9 (user 10-14 17:3x: no microphone; «Requested device not found» shown twice, in Chromium's English).
// tdesktop shows one line of its own instead (lng_record_audio_problem / lng_record_video_problem,
// history/history_widget.cpp:1378-1392, v7.3.1 6fed91ff).
const domError = (name: string) => new DOMException('Requested device not found', name)

test('a missing device says to check the microphone; on Windows also the privacy switch', () => {
  assert.equal(captureProblem(domError('NotFoundError'), 'audio', 'macOS'), '마이크를 찾을 수 없어요. 마이크가 연결돼 있는지 확인해 주세요.')
  assert.match(captureProblem(domError('NotFoundError'), 'audio', 'Windows')!, /Windows 설정 › 개인 정보 및 보안 › 마이크/)
  assert.match(captureProblem(domError('NotFoundError'), 'video', 'Windows')!, /카메라나 마이크를 찾을 수 없어요/)
  assert.equal(captureProblem(domError('OverconstrainedError'), 'audio', 'macOS'), captureProblem(domError('NotFoundError'), 'audio', 'macOS'))
})

test('refused, busy and any other device failure each have their words; the app\'s own errors are left as they are', () => {
  // B487b: a refusal has one wording on both systems (device-access.ts); main's gate says it before the device opens.
  assert.equal(captureProblem(domError('NotAllowedError'), 'audio', 'macOS'), '음성 메시지를 보내려면 마이크 접근이 필요해요. 설정에서 마이크를 허용해 주세요.')
  assert.equal(captureProblem(domError('NotAllowedError'), 'audio', 'Windows'), captureProblem(domError('NotAllowedError'), 'audio', 'macOS'))
  assert.match(captureProblem(domError('NotReadableError'), 'audio', 'Windows')!, /다른 앱이 마이크를/)
  assert.equal(captureProblem(domError('InvalidStateError'), 'audio', 'Windows'), '녹음을 시작하지 못했어요. 마이크를 확인해 주세요.', 'tdesktop lng_record_audio_problem')
  assert.equal(captureProblem(new Error('현재 대화를 확인해 주세요.'), 'audio', 'Windows'), null)
  assert.equal(captureProblem('nothing', 'audio', 'Windows'), null)
})

test('Windows 11 names the settings page «개인 정보 및 보안»', () => {
  for (const name of ['NotFoundError']) for (const media of ['audio', 'video'] as const) assert.match(captureProblem(domError(name), media, 'Windows')!, /Windows 설정 › 개인 정보 및 보안 › /)
})

test('no English device words: every message has its English and Russian', () => {
  for (const media of ['audio', 'video'] as const) for (const platform of ['Windows', 'macOS']) for (const name of ['NotFoundError', 'NotAllowedError', 'NotReadableError', 'InvalidStateError']) {
    const text = captureProblem(domError(name), media, platform)!
    assert.ok(!/Requested device/.test(text))
    assert.ok(text in en && text in ru, text)
  }
})

test('the same words twice within a second are shown once', () => {
  assert.equal(repeatedProblem(null, 'a', 0), false)
  assert.equal(repeatedProblem({ text: 'a', at: 0 }, 'a', 500), true)
  assert.equal(repeatedProblem({ text: 'a', at: 0 }, 'a', 1000), false)
  assert.equal(repeatedProblem({ text: 'a', at: 0 }, 'b', 10), false)
})

test('the three recorders take their words from the one function', () => {
  const files = { 'src/renderer/src/history/voice-record.tsx': "'audio'", 'src/renderer/src/channels/inquiry-voice.tsx': "'audio'", 'src/renderer/src/history/round-video-record.tsx': "'video'" }
  for (const [file, media] of Object.entries(files)) assert.ok(readFileSync(file, 'utf8').includes(`cancel(captureMessage(reason, ${media},`), file)
  const helper = readFileSync('src/renderer/src/app/capture-message.ts', 'utf8')
  assert.match(helper, /if \(repeatedProblem\(last, text, now\)\) return undefined/)
})
