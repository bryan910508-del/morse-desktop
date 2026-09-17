import { classifyLink, suspiciousLink } from '../../../shared/text-links'
import { showChannelDiscoveryBox } from '../channels/channel-discovery-box'
import { showInviteBox } from '../boxes/invite-box'
import { confirmBox } from '../ui/layers'
import { errorText } from './format'
import { controller } from './ui'
import { tr } from '../../../shared/i18n'

// A link pressed in a message. Morse's own addresses open inside the app like the iOS router (an invite, a channel
// preview); anything else goes to the browser, and a lookalike domain is confirmed first as Telegram does.
export async function openLink(accountUid: string, url: string): Promise<void> {
  const target = classifyLink(url)
  if (target.kind === 'invite') return showInviteBox(accountUid, target.url)
  if (target.kind === 'channel') return showChannelDiscoveryBox(accountUid, target.url)
  if (suspiciousLink(url) && !await confirmBox({ title: tr('링크 열기'), text: tr('이 링크를 열까요?\n{0}', [encodedForDisplay(url)]), confirm: tr('열기') })) return
  try { await window.morse.openMessageLink(url) }
  catch (reason) { controller.toast(errorText(reason, tr('링크를 열지 못했습니다.')), 'error') }
}

// UrlClickHandler::ShowEncoded: the confirmation shows the punycode form, so the imitation is visible.
function encodedForDisplay(url: string): string {
  try { return new URL(url).href } catch { return url }
}
