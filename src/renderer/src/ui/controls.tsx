import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { composingKey } from '../../../shared/shortcuts'
import { tr } from '../../../shared/i18n'

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="progressbar" aria-label={tr('처리 중')} />
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange(value: boolean): void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />
}

export function RoundCheck({ checked }: { checked: boolean }) {
  return <span className={`round-check${checked ? ' checked' : ''}`} aria-hidden="true">{checked && <Check size={13} strokeWidth={3} />}</span>
}

export function TextField({ label, value, onChange, maxLength, placeholder, multiline, rows, autoFocus, disabled, invalid, counter, onSubmit, type = 'text' }: {
  label?: string; value: string; onChange(value: string): void; maxLength?: number; placeholder?: string; multiline?: boolean; rows?: number
  autoFocus?: boolean; disabled?: boolean; invalid?: boolean; counter?: boolean; onSubmit?(): void; type?: 'text' | 'password'
}) {
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!autoFocus) return
    const element = input.current
    element?.focus()
    if (element) element.setSelectionRange(element.value.length, element.value.length)
  }, [autoFocus])
  const keydown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (!onSubmit || event.key !== 'Enter' || composingKey(event.nativeEvent) || (multiline && !(event.metaKey || event.ctrlKey))) return
    event.preventDefault(); onSubmit()
  }
  const common = { ref: input, value, maxLength, placeholder, disabled, 'aria-label': label ?? placeholder, onKeyDown: keydown }
  return <label className={`field${invalid ? ' invalid' : ''}`}>
    {label && <span>{label}</span>}
    {multiline ? <textarea {...common} rows={rows ?? 4} onChange={event => onChange(event.target.value)} />
      : <input {...common} type={type} spellCheck={false} onChange={event => onChange(event.target.value)} />}
    {counter && maxLength !== undefined && <small className="counter">{[...value].length} / {maxLength}</small>}
  </label>
}

export function ListButton({ icon, label, detail, danger, onClick, disabled, trailing }: { icon?: ReactNode; label: string; detail?: string; danger?: boolean; onClick?(): void; disabled?: boolean; trailing?: ReactNode }) {
  return <button type="button" className={`list-button${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}>
    {icon && <span className="list-button-icon">{icon}</span>}
    <span className="list-button-text"><span className="ellipsis">{label}</span>{detail && <small className="ellipsis">{detail}</small>}</span>
    {trailing}
  </button>
}
