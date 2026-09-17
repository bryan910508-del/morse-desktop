// Telegram Desktop's build.sh sends the finished setup .dmg to the notary service and staples the ticket
// to the disk image as well as to the app, so a downloaded image passes Gatekeeper before it is opened.
// An unsigned image keeps its stapled ticket where `syspolicy_check distribution` does not find it
// ("Notary Ticket Missing"), so the image is signed with the release identity first, as Apple's
// notarization workflow for disk images describes.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const release = require('../electron-builder.release.cjs')

const profile = process.env.APPLE_KEYCHAIN_PROFILE
const image = path.resolve(__dirname, '..', 'dist', release.dmg.artifactName.replace('${ext}', 'dmg'))
if (!profile) throw new Error('APPLE_KEYCHAIN_PROFILE is not set; notarytool needs a stored keychain profile')
if (!fs.existsSync(image)) throw new Error(`${path.basename(image)} was not built`)
const run = (...args) => execFileSync('xcrun', args, { stdio: 'inherit' })
run('codesign', '--force', '--timestamp', '--sign', release.mac.identity, image)
run('notarytool', 'submit', image, '--keychain-profile', profile, '--wait')
run('stapler', 'staple', image)
run('stapler', 'validate', image)
execFileSync('syspolicy_check', ['distribution', image], { stdio: 'inherit' })
