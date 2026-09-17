const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')

// Dependency preparation and native compilation only; never starts the app.
const env = {
  ...process.env,
  ELECTRON_CACHE: resolve('.build-cache/electron'),
  ELECTRON_BUILDER_CACHE: resolve('.build-cache/electron-builder'),
  npm_config_devdir: resolve('.build-cache/node-gyp')
}
for (const [entry, args] of [
  ['electron/install.js', []],
  ['electron-builder/out/cli/cli.js', ['install-app-deps']]
]) {
  const result = spawnSync(process.execPath, [require.resolve(entry), ...args], {
    stdio: 'inherit', env, cwd: resolve('.')
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
