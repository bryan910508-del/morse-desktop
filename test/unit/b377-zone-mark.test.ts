import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { zoneMarker, zonePolicyAllows, type ZoneMarkDeps } from '../../src/main/platform/zone-mark'

// B377 (reports/desktop/2026-10-14-0.241.30-plan.md): tdesktop PostprocessDownloaded (file_utilities_win.cpp:305-321,
// v7.3.1 6fed91ff) marks a received file as from the Internet zone, unless Group Policy keeps no zone information
// (ShouldSaveZoneInformation :120-141).
function fake(platform: string, policy: string | Error, fails = false) {
  const written: { path: string; data: string }[] = []
  let reads = 0
  const deps: ZoneMarkDeps = {
    platform,
    policy: async () => { reads++; if (policy instanceof Error) throw policy; return policy },
    write: async (path, data) => { if (fails) throw new Error('no alternate streams'); written.push({ path, data }) }
  }
  return { mark: zoneMarker(deps), written, reads: () => reads }
}

test('the policy as reg prints it: only SaveZoneInformation = 1 keeps files unmarked', () => {
  assert.equal(zonePolicyAllows(''), true, 'no key: Windows keeps the zone')
  assert.equal(zonePolicyAllows('\r\nHKEY_CURRENT_USER\\Software\\…\\Attachments\r\n    SaveZoneInformation    REG_DWORD    0x1\r\n'), false)
  assert.equal(zonePolicyAllows('    SaveZoneInformation    REG_DWORD    0x2\r\n'), true)
  assert.equal(zonePolicyAllows('    SaveZoneInformation    REG_SZ    1\r\n'), true, 'another type is not the policy')
})

test('Windows writes the Internet zone beside the file, reading the policy once', async () => {
  const windows = fake('win32', '')
  await windows.mark('C:\\Users\\a\\Downloads\\report.docx')
  await windows.mark('C:\\Users\\a\\Downloads\\setup.exe')
  assert.deepEqual(windows.written.map(entry => entry.path), ['C:\\Users\\a\\Downloads\\report.docx', 'C:\\Users\\a\\Downloads\\setup.exe'])
  assert.equal(windows.written[0]!.data, '[ZoneTransfer]\r\nZoneId=3\r\n')
  assert.equal(windows.reads(), 1)
})

test('the policy, another platform, an unreadable policy and a drive without streams', async () => {
  const policy = fake('win32', '    SaveZoneInformation    REG_DWORD    0x1\r\n')
  await policy.mark('C:\\a.exe'); assert.equal(policy.written.length, 0)
  const mac = fake('darwin', ''); await mac.mark('/Users/a/a.exe')
  assert.equal(mac.written.length, 0); assert.equal(mac.reads(), 0)
  const unreadable = fake('win32', new Error('reg failed')); await unreadable.mark('C:\\a.exe')
  assert.equal(unreadable.written.length, 1, 'unreadable: the default keeps the zone')
  const fat = fake('win32', '', true)
  await assert.doesNotReject(fat.mark('E:\\a.exe'), 'left unmarked quietly')
})

test('the stream is written by name beside the file; saving and opening mark after the rename', () => {
  const source = readFileSync('src/main/platform/zone-mark.ts', 'utf8')
  assert.match(source, /writeFile\(`\$\{path\}:Zone\.Identifier`, data\)/)
  const save = readFileSync('src/main/media/media-session.ts', 'utf8'), open = readFileSync('src/main/media/opened-files.ts', 'utf8')
  assert.match(save, /await rename\(temporary, destination\)\n\s+temporary = null\n(?:\s*\/\/.*\n)?\s+await markDownloaded\(destination\)/)
  assert.match(open, /await rename\(temporary, file\)\n\s+temporary = null\n(?:\s*\/\/.*\n)?\s+await markDownloaded\(file\)/)
})
