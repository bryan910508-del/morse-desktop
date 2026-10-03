import { useEffect } from 'react'
import { QrCode } from '../boxes/profile-share-box'
import { Spinner } from '../ui/controls'
import type { AuthenticationSnapshot } from '../../../shared/auth'
import { tr } from '../../../shared/i18n'

// A13 · 08 §3.5 (Telegram's first sign-in step, tdesktop intro/intro_qr.cpp): «scan with your phone» above the
// recovery code. The code runs while this screen is in front and stops when it is hidden or left (intro_qr.cpp:537-559);
// back in front, a new one is asked for. The server switch off shows nothing at all (D-6).
export function QrSignInPanel({ auth }: { auth: AuthenticationSnapshot }) {
  useEffect(() => {
    const start = (): void => { if (document.visibilityState === 'visible') void window.morse.authentication.startQrSignIn().catch(() => {}) }
    const changed = (): void => {
      if (document.visibilityState === 'visible') start()
      else void window.morse.authentication.stopQrSignIn().catch(() => {})
    }
    start()
    document.addEventListener('visibilitychange', changed)
    return () => { document.removeEventListener('visibilitychange', changed); void window.morse.authentication.stopQrSignIn().catch(() => {}) }
  }, [])
  if (auth.qrOff) return null
  const qr = auth.qr
  return <section className="intro-qr" aria-label={tr('휴대폰으로 스캔해 로그인')}>
    <strong className="intro-qr-title">{tr('휴대폰으로 스캔해 로그인')}</strong>
    {qr?.state === 'password-needed'
      ? <div className="intro-qr-password" role="status">
        {/* §24 checks the two-step password; until then this computer says it is needed. */}
        <p>{tr('이 계정은 2단계 인증 비밀번호가 필요해요.')}</p>
        {qr.hint && <p className="intro-note">{tr('힌트: {0}', [qr.hint])}</p>}
        <p className="intro-note">{tr('이 버전에서는 아직 비밀번호를 넣을 수 없어요. 복구 코드로 연결해 주세요.')}</p>
      </div>
      : <div className="intro-qr-code">
        {qr?.state === 'code' && qr.link
          ? <QrCode text={qr.link} size={200} level="QUARTILE" logo="/morse.png" />
          : qr ? <Spinner size={22} />
            : <button className="button secondary" type="button" onClick={() => { void window.morse.authentication.startQrSignIn().catch(() => {}) }}>{tr('QR 코드 받기')}</button>}
      </div>}
    <ol className="intro-qr-steps">
      {/* The path as Android writes it (DesktopLinkSteps.kt:27); Telegram Desktop writes «Settings > Devices > Link Desktop Device». */}
      <li>{tr('휴대폰에서 Morse 를 엽니다')}</li>
      <li>{tr('«설정 › 개인 계정 및 보안 › 활성 세션 › 데스크톱 연결»로 갑니다')}</li>
      <li>{tr('이 코드를 스캔합니다')}</li>
    </ol>
    <p className="intro-note">{tr('이 코드를 다른 사람에게 보내거나 보여주지 마세요.')}</p>
  </section>
}
