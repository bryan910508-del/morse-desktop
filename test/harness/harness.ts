// Renderer test harness: the real Morse renderer with a fake main-process bridge, so screens
// can be exercised in a browser without an account, a server or Electron.
import { installMockBridge } from './mock-bridge'

installMockBridge()
void import('../../src/renderer/src/main.tsx')
