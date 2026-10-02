import { execFile } from 'node:child_process'
import { release } from 'node:os'

// What this computer is called in the account's session list (A6 contract §3-3): the device model and system version
// startMorseDeviceSession stores for the row, as Telegram Desktop sends them with every sign-in (main_account.cpp:431-432
// fields.deviceModel = Platform::DeviceModelPretty(), fields.systemVersion = Platform::SystemVersionPretty()). The rules
// are lib_base's (desktop-app/lib_base de35c7ab): base/platform/mac/base_info_mac.mm, base/platform/win/base_info_win.cpp
// and base/platform/base_platform_info.cpp. Reading them runs a system tool once per run; what cannot be read falls back
// the way FinalizeDeviceModel does («Mac», «Desktop»).

// base_platform_info.cpp: kMaxDeviceModelLength, kMaxGoodDeviceModelLength, IsDeviceModelOk, SimplifyDeviceModel.
const maxDeviceModelLength = 15, maxGoodDeviceModelLength = 32
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim()
const deviceModelOk = (model: string): boolean => model.length > 0 && model.length <= maxDeviceModelLength
const simplify = (model: string): string => clean(model.replace(/_/g, ''))
// base_platform_info.cpp FinalizeDeviceModel.
export function finalizeDeviceModel(model: string, mac: boolean): string { return clean(model) || (mac ? 'Mac' : 'Desktop') }

// base_info_mac.mm DeviceFromSystemProfiler: `system_profiler -json SPHardwareDataType -detailLevel mini` gives the
// machine name, and an Apple chip is added after it («MacBook Pro» + «Apple M3 Pro» → «MacBook Pro M3 Pro»), since from
// the M2 MacBooks on hw.model is only «Mac14,2».
export function macModelFromProfiler(json: string): string {
  try {
    const fields = (JSON.parse(json) as { SPHardwareDataType?: Record<string, unknown>[] }).SPHardwareDataType?.[0] ?? {}
    const name = typeof fields.machine_name === 'string' ? fields.machine_name : ''
    if (!name) return ''
    const chip = typeof fields.chip_type === 'string' ? fields.chip_type : ''
    return chip.startsWith('Apple ') ? name + chip.slice(5) : name
  } catch { return '' }
}
// base_info_mac.mm FromIdentifier: the letters of hw.model split at capitals, «Mac» and «Book» kept joined
// («MacBookPro18,3» → «MacBook Pro»).
export function macModelFromIdentifier(model: string): string {
  if (!model.toLowerCase().includes('mac')) return ''
  const words: string[] = []
  let word = ''
  for (const ch of model) {
    if (!/\p{L}/u.test(ch)) continue
    if (ch !== ch.toLowerCase() && word) { words.push(word); word = '' }
    word += ch
  }
  if (word) words.push(word)
  let result = ''
  for (const part of words) result += (result && part !== 'Mac' && part !== 'Book' ? ' ' : '') + part
  return clean(result)
}
// base_info_mac.mm SystemVersionPretty, from Electron's process.getSystemVersion() («26.4.0»).
export function macSystemVersion(version: string): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(part => Number.parseInt(part, 10) || 0)
  const addAsPatch = patch > 0 ? `.${patch}` : ''
  if (major < 10) return 'OS X'
  if (major === 10 && minor < 12) return `OS X 10.${minor}${addAsPatch}`
  return `macOS ${major}.${minor}${addAsPatch}`
}

// base_platform_info.cpp ProductNameToDeviceModel / SimplifyGoodDeviceModel, and base_info_win.cpp DeviceModelPretty:
// the BIOS product name when it is short (an HP name shortened), else family + board, the board, the family.
function goodDeviceModel(model: string, remove: string[]): string {
  let result = ''
  for (const word of model.split(' ')) {
    if (remove.includes(word.toLowerCase())) continue
    if (!result) result = word
    else if (result.length + word.length + 1 > maxGoodDeviceModelLength) return result
    else result += ` ${word}`
  }
  return result
}
export function windowsModel(bios: { systemProductName?: string; systemFamily?: string; baseBoardProduct?: string }): string {
  const product = simplify(bios.systemProductName ?? ''), family = simplify(bios.systemFamily ?? ''), board = simplify(bios.baseBoardProduct ?? '')
  const named = product.startsWith('HP ') ? goodDeviceModel(product, ['notebook', 'desktop', 'mobile', 'workstation', 'pc']) : deviceModelOk(product) ? product : ''
  if (named) return named
  const familyBoard = simplify(`${family} ${board}`)
  return deviceModelOk(familyBoard) ? familyBoard : deviceModelOk(board) ? board : deviceModelOk(family) ? family : ''
}
// base_info_win.cpp SystemVersionPretty: Windows 11 from build 22000 (IsWindows11OrGreater), from os.release()
// («10.0.22631»). The processor suffix it adds is left out.
export function windowsSystemVersion(osRelease: string): string {
  const [major = 0, minor = 0, build = 0] = osRelease.split('.').map(part => Number.parseInt(part, 10) || 0)
  if (major > 10 || (major === 10 && build >= 22000)) return 'Windows 11'
  if (major === 10) return 'Windows 10'
  if (major === 6 && minor === 3) return 'Windows 8.1'
  if (major === 6 && minor === 2) return 'Windows 8'
  if (major === 6 && minor === 1) return 'Windows 7'
  return 'Windows'
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise(resolve => execFile(file, args, { timeout: 8000, maxBuffer: 1 << 20, windowsHide: true },
    (error, stdout) => resolve(error ? '' : String(stdout))))
}
function registryValue(output: string, name: string): string {
  const line = output.split(/\r?\n/).find(row => row.trim().startsWith(`${name} `))
  return line ? clean(line.trim().slice(name.length).replace(/^\s*REG_\w+\s*/, '')) : ''
}
let described: Promise<{ deviceModel: string; systemVersion: string }> | null = null
// Read once per run, as lib_base keeps its answer in a static. Never fails: a sign-in does not wait on a name.
export function describeThisDevice(): Promise<{ deviceModel: string; systemVersion: string }> {
  described ??= read().catch(() => ({ deviceModel: finalizeDeviceModel('', process.platform === 'darwin'), systemVersion: '' }))
  return described
}
async function read(): Promise<{ deviceModel: string; systemVersion: string }> {
  if (process.platform === 'darwin') {
    const profiled = macModelFromProfiler(await run('/usr/sbin/system_profiler', ['-json', 'SPHardwareDataType', '-detailLevel', 'mini']))
    const model = profiled || macModelFromIdentifier((await run('/usr/sbin/sysctl', ['-n', 'hw.model'])).trim())
    return { deviceModel: finalizeDeviceModel(model, true).slice(0, 100), systemVersion: typeof process.getSystemVersion === 'function' ? macSystemVersion(process.getSystemVersion()) : '' }
  }
  if (process.platform === 'win32') {
    const bios = await run('reg', ['query', 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS'])
    const model = windowsModel({ systemProductName: registryValue(bios, 'SystemProductName'), systemFamily: registryValue(bios, 'SystemFamily'),
      baseBoardProduct: registryValue(bios, 'BaseBoardProduct') })
    return { deviceModel: finalizeDeviceModel(model, false).slice(0, 100), systemVersion: windowsSystemVersion(release()) }
  }
  return { deviceModel: 'Desktop', systemVersion: '' }
}
