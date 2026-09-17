import { useState } from 'react'
import { Copy } from 'lucide-react'
import { copyText } from '../app/clipboard'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// The recovery code is shown once; the box closes only when the user confirms it is kept.
export function BackupCodeBox({ code, userId, notice, close }: { code: string; userId?: string; notice?: string | null; close(): void }) {
  const [copied, setCopied] = useState(false)
  return <Box title={tr('복구 코드')} width={420} buttons={<button className="button flat" data-autofocus onClick={close}>{tr('저장했어요, 시작하기')}</button>}>
    <p className="box-note">{tr('이 코드를 안전한 곳에 저장하세요. 분실 시 다른 기기에서 계정을 복구할 수 있어요.')}</p>
    <div className="backup-code-card">
      <code className="selectable">{code}</code>
      <button className="button secondary" onClick={() => setCopied(copyText(code))}><Copy size={16} />{copied ? tr('복사됨') : tr('복사')}</button>
    </div>
    {userId && <p className="box-note">Morse ID @{userId}</p>}
    <p className="box-error">{tr('이 코드를 잃어버리면 계정을 복구할 수 없어요. 반드시 안전한 곳에 저장하세요.')}</p>
    {notice && <p className="box-note">{notice}</p>}
  </Box>
}
