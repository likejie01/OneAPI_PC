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
  assert.equal(extracted.chips.length, 1)
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

test('extractMessageLinkChips moves labeled address lines into chips without blanks', () => {
  const extracted = extractMessageLinkChips([
    '官网地址：https://n8n.io',
    '文档地址：[docs.n8n.io](https://docs.n8n.io/hosting)',
    'GitHub 地址：https://github.com/n8n-io/n8n',
    '保留正文',
  ].join('\n'))

  assert.equal(extracted.content, '保留正文')
  assert.deepEqual(extracted.chips.map((item) => item.url), [
    'https://n8n.io/',
    'https://docs.n8n.io/hosting',
    'https://github.com/n8n-io/n8n',
  ])
})
