import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatDesktopRequestTimeoutMessage,
  IMAGE_REQUEST_TIMEOUT_MS,
  resolveDesktopRequestTimeoutMs,
} from './request-timeouts.ts'

test('resolveDesktopRequestTimeoutMs applies hard timeout to image requests only', () => {
  assert.equal(resolveDesktopRequestTimeoutMs('/pg/images/generations'), IMAGE_REQUEST_TIMEOUT_MS)
  assert.equal(resolveDesktopRequestTimeoutMs('/v1/images/generations'), IMAGE_REQUEST_TIMEOUT_MS)
  assert.equal(resolveDesktopRequestTimeoutMs('/v1/images/edits'), IMAGE_REQUEST_TIMEOUT_MS)
  assert.equal(resolveDesktopRequestTimeoutMs('/pg/chat/completions'), 0)
})

test('formatDesktopRequestTimeoutMessage exposes a readable timeout error', () => {
  assert.equal(formatDesktopRequestTimeoutMessage(10 * 60_000), '请求超时（600s）')
})
