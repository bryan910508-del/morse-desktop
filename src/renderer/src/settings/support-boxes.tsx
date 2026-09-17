import { useState } from 'react'
import { ChevronDown, ChevronRight, Lock, Megaphone, MessageCircle, ShieldCheck, UserRoundX, Users } from 'lucide-react'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Box } from '../ui/layers'
import { Spinner } from '../ui/controls'
import { tr } from '../../../shared/i18n'

// iOS SupportCenterView: frequently asked questions, a chat with Morse's support account, and the app's details.
const faq = [
  { q: tr('Morse는 어떻게 익명인가요?'), a: tr('전화번호, 이메일, 실명 등 어떤 개인정보도 받지 않아요. 사용자 ID 하나만 정해주면 가입이 끝나요. 복구 코드 한 줄로 다른 기기에서도 계정을 복구할 수 있어요.') },
  { q: tr('시크릿 채팅은 정말 안전한가요?'), a: tr('시크릿 채팅은 Curve25519 키 교환 + AES-GCM 256비트로 종단간 암호화돼요. 개인키는 본인 디바이스에만 저장되며, 운영자도 메시지를 복호화할 수 없어요. 화면 녹화도 자동으로 검은 오버레이로 가려져요.') },
  { q: tr('복구 코드를 잃어버렸어요'), a: tr('현재 로그인 중인 기기에서 설정 → 복구 코드 → 새 코드 생성으로 새로 발급받을 수 있어요. 기존 코드는 자동으로 폐기돼요. 모든 기기에서 로그아웃됐다면 계정 복구가 어려울 수 있어요.') },
  { q: tr('계정 여러 개를 사용하려면?'), a: tr('설정 → 계정 → 계정 추가에서 새 계정을 만들 수 있어요. 무료 사용자는 2개, Morse+ 사용자는 4개까지 가능해요. 설정 화면을 두 번 탭하면 빠르게 전환할 수 있어요.') },
  { q: tr('메시지가 도착하지 않아요'), a: tr('1) 알림 설정이 켜져 있는지 확인 2) 인터넷 연결 확인 3) 앱을 종료 후 재시작. 그래도 안 되면 설정 → 고객 센터에서 채팅으로 문의해 주세요.') },
  { q: tr('광고나 트래킹은 정말 없나요?'), a: tr('네. 광고 SDK, 행동 분석, 데이터 판매, 제3자 트래킹 모두 0이에요. Firebase Analytics도 비활성화했고, App Tracking Transparency 권한도 요청하지 않아요.') },
  { q: tr('신고 처리는 얼마나 걸리나요?'), a: tr('긴급 신고(아동 안전, 폭력 위협)는 1시간 이내, 심각(성적 콘텐츠, 혐오)은 24시간, 일반(스팸, 괴롭힘)은 72시간 이내에 처리해요. 자세한 내용은 커뮤니티 가이드라인을 참고해주세요.') }
]
// iOS AppGuideView (MorseFeature): the features Morse is built around, each with its details.
const features = [
  { icon: UserRoundX, title: tr('익명 가입'), summary: tr('전화번호도, 이메일도 필요 없어요'), detailTitle: tr('진짜 익명 메신저'), detailBody: tr('Morse는 어떤 개인정보도 수집하지 않아요. 사용자 ID 하나만 정해주면 가입이 끝납니다. 복구 코드 한 줄로 다른 기기에서 계정을 복구할 수 있어요.'), bullets: [tr('전화번호 인증 없음'), tr('이메일 인증 없음'), tr('디바이스 연락처 접근 안 함'), tr('사용자 ID 임의 생성'), tr('복구 코드로 계정 복구')] },
  { icon: Lock, title: tr('시크릿 채팅'), summary: tr('Curve25519 + AES-GCM 종단간 암호화'), detailTitle: tr('진짜 종단간 암호화'), detailBody: tr('시크릿 채팅은 Curve25519 키 교환 + AES-GCM 256비트로 보호돼요. 개인키는 본인 디바이스에만 저장되고, 운영자도 메시지를 복호화할 수 없어요.'), bullets: [tr('Curve25519 키 교환'), tr('AES-GCM 256비트 암호화'), tr('개인키는 디바이스 내에만'), tr('화면 녹화·미러링 감지 시 내용 가림 (스크린샷 차단은 보장되지 않음)'), tr('화면 녹화 시 검은 오버레이')] },
  { icon: Megaphone, title: tr('채널'), summary: tr('관심사로 익명 연결'), detailTitle: tr('공감대로 모이는 채널'), detailBody: tr('관심사가 같은 사람들과 익명 채널로 연결돼요. 이름이나 신원 없이도 깊이 있는 대화가 가능해요.'), bullets: [tr('익명 구독 / 게시 / 댓글'), tr('공개 채널은 누구나 발견'), tr('구독자 수만 표시 (정체 X)'), tr('알림 끄기 / 음소거')] },
  { icon: Users, title: tr('멀티 계정'), summary: tr('한 디바이스에서 여러 계정 전환'), detailTitle: tr('여러 자아, 한 앱에서'), detailBody: tr('공적인 나, 사적인 나 — 상황에 맞게 분리할 수 있어요. 설정 화면을 두 번 탭하면 빠르게 전환돼요.'), bullets: [tr('무료: 계정 2개'), tr('Morse+: 계정 4개'), tr('설정 더블탭으로 즉시 전환'), tr('알림 탭 시 해당 계정으로 전환'), tr('계정 간 데이터 완전 분리')] },
  { icon: ShieldCheck, title: tr('광고 0, 트래킹 0'), summary: tr('당신의 데이터를 팔지 않아요'), detailTitle: tr('진짜 프라이버시'), detailBody: tr('다른 메신저들과 다르게, Morse는 광고 SDK도 없고, 행동 분석도 안 하고, 데이터를 팔지도 않아요. App Tracking Transparency 권한도 요청하지 않습니다.'), bullets: [tr('광고 SDK 없음'), tr('사용자 행동 분석 없음'), tr('데이터 판매 없음'), tr('제3자 트래킹 없음'), tr('Firebase Analytics 비활성화')] }
]

function SupportBox({ accountUid, version, close }: { accountUid: string; version: string; close(): void }) {
  const [open, setOpen] = useState<number | null>(null), [busy, setBusy] = useState(false)
  async function chat(): Promise<void> {
    if (busy) return
    setBusy(true)
    try { const chatId = await window.morse.openSupportChat(accountUid); close(); controller.closeAllLayers(); controller.openChat(chatId) }
    catch (reason) { controller.toast(errorText(reason, tr('채팅을 열 수 없어요. 네트워크를 확인하거나 잠시 후 다시 시도해 주세요.')), 'error') }
    finally { setBusy(false) }
  }
  return <Box title={tr('고객 센터')} width={440} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <div className="settings-hero"><strong>{tr('도움이 필요하신가요?')}</strong><span>{tr('자주 묻는 질문을 먼저 확인해 보세요.\n해결되지 않으면 앱 안에서 고객 센터와 채팅으로 문의할 수 있어요.')}</span></div>
    <div className="section-label">{tr('자주 묻는 질문')}</div>
    <div className="faq-list">{faq.map((item, index) => <div key={index} className="faq-item">
      <button type="button" className="faq-question" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}><span>{item.q}</span>{open === index ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
      {open === index && <p className="faq-answer">{item.a}</p>}
    </div>)}</div>
    <div className="section-label">{tr('문의하기')}</div>
    <button type="button" className="support-chat" disabled={busy} onClick={() => { void chat() }}>
      <span className="shared-media-icon">{busy ? <Spinner size={18} /> : <MessageCircle size={20} />}</span>
      <span className="shared-media-text"><strong>{tr('채팅으로 문의하기')}</strong><small>{tr('버그·기능 제안도 같은 대화에 남겨 주세요. 이메일 주소는 표시되지 않아요.')}</small></span>
    </button>
    <div className="section-label">{tr('앱 정보')}</div>
    <div className="support-info"><span>{tr('버전')}</span><span>{version}</span></div>
    <div className="support-info"><span>{tr('디바이스')}</span><span>Mac</span></div>
    <p className="box-note">{tr('평균 응답 시간: 영업일 기준 24시간 이내')}<br />{tr('긴급 신고는 1시간 이내 처리')}</p>
  </Box>
}

function GuideBox({ close }: { close(): void }) {
  const [detail, setDetail] = useState<number | null>(null)
  const feature = detail === null ? null : features[detail]!
  return <Box title={feature ? feature.title : tr('기능 소개')} width={440} onClose={close} buttons={<>
    {feature && <button className="button flat" onClick={() => setDetail(null)}>{tr('뒤로')}</button>}
    <button className="button flat" onClick={close}>{tr('닫기')}</button>
  </>}>
    {feature ? <>
      <div className="settings-hero"><feature.icon size={36} /><strong>{feature.detailTitle}</strong><span>{feature.detailBody}</span></div>
      <ul className="guide-bullets">{feature.bullets.map(item => <li key={item}>{item}</li>)}</ul>
    </> : <>
      <div className="settings-hero"><strong>{tr('Morse의 모든 기능')}</strong><span>{tr('이름 없이도, 흔적 없이도\n자유롭게 대화할 수 있어요')}</span></div>
      {features.map((item, index) => <button key={item.title} type="button" className="support-chat" onClick={() => setDetail(index)}>
        <span className="shared-media-icon"><item.icon size={20} /></span>
        <span className="shared-media-text"><strong>{item.title}</strong><small>{item.summary}</small></span>
        <ChevronRight size={16} className="guide-chevron" />
      </button>)}
      <p className="box-note guide-tagline">{tr('"공적인 것에서 해방된 메신저"')}<br />{'Morse'}</p>
    </>}
  </Box>
}

export function showSupportBox(accountUid: string, version: string): void {
  controller.showLayer(close => <SupportBox accountUid={accountUid} version={version} close={close} />)
}
export function showGuideBox(): void {
  controller.showLayer(close => <GuideBox close={close} />)
}
// SettingsView.openPolicyURL: https://talky-a38c3.web.app/{privacy|community}/{language}.
export function openPolicy(path: 'privacy' | 'community'): void {
  void window.morse.openMessageLink(`https://talky-a38c3.web.app/${path}/ko`).catch(reason => controller.toast(errorText(reason, tr('페이지를 열지 못했습니다.')), 'error'))
}
