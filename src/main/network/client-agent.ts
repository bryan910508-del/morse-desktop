// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { app } from 'electron'

// 0.241.36: which Desktop asks. tdesktop names its app version, system and device on every connection it makes
// (initConnection app_version·system_version·device_model, mtproto/session_private.cpp:675-702), so the server can
// tell versions apart. Desktop already names its version on the socket (socket-transport.ts register) and in its
// device session (firebase-rest.ts); its callables, Storage requests and Firestore calls went out as Node's own
// «node», and the server could not count them by version. One text names the version, the system and the CPU — no
// account, device or person.
export function clientAgentText(version: string, platform: string, arch: string): string {
  return `Morse-Desktop/${version} (${platform}; ${arch})`
}
let agent: string | null = null
export function clientAgent(): string {
  agent ??= clientAgentText(app.getVersion(), process.platform, process.arch)
  return agent
}

// fetch with that text as the request's User-Agent (a User-Agent the caller set is kept). Every request to the
// project's servers goes through here; test/unit/client-agent.test.ts finds any that does not.
export function morseFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const given = init.headers
  if (given instanceof Headers || Array.isArray(given)) {
    const headers = new Headers(given)
    if (!headers.has('user-agent')) headers.set('user-agent', clientAgent())
    return globalThis.fetch(input, { ...init, headers })
  }
  const headers: Record<string, string> = { ...(given as Record<string, string> | undefined) }
  if (!Object.keys(headers).some(key => key.toLowerCase() === 'user-agent')) headers['User-Agent'] = clientAgent()
  return globalThis.fetch(input, { ...init, headers })
}
