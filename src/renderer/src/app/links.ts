import { classifyLink, suspiciousLink } from '../../../shared/text-links'
import { showChannelDiscoveryBox } from '../channels/channel-discovery-box'
import { showInviteBox } from '../boxes/invite-box'
import { confirmBox, informBox } from '../ui/layers'
import { showSettingsBox } from '../settings/settings-box'
import { errorText } from './format'
import { controller } from './ui'
import { tr } from '../../../shared/i18n'

// A link pressed in a message or a story. Morse's own addresses open inside the app like the iOS router (an invite, a
// channel preview, a profile); anything else goes to the browser, and a lookalike domain is confirmed first as Telegram does.
export async function openLink(accountUid: string, url: string): Promise<void> {
  const target = classifyLink(url)
  if (target.kind === 'invite') return showInviteBox(accountUid, target.url)
  if (target.kind === 'channel') return showChannelDiscoveryBox(accountUid, target.url)
  if (target.kind === 'profile') return openProfileLink(accountUid, target.morseId)
  if (suspiciousLink(url) && !await confirmBox({ title: tr('링크 열기'), text: tr('이 링크를 열까요?\n{0}', [encodedForDisplay(url)]), confirm: tr('열기') })) return
  try { await window.morse.openMessageLink(url) }
  catch (reason) { controller.toast(errorText(reason, tr('링크를 열지 못했습니다.')), 'error') }
}

// N-49 (iOS openProfileLink, tdesktop resolveUsername → showPeerInfo): the person's profile beside what is open, this
// account's own ID its profile settings, and an ID nobody has (or a private account) says so (MakeInformBox). One
// lookup at a time for the same ID, however often the link is pressed.
let resolving: string | null = null
async function openProfileLink(accountUid: string, morseId: string): Promise<void> {
  if (resolving === morseId) return
  resolving = morseId
  try {
    const found = await window.morse.resolveProfileLink(accountUid, morseId)
    if (!found) informBox({ text: tr("'{0}' 사용자를 찾을 수 없어요", [morseId]) })
    else if (found.uid === accountUid) showSettingsBox(accountUid, 'profile')
    else controller.openPersonInfo(found.uid, found.displayName)
  } catch (reason) { controller.toast(errorText(reason, tr('프로필을 열지 못했습니다.')), 'error') }
  finally { if (resolving === morseId) resolving = null }
}

// UrlClickHandler::ShowEncoded: the confirmation shows the punycode form, so the imitation is visible.
function encodedForDisplay(url: string): string {
  try { return new URL(url).href } catch { return url }
}
