// Channel documents are observed while a channel surface is on screen (the
// channels folder or an open channel) and the window is visible.
const holders = new Map<string, number>()
const sent = new Map<string, boolean>()
const releases = new Map<string, ReturnType<typeof setTimeout>>()
// Switching from the channels tab to a chat and back within this time keeps the channel list read, so its rows and
// photos stay instead of being read again (Telegram keeps loaded peers while other sections are shown).
const releaseDelay = 30000

function sync(accountUid: string, immediate = false): void {
  const visible = !document.hidden && (holders.get(accountUid) ?? 0) > 0
  const pending = releases.get(accountUid)
  if (pending) { clearTimeout(pending); releases.delete(accountUid) }
  if (sent.get(accountUid) === visible) return
  if (!visible && !immediate && !document.hidden) {
    releases.set(accountUid, setTimeout(() => { releases.delete(accountUid); sync(accountUid, true) }, releaseDelay))
    return
  }
  sent.set(accountUid, visible)
  void window.morse.setChannelsVisible(accountUid, visible).catch(() => { sent.delete(accountUid) })
}

document.addEventListener('visibilitychange', () => { for (const accountUid of sent.keys()) sync(accountUid) })

export function retainChannels(accountUid: string): () => void {
  holders.set(accountUid, (holders.get(accountUid) ?? 0) + 1)
  sync(accountUid)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (holders.get(accountUid) ?? 1) - 1
    if (count > 0) holders.set(accountUid, count); else holders.delete(accountUid)
    sync(accountUid)
  }
}
