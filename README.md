# Morse Desktop

Morse Messenger for macOS and Windows.

- **Download:** https://talky-a38c3.web.app/download/
- **Releases:** https://github.com/bryan910508-del/morse-desktop/releases

## Build

Requirements: Node.js 22.12 or later. macOS builds need Xcode (Swift helpers); Windows builds need Visual Studio
Build Tools with "Desktop development with C++" and Python 3.

```
npm ci
npm run build
npx electron-builder --config electron-builder.release.cjs --mac --publish never   # on macOS
npx electron-builder --config electron-builder.release.cjs --win --publish never   # on Windows
```

A release signs the Mac app with a Developer ID Application certificate and notarizes it
(`APPLE_KEYCHAIN_PROFILE`). Account features need the Morse service; the Firebase web configuration in
`infrastructure/firebase-public.json` is the same public configuration any web client of the service carries.

## License

GNU General Public License v3.0 or later — see `LICENSE`, `LEGAL` and `resources/THIRD_PARTY_NOTICES.txt`.
Parts of the structure and code are derived from Telegram Desktop (GPLv3).
