// F-ST-004 A (contracts/F-ST-004-problem-report.md §2 · §6): what ended the app or broke a window, kept on this device
// only — the stack's frames and the error's class, never its message — under one masking function that every app uses
// with the same table. Nothing here is sent: the «문제 보고» box (B) shows a report before anything leaves, and sends it
// only after the person agrees. No native dumps: a dump can hold message text from memory (§2-3).
import { app } from 'electron'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

// Within one report the same value always becomes the same number (§6 rows 1–4): people u1…, rooms c1…, messages m1….
export interface MaskNumbers { people: Map<string, string>; rooms: Map<string, string>; messages: Map<string, string> }
export function maskNumbers(): MaskNumbers { return { people: new Map(), rooms: new Map(), messages: new Map() } }
export interface MaskKnown { uids?: readonly string[]; rooms?: readonly string[] }

const numbered = /^[ucm]\d+$/
const number = (map: Map<string, string>, prefix: string, value: string): string => {
  if (numbered.test(value)) return value
  let label = map.get(value)
  if (!label) { label = `${prefix}${map.size + 1}`; map.set(value, label) }
  return label
}
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Contract §6 «맞춤» (the three apps' one list, iOS f283724a): whose value becomes a person, a room or a message number,
// and whose value is masked outright. Written as `key=value` or as JSON `"key":"value"`.
export const personKeys = ['uid', 'userId', 'senderId', 'recipientUid', 'ownerId', 'actorUid', 'peerId', 'partnerId', 'accountUid', 'viewerUid', 'targetUid', 'memberUid'] as const
export const roomKeys = ['chatId', 'roomId', 'inquiryId', 'channelId', 'groupId'] as const
export const messageKeys = ['messageId', 'reactedMessageId', 'storyId', 'postId'] as const
export const secretKeys = ['token', 'fcmToken', 'apnsToken', 'idToken', 'refreshToken', 'accessToken', 'appCheckToken', 'authToken', 'apiKey', 'secret', 'password', 'inviteCode', 'backupCode'] as const
const keyed = (keys: readonly string[]): RegExp => new RegExp(`(?<![\\w])(${keys.join('|')})(=|"\\s*:\\s*")([^\\s&,;"')}\\]]+)`, 'g')
const personKey = keyed(personKeys), roomKey = keyed(roomKeys), messageKey = keyed(messageKeys)
const secretKey = new RegExp(`(?<![\\w])(${secretKeys.join('|')}|[A-Za-z]*Token)(=|"\\s*:\\s*")(?!\\[가림\\])([^\\s&,;"')}\\]]+)`, 'g')

// §6, in the table's order where it matters: tokens before ids (a token can look like an id), paths before people
// (a home folder name is not an uid), exception messages last (after the frames that must stay are known).
export function maskReportText(text: string, numbers: MaskNumbers = maskNumbers(), known: MaskKnown = {}): string {
  let out = text
  // 5 — tokens: a JWT anywhere, «Bearer …», and any key ending in token.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, '[토큰]')
  out = out.replace(/\bBearer\s+(?!\[가림\])\S+/g, 'Bearer [가림]')
  out = out.replace(secretKey, (_all, key: string, sep: string) => `${key}${sep}[가림]`)
  // 6 — mail.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[메일]')
  // 9 · 10 — paths: the person's home folder becomes «~», an iOS app container «<app>».
  out = out.replace(/\/var\/mobile\/Containers\/Data\/Application\/[0-9A-Fa-f-]{8,}(?=\/|\b)/g, '<app>')
  out = out.replace(/\/Users\/[^/\s:]+(?=\/|\b)/g, '~')
  out = out.replace(/\/home\/[^/\s:]+(?=\/|\b)/g, '~')
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s:]+(?=\\|\b)/g, '~')
  // 8 — IP: IPv4, and IPv6 written with «::» or as eight groups (so «14:45:02» or «main.js:42:7» are left alone).
  out = out.replace(/(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\d.])/g, '[IP]')
  out = out.replace(/(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*)?(?![\w:])/g, '[IP]')
  out = out.replace(/(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?![\w:])/g, '[IP]')
  // 7 — phone: an international number, or a local one written in groups.
  out = out.replace(/\+\d{1,3}[\s-]?\d{1,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g, '[전화]')
  out = out.replace(/(?<![\w.:-])0\d{1,2}[\s-]\d{3,4}[\s-]\d{4}(?![\w.:-])/g, '[전화]')
  // 13 — long hex (32 characters or more: hashes, keys — contract §6 «맞춤», as Android).
  out = out.replace(/\b[0-9A-Fa-f]{32,}\b/g, '[가림]')
  // 1 · 3 — people, rooms and messages named by their key (the contract's lists).
  out = out.replace(personKey, (_all, key: string, sep: string, value: string) => `${key}${sep}${number(numbers.people, 'u', value)}`)
  out = out.replace(roomKey, (_all, key: string, sep: string, value: string) => `${key}${sep}${number(numbers.rooms, 'c', value)}`)
  out = out.replace(messageKey, (_all, key: string, sep: string, value: string) => `${key}${sep}${number(numbers.messages, 'm', value)}`)
  // 4 — what the app knows as its own uid and its rooms, wherever it appears bare.
  for (const room of known.rooms ?? []) if (room && !numbered.test(room)) out = out.replace(new RegExp(`(?<![\\w-])${escape(room)}(?![\\w-])`, 'g'), () => number(numbers.rooms, 'c', room))
  for (const uid of known.uids ?? []) if (uid && !numbered.test(uid)) out = out.replace(new RegExp(`(?<![\\w-])${escape(uid)}(?![\\w-])`, 'g'), () => number(numbers.people, 'u', uid))
  // 1 · 2 — people: a Firebase uid is 28 letters and digits; «uid=» or bare, the same value keeps its number.
  out = out.replace(/(?<![\w-])[A-Za-z0-9]{28}(?![\w-])/g, value => /[A-Za-z]/.test(value) && /\d/.test(value) ? number(numbers.people, 'u', value) : value)
  // 11 — an exception's message goes; its class stays (frames below it are untouched: 12).
  out = out.split('\n').map(line => {
    const match = /^(\s*(?:Uncaught\s+)?(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Exception|Error))(?::\s.*)?$/.exec(line)
    return match ? match[1]! : line
  }).join('\n')
  return out
}

// One recorded problem: what kind, its class, and only the stack's frame lines (§2-1).
export interface ProblemEntry { at: string; version: string; kind: string; name: string; frames: string[] }
export function stackFrames(stack: string | undefined, limit = 30): string[] {
  if (!stack) return []
  return stack.split('\n').map(line => line.trim()).filter(line => /^at\s/.test(line)).slice(0, limit)
}

// §2-1: 1 MB, 7 days, 10 reports, in the app's own data folder.
export const problemLimits = { bytes: 1024 * 1024, ageMs: 7 * 24 * 60 * 60 * 1000, count: 10 }
const folder = (): string => join(app.getPath('userData'), 'problem-reports')
let tail: Promise<unknown> = Promise.resolve()
const seen = new Set<string>()
// At most this many a run, so a loop of the same failing code cannot grow the set or the disk without end (review 11-05).
export const problemsPerRun = 50
let recorded = 0

export function recordProblem(kind: string, error: { name?: unknown; stack?: unknown } | null | undefined, known: MaskKnown = {}): void {
  const name = typeof error?.name === 'string' && /^[A-Za-z_$][\w$.]{0,80}$/.test(error.name) ? error.name : 'Error'
  const frames = stackFrames(typeof error?.stack === 'string' ? error.stack : undefined)
  // A window error with no frames (a resource that failed to load, a rejection that is not an Error) says nothing a
  // report could use: it is not kept. A window that went away has no frames and is kept.
  if (kind === 'renderer-error' && !frames.length) return
  const key = `${kind}|${name}|${frames.slice(0, 3).join('|')}`
  if (seen.has(key) || recorded >= problemsPerRun) return
  seen.add(key); recorded++
  const numbers = maskNumbers()
  const entry: ProblemEntry = { at: new Date().toISOString(), version: app.getVersion(), kind: kind.replace(/[^\w-]/g, '').slice(0, 40), name,
    frames: frames.map(frame => maskReportText(frame, numbers, known)) }
  tail = tail.then(async () => {
    try {
      const directory = folder()
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(join(directory, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(entry), { mode: 0o600 })
      await pruneProblems(directory)
    } catch { /* Recording is best effort. */ }
  })
}

// Oldest go first: past 7 days, past 10 reports, past 1 MB in all.
export async function pruneProblems(directory = folder(), now = Date.now()): Promise<void> {
  const names = (await readdir(directory).catch(() => [] as string[])).filter(name => name.endsWith('.json'))
  const files = (await Promise.all(names.map(async name => {
    const info = await stat(join(directory, name)).catch(() => null)
    return info ? { name, size: info.size, at: info.mtimeMs } : null
  }))).filter((file): file is { name: string; size: number; at: number } => file !== null).sort((a, b) => b.at - a.at)
  let total = 0
  for (const [index, file] of files.entries()) {
    total += file.size
    if (index >= problemLimits.count || now - file.at > problemLimits.ageMs || total > problemLimits.bytes) await rm(join(directory, file.name), { force: true })
  }
}

// What is kept now (the B box reads this): each report, read back as written.
export async function readProblems(directory = folder()): Promise<ProblemEntry[]> {
  await pruneProblems(directory)
  const names = (await readdir(directory).catch(() => [] as string[])).filter(name => name.endsWith('.json')).sort()
  const entries: ProblemEntry[] = []
  for (const name of names) {
    try { entries.push(JSON.parse(await readFile(join(directory, name), 'utf8')) as ProblemEntry) } catch { /* A broken file is skipped. */ }
  }
  return entries
}
export function problemsWritten(): Promise<void> { return tail.then(() => {}, () => {}) }
// Test only: start a run's count again.
export function resetProblemRun(): void { seen.clear(); recorded = 0 }
export function problemsThisRun(): number { return recorded }

// 0.241.36–0.241.52 started crashReporter, which left native dumps in the app's crash folder (Crashpad: completed,
// pending, new). A dump can hold message text from memory (§2-3), so they go once at start. Only that folder (by its
// name) and only Crashpad's dump files are touched; the number removed is all that is told.
export async function clearOldDumps(directory: string): Promise<number> {
  if (!/^(crashpad|crashdumps)$/i.test(basename(directory))) return 0
  let removed = 0
  for (const sub of ['', 'completed', 'pending', 'new']) {
    const place = join(directory, sub)
    const names = await readdir(place).catch(() => [] as string[])
    for (const name of names) {
      if (!/\.(dmp|meta)$/i.test(name)) continue
      await rm(join(place, name), { force: true }).then(() => { removed++ }, () => {})
    }
  }
  return removed
}

// ── F-ST-004 B (contract §7-2): the file the «문제 보고» box shows and sends — one function, so what is seen is what is
// sent, byte for byte.
export const reportBytesLimit = 262_144
export const reportsPerDay = 3
export interface ReportHeader { app: 'desktop'; version: string; device: string; os: string; created: Date; account: string | null }
export interface BuiltReport { name: string; text: string; included: number; leftOut: number }
const stamp = (date: Date): string => date.toISOString().replace(/[-:]/g, '').replace(/T(\d{4}).*$/, '-$1')
export function buildProblemReport(header: ReportHeader, entries: readonly ProblemEntry[]): BuiltReport {
  const oldestFirst = [...entries].sort((a, b) => a.at.localeCompare(b.at))
  const head = (count: number): string => ['Morse problem report', `app: ${header.app}`, `version: ${header.version}`, `device: ${header.device}`, `os: ${header.os}`,
    `created: ${header.created.toISOString().replace(/\.\d{3}Z$/, 'Z')}`, ...(header.account ? [`account: ${header.account}`] : []), `reports: ${count}`].join('\n')
  const bodyOf = (list: readonly ProblemEntry[], leftOut: number): string => {
    const numbers = maskNumbers()
    const blocks = list.map((entry, index) => [`--- ${index + 1} ---`, `at: ${entry.at}`, `kind: ${entry.kind}`, `version: ${entry.version}`, `name: ${entry.name}`, ...entry.frames].join('\n'))
    // Masked again when sent (§2-2); only the account line, which the person turned on, stays outside.
    const body = maskReportText(blocks.join('\n'), numbers)
    return leftOut ? `${body}\n(older reports left out: ${leftOut})` : body
  }
  let start = 0, text = ''
  for (;;) {
    const list = oldestFirst.slice(start)
    text = `${head(list.length)}\n\n${bodyOf(list, start)}\n`
    if (Buffer.byteLength(text, 'utf8') <= reportBytesLimit || !list.length) break
    start++
  }
  return { name: `morse-problem-report-${header.app}-${header.version}-${stamp(header.created)}.txt`, text, included: oldestFirst.length - start, leftOut: start }
}

// Three a day, counted on this device by the local day (§7-1 5): only the times of sends are kept.
export function sentToday(times: readonly number[], now = Date.now()): number {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0)
  return times.filter(time => time >= midnight.getTime() && time <= now).length
}
const sentFile = (): string => join(folder(), 'sent.json')
export async function readSentTimes(): Promise<number[]> {
  try {
    const value = JSON.parse(await readFile(sentFile(), 'utf8')) as unknown
    return Array.isArray(value) ? value.filter((time): time is number => typeof time === 'number' && Number.isFinite(time)) : []
  } catch { return [] }
}
export async function noteSent(now = Date.now()): Promise<void> {
  const keep = (await readSentTimes()).filter(time => now - time < 2 * 24 * 60 * 60 * 1000)
  await mkdir(folder(), { recursive: true, mode: 0o700 })
  await writeFile(sentFile(), JSON.stringify([...keep, now]), { mode: 0o600 })
}
// The file the send attaches, written where only this app reads; older ones go.
export async function writeOutgoingReport(report: BuiltReport): Promise<string> {
  const directory = join(folder(), 'outgoing')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (const name of await readdir(directory).catch(() => [] as string[])) await rm(join(directory, name), { force: true })
  const path = join(directory, report.name)
  await writeFile(path, report.text, { mode: 0o600 })
  return path
}
// device: the model identifier, never the computer's name (§7-2) — macOS `hw.model`, Windows the BIOS product name.
export async function deviceModel(run: (command: string, args: string[]) => Promise<string>): Promise<string> {
  try {
    if (process.platform === 'darwin') return (await run('/usr/sbin/sysctl', ['-n', 'hw.model'])).trim().slice(0, 60) || 'unknown'
    if (process.platform === 'win32') {
      const out = await run('reg', ['query', 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS', '/v', 'SystemProductName'])
      return /SystemProductName\s+REG_SZ\s+(.+)/.exec(out)?.[1]?.trim().slice(0, 60) || 'unknown'
    }
  } catch { /* unknown below */ }
  return 'unknown'
}
