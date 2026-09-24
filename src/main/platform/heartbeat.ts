import { recordConnectionStep } from './connection-diagnostics'

// A socket that is dropped for «ping timeout» while the network is fine can mean the process itself
// stopped running — macOS suspends a background app, and its timers with it. A second's tick that
// arrives late says how long this process was away, which is the difference between the two.
const tick = 1000
const late = 5000
export function watchForStalls(): () => void {
  let last = Date.now()
  const timer = setInterval(() => {
    const now = Date.now(), gap = now - last
    last = now
    if (gap >= late) recordConnectionStep('stall', `${Math.round(gap / 1000)}s`)
  }, tick)
  timer.unref?.()
  return () => clearInterval(timer)
}
