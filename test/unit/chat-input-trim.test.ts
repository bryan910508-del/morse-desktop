import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outgoingText, sendableText, trimChatInput } from '../../src/shared/validation'

// B177: Telegram's trimChatInputText takes " ", "\t", "\n" and U+200C from both ends of what goes out; JS trim alone
// leaves U+200C (it is not white space).
const zwnj = '‌'

test('B177: blank at both ends goes, U+200C with it; inside it stays', () => {
  assert.equal(outgoingText(`  \n\t${zwnj} 안녕 ${zwnj}\n `), '안녕')
  assert.equal(outgoingText(`${zwnj}${zwnj}hi`), 'hi')
  assert.equal(outgoingText(`می${zwnj}خواهم`), `می${zwnj}خواهم`, 'a U+200C between letters shapes them and stays')
  assert.equal(outgoingText('줄1\n\n줄2'), '줄1\n\n줄2', 'line breaks inside stay')
  assert.equal(trimChatInput(` ${zwnj}설명${zwnj} `), '설명', 'a caption is trimmed the same way')
})

test('B177: a text of nothing but blank and U+200C cannot be sent', () => {
  assert.throws(() => outgoingText(`${zwnj} \n${zwnj}`))
  assert.equal(sendableText(`${zwnj}\n`), false)
})

test('B177: the worker still takes a text an earlier build queued with a U+200C at an end; white space at an end it never did', () => {
  assert.equal(sendableText('안녕'), true)
  assert.equal(sendableText(`${zwnj}안녕`), true, 'queued before the update: it goes as written')
  assert.equal(sendableText(`안녕${zwnj}`), true)
  assert.equal(sendableText(' 안녕'), false)
  assert.equal(sendableText('안녕\n'), false)
  assert.equal(sendableText(42), false)
})
