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

export function QrCode({ text, size }: { text: string; size: number }) {
  const path = useMemo(() => {
    const code = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM)
    let d = ''
    for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) if (code.getModule(x, y)) d += `M${x + 2},${y + 2}h1v1h-1z`
    return { d, modules: code.size + 4 }
  }, [text])
  return <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${path.modules} ${path.modules}`} shapeRendering="crispEdges" role="img" aria-label={tr('QR 코드')}>
    <rect width={path.modules} height={path.modules} fill="#fff" /><path d={path.d} fill="#000" />
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
