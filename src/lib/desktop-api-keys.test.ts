import test from 'node:test'
import assert from 'node:assert/strict'
import {
  API_KEY_STATUS_DISABLED,
  API_KEY_STATUS_ENABLED,
  applySingleActiveDesktopApiKey,
  getActiveDesktopApiKey,
  isAllChannelGroupsDesktopApiKeyGroup,
  resolveSelectedDesktopApiKeyId,
} from './desktop-api-keys.ts'

test('active desktop api key ignores disabled keys', () => {
  const keys = [
    { id: 1, status: API_KEY_STATUS_DISABLED },
    { id: 2, status: API_KEY_STATUS_ENABLED },
  ]

  assert.equal(getActiveDesktopApiKey(keys)?.id, 2)
})

test('selected desktop api key falls back when selected key is disabled', () => {
  const keys = [
    { id: 1, status: API_KEY_STATUS_DISABLED },
    { id: 2, status: API_KEY_STATUS_ENABLED },
  ]

  assert.equal(resolveSelectedDesktopApiKeyId(keys, 1), 2)
})

test('selected desktop api key returns null when no enabled key exists', () => {
  const keys = [
    { id: 1, status: API_KEY_STATUS_DISABLED },
    { id: 2, status: API_KEY_STATUS_DISABLED },
  ]

  assert.equal(resolveSelectedDesktopApiKeyId(keys, 1), null)
})

test('single active desktop api key disables all peers', () => {
  const keys = applySingleActiveDesktopApiKey([
    { id: 1, status: API_KEY_STATUS_ENABLED },
    { id: 2, status: API_KEY_STATUS_DISABLED },
    { id: 3, status: API_KEY_STATUS_ENABLED },
  ], 2)

  assert.deepEqual(
    keys.map((item) => [item.id, item.status]),
    [
      [1, API_KEY_STATUS_DISABLED],
      [2, API_KEY_STATUS_ENABLED],
      [3, API_KEY_STATUS_DISABLED],
    ]
  )
})

test('all channel groups api key group includes empty and default groups', () => {
  assert.equal(isAllChannelGroupsDesktopApiKeyGroup(''), true)
  assert.equal(isAllChannelGroupsDesktopApiKeyGroup('default'), true)
  assert.equal(isAllChannelGroupsDesktopApiKeyGroup('OpenAI'), false)
  assert.equal(isAllChannelGroupsDesktopApiKeyGroup('auto'), false)
})
