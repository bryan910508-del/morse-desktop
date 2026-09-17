// A selection copy inside the user's gesture. The renderer receives no general
// clipboard permission, so the browser copy command is used on a detached field.
export function copyText(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'; field.style.opacity = '0'; field.style.pointerEvents = 'none'
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.body.append(field)
  field.select()
  let copied = false
  try { copied = document.execCommand('copy') } catch { copied = false }
  field.remove()
  previous?.focus({ preventScroll: true })
  return copied
}
