import test from 'node:test'
import assert from 'node:assert/strict'
import { extractMessageLinkChips } from './message-links.ts'

test('extractMessageLinkChips turns standalone URLs into chips', () => {
  const extracted = extractMessageLinkChips('https://github.com/wuyoscar/GPT-Image2-Skill')
  assert.equal(extracted.content, '')
  assert.deepEqual(extracted.chips, [
    {
      url: 'https://github.com/wuyoscar/GPT-Image2-Skill',
      label: 'wuyoscar/GPT-Image2-Skill',
      hostLabel: 'GitHub',
      kind: 'github',
    },
  ])
})

test('extractMessageLinkChips keeps inline URLs inside normal sentences', () => {
  const extracted = extractMessageLinkChips('请查看 https://example.com/docs 这一段说明。')
  assert.equal(extracted.chips.length, 0)
  assert.equal(extracted.content, '请查看 https://example.com/docs 这一段说明。')
})

test('extractMessageLinkChips supports standalone markdown links', () => {
  const extracted = extractMessageLinkChips('[OneAPI](https://ai.oneapi.center)')
  assert.equal(extracted.content, '')
  assert.deepEqual(extracted.chips[0], {
    url: 'https://ai.oneapi.center/',
    label: 'OneAPI',
    hostLabel: 'ai.oneapi.center',
    kind: 'website',
  })
})
