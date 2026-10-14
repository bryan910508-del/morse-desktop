import { captureProblem, repeatedProblem, type CaptureMedia } from '../../../shared/capture-problem'
import { desktop } from './store'
import { errorText } from './format'

// What a recorder that could not start says (capture-problem.ts): a device's failure in words of what to check, any
// other error as before; the same words again within a second are not shown a second time (undefined).
let last: { text: string; at: number } | null = null
export function captureMessage(reason: unknown, media: CaptureMedia, fallback: string): string | undefined {
  const text = captureProblem(reason, media, desktop.value?.platform ?? '') ?? errorText(reason, fallback)
  const now = Date.now()
  if (repeatedProblem(last, text, now)) return undefined
  last = { text, at: now }
  return text
}
