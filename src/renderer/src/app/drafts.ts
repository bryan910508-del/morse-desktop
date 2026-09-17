// Editors save continuously (Telegram local drafts). On quit, main asks the
// renderer to flush the last keystrokes before the account worker closes.
export const draftFlushers = new Set<() => Promise<void>>()
const writes = new Set<Promise<unknown>>()

export function trackWrite<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(() => undefined, () => undefined)
  writes.add(settled)
  void settled.finally(() => writes.delete(settled))
  return promise
}

export async function flushDrafts(): Promise<void> {
  await Promise.all([...draftFlushers].map(flush => flush()))
  await Promise.all([...writes])
}
