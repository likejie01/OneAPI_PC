import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveVisibleDrawMessageContent } from './draw-message.ts'

test('resolveVisibleDrawMessageContent hides assistant prompt text once an image is rendered', () => {
  assert.equal(
    resolveVisibleDrawMessageContent({
      role: 'assistant',
      content: 'cinematic portrait with warm light',
      imageUrl: 'data:image/png;base64,abc',
      pending: false,
    }),
    ''
  )
})

test('resolveVisibleDrawMessageContent keeps pending text while the image is still generating', () => {
  assert.equal(
    resolveVisibleDrawMessageContent({
      role: 'assistant',
      content: '网络已断开，恢复后将自动继续生成...',
      imageUrl: '__oneapi_draw_pending__',
      pending: true,
    }),
    '网络已断开，恢复后将自动继续生成...'
  )
})
