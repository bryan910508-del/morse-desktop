import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// B379 (reports/desktop/2026-10-14-0.241.30-plan.md): the unit tests run on Windows before a Windows installer is
// published, and the Windows check installs that installer silently, starts it and removes it. No secret is read there.
const release = readFileSync('.github/workflows/release-windows.yml', 'utf8'), check = readFileSync('.github/workflows/windows-check.yml', 'utf8')

test('a release runs the unit tests on Windows before it builds or publishes anything', () => {
  const tests = release.indexOf('run: npm run test:unit'), values = release.indexOf('put-official-values'), publish = release.indexOf('--publish always')
  assert.ok(tests > 0 && tests < values && values < publish, 'npm ci → unit tests → official values → … → publish')
})

test('the Windows check: unit tests, build, silent install, version, a started window, removal — and no secret', () => {
  const order = ['run: npm run test:unit', 'run: npm run build', "-ArgumentList '/S' -Wait -PassThru", 'VersionInfo.ProductVersion',
    "--remote-debugging-port=9222", "$_.url -like 'morse://app/*'", "Uninstall*.exe"].map(text => check.indexOf(text))
  assert.ok(order.every(at => at > 0), JSON.stringify(order))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  assert.ok(!/secrets\./.test(check), 'the check reads no secret')
  assert.match(check, /if: \$\{\{ always\(\) && env\.MORSE_EXE != '' \}\}\n\s+shell: pwsh\n\s+run: \|\n\s+Get-Process -Name Morse/, 'removal runs even after a failure')
})

test('the runner starts esbuild through its API and names the bundles relative to the project', () => {
  const runner = readFileSync('scripts/run-unit-tests.cjs', 'utf8')
  assert.ok(!/spawnSync\([^)]*\.bin\/esbuild/.test(runner), 'a shell script spawnSync cannot start on Windows')
  assert.match(runner, /esbuild\.buildSync\(/)
  assert.match(runner, /outputs\.push\(relative\(root, file\)\)/)
})
