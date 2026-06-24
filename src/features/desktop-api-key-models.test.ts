import test from 'node:test'
import assert from 'node:assert/strict'
import {
  loadOneApiModelsForActiveKey,
  resolveActiveDesktopApiKeySummary,
  resolveCliDeployModelForActiveKey,
  resolveOneApiRequestGroupForActiveKey,
  sameActiveDesktopApiKeySummary,
  type ActiveKeyModelLoader,
  type ActiveDesktopApiKeyRecord,
} from './desktop-api-key-models.ts'
import type { ChatModelOption } from '../shared/contracts.ts'

function key(input: Partial<ActiveDesktopApiKeyRecord>): ActiveDesktopApiKeyRecord {
  return {
    id: 1,
    name: 'key',
    status: 1,
    group: 'default',
    created_time: 100,
    model_limits_enabled: false,
    model_limits: '',
    ...input,
  }
}

test('resolveActiveDesktopApiKeySummary keeps selected enabled key and falls back to active key', () => {
  const keys = [
    key({ id: 1, status: 2 }),
    key({ id: 2, name: 'enabled', status: 1 }),
  ]

  assert.equal(resolveActiveDesktopApiKeySummary(keys, 2)?.id, 2)
  assert.equal(resolveActiveDesktopApiKeySummary(keys, 1)?.id, 2)
})

test('sameActiveDesktopApiKeySummary detects group and model limit changes', () => {
  assert.equal(sameActiveDesktopApiKeySummary(key({ group: '1.10x' }), key({ group: '1.20x' })), false)
  assert.equal(
    sameActiveDesktopApiKeySummary(
      key({ model_limits_enabled: true, model_limits: 'deepseek-v4-pro' }),
      key({ model_limits_enabled: true, model_limits: 'mimo-v2.5-pro' })
    ),
    false
  )
})

test('loadOneApiModelsForActiveKey merges key-scoped models with filtered user models', async () => {
  const scopedModels: ChatModelOption[] = [
    { label: 'mimo-v2.5', value: 'mimo-v2.5' },
  ]
  const loader: ActiveKeyModelLoader = {
    fetchApiKeySecret: async () => 'sk-active',
    getApiKeyModels: async () => scopedModels,
    getUserModels: async () => [
      { label: 'mimo-v2.5', value: 'mimo-v2.5' },
      { label: 'xiaomimimo-v2.5-pro', value: 'xiaomimimo-v2.5-pro' },
      { label: 'gpt-5.5', value: 'gpt-5.5', enableGroups: ['1.60x'] },
    ],
  }

  assert.deepEqual(
    (await loadOneApiModelsForActiveKey(key({ group: '1.10x DeepSeek / Xiaomi MIMO官方' }), loader)).map((item) => item.value),
    ['mimo-v2.5', 'xiaomimimo-v2.5-pro']
  )
})

test('loadOneApiModelsForActiveKey falls back to user models filtered by active key', async () => {
  const loader: ActiveKeyModelLoader = {
    fetchApiKeySecret: async () => 'sk-active',
    getApiKeyModels: async () => {
      throw new Error('old server')
    },
    getUserModels: async () => [
      { label: 'gpt-5.5', value: 'gpt-5.5', enableGroups: ['1.60x'] },
      { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro', enableGroups: ['1.10x'] },
    ],
  }

  assert.deepEqual(
    (await loadOneApiModelsForActiveKey(key({ group: '1.10x' }), loader)).map((item) => item.value),
    ['deepseek-v4-pro']
  )
})

test('resolveOneApiRequestGroupForActiveKey prefers the active key group over stale session group', () => {
  assert.equal(
    resolveOneApiRequestGroupForActiveKey(
      key({ group: '1.60 OpenAI官方线路' }),
      'Anthropic官方'
    ),
    '1.60 OpenAI官方线路'
  )
})

test('resolveOneApiRequestGroupForActiveKey keeps selected group for all-channel keys', () => {
  assert.equal(
    resolveOneApiRequestGroupForActiveKey(key({ group: 'default' }), 'Anthropic官方'),
    'Anthropic官方'
  )
})

test('resolveCliDeployModelForActiveKey returns a compatible client model', () => {
  const models: ChatModelOption[] = [
    { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
    { label: 'mimo-v2.5-pro', value: 'mimo-v2.5-pro' },
  ]

  assert.equal(resolveCliDeployModelForActiveKey('claude', models, 'claude-sonnet-4-6', 'mimo-v2.5-pro'), 'mimo-v2.5-pro')
})
