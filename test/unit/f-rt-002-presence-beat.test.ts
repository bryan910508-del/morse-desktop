import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

// F-RT-002 (contracts/F-RT-002-presence-heartbeat.md): presenceBeat/{me} gets the server's time with online:true and then
// every 30 s while online and connected; offline, disconnected or closed it stops and is left as it is. presence/{me} is
// not written again for it.
const source = readFileSync('src/main/accounts/presence.ts', 'utf8')

test('the beat is the server\'s time at presenceBeat/{me}, every 30 s', () => {
  assert.match(source, /export const presenceBeatMs = 30000\n/)
  assert.match(source, /void set\(ref\(database, `presenceBeat\/\$\{this\.uid\}`\), serverTimestamp\(\)\)\.catch\(\(\) => \{\}\)/)
  assert.match(source, /write\(\)\n\s*this\.beat = setInterval\(write, presenceBeatMs\)/, 'once at once, then each period')
  assert.doesNotMatch(source, /set\(ref\(database, `presence\/\$\{this\.uid\}`\)/, 'presence itself is not written for it')
})

test('it starts with the online write and stops offline, disconnected and closed, never deleting', () => {
  assert.match(source, /void update\(me, \{ online: true, lastSeen: serverTimestamp\(\) \}\)\.catch\(retry\)\n\s*this\.watchOwn\(database\)\n\s*this\.startBeat\(database\)/)
  assert.match(source, /\} else \{\n\s*this\.stopBeat\(\)/, 'writing offline')
  assert.match(source, /if \(this\.connected\) this\.written = false\n\s*else this\.stopBeat\(\)/, 'the connection gone')
  assert.match(source, /else \{ this\.stopOwn\?\.\(\); this\.stopOwn = null; this\.stopBeat\(\) \}/, 'set offline')
  assert.match(source, /this\.closed = true\n\s*this\.stopBeat\(\)/, 'closed')
  assert.match(source, /if \(this\.closed \|\| !this\.connected \|\| !this\.online \|\| !this\.written\) \{ this\.stopBeat\(\); return \}/, 'each beat checks')
  assert.doesNotMatch(source, /remove\(ref\(database, `presenceBeat/, 'a stopped beat is left for its age')
})
