// F5 (2026-10-12): a press on a file, a video or a link sometimes did nothing until it was pressed again. This watches
// the window's own presses, passively, and when one is followed within three seconds by a press on the same kind of
// element that did what the first did not, it tells main (tap-check.log, this device only) which step the first was
// lost at: the button went down, came up, became a click, reached the window, was not cancelled, and whether the
// element pressed was still the one released (a list drawn again between them takes the click away). Only element kinds
// (tag, class, role), times and outcomes — no words, names or ids.
interface Tap { at: number; node: Element | null; kind: string; screen: string; down: boolean; up: boolean; click: boolean
  sameTarget: boolean; downGone: boolean; bubbled: boolean; prevented: boolean; focused: boolean; hidden: boolean; changed: boolean | null }

const interactive = 'button, a, input, textarea, select, label, [role=button], [role=menuitem], [role=tab], [role=option], [role=link]'
export function elementKind(element: Element | null): string {
  if (!element) return '-'
  const role = element.getAttribute('role')
  const classes = [...element.classList].slice(0, 2).join('.')
  return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${role ? `[${role}]` : ''}`.replace(/[^\w.[\]-]/g, '').slice(0, 60)
}
// What a press is expected to change: a layer, a dialog, a menu or a side pane appearing or going.
export function screenShape(root: ParentNode = document): string {
  return ['.layer', '[role=dialog]', '[role=menu]', '.side-panel', '.column-third', '.history-scroll', '.intro-step'].map(selector => root.querySelectorAll(selector).length).join(',')
}
export function lostDetail(tap: Tap): string {
  const step = !tap.up ? 'no-up' : !tap.click ? (tap.downGone ? 'no-click:redrawn' : !tap.sameTarget ? 'no-click:moved' : 'no-click') : tap.prevented ? 'prevented' : !tap.bubbled ? 'stopped' : 'no-effect'
  return `step=${step} kind=${tap.kind} down=${+tap.down} up=${+tap.up} click=${+tap.click} same=${+tap.sameTarget} gone=${+tap.downGone} bubbled=${+tap.bubbled} prevented=${+tap.prevented} focused=${+tap.focused} hidden=${+tap.hidden}`
}

export function installTapRecorder(report: (lost: { at: number; detail: string }) => void, win: Window = window): () => void {
  const recent: Tap[] = []
  let current: Tap | null = null
  const target = (event: Event): Element | null => (event.target instanceof Element ? event.target.closest(interactive) : null)
  const down = (event: MouseEvent): void => {
    if (event.button !== 0) return
    const node = target(event)
    if (!node) { current = null; return }
    current = { at: Date.now(), node, kind: elementKind(node), screen: screenShape(win.document), down: true, up: false, click: false, sameTarget: false,
      downGone: false, bubbled: false, prevented: false, focused: win.document.hasFocus(), hidden: win.document.hidden, changed: null }
    const tap = current
    win.setTimeout(() => settle(tap), 1000)
  }
  const up = (event: MouseEvent): void => {
    if (!current || current.up || event.button !== 0) return
    current.up = true; current.sameTarget = target(event) === current.node; current.downGone = !current.node?.isConnected
  }
  const clickCapture = (): void => { if (current && current.up) current.click = true }
  const clickBubble = (event: MouseEvent): void => { if (current && current.click) { current.bubbled = true; current.prevented = event.defaultPrevented } }
  function settle(tap: Tap): void {
    tap.changed = screenShape(win.document) !== tap.screen
    tap.node = tap.node?.isConnected ? tap.node : null
    const first = [...recent].reverse().find(previous => previous !== tap && previous.kind === tap.kind && previous.changed === false && tap.at - previous.at <= 3000)
    if (first && tap.changed) { report({ at: first.at, detail: lostDetail(first) }); first.changed = null }
    recent.push(tap)
    if (recent.length > 8) recent.splice(0, recent.length - 8)
  }
  win.addEventListener('mousedown', down, true)
  win.addEventListener('mouseup', up, true)
  win.addEventListener('click', clickCapture, true)
  win.addEventListener('click', clickBubble, false)
  return () => {
    win.removeEventListener('mousedown', down, true); win.removeEventListener('mouseup', up, true)
    win.removeEventListener('click', clickCapture, true); win.removeEventListener('click', clickBubble, false)
  }
}
