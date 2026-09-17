import { ipcRenderer } from 'electron'

// The remote verification page receives no Electron API or account data. This
// one-way adapter forwards only a bounded App Check result from its own frame.
const origin = 'https://morse-desktop-auth.web.app'
if (window.top === window && location.origin === origin && location.pathname === '/verify.html') {
  const requestId = new URLSearchParams(location.hash.slice(1)).get('requestId')
  let completed = false
  window.addEventListener('message', event => {
    if (completed || event.source !== window || event.origin !== origin || !event.data || typeof event.data !== 'object') return
    const data = event.data as Record<string, unknown>
    if (data.requestId !== requestId || data.channel !== 'morse-app-proof') return
    if (data.kind === 'error') {
      completed = true
      ipcRenderer.send('morse:app-proof', { requestId, kind: 'error' })
    } else if (data.kind === 'token' && typeof data.token === 'string' && data.token.length <= 16384 &&
               typeof data.appId === 'string' && data.appId.length <= 128) {
      completed = true
      ipcRenderer.send('morse:app-proof', { requestId, kind: 'token', appId: data.appId, token: data.token })
    }
  })
}
