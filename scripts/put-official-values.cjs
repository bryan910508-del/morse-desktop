// The official Windows build puts in what the public source leaves out (scripts/export-public-source.cjs
// officialOnly), from the repository's secrets, as tdesktop's official build puts in its api_id/api_hash
// (Telegram/SourceFiles/config.h: without them the build stops). Without them the release build stops too:
// an official installer without Google sign-in must not be published.
const fs = require('node:fs')
const path = require('node:path')
const file = path.join(__dirname, '..', 'src/main/auth/google-answer.ts')
const id = process.env.MORSE_GOOGLE_DESKTOP_CLIENT_ID || '', secret = process.env.MORSE_GOOGLE_DESKTOP_CLIENT_SECRET || ''
if (!/^\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com$/.test(id) || !/^GOCSPX-[A-Za-z0-9_-]{10,}$/.test(secret)) {
  console.error('The official Google desktop client is missing (MORSE_GOOGLE_DESKTOP_CLIENT_ID / _SECRET).')
  process.exit(1)
}
let text = fs.readFileSync(file, 'utf8')
const lines = [[/^export const googleDesktopClientId = ''$/m, `export const googleDesktopClientId = '${id}'`],
  [/^export const googleDesktopClientSecret = ''$/m, `export const googleDesktopClientSecret = '${secret}'`]]
for (const [line, value] of lines) {
  if (!line.test(text)) { console.error(`${line} was not found to fill.`); process.exit(1) }
  text = text.replace(line, value)
}
fs.writeFileSync(file, text)
console.log('The official Google desktop client is in.')
