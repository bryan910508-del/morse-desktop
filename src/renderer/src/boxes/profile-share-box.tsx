// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { useMemo } from 'react'
import { Copy, Link as LinkIcon } from 'lucide-react'
import { qrcodegen } from '../../../../vendor/qrcodegen/qrcodegen'
import { morseWebHost } from '../../../shared/text-links'
import { copyText } from '../app/clipboard'
import { controller } from '../app/ui'
import { Avatar } from '../ui/avatar'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// iOS ProfileShareSheet: the profile's web address (https://…/u/{userId}) as a QR code and a link to copy. The code is
// drawn with the QR generator Telegram Desktop's lib_qr uses, at the medium error correction CIQRCodeGenerator uses.
export function profileShareURL(userId: string): string { return `https://${morseWebHost}/u/${encodeURIComponent(userId)}` }

// The code's dark modules as one SVG path, with a two-module quiet zone. A13 · 08 §3.2: the sign-in code is drawn at
// quartile error correction with the logo over its middle, as tdesktop's intro_qr.cpp:82,178-183 draws it.
export type QrLevel = 'MEDIUM' | 'QUARTILE'
export function qrPath(text: string, level: QrLevel = 'MEDIUM'): { d: string; modules: number; size: number } {
  const code = qrcodegen.QrCode.encodeText(text, level === 'QUARTILE' ? qrcodegen.QrCode.Ecc.QUARTILE : qrcodegen.QrCode.Ecc.MEDIUM)
  let d = ''
  for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) if (code.getModule(x, y)) d += `M${x + 2},${y + 2}h1v1h-1z`
  return { d, modules: code.size + 4, size: code.size }
}
export function QrCode({ text, size, level = 'MEDIUM', logo }: { text: string; size: number; level?: QrLevel; logo?: string }) {
  const path = useMemo(() => qrPath(text, level), [text, level])
  // The logo covers about a fifth of the side, well inside what quartile correction restores.
  const mark = Math.round(path.size * 0.2), at = (path.modules - mark) / 2
  return <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${path.modules} ${path.modules}`} shapeRendering="crispEdges" role="img" aria-label={tr('QR 코드')}>
    <rect width={path.modules} height={path.modules} fill="#fff" /><path d={path.d} fill="#000" />
    {logo && <><rect x={at - 0.5} y={at - 0.5} width={mark + 1} height={mark + 1} rx={1} fill="#fff" /><image href={logo} x={at} y={at} width={mark} height={mark} /></>}
  </svg>
}

function ProfileShareBox({ name, userId, photo, close }: { name: string; userId: string; photo: string | null; close(): void }) {
  const url = profileShareURL(userId)
  return <Box title={tr('내 프로필 공유')} width={380} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <div className="profile-share">
      <Avatar name={name || 'M'} url={photo} size={88} />
      <strong>{name}</strong><span>@{userId}</span>
      <div className="profile-share-qr"><QrCode text={url} size={220} /><small>{tr('QR 코드로 친구를 빠르게 추가하세요')}</small></div>
      <div className="profile-share-link"><LinkIcon size={16} /><span className="ellipsis selectable">{url}</span>
        <button type="button" className="icon-button small" aria-label={tr('링크 복사')} onClick={() => controller.toast(copyText(url) ? tr('복사 완료') : tr('복사하지 못했습니다.'))}><Copy size={16} /></button>
      </div>
    </div>
  </Box>
}

export function showProfileShareBox(name: string, userId: string, photo: string | null): void {
  controller.showLayer(close => <ProfileShareBox name={name} userId={userId} photo={photo} close={close} />)
}
