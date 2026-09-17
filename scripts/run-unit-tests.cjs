// Main-process unit tests: each test/unit/*.test.ts is bundled with esbuild (Electron replaced by
// test/unit/electron-stub.ts, native modules left external) and run with Node's test runner.
const { spawnSync } = require('node:child_process')
const { mkdirSync, readdirSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
// The bundles stay inside the project so that a module left external (@grpc/proto-loader for the
// wire-format tests) still resolves from node_modules when Node runs them.
const root = resolve(__dirname, '..'), unit = join(root, 'test/unit'), out = join(root, '.build-cache/unit-tests')
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const tests = readdirSync(unit).filter(name => name.endsWith('.test.ts'))
const outputs = []
for (const name of tests) {
  const file = join(out, name.replace(/\.ts$/, '.cjs'))
  const built = spawnSync(join(root, 'node_modules/.bin/esbuild'), [join(unit, name), '--bundle', '--platform=node', '--format=cjs', '--log-level=warning',
    `--outfile=${file}`, `--alias:electron=${join(unit, 'electron-stub.ts')}`, '--external:better-sqlite3-multiple-ciphers', '--external:@grpc/grpc-js', '--external:@grpc/proto-loader'], { cwd: root, stdio: 'inherit' })
  if (built.status !== 0) process.exit(built.status ?? 1)
  outputs.push(file)
}
const run = spawnSync(process.execPath, ['--test', ...outputs], { cwd: root, stdio: 'inherit' })
process.exit(run.status ?? 1)
