// Release packaging (npm run release:mac / release:win). Development builds keep package.json's "build" settings:
// an unpacked, Apple Development signed app for this Mac only.
//
// macOS: one universal app for Apple silicon and Intel, as Telegram Desktop ships, signed with the Developer ID
// Application certificate and notarized by Apple (APPLE_KEYCHAIN_PROFILE names the notarytool credentials saved
// with `xcrun notarytool store-credentials`), as a DMG to install and a ZIP for the updater.
// Windows: an x64 NSIS installer for one user, no administrator rights, choosing the folder like Telegram's setup.
// Both publish to the GitHub repository in src/shared/app-release.ts, which also carries the source (GPLv3 §6).
const base = require('./package.json').build
const releaseOwner = 'bryan910508-del', releaseRepository = 'morse-desktop'

module.exports = {
  ...base,
  artifactName: 'Morse-${version}-${os}-${arch}.${ext}',
  publish: [{ provider: 'github', owner: releaseOwner, repo: releaseRepository, releaseType: 'release' }],
  // Electron's security checklist (docs/tutorial/fuses.md), set in the released binary before it is signed: the signed
  // Morse cannot be run as plain Node (ELECTRON_RUN_AS_NODE), take NODE_OPTIONS or NODE_EXTRA_CA_CERTS, or open an
  // inspector (--inspect, SIGUSR1), so nothing else borrows its microphone, camera or Keychain trust; it starts only
  // from app.asar and only when app.asar matches the hash in Info.plist (Windows: the executable's resources); file://
  // gets no more than a browser gives it (the window loads morse://); cookies on disk are encrypted with the Keychain
  // key. Cookie encryption is one-way: turning it off again leaves the stored cookies unreadable. Development builds
  // (package.json "build") keep the defaults, so the local test tools can still use the inspector.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
    enableCookieEncryption: true
  },
  mac: {
    ...base.mac,
    identity: 'Developer ID Application',
    hardenedRuntime: true,
    notarize: true,
    minimumSystemVersion: '13.0',
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],
    // The helpers and the lzfse addon are already universal, and better-sqlite3 carries a prebuilt addon for each
    // architecture and loads the matching one, so both halves carry the same files.
    x64ArchFiles: 'Contents/Resources/app.asar.unpacked/{resources/native/*,node_modules/better-sqlite3-multiple-ciphers/prebuilds/**}'
  },
  // Unversioned installer names keep the site's links (releases/latest/download/…) valid for every release.
  dmg: { artifactName: 'Morse-mac-universal.${ext}', writeUpdateInfo: false },
  win: { ...base.win, target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    artifactName: 'Morse-Setup-x64.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'Morse'
  }
}
