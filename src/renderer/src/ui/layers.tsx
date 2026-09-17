import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { controller, useUi } from '../app/ui'
import { useShortcut } from '../app/shortcuts'
import { tr } from '../../../shared/i18n'

const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

function LayerFrame({ top, dismissible, onDismiss, children }: { top: boolean; dismissible: boolean; onDismiss(): void; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = frame.current
    if (element && !element.contains(document.activeElement)) {
      const target = element.querySelector<HTMLElement>('[data-autofocus]') ?? element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)') ?? element.querySelector<HTMLElement>(focusable)
      target?.focus({ preventScroll: true })
    }
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const trap = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !frame.current) return
    const items = [...frame.current.querySelectorAll<HTMLElement>(focusable)].filter(item => item.getClientRects().length)
    if (!items.length) { event.preventDefault(); return }
    const first = items[0]!, last = items[items.length - 1]!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <div ref={frame} className="layer" inert={!top} onKeyDown={trap}
    onMouseDown={event => { if (top && dismissible && event.target === event.currentTarget) onDismiss() }}>{children}</div>
}

// Ui::LayerManager: boxes stack above the window; Esc closes the top one.
export function LayerHost() {
  const layers = useUi(state => state.layers)
  useShortcut(100, command => {
    if (!layers.length) return false
    if (command === 'back') controller.closeTopLayer()
    return true
  })
  return <>{layers.map((layer, index) => <LayerFrame key={layer.id} top={index === layers.length - 1} dismissible={layer.dismissible} onDismiss={() => controller.closeLayer(layer.id)}>
    {layer.render(() => controller.closeLayer(layer.id))}
  </LayerFrame>)}</>
}

export function Box({ title, children, buttons, width = 380, onClose, className }: { title?: ReactNode; children?: ReactNode; buttons?: ReactNode; width?: number; onClose?(): void; className?: string }) {
  return <section className={`box${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" style={{ width }}>
    {(title || onClose) && <header className="box-title">{title && <h2>{title}</h2>}{onClose && <button className="icon-button small" aria-label={tr('닫기')} onClick={onClose}><X size={18} /></button>}</header>}
    <div className="box-content">{children}</div>
    {buttons && <footer className="box-buttons">{buttons}</footer>}
  </section>
}

// Confirmation is reserved for destructive or irreversible actions.
export function confirmBox(options: { title?: string; text: string; confirm?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const settle = (value: boolean): void => { if (!settled) { settled = true; resolve(value) } }
    controller.showLayer(close => <Box title={options.title} width={360} buttons={<>
      <button className="button flat" onClick={() => { settle(false); close() }}>{options.cancel ?? tr('취소')}</button>
      <button className={`button flat${options.danger ? ' danger' : ''}`} data-autofocus onClick={() => { settle(true); close() }}>{options.confirm ?? tr('확인')}</button>
    </>}><p className="box-text">{options.text}</p></Box>, { onClose: () => settle(false) })
  })
}

export function ToastHost() {
  const toasts = useUi(state => state.toasts)
  return <div className="toasts" aria-live="polite">{toasts.map(toast => <div key={toast.id} className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
    <span>{toast.text}</span>
    {toast.action && <button onClick={() => { toast.action!.run(); controller.dismissToast(toast.id) }}>{toast.action.label}</button>}
  </div>)}</div>
}
