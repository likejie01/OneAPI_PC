import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDesktopCliApiKey, resolveCliDeploySettings } from './cli-deploy.ts'

const RAW_KEY = 'a'.repeat(48)
const SK_KEY = `sk-${RAW_KEY}`

test('resolveCliDeploySettings ignores legacy preset api keys and endpoints', () => {
  assert.deepEqual(
    resolveCliDeploySettings({
      preset: {
        client: 'codex',
        apiKey: 'sk-legacy',
        model: 'gpt-5.4',
        baseUrl: 'https://legacy.example/v1',
        managedByDesktop: false,
      },
      generatedApiKey: RAW_KEY,
      defaultBaseUrl: 'https://ai.oneapi.center/v1',
      defaultModel: 'gpt-5.5',
    }),
    {
      apiKey: SK_KEY,
      baseUrl: 'https://ai.oneapi.center/v1',
      model: 'gpt-5.4',
    }
  )
})

test('resolveCliDeploySettings reuses managed desktop endpoint but still rotates api key', () => {
  assert.deepEqual(
    resolveCliDeploySettings({
      preset: {
        client: 'claude',
        apiKey: 'sk-old',
        model: 'claude-opus-4-7',
        baseUrl: 'https://ai.oneapi.center',
        managedByDesktop: true,
      },
      generatedApiKey: SK_KEY,
      defaultBaseUrl: 'https://ai.oneapi.center',
      defaultModel: 'claude-opus-4-7',
    }),
    {
      apiKey: SK_KEY,
      baseUrl: 'https://ai.oneapi.center',
      model: 'claude-opus-4-7',
    }
  )
})

test('deploy UI creates fresh generated keys outside resolveCliDeploySettings', () => {
  const result = resolveCliDeploySettings({
    preset: null,
    generatedApiKey: RAW_KEY,
    defaultBaseUrl: 'https://ai.oneapi.center',
    defaultModel: 'claude-sonnet-4-6',
  })
  assert.equal(result.apiKey, SK_KEY)
})

test('normalizeDesktopCliApiKey rejects test and malformed keys', () => {
  assert.equal(normalizeDesktopCliApiKey(RAW_KEY), SK_KEY)
  assert.equal(normalizeDesktopCliApiKey(SK_KEY), SK_KEY)
  assert.throws(() => normalizeDesktopCliApiKey('sk-test_1780028385_359614'), /测试 Key/)
  assert.throws(() => normalizeDesktopCliApiKey('test_1780028385_359614'), /测试 Key/)
  assert.throws(() => normalizeDesktopCliApiKey('sk-short'), /格式异常/)
})
