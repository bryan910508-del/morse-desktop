// Builds the macOS helpers with the Xcode Swift toolchain, for Apple silicon and Intel in one file each (Telegram
// Desktop ships one universal Mac app). Apple's Translation framework exists only on macOS, so other platforms skip
// them and Desktop reports translation, background removal and voice to text as unavailable there.
const { spawnSync } = require('node:child_process')
const { mkdirSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')
const root = resolve(__dirname, '..')
if (process.platform !== 'darwin') process.exit(0)
const out = join(root, 'resources/native'), work = join(root, '.build-cache/native')
mkdirSync(out, { recursive: true }); mkdirSync(work, { recursive: true })
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
// name, minimum macOS, sources and extra compiler arguments.
function universal(name, minimum, source, extra = []) {
  const parts = ['arm64', 'x86_64'].map(arch => {
    const file = join(work, `${name}-${arch}`)
    run('xcrun', ['swiftc', '-parse-as-library', '-O', '-target', `${arch}-apple-macosx${minimum}`, ...extra, source, '-o', file])
    return file
  })
  run('xcrun', ['lipo', '-create', ...parts, '-output', join(out, name)])
  for (const part of parts) rmSync(part, { force: true })
}
// The on-device translation helper uses the Translation framework's session API (macOS 26).
universal('morse-translate', '26.0', join(root, 'native/morse-translate/main.swift'))
// The media helper (native/morse-media): sticker background removal (Vision, macOS 14), voice to text (Speech), video
// compression and animated sticker crops. Its Info.plist is embedded so the speech recognition prompt has its usage
// description.
universal('morse-media', '13.0', join(root, 'native/morse-media/main.swift'),
  ['-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', join(root, 'native/morse-media/Info.plist')])
