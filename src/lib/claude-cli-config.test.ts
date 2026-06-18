import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeClaudeApiKey,
  pickClaudeApiKeyFromUnknown,
  pickClaudeBaseUrlFromUnknown,
  resolveClaudeDesktopEnv,
} from './claude-cli-config.ts'

test('normalizeClaudeApiKey keeps sk-prefixed keys and normalizes bare keys', () => {
  assert.equal(normalizeClaudeApiKey('sk-demo'), 'sk-demo')
  assert.equal(normalizeClaudeApiKey('demo'), 'sk-demo')
  assert.equal(normalizeClaudeApiKey('  demo  '), 'sk-demo')
  assert.equal(normalizeClaudeApiKey(''), '')
})

test('pickClaudeApiKeyFromUnknown reads only API key and ignores legacy auth token', () => {
  assert.equal(
    pickClaudeApiKeyFromUnknown({
      ANTHROPIC_API_KEY: 'sk-api',
      ANTHROPIC_AUTH_TOKEN: 'sk-auth',
    }),
    'sk-api'
  )
  assert.equal(
    pickClaudeApiKeyFromUnknown({
      ANTHROPIC_AUTH_TOKEN: 'sk-auth',
    }),
    ''
  )
  assert.equal(
    pickClaudeApiKeyFromUnknown({
      ANTHROPIC_API_KEY: 'sk-api',
    }),
    'sk-api'
  )
  assert.equal(pickClaudeApiKeyFromUnknown(null), '')
})

test('pickClaudeBaseUrlFromUnknown reads anthropic base url', () => {
  assert.equal(
    pickClaudeBaseUrlFromUnknown({
      ANTHROPIC_BASE_URL: 'https://ai.oneapi.center',
    }),
    'https://ai.oneapi.center'
  )
  assert.equal(pickClaudeBaseUrlFromUnknown({}), '')
})

test('resolveClaudeDesktopEnv restores missing base url from auth document', () => {
  const env = resolveClaudeDesktopEnv({
    currentEnv: {
      ANTHROPIC_API_KEY: 'sk-demo',
      ANTHROPIC_AUTH_TOKEN: 'sk-demo',
    },
    authDocument: {
      ANTHROPIC_BASE_URL: 'https://ai.oneapi.center',
    },
    defaultBaseUrl: 'https://fallback.example.com',
  })

  assert.equal(env.ANTHROPIC_API_KEY, 'sk-demo')
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://ai.oneapi.center')
})

test('resolveClaudeDesktopEnv falls back to default base url and fallback key', () => {
  const env = resolveClaudeDesktopEnv({
    currentEnv: {},
    authDocument: null,
    fallbackApiKey: 'demo',
    defaultBaseUrl: 'https://ai.oneapi.center',
  })

  assert.equal(env.ANTHROPIC_API_KEY, 'sk-demo')
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://ai.oneapi.center')
})
