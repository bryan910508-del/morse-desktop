import { useEffect, useRef } from 'react'
import { useDesktop } from '../app/store'
import { tr } from '../../../shared/i18n'

// app_config/desktop below its minimum (main/platform/app-version-gate.ts): the whole window says this version may not
// run and offers the update the way tdesktop's «Update» box does (Core::UpdateApplication) — the updater checks at once,
// downloads, and restarts into the new version; with no updater, or one that fails, the download page. Nothing of the
// accounts is shown; their data, drafts and unsent messages stay as they are.
export function UpdateRequiredScreen() {
  const gate = useDesktop(snapshot => snapshot?.versionGate ?? null)
  const update = useDesktop(snapshot => snapshot?.appUpdate ?? null)
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || !update?.available || !['idle', 'latest', 'error'].includes(update.status)) return
    asked.current = true
    void window.morse.checkAppUpdate().catch(() => {})
  }, [update?.available, update?.status])
  const status = !update?.available ? null : update.status === 'checking' ? tr('업데이트 확인 중…')
    : update.status === 'downloading' ? tr('업데이트 내려받는 중… {0}%', [Math.round(update.progress * 100)])
    : update.status === 'ready' ? tr('새 버전 {0} 준비됨', [update.version ?? '']) : update.status === 'error' ? tr('업데이트 확인에 실패했습니다') : null
  const page = !update?.available || update.status === 'error' || update.status === 'latest'
  return <div className="lock-screen" role="dialog" aria-modal="true" aria-label={tr('업데이트 필요')}>
    <div className="lock-screen-form">
      <img src="/morse.png" alt="" className="lock-screen-logo" />
      <h1>{tr('업데이트가 필요해요')}</h1>
      <p className="lock-screen-note">{gate?.message || tr('최신 버전의 Morse로 업데이트해야 연결할 수 있습니다. 보내지 않은 메시지와 초안은 그대로 있습니다.')}</p>
      {status && <p className="lock-screen-note" role="status">{status}</p>}
      {update?.status === 'ready' && <button type="button" className="button primary lock-screen-submit" onClick={() => { void window.morse.installAppUpdate().catch(() => {}) }}>{tr('재시작해 업데이트')}</button>}
      {update?.available && page && <button type="button" className="button secondary lock-screen-submit" onClick={() => { void window.morse.checkAppUpdate().catch(() => {}) }}>{tr('업데이트 확인')}</button>}
      {page && <button type="button" className="button primary lock-screen-submit" onClick={() => { void window.morse.openUpdatePage().catch(() => {}) }}>{tr('내려받기 페이지 열기')}</button>}
      <button type="button" className="button flat" onClick={() => { void window.morse.quitApp().catch(() => {}) }}>{tr('종료')}</button>
    </div>
  </div>
}
