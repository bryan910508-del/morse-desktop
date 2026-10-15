import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { clientAgent, clientAgentText, morseFetch } from '../../src/main/network/client-agent'

// 0.241.36: every request Desktop makes to the project's servers names the Desktop version, as tdesktop names its
// version on every connection (mtproto/session_private.cpp:675-702) — the server could not tell Desktop versions apart.
test('the text names the version, the system and the CPU, and nothing else', () => {
  assert.equal(clientAgentText('0.241.36', 'darwin', 'arm64'), 'Morse-Desktop/0.241.36 (darwin; arm64)')
  assert.match(clientAgent(), /^Morse-Desktop\/[^\s]+ \([a-z0-9]+; [a-z0-9]+\)$/)
})

test('morseFetch sends it as the User-Agent, keeps every other header, and keeps a User-Agent already given', async () => {
  const original = globalThis.fetch, seen: Headers[] = []
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return new Response('') }) as typeof fetch
  try {
    await morseFetch('https://example.test/a', { headers: { Authorization: 'Bearer x' } })
    await morseFetch('https://example.test/b', { headers: new Headers({ 'X-Firebase-AppCheck': 'y' }) })
    await morseFetch('https://example.test/c')
    await morseFetch('https://example.test/d', { headers: { 'user-agent': 'kept' } })
    assert.deepEqual(seen.map(h => h.get('user-agent')), [clientAgent(), clientAgent(), clientAgent(), 'kept'])
    assert.equal(seen[0]!.get('authorization'), 'Bearer x')
    assert.equal(seen[1]!.get('x-firebase-appcheck'), 'y')
  } finally { globalThis.fetch = original }
})

test('no request to the project\'s servers leaves main without it', () => {
  const files = (base: string): string[] => readdirSync(base).flatMap(name => {
    const path = join(base, name)
    return statSync(path).isDirectory() ? files(path) : /\.ts$/.test(name) ? [path] : []
  })
  // Google's own sign-in token endpoint is not the project's server.
  const allowed = new Set([join('src', 'main', 'network', 'client-agent.ts'), join('src', 'main', 'auth', 'google-authorization.ts')])
  const raw = files(join('src', 'main')).filter(path => !allowed.has(path)).flatMap(path =>
    readFileSync(path, 'utf8').split('\n').flatMap((line, index) => /(^|[^A-Za-z0-9_.])fetch\(/.test(line) && !/^\s*(private\s+)?(async\s+)?fetch\(/.test(line) /* a method named fetch */ ? [`${path}:${index + 1}`] : []))
  assert.deepEqual(raw, [], 'a raw fetch( — use morseFetch')
  const grpc = readFileSync(join('src', 'main', 'network', 'firestore-rpc.ts'), 'utf8')
  assert.match(grpc, /'grpc\.primary_user_agent': clientAgent\(\)/, 'the Firestore channel names it too')
})
