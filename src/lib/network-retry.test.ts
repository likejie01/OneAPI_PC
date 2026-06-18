import test from 'node:test'
import assert from 'node:assert/strict'
import { isRecoverableNetworkError } from './network-retry.ts'

test('isRecoverableNetworkError detects fetch failures and offline errors', () => {
  assert.equal(isRecoverableNetworkError(new Error('fetch failed')), true)
  assert.equal(isRecoverableNetworkError(new Error('Failed to fetch')), true)
  assert.equal(isRecoverableNetworkError(new Error('网络连接已断开，请稍后重试')), true)
})

test('isRecoverableNetworkError ignores regular business failures', () => {
  assert.equal(isRecoverableNetworkError(new Error('invalid api key')), false)
  assert.equal(isRecoverableNetworkError(new Error('图片生成失败（400）')), false)
})
