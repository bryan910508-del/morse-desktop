import assert from 'node:assert/strict'
import { test } from 'node:test'

// The renderer tells the main process whether a channel surface is seen: shown, resting in a hidden window, or released.
// A word the main process refused (the screen still counted as locked while the Mac woke) must not leave that account
// out of later ones: its open channel then kept loading until it was opened again.
test('an account whose last word was refused is told again when the window is hidden and shown', async () => {
  const page = new EventTarget() as EventTarget & { hidden: boolean }
  page.hidden = false
  const said: string[] = []
  let refuse = false
  Object.assign(globalThis, { document: page, window: { morse: { setChannelsVisible: async (uid: string, visible: boolean, resting: boolean) => {
    said.push(`${uid} ${visible ? 'shown' : resting ? 'resting' : 'released'}${refuse ? ' refused' : ''}`)
    if (refuse) throw new Error('locked')
  } } } })
  const { retainChannels } = await import('../../src/renderer/src/app/channel-visibility')
  const settle = () => new Promise(resolve => setImmediate(resolve))
  const flip = async (hidden: boolean) => { page.hidden = hidden; page.dispatchEvent(new Event('visibilitychange')); await settle() }
  const release = retainChannels('a')
  await settle()
  await flip(true)
  refuse = true
  await flip(false)
  refuse = false
  await flip(true)
  await flip(false)
  assert.deepEqual(said, ['a shown', 'a resting', 'a shown refused', 'a resting', 'a shown'])
  release()
})
