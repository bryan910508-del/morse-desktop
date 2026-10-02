// Channel documents are observed while a channel surface is on screen (the
// channels folder or an open channel) and the window is visible.
const holders = new Map<string, number>()
type Reading = 'shown' | 'resting' | 'released'
const sent = new Map<string, Reading>()
const releases = new Map<string, ReturnType<typeof setTimeout>>()
// Switching from the channels tab to a chat and back within this time keeps the channel list read, so its rows and
// photos stay instead of being read again (Telegram keeps loaded peers while other sections are shown).
const releaseDelay = 30000

// A channel surface in a hidden window rests: its reads stop and what they showed stays, and they carry on when the
// window is seen again (Telegram Desktop keeps a channel's posts and replies while its window is hidden). A surface
// that was left is released.
function sync(accountUid: string, immediate = false): void {
  const reading: Reading = (holders.get(accountUid) ?? 0) === 0 ? 'released' : document.hidden ? 'resting' : 'shown'
  const pending = releases.get(accountUid)
  if (pending) { clearTimeout(pending); releases.delete(accountUid) }
  if (sent.get(accountUid) === reading) return
  if (reading === 'released' && !immediate && !document.hidden) {
    releases.set(accountUid, setTimeout(() => { releases.delete(accountUid); sync(accountUid, true) }, releaseDelay))
    return
  }
  sent.set(accountUid, reading)
  void window.morse.setChannelsVisible(accountUid, reading === 'shown', reading === 'resting').catch(() => { sent.delete(accountUid) })
}

// Every account with a channel surface open is told, not only those told before: one whose last word was refused (the
// main process was not ready for it) would otherwise never hear of the window again, and its open channel kept loading.
document.addEventListener('visibilitychange', () => { for (const accountUid of new Set([...holders.keys(), ...sent.keys()])) sync(accountUid) })

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
