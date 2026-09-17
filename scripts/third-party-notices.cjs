const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const mitLicense = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const sections = ['Morse Desktop — Third-party notices\n\nMorse Desktop is free software licensed under the GNU General Public License v3.0 or later (see LICENSE and LEGAL).\nPortions are derived from Telegram Desktop 7.2.8 (commit 272f6f5c), Copyright (c) 2014-2026 The Telegram Desktop Authors,\nlicensed under GPL-3.0-or-later with an additional permission to link with the OpenSSL library.\nElectron, Chromium and Node.js carry their own bundled notices.']
// Development packages bundled into out/main by electron-vite still ship with the app.
const bundled = new Set(['@firebase/app', '@firebase/database', '@firebase/component', '@firebase/logger', '@firebase/util', '@firebase/auth-interop-types', '@firebase/app-check-interop-types',
  'faye-websocket', 'websocket-driver', 'http-parser-js', 'websocket-extensions', 'safe-buffer', 'tslib', 'idb'].map(name => `node_modules/${name}`))
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || (metadata.dev && !bundled.has(location))) continue
  const directory = path.join(root, location)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const names = fs.readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)([._-]|$)/i.test(name))
  const notices = names.filter(name => fs.statSync(path.join(directory, name)).isFile())
    .map(name => `${name}\n${fs.readFileSync(path.join(directory, name), 'utf8')}`)
  // Firebase SDK packages ship without a license file. Their sources carry "Copyright Google LLC,
  // SPDX-License-Identifier: Apache-2.0"; the Apache License 2.0 text is the one shipped with @grpc/grpc-js.
  if (!notices.length && bundled.has(location) && manifest.name.startsWith('@firebase/') && manifest.license === 'Apache-2.0') {
    const apache = fs.readFileSync(path.join(root, 'node_modules/@grpc/grpc-js/LICENSE'), 'utf8')
    if (!apache.includes('Apache License')) throw new Error('Apache License 2.0 text not found; review before packaging.')
    notices.push(`LICENSE\nCopyright Google LLC (Firebase JavaScript SDK). Licensed under the Apache License, Version 2.0:\n\n${apache}`)
  }
  // lazy-val (electron-updater) is published under "license": "MIT" by its author without a license file; the
  // notice carries the MIT License text with the author the package names. Any other package without one stops here.
  if (!notices.length && location === 'node_modules/lazy-val' && manifest.license === 'MIT' && typeof manifest.author === 'string') {
    notices.push(`LICENSE (MIT, from package.json)\nCopyright (c) ${manifest.author}\n\n${mitLicense}`)
  }
  if (!notices.length) throw new Error(`License text missing for ${manifest.name}; review before packaging.`)
  sections.push(`${manifest.name} ${manifest.version} — ${manifest.license ?? metadata.license ?? 'see notice'}\n\n${notices.join('\n\n')}`)
}
sections.push(`Pretendard\n\n${fs.readFileSync(path.join(root, 'resources/brand/Pretendard-LICENSE.txt'), 'utf8')}`)
sections.push(`QR Code generator library (TypeScript), Project Nayuki — MIT\n\n${fs.readFileSync(path.join(root, 'vendor/qrcodegen/qrcodegen.ts'), 'utf8').split('*/')[0].replace(/^\/\*[^\n]*\n/, '').replace(/^ \* ?/gm, '').trim()}`)
sections.push(`LZFSE e634ca58b4821d9f3d560cdc6df5dec02ffc93fd\n\n${fs.readFileSync(path.join(root, 'vendor/morse-lzfse/upstream/LICENSE'), 'utf8')}`)
fs.writeFileSync(path.join(root, 'resources/THIRD_PARTY_NOTICES.txt'), `${sections.join('\n\n' + '='.repeat(72) + '\n\n')}\n`)
