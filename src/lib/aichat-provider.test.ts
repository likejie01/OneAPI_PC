import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_AI_CHAT_PROVIDER_CONFIG,
  hasUsableCustomAiChatProvider,
  isOneApiBridgeOnlyCliModel,
  normalizeAiChatProviderConfig,
  normalizeOpenAICompatibleBaseUrl,
  resolveAiChatProviderState,
  shouldDisableCliModelForProvider,
} from './aichat-provider.ts'

test('normalizeOpenAICompatibleBaseUrl requires http protocol and appends v1', () => {
  assert.equal(normalizeOpenAICompatibleBaseUrl('https://proxy.example.com'), 'https://proxy.example.com/v1')
  assert.equal(normalizeOpenAICompatibleBaseUrl('https://proxy.example.com/v1/'), 'https://proxy.example.com/v1')
  assert.throws(() => normalizeOpenAICompatibleBaseUrl('proxy.example.com'), /http/)
})

test('resolveAiChatProviderState prefers usable custom provider over logged in OneAPI user', () => {
  const state = resolveAiChatProviderState(
    normalizeAiChatProviderConfig({
      customEnabled: true,
      customBaseUrl: 'https://proxy.example.com',
      customApiKey: 'sk-custom',
      customDefaultModel: 'gpt-compatible',
      customModels: ['gpt-compatible', 'gpt-compatible', ''],
    }),
    { id: 7, username: 'demo' } as any
  )

  assert.equal(state.mode, 'custom')
  assert.equal(state.baseUrl, 'https://proxy.example.com/v1')
  assert.equal(state.apiKey, 'sk-custom')
  assert.equal(state.defaultModel, 'gpt-compatible')
  assert.deepEqual(state.models, ['gpt-compatible'])
})

test('resolveAiChatProviderState falls back to OneAPI for logged in users and unavailable for anonymous users', () => {
  assert.equal(resolveAiChatProviderState(DEFAULT_AI_CHAT_PROVIDER_CONFIG, { id: 1 } as any).mode, 'oneapi')

  const anonymous = resolveAiChatProviderState(DEFAULT_AI_CHAT_PROVIDER_CONFIG, null)
  assert.equal(anonymous.mode, 'unavailable')
  assert.match(anonymous.reason || '', /登录 OneAPI/)
})

test('hasUsableCustomAiChatProvider rejects incomplete custom provider config', () => {
  assert.equal(hasUsableCustomAiChatProvider({
    customEnabled: true,
    customBaseUrl: 'https://proxy.example.com',
    customApiKey: '',
    customDefaultModel: '',
    customModels: [],
  }), false)
  assert.equal(hasUsableCustomAiChatProvider({
    customEnabled: true,
    customBaseUrl: 'https://proxy.example.com',
    customApiKey: 'sk-custom',
    customDefaultModel: '',
    customModels: [],
  }), true)
})

test('DeepSeek and Xiaomi MiMo cli models stay available for custom provider bridge mode', () => {
  assert.equal(isOneApiBridgeOnlyCliModel('deepseek-chat'), true)
  assert.equal(isOneApiBridgeOnlyCliModel('mimo-v2.5-pro'), true)
  assert.equal(isOneApiBridgeOnlyCliModel('xiaomi-mimo'), true)
  assert.equal(isOneApiBridgeOnlyCliModel('gpt-5.4'), false)

  assert.equal(shouldDisableCliModelForProvider('deepseek-chat', 'custom'), false)
  assert.equal(shouldDisableCliModelForProvider('deepseek-chat', 'oneapi'), false)
})
