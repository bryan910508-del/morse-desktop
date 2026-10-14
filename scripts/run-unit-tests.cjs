// Main-process unit tests: each test/unit/*.test.ts is bundled with esbuild (Electron replaced by
// test/unit/electron-stub.ts, native modules left external) and run with Node's test runner.
// B379: esbuild is called through its JavaScript API rather than node_modules/.bin/esbuild, which on Windows is a shell
// script spawnSync cannot start (the first Windows run ended at once with no output). The test files are named relative
// to the project, which keeps the one `node --test` command line well inside Windows' 32,767 characters.
const { spawnSync } = require('node:child_process')
const { mkdirSync, readdirSync, rmSync } = require('node:fs')
const { join, relative, resolve } = require('node:path')
const esbuild = require('esbuild')
// The bundles stay inside the project so that a module left external (@grpc/proto-loader for the
// wire-format tests) still resolves from node_modules when Node runs them.
const root = resolve(__dirname, '..'), unit = join(root, 'test/unit'), out = join(root, '.build-cache/unit-tests')
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const tests = readdirSync(unit).filter(name => name.endsWith('.test.ts'))
const outputs = []
for (const name of tests) {
  const file = join(out, name.replace(/\.ts$/, '.cjs'))
  try {
    esbuild.buildSync({ entryPoints: [join(unit, name)], bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', outfile: file,
      absWorkingDir: root, alias: { electron: join(unit, 'electron-stub.ts') }, external: ['better-sqlite3-multiple-ciphers', '@grpc/grpc-js', '@grpc/proto-loader'] })
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
  outputs.push(relative(root, file))
}
const run = spawnSync(process.execPath, ['--test', ...outputs], { cwd: root, stdio: 'inherit' })
if (run.error) console.error(run.error.message)
process.exit(run.status ?? 1)
