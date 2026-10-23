import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { deviceAccess, type DeviceSystem } from '../../src/main/platform/device-access'
import { deviceDeniedText, deviceRefusalFrom, deviceRefusalMessage, deviceSettingsAddress, type DeviceKind, type DeviceStatus } from '../../src/shared/device-access'
import { captureProblem } from '../../src/shared/capture-problem'
import en from '../../src/shared/i18n/en.json'
import ru from '../../src/shared/i18n/ru.json'

// B487b: a recording's gate in main, in the shape Telegram Desktop gives a call (calls_instance.cpp:995-1027): granted
// goes on, not yet decided asks the system and a «no» ends quietly, refused shows words and a way to the system's page
// for that device (specific_mac.mm:414-423, specific_win.cpp:672-684). iOS and Android say the same (B487b).
function system(platform: string, statuses: Partial<Record<DeviceKind, DeviceStatus>>, answers: Partial<Record<DeviceKind, boolean>> = {}) {
  const asked: DeviceKind[] = []
  const value: DeviceSystem = { platform, status: device => statuses[device] ?? 'granted', ask: async device => { asked.push(device); return answers[device] ?? true } }
  return { value, asked }
}
const refusal = async (run: Promise<void>) => { try { await run; return null } catch (error) { return deviceRefusalFrom(error) } }

test('granted goes on without asking; a device not yet decided is asked on macOS, and a «no» ends quietly', async () => {
  const granted = system('darwin', { microphone: 'granted', camera: 'granted' })
  assert.equal(await refusal(deviceAccess('video', granted.value)), null)
  assert.deepEqual(granted.asked, [], 'nothing asked once allowed')
  const fresh = system('darwin', { microphone: 'not-determined', camera: 'not-determined' })
  assert.equal(await refusal(deviceAccess('video', fresh.value)), null)
  assert.deepEqual(fresh.asked, ['microphone', 'camera'], 'the microphone first, as tdesktop requestPermissionsOrFail')
  const no = system('darwin', { microphone: 'granted', camera: 'not-determined' }, { camera: false })
  assert.deepEqual(await refusal(deviceAccess('video', no.value)), { kind: 'declined', devices: ['camera'] })
  assert.equal(await refusal(deviceAccess('audio', system('darwin', { microphone: 'unknown' }).value)), null, 'an unknown answer leaves it to the device')
})

test('refused or restricted is said before anything is asked, naming each refused device', async () => {
  for (const status of ['denied', 'restricted'] as const) {
    const mac = system('darwin', { microphone: status, camera: 'not-determined' })
    assert.deepEqual(await refusal(deviceAccess('video', mac.value)), { kind: 'denied', devices: ['microphone'] })
    assert.deepEqual(mac.asked, [], 'no system question when one device is already refused')
  }
  assert.deepEqual(await refusal(deviceAccess('video', system('darwin', { microphone: 'granted', camera: 'denied' }).value)), { kind: 'denied', devices: ['camera'] })
  assert.deepEqual(await refusal(deviceAccess('video', system('darwin', { microphone: 'denied', camera: 'denied' }).value)), { kind: 'denied', devices: ['microphone', 'camera'] })
  assert.deepEqual(await refusal(deviceAccess('audio', system('darwin', { microphone: 'granted', camera: 'denied' }).value)), null, 'a voice message does not need the camera')
})

test('on Windows the privacy switch is read first, so a switched-off device is caught before it is opened; nothing is asked', async () => {
  const off = system('win32', { microphone: 'denied' })
  assert.deepEqual(await refusal(deviceAccess('audio', off.value)), { kind: 'denied', devices: ['microphone'] })
  assert.deepEqual(await refusal(deviceAccess('video', system('win32', { camera: 'denied' }).value)), { kind: 'denied', devices: ['camera'] })
  const on = system('win32', { microphone: 'not-determined' })
  assert.equal(await refusal(deviceAccess('audio', on.value)), null)
  assert.deepEqual(on.asked, [], 'Windows has no question to ask')
  assert.equal(await refusal(deviceAccess('audio', system('linux', { microphone: 'denied' }).value)), null)
})

test('the refusal crosses to the window inside the invoke error, and only its own word is read', () => {
  const message = deviceRefusalMessage({ kind: 'denied', devices: ['microphone', 'camera'] })
  const invoked = new Error(`Error invoking remote method 'morse:begin-round-video': Error: ${message}`)
  assert.deepEqual(deviceRefusalFrom(invoked), { kind: 'denied', devices: ['microphone', 'camera'] })
  assert.deepEqual(deviceRefusalFrom(new Error('device-declined:camera')), { kind: 'declined', devices: ['camera'] })
  assert.equal(deviceRefusalFrom(new Error('현재 대화를 확인해 주세요.')), null)
  assert.equal(deviceRefusalFrom(new Error('device-denied:speaker')), null)
  assert.equal(deviceRefusalFrom('device-denied:microphone'), null, 'not an error')
})

test('each device opens its own page of the system\'s settings, chosen in main', () => {
  assert.equal(deviceSettingsAddress('microphone', 'darwin'), 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  assert.equal(deviceSettingsAddress('camera', 'darwin'), 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera')
  assert.equal(deviceSettingsAddress('microphone', 'win32'), 'ms-settings:privacy-microphone')
  assert.equal(deviceSettingsAddress('camera', 'win32'), 'ms-settings:privacy-webcam')
  assert.equal(deviceSettingsAddress('camera', 'linux'), null)
  const index = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf8')
  assert.match(index, /handle\('open-device-settings', device => \{\n    const address = device === 'microphone' \|\| device === 'camera' \? deviceSettingsAddress\(device, process\.platform\) : null/)
})

test('one wording, as Android says it, in every language; a refused device opened anyway says the same', () => {
  assert.equal(deviceDeniedText('audio'), '음성 메시지를 보내려면 마이크 접근이 필요해요. 설정에서 마이크를 허용해 주세요.')
  assert.equal(deviceDeniedText('video'), '영상 메시지를 보내려면 카메라와 마이크 접근이 필요해요. 설정에서 카메라와 마이크를 허용해 주세요.')
  for (const media of ['audio', 'video'] as const) {
    const text = deviceDeniedText(media)
    assert.ok(text in en && text in ru, text)
    for (const platform of ['macOS', 'Windows']) assert.equal(captureProblem(new DOMException('denied', 'NotAllowedError'), media, platform), text)
  }
  assert.ok('설정 열기' in en && '취소' in en && '설정 열기' in ru && '취소' in ru, 'the cancel word iOS and Android use')
})

test('all four ways into a recording go through the gate in main and show the refusal in one place', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../src', path), 'utf8')
  const index = read('main/index.ts'), message = read('renderer/src/app/capture-message.ts')
  assert.match(index, /const askForRecording = \(media: CaptureMedia\): Promise<void> => deviceAccess\(media, \{/)
  assert.match(index, /status: device => systemPreferences\.getMediaAccessStatus\(device\)/)
  assert.equal((index.match(/askForMediaAccess/g) ?? []).length, 1, 'asked only inside the gate')
  // Chat voice and round video (beginChatVoice), inquiry voice and round video (the inquiry's begin).
  assert.match(index, /handle\('begin-voice-capture',async\(uid,raw\)=>\{try\{const grant=await beginChatVoice\(uid,raw,'audio'\)/)
  assert.match(index, /handle\('begin-round-video',async\(uid,raw\)=>\{try\{const grant=await beginChatVoice\(uid,raw,'video'\)/)
  assert.match(index, /try\{await askForRecording\(media\);validate\(\)/)
  assert.match(index, /await askForRecording\(media\)\n      validate\(\); voiceCaptures\.permissionReady\(capture\)/)
  for (const [path, media] of [['renderer/src/history/voice-record.tsx', 'audio'], ['renderer/src/history/round-video-record.tsx', 'video'], ['renderer/src/channels/inquiry-voice.tsx', 'audio']] as const) {
    assert.match(read(path), new RegExp(`captureMessage\\(reason, '${media}'`), path)
  }
  assert.match(message, /const refusal = deviceRefusalFrom\(reason\)/)
  assert.match(message, /confirmBox\(\{ text, confirm: tr\('설정 열기'\), cancel: tr\('취소'\) \}\)\) await window\.morse\.openDeviceSettings\(device\)/)
  // The old words, written twice, are gone.
  for (const path of ['main/index.ts', 'shared/capture-problem.ts']) assert.doesNotMatch(read(path), /접근을 허용해 주세요\.'\)|데스크톱 앱의 마이크 사용을 켜/)
})
