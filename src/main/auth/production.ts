import { app } from 'electron'
import { join } from 'node:path'
import configuration from '../../../infrastructure/firebase-public.json'
import { ProofTokenStore } from './proof-token-store'
import type { DesktopAuthConfiguration } from './contracts'
import { HostedWebAppProof } from './web-app-proof'

// Operator-provisioned, public build-time configuration. Never accepts a
// renderer-supplied endpoint, key, mobile App ID, or debug-provider token.
export function productionAuthentication(): DesktopAuthConfiguration | null {
  const platform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : null
  if (!platform) return null
  const appId = configuration.apps[platform].appId
  return { projectId: 'talky-a38c3', projectNumber: '123713400904', appId,
    platform, apiKey: configuration.authApiKey,
    proof: new HostedWebAppProof(configuration.origin, appId, platform, new ProofTokenStore(join(app.getPath('userData'), 'credentials'))) }
}
