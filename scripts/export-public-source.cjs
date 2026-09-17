// Copies the committed source of this release into release/public-source, the working tree of the public
// repository (src/shared/app-release.ts) that carries the releases and their Corresponding Source (GPLv3 §6).
// Only files tracked by git are copied, so ignored files — infrastructure/.private, .env files, build output — never
// leave this Mac. Development notes (docs/, the internal README, editor settings) stay private.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..'), target = path.join(root, 'release/public-source')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
if (git('status', '--porcelain').trim()) { console.error('Commit or stash local changes first: the public source must match a commit.'); process.exit(1) }
// infrastructure/ holds service deployment and administration tooling; the app build needs only the public web
// configuration it imports (src/main/auth/production.ts).
const excluded = [/^docs\//, /^\.claude\//, /^README\.md$/, /^release\//, /^infrastructure\/(?!firebase-public\.json$)/]
const forbidden = [/(^|\/)\.env/, /(^|\/)\.private\//, /\.(p8|p12|pem|key|mobileprovision)$/i, /service-account/i, /apiKeys\.json$/i, /recaptchaKeys\.json$/i]
const files = git('ls-files', '-z').split('\0').filter(Boolean).filter(file => !excluded.some(rule => rule.test(file)))
const refused = files.filter(file => forbidden.some(rule => rule.test(file)))
if (refused.length) { console.error(`Refusing to publish: ${refused.join(', ')}`); process.exit(1) }
const secretText = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bghp_[A-Za-z0-9]{30,}/, /"type":\s*"service_account"/, /\bxox[bap]-[A-Za-z0-9-]{10,}/]
fs.mkdirSync(target, { recursive: true })
for (const entry of fs.readdirSync(target)) if (entry !== '.git') fs.rmSync(path.join(target, entry), { recursive: true, force: true })
let bytes = 0
for (const file of files) {
  const source = path.join(root, file), destination = path.join(target, file)
  const content = fs.readFileSync(source)
  if (content.length < 5 * 1024 * 1024 && secretText.some(rule => rule.test(content.toString('utf8')))) { console.error(`Refusing to publish ${file}: it looks like it holds a secret.`); process.exit(1) }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, content, { mode: fs.statSync(source).mode })
  bytes += content.length
}
fs.copyFileSync(path.join(root, 'release/public-README.md'), path.join(target, 'README.md'))
console.log(`Exported ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) from ${git('rev-parse', '--short', 'HEAD').trim()} for version ${require('../package.json').version} into release/public-source.`)
