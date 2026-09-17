import { useEffect } from 'react'
import { dialogById, useDesktop } from './store'
import { useUi } from './ui'

// iOS ChannelSecureScreen (Channel.requiresContentProtection: every channel that is not public) and
// ChannelDiscussionProtection, applied the way tdesktop's Core::ScreenshotProtection does: while such a
// channel, its comments or its discussion group is on screen, the whole window is left out of screenshots
// and screen recordings. A channel not yet known to be public counts as protected, as a failed read does on iOS.
export function useContentProtection(): void {
  const chatId = useUi(state => state.chatId)
  const channelId = useUi(state => state.channelId)
  const enabled = useDesktop(snapshot => {
    if (!snapshot || snapshot.appLock?.locked) return false
    if (chatId) return dialogById(snapshot, chatId)?.contentProtected === true
    if (channelId) return snapshot.channels?.items.find(channel => channel.id === channelId)?.type !== 'public'
    return false
  })
  useEffect(() => { void window.morse.setContentProtection(enabled).catch(() => {}) }, [enabled])
}
