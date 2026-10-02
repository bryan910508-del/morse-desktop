// MTProto never hands a broken connection to the feature that asked. A request the connection never
// carried is put back and sent again once the link is there (SessionPrivate::resend / resendAll), and
// its connect timeout grows from a second to eight (kMinConnectedTimeout 1000, kMaxConnectedTimeout
// 8000) instead of failing once. undici gives up after a single 10 second connect timeout and says
// only «fetch failed», which is how one moment of a bad link became a story that would not upload.
// Only a failure that proves the request never left is sent again; anything the server may have seen
// is not repeated.
const neverSent = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ENOTFOUND', 'EAI_AGAIN'])
const delays = [1000, 2000, 4000]

// A failure's short name for connection-check.log: the errno or failure code it carries, else its class. Never its
// text, which can hold an address or an account's data.
export function causeCode(error: unknown): string {
  const cause = error instanceof Error && error.cause && typeof error.cause === 'object' ? (error.cause as { code?: unknown }).code : undefined
  if (typeof cause === 'string' && /^[\w:.-]{1,40}$/.test(cause)) return cause
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (typeof code === 'string' && /^[\w:.-]{1,40}$/.test(code)) return code
  return error instanceof Error ? error.name.slice(0, 40) : typeof error
}
export function unsentReason(error: unknown): string {
  const cause = error instanceof Error ? error.cause : null
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined
  return typeof code === 'string' && neverSent.has(code) ? code : ''
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); done() }, milliseconds)
    const stop = (): void => { clearTimeout(timer); fail(new Error('Resend cancelled')) }
    signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
  })
}

export async function sendAgain(signal: AbortSignal, send: () => Promise<Response>, note: (code: string, attempt: number) => void = () => {}): Promise<Response> {
  for (let tries = 0; ; tries++) {
    try { return await send() }
    catch (error) {
      const code = unsentReason(error)
      if (!code || tries >= delays.length || signal.aborted) throw error
      note(code, tries + 1)
      await wait(delays[tries]!, signal)
    }
  }
}
