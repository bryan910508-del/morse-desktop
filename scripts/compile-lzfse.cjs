const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, copyFileSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { homedir } = require('node:os')
const root = resolve(__dirname, '..')
// On a Mac the addon needs only Node's headers, so ones node-gyp already cached can stand in for a source tree. A Windows
// addon also links node.lib, which --nodedir looks for as Release\node.lib while the cache keeps it as <arch>\node.lib
// (LNK1104 on the Windows runner), so there node-gyp fetches headers and library into the project's own dev dir.
const cached = process.platform === 'darwin' ? join(homedir(), 'Library/Caches/node-gyp', process.versions.node) : ''
function build(arch) {
  const args = ['rebuild', '--directory', join(root, 'vendor/morse-lzfse'), '--devdir', join(root, '.build-cache/node-gyp')]
  if (cached && existsSync(join(cached, 'include/node/node_api.h'))) args.push(`--nodedir=${cached}`)
  if (arch) args.push(`--arch=${arch}`)
  const result = spawnSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  return join(root, 'vendor/morse-lzfse/build/Release/morse_lzfse.node')
}
mkdirSync(join(root, 'resources/native'), { recursive: true })
const target = join(root, 'resources/native/morse_lzfse.node')
if (process.platform === 'darwin') {
  // One addon for Apple silicon and Intel, as the universal Mac app loads the same file on both.
  const work = join(root, '.build-cache/native'), parts = []
  mkdirSync(work, { recursive: true })
  for (const arch of ['arm64', 'x64']) { const file = join(work, `morse_lzfse-${arch}.node`); copyFileSync(build(arch), file); parts.push(file) }
  const lipo = spawnSync('xcrun', ['lipo', '-create', ...parts, '-output', target], { cwd: root, stdio: 'inherit' })
  if (lipo.error) throw lipo.error
  if (lipo.status !== 0) process.exit(lipo.status ?? 1)
  for (const part of parts) rmSync(part, { force: true })
} else copyFileSync(build(null), target)
