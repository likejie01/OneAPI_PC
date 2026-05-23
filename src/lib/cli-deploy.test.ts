import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCliDeploySettings } from './cli-deploy.ts'

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
      generatedApiKey: 'sk-generated',
      defaultBaseUrl: 'https://ai.oneapi.center/v1',
      defaultModel: 'gpt-5.5',
    }),
    {
      apiKey: 'sk-generated',
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
      generatedApiKey: 'sk-fresh',
      defaultBaseUrl: 'https://ai.oneapi.center',
      defaultModel: 'claude-opus-4-7',
    }),
    {
      apiKey: 'sk-fresh',
      baseUrl: 'https://ai.oneapi.center',
      model: 'claude-opus-4-7',
    }
  )
})
