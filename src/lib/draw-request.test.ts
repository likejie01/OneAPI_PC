import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPendingDrawRetryRequest, resolvePendingDrawRequestGroup } from './draw-request.ts'

test('buildPendingDrawRetryRequest preserves the selected group for image edits', () => {
  const request = buildPendingDrawRetryRequest({
    model: 'gpt-image-2',
    prompt: '补充要求：将照片改成吉卜力风格',
    group: 'vip',
    size: '1024x1024',
    quality: 'high',
    imageAttachment: {
      name: 'image.png',
      mimeType: 'image/png',
      dataBase64: 'ZmFrZQ==',
    },
  })

  assert.equal(request.kind, 'edit')
  assert.equal(request.group, 'vip')
})

test('resolvePendingDrawRequestGroup prefers the request group and falls back safely', () => {
  assert.equal(resolvePendingDrawRequestGroup({ group: 'artist' }, 'default'), 'artist')
  assert.equal(resolvePendingDrawRequestGroup({ group: '' }, 'default'), 'default')
})
