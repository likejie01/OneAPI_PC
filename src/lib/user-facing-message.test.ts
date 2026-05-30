import test from 'node:test'
import assert from 'node:assert/strict'
import { formatUserFacingMessage } from './user-facing-message.ts'

test('formatUserFacingMessage turns structured upstream errors into plain language', () => {
  const message = formatUserFacingMessage(
    JSON.stringify({
      error: {
        type: 'bad_response_status_code',
        code: 'bad_response_status_code',
        message: 'openai_error',
      },
    })
  )

  assert.equal(message, '服务器暂时异常，请稍后重试。')
})

test('formatUserFacingMessage turns network errors into plain language', () => {
  const message = formatUserFacingMessage('TypeError: fetch failed, connect ETIMEDOUT')

  assert.equal(message, '网络连接异常，请检查网络后重试。')
})

test('formatUserFacingMessage keeps already friendly messages', () => {
  const message = formatUserFacingMessage('服务地址已切换为 https://example.com，请重新登录。')

  assert.equal(message, '服务地址已切换为 https://example.com，请重新登录。')
})
