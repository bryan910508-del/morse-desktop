// Windows check only (windows-check.yml, B348d): a bare Electron notification-area icon, the way desktop-shell.ts makes
// it, whose tooltip and picture the workflow changes one at a time and reads back through UI Automation. It answers on
// 127.0.0.1:47900: /tip?text=… calls setToolTip, /image calls setImage, /quit ends it. No window, no account.
const { app, Tray, nativeImage } = require('electron')
const http = require('node:http')
const { join } = require('node:path')

app.on('window-all-closed', event => event.preventDefault())
app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(join(__dirname, '..', 'resources', 'brand', 'morse.png')).resize({ width: 32, height: 32, quality: 'best' })
  const tray = new Tray(icon)
  tray.setToolTip('Probe')
  http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/tip') tray.setToolTip(url.searchParams.get('text') ?? '')
    else if (url.pathname === '/image') tray.setImage(icon)
    else if (url.pathname === '/quit') { response.end('bye'); tray.destroy(); app.quit(); return }
    response.end('ok')
  }).listen(47900, '127.0.0.1', () => console.log('tray probe ready'))
})
