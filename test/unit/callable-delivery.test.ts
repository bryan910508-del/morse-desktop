import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { after, test } from 'node:test'
import { callableAnswer, callFunctionAt, MorseCallableFailure, type CallableDelivery } from '../../src/main/network/morse-callable'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// Every Cloud Function call of Desktop goes through morse-callable.ts, and what it makes of a failure decides whether
// the work may go again (user decision 2026-09-29): «안 보냄» never left this device, «모름» may have reached the
// function, «서버 답» is the function's own refusal. These are the failures reproduced on 2026-09-29 in Electron 44's
// fetch (undici), made here for real: a name that does not resolve, a port nothing listens on, a server that never
// answers, one that cuts the connection after the request, a gateway page, and the function's own JSON errors.
const auth = (tokens: boolean[] = []): ReadCredentials => ({
  signal: new AbortController().signal,
  authorize: async (_signal, force) => { tokens.push(force); return { idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 } }
})
const servers: Server[] = []
after(() => { for (const server of servers) { server.closeAllConnections(); server.close() } })
async function serve(handle: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handle)
  servers.push(server)
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/fn`
}
function reply(status: number, type: string, body: string): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => { request.resume(); request.on('end', () => { response.writeHead(status, { 'content-type': type }); response.end(body) }) }
}
async function delivery(url: string, options: Parameters<typeof callFunctionAt>[4] = {}, credentials = auth()): Promise<{ delivery: CallableDelivery; status: string }> {
  try { await callFunctionAt(url, credentials, { a: 1 }, new AbortController().signal, options, [1, 1, 1]); assert.fail('the call succeeded') }
  catch (error) {
    assert.ok(error instanceof MorseCallableFailure, String(error))
    return { delivery: error.delivery, status: error.status }
  }
}

test('a name that does not resolve and a port nothing listens on never sent anything', async () => {
  assert.equal((await delivery('https://no-such-host.invalid/fn')).delivery, 'not-sent')
  const port = await new Promise<number>(done => { const probe = createSocketServer().listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => done(port)) }) })
  assert.equal((await delivery(`http://127.0.0.1:${port}/fn`)).delivery, 'not-sent')
})

test('a connection made and then left without an answer may have reached the function', async () => {
  // Nothing answers: the request's own time runs out (TimeoutError).
  assert.equal((await delivery(await serve(request => { request.resume() }), { timeout: 300 })).delivery, 'unknown')
  // The request arrives and the connection is cut before an answer (undici UND_ERR_SOCKET).
  assert.equal((await delivery(await serve(request => { request.resume(); request.on('end', () => request.socket.destroy()) }))).delivery, 'unknown')
})

test('a gateway page and the function\'s INTERNAL, UNAVAILABLE or DEADLINE_EXCEEDED are «모름»', async () => {
  assert.deepEqual(await delivery(await serve(reply(503, 'text/html', '<html>Service Unavailable</html>'))), { delivery: 'unknown', status: 'UNKNOWN' })
  assert.deepEqual(await delivery(await serve(reply(500, 'application/json', '{"error":{"message":"INTERNAL","status":"INTERNAL"}}'))), { delivery: 'unknown', status: 'INTERNAL' })
  assert.deepEqual(await delivery(await serve(reply(503, 'application/json', '{"error":{"message":"busy","status":"UNAVAILABLE"}}'))), { delivery: 'unknown', status: 'UNAVAILABLE' })
  assert.deepEqual(await delivery(await serve(reply(504, 'application/json', '{"error":{"status":"DEADLINE_EXCEEDED"}}'))), { delivery: 'unknown', status: 'DEADLINE_EXCEEDED' })
})

test('every other status the function answers with stands as its answer', async () => {
  for (const [status, code] of [[400, 'FAILED_PRECONDITION'], [429, 'RESOURCE_EXHAUSTED'], [404, 'NOT_FOUND'], [409, 'ALREADY_EXISTS'], [403, 'PERMISSION_DENIED'], [500, 'UNKNOWN']] as const) {
    assert.deepEqual(await delivery(await serve(reply(status, 'application/json', JSON.stringify({ error: { status: code, message: 'no' } })))), { delivery: 'answered', status: code })
  }
  // The reason a function gives travels with its answer (morse-release-authority.js pollFailure).
  assert.throws(() => callableAnswer(false, '{"error":{"status":"FAILED_PRECONDITION","details":{"reason":"POLL_CLOSED"}}}'),
    (error: unknown) => error instanceof MorseCallableFailure && error.reason === 'POLL_CLOSED' && error.delivery === 'answered')
  // A JSON error that is not a callable status is not the function speaking.
  assert.throws(() => callableAnswer(false, '{"error":{"code":502}}'), (error: unknown) => error instanceof MorseCallableFailure && error.delivery === 'unknown')
})

test('an account whose proof cannot be had, or a check that fails, sends nothing', async () => {
  let reached = false
  const url = await serve((request, response) => { reached = true; reply(200, 'application/json', '{"result":{"ok":true}}')(request, response) })
  const broken: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('no token') } }
  assert.equal((await delivery(url, {}, broken)).delivery, 'not-sent')
  assert.equal((await delivery(url, { validate: () => { throw new Error('account changed') } })).delivery, 'not-sent')
  assert.equal(reached, false)
})

test('an answer is the function\'s result, and a stale proof is refreshed once when asked', async () => {
  const url = await serve(reply(200, 'application/json', '{"result":{"ok":true,"id":"m1"}}'))
  assert.deepEqual(await callFunctionAt(url, auth(), {}, new AbortController().signal), { ok: true, id: 'm1' })
  let calls = 0
  const stale = await serve((request, response) => { calls++; calls === 1 ? reply(401, 'application/json', '{"error":{"status":"UNAUTHENTICATED"}}')(request, response) : reply(200, 'application/json', '{"result":{"ok":true}}')(request, response) })
  const tokens: boolean[] = []
  assert.deepEqual(await callFunctionAt(stale, auth(tokens), {}, new AbortController().signal, { refreshUnauthenticated: true }), { ok: true })
  assert.deepEqual(tokens, [false, true])
  // Without it the 401 is the function's answer.
  calls = 0
  assert.deepEqual(await delivery(stale), { delivery: 'answered', status: 'UNAUTHENTICATED' })
})
