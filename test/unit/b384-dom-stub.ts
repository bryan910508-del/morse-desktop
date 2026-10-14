// The renderer modules a row view imports reach `document` and `window` as they load; a test that only draws markup gives
// them inert stand-ins (imported before the view, b384-emoji-pending.test.ts).
const inert = (): void => {}
const stub: Record<string, unknown> = { addEventListener: inert, removeEventListener: inert, visibilityState: 'visible', hasFocus: () => true,
  documentElement: { style: {}, dataset: {}, classList: { add: inert, remove: inert, toggle: inert } }, createElement: () => ({ style: {}, getContext: () => null }) }
const g = globalThis as Record<string, unknown>
g.document ??= stub
g.window ??= Object.assign(g, { addEventListener: inert, removeEventListener: inert, matchMedia: () => ({ matches: false, addEventListener: inert, removeEventListener: inert }),
  morse: new Proxy({}, { get: () => () => Promise.resolve(null) }) })
g.localStorage ??= { getItem: () => null, setItem: inert, removeItem: inert }
g.requestAnimationFrame ??= (callback: () => void) => setTimeout(callback, 0)
