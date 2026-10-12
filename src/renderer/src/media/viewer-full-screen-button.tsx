import { Maximize2, Minimize2 } from 'lucide-react'
import { tr } from '../../../shared/i18n'

// B301: the viewer's own «full screen», beside its close button (useViewerWindow keeps the choice).
export function ViewerFullScreenButton({ fullScreen, onToggle }: { fullScreen: boolean; onToggle(): void }) {
  const label = fullScreen ? tr('전체 화면 끝내기') : tr('전체 화면')
  return <button className="media-viewer-button" aria-label={label} title={label} aria-pressed={fullScreen} onClick={onToggle}>
    {fullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
  </button>
}
