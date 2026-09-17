// Links inside message text, found the way Telegram Desktop finds them (lib_ui text_entity.cpp ParseEntities,
// url and email entities only: Morse has no mentions, hashtags or bot commands) and classified the way the iOS
// app routes them (MorseDeepLinkParsing, InviteLinkService.parseToken).

export interface TextLink { start: number; end: number; kind: 'url' | 'email'; text: string }

// lib_base qthelp_url.cpp ExpressionDomain / ExpressionDomainExplicit. Qt runs them with Unicode properties, so
// \w and \d there are the Unicode classes written out here.
const word = String.raw`\p{L}\p{N}\p{Mn}\p{Pc}`
const label = String.raw`[A-Za-zА-ЯЁа-яё0-9\-_]+\.`
const top = String.raw`[A-Za-zрф\-\p{Nd}]{2,22}`
const domain = new RegExp(String.raw`(?<![${word}\$\-_%=\.])(?:([a-zA-Z]+):\/\/)?((?:${label}){1,10}(${top})(:\p{Nd}+)?)`, 'gu')
const explicitDomain = new RegExp(String.raw`(?<![${word}\$\-_%=\.])(?:([a-zA-Z]+):\/\/)((?:${label}){0,10}(${top})(:\p{Nd}+)?)`, 'gu')
const mailNameAtEnd = /[a-zA-Z\-_.0-9]{1,256}$/

// text_entity.cpp CreateValidProtocols, without tg:// which Morse does not own.
const validProtocols = new Set(['itmss', 'http', 'https', 'ftp'])
const validTopDomains = new Set([
  'ac', 'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'an', 'ao', 'aq', 'ar', 'as', 'at', 'au', 'aw', 'ax', 'az', 'ba',
  'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bm', 'bn', 'bo', 'br', 'bs', 'bt', 'bv', 'bw', 'by', 'bz', 'ca',
  'cc', 'cd', 'cf', 'cg', 'ch', 'ci', 'ck', 'cl', 'cm', 'cn', 'co', 'cr', 'cu', 'cv', 'cx', 'cy', 'cz', 'de', 'dj',
  'dk', 'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'eh', 'er', 'es', 'et', 'eu', 'fi', 'fj', 'fk', 'fm', 'fo', 'fr', 'ga',
  'gd', 'ge', 'gf', 'gg', 'gh', 'gi', 'gl', 'gm', 'gn', 'gp', 'gq', 'gr', 'gs', 'gt', 'gu', 'gw', 'gy', 'hk', 'hm',
  'hn', 'hr', 'ht', 'hu', 'id', 'ie', 'il', 'im', 'in', 'io', 'iq', 'ir', 'is', 'it', 'je', 'jm', 'jo', 'jp', 'ke',
  'kg', 'kh', 'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'ls', 'lt', 'lu',
  'lv', 'ly', 'ma', 'mc', 'md', 'me', 'mg', 'mh', 'mk', 'ml', 'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu',
  'mv', 'mw', 'mx', 'my', 'mz', 'na', 'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa',
  'pe', 'pf', 'pg', 'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'py', 'qa', 're', 'ro', 'ru', 'rs', 'rw',
  'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss', 'st', 'su', 'sv',
  'sx', 'sy', 'sz', 'tc', 'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl', 'tm', 'tn', 'to', 'tp', 'tr', 'tt', 'tv', 'tw',
  'tz', 'ua', 'ug', 'uk', 'um', 'us', 'uy', 'uz', 'va', 'vc', 've', 'vg', 'vi', 'vn', 'vu', 'wf', 'ws', 'ye', 'yt',
  'yu', 'za', 'zm', 'zw', 'arpa', 'aero', 'asia', 'biz', 'cat', 'com', 'coop', 'info', 'int', 'jobs', 'mobi', 'museum',
  'name', 'net', 'org', 'post', 'pro', 'tel', 'travel', 'xxx', 'edu', 'gov', 'mil', 'local', 'xn--lgbbat1ad8j',
  'xn--54b7fta0cc', 'xn--fiqs8s', 'xn--fiqz9s', 'xn--wgbh1c', 'xn--node', 'xn--j6w193g', 'xn--h2brj9c',
  'xn--mgbbh1a71e', 'xn--fpcrj9c3d', 'xn--gecrj9c', 'xn--s9brj9c', 'xn--xkc2dl3a5ee0h', 'xn--45brj9c',
  'xn--mgba3a4f16a', 'xn--mgbayh7gpa', 'xn--80ao21a', 'xn--mgbx4cd0ab', 'xn--l1acc', 'xn--mgbc0a9azcg', 'xn--mgb9awbf',
  'xn--mgbai9azgqp6j', 'xn--ygbi2ammx', 'xn--wgbl6a', 'xn--p1ai', 'xn--mgberp4a5d4ar', 'xn--90a3ac', 'xn--yfro4i67o',
  'xn--clchc0ea0b2g2a9gcd', 'xn--3e0b707e', 'xn--fzc2c9e2c', 'xn--xkc2al3hye2a', 'xn--mgbtf8fl', 'xn--kprw13d',
  'xn--kpry57d', 'xn--o3cw4h', 'xn--pgbs0dh', 'xn--j1amh', 'xn--mgbaam7a8h', 'xn--mgb2ddes', 'xn--ogbpf8fl', 'рф'
])

// ui/text/text.cpp IsBad, IsSpace, IsNewline, IsLinkEnd, IsAlmostLinkEnd.
function isBad(code: number): boolean {
  return code === 0 || (code >= 8232 && code < 8237) || (code >= 65024 && code < 65040 && code !== 65039) || (code >= 127 && code < 160 && code !== 156) || code === 6158
}
function isLinkEnd(code: number): boolean {
  return isBad(code) || /\s/.test(String.fromCharCode(code)) || code < 32 || code === 0x2029 || code === 0x2028 || code === 0xFFFC || code === 156 ||
    (code >= 0xD800 && code <= 0xDFFF)
}
function isAlmostLinkEnd(code: number): boolean {
  return code === 63 || code === 44 || code === 46 || code === 34 || code === 58 || code === 33 || code === 39
}
const opening: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' }

function matchAt(expression: RegExp, text: string, from: number): RegExpExecArray | null {
  expression.lastIndex = from
  return expression.exec(text)
}

export function findTextLinks(text: string): TextLink[] {
  const result: TextLink[] = []
  const length = text.length
  let offset = 0, matchOffset = 0
  while (offset < length) {
    const plain = matchAt(domain, text, matchOffset), explicit = matchAt(explicitDomain, text, matchOffset)
    if (!plain && !explicit) break
    const found = explicit && (!plain || explicit.index < plain.index) ? explicit : plain!
    const domainStart = found.index, domainEnd = found.index + found[0].length
    const protocol = (found[1] ?? '').toLowerCase(), topDomain = (found[3] ?? '').toLowerCase()
    const protocolValid = !protocol || validProtocols.has(protocol), topDomainValid = Boolean(protocol) || validTopDomains.has(topDomain)
    let kind: TextLink['kind'] = 'url', start = 0, end = 0
    if (!protocol && domainStart > offset + 1 && text[domainStart - 1] === '@') {
      const name = mailNameAtEnd.exec(text.slice(offset, domainStart - 1))
      if (name) { kind = 'email'; start = Math.max(offset, offset + name.index); end = domainEnd }
    }
    if (kind === 'url') {
      if (!protocolValid || !topDomainValid) { matchOffset = domainEnd; continue }
      start = domainStart
      const parentheses: number[] = []
      let p = domainEnd
      for (; p < length; ++p) {
        let code = text.charCodeAt(p)
        if (isLinkEnd(code)) break
        if (isAlmostLinkEnd(code)) {
          let test = p + 1
          while (test < length && isAlmostLinkEnd(text.charCodeAt(test))) ++test
          if (test >= length || isLinkEnd(text.charCodeAt(test))) break
          p = test
          code = text.charCodeAt(p)
        }
        const ch = String.fromCharCode(code)
        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') parentheses.push(p)
        else if (opening[ch]) {
          const open = parentheses.pop()
          if (open === undefined) break
          if (text[open] !== opening[ch]) { p = open; break }
        }
      }
      if (p > domainEnd && text[domainEnd] !== '/' && text[domainEnd] !== '?') { matchOffset = domainEnd; continue }
      end = p
    }
    result.push({ start, end, kind, text: text.slice(start, end) })
    offset = matchOffset = end
  }
  return result
}

// basic_click_handlers.cpp UrlClickHandler::EncodeForOpening: a link written without a protocol opens as https.
export function linkTarget(link: TextLink): string {
  if (link.kind === 'email') return `mailto:${link.text}`
  return /^[a-zA-Z]+:/.test(link.text) ? link.text : `https://${link.text}`
}

// UrlClickHandler::IsSuspicious: a domain with characters outside plain Latin letters, digits, dots and dashes may
// imitate another site, so Telegram asks before opening it.
export function suspiciousLink(url: string): boolean {
  const first = /^((https?|s?ftp):\/\/)?([^/#:?]+)([/#:?]|$)/i.exec(url)
  if (!first) return false
  const second = /^(.*)\.[a-zA-Z]+$/.exec(first[3]!)
  return second ? /[^a-zA-Z0-9.-]/.test(second[1]!) : false
}

export const morseWebHost = 'talky-a38c3.web.app'

export type MorseLink =
  | { kind: 'channel'; url: string; channelId: string }
  | { kind: 'invite'; url: string }
  | { kind: 'external'; url: string }

// MorseMessengerApp.handleUniversalLink: /i/{token} accepts an invite, /channel/{id} opens the channel inside the
// app, and every other web address (profile links under /u/ included) opens in the browser.
export function classifyLink(url: string): MorseLink {
  let parsed: URL
  try { parsed = new URL(url) } catch { return { kind: 'external', url } }
  const parts = parsed.pathname.split('/').filter(Boolean)
  const morse = (parsed.protocol === 'https:' && parsed.hostname === morseWebHost) || parsed.protocol === 'talky:'
  if (morse && parsed.protocol === 'https:' && parts[0] === 'i' && parts[1]?.length === 16) return { kind: 'invite', url }
  if (morse && parsed.protocol === 'https:' && parts[0] === 'channel' && parts[1] && parts[1] !== 'post') return { kind: 'channel', url, channelId: parts[1] }
  if (parsed.protocol === 'talky:' && parsed.hostname === 'channel' && parts[0]) return { kind: 'channel', url, channelId: parts[0] }
  return { kind: 'external', url }
}

// Morse's own address schemes on the desktop, as Telegram Desktop opens tg:// links: morse:// and iOS's talky://
// (MorseDeepLinkParsing) open a channel — …//channel/{id}, or …//channel/{id}/post/{postId} — or an invite
// …//i/{token}, the same way their web addresses open inside the app.
export function schemeLinkTarget(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if ((url.protocol !== 'morse:' && url.protocol !== 'talky:') || url.username || url.password || url.port || url.search || url.hash) return null
  const parts = [url.hostname, ...url.pathname.split('/')].filter(Boolean), id = /^[A-Za-z0-9_-]{1,160}$/
  if (parts[0] === 'channel' && parts[1] && parts[1] !== 'post' && id.test(parts[1])) {
    if (parts.length === 2) return `https://${morseWebHost}/channel/${parts[1]}`
    if (parts.length === 4 && parts[2] === 'post' && id.test(parts[3]!)) return `https://${morseWebHost}/channel/${parts[1]}/post/${parts[3]}`
    return null
  }
  if (parts[0] === 'i' && parts.length === 2 && /^[A-Za-z0-9_-]{16}$/.test(parts[1]!)) return `https://${morseWebHost}/i/${parts[1]}`
  return null
}

export interface ChannelShareCard { channelId: string; channelName: string; url: string; bodyText: string }

// MorseDeepLinkParsing.parseChannelSharePreview: "📢 [name] …" followed by the channel's web address becomes a
// card, and the bubble keeps only the words before the address.
export function channelShareCard(text: string): ChannelShareCard | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('📢')) return null
  const prefix = `https://${morseWebHost}/channel/`
  const at = trimmed.toLowerCase().indexOf(prefix)
  if (at < 0) return null
  const rest = trimmed.slice(at), stop = rest.search(/\s/)
  const url = stop < 0 ? rest : rest.slice(0, stop)
  const target = classifyLink(url)
  if (target.kind !== 'channel') return null
  const heading = trimmed.slice(0, at).trim()
  const open = heading.indexOf('['), close = open < 0 ? -1 : heading.indexOf(']', open + 1)
  if (open < 0 || close < 0) return null
  const channelName = heading.slice(open + 1, close).trim()
  return channelName ? { channelId: target.channelId, channelName, url, bodyText: heading } : null
}
