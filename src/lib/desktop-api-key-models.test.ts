import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterModelsForDesktopApiKey,
  type DesktopApiKeyModelFilterKey,
} from './desktop-api-key-models.ts'
import type { ChatModelOption } from '../shared/contracts.ts'

const models: ChatModelOption[] = [
  { label: 'gpt-5.5', value: 'gpt-5.5', enableGroups: ['1.60x'] },
  { label: 'deepseek-v4-flash', value: 'deepseek-v4-flash', enableGroups: ['1.10x'], supportedEndpointTypes: ['anthropic', 'openai-response', 'openai'] },
  { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro', enableGroups: ['1.10 DeepSeek / Xiaomi MIMO官方'] },
  { label: 'mimo-v2.5-pro', value: 'mimo-v2.5-pro' },
  { label: 'xiaomimimo-v2.5-pro', value: 'xiaomimimo-v2.5-pro' },
  { label: 'gemini-2.5-pro', value: 'gemini-2.5-pro', enableGroups: ['2.00x'] },
]

function key(input: Partial<DesktopApiKeyModelFilterKey>): DesktopApiKeyModelFilterKey {
  return {
    id: 1,
    group: '',
    model_limits_enabled: false,
    model_limits: '',
    ...input,
  }
}

test('all channel group keys keep all available models', () => {
  assert.deepEqual(
    filterModelsForDesktopApiKey(models, key({ group: 'default' })).map((item) => item.value),
    ['gpt-5.5', 'deepseek-v4-flash', 'deepseek-v4-pro', 'mimo-v2.5-pro', 'xiaomimimo-v2.5-pro', 'gemini-2.5-pro']
  )
})

test('specific group keys keep matching described, canonical, and known bridge models', () => {
  assert.deepEqual(
    filterModelsForDesktopApiKey(models, key({ group: '1.10x DeepSeek / Xiaomi MIMO官方' })).map((item) => item.value),
    ['deepseek-v4-flash', 'deepseek-v4-pro', 'mimo-v2.5-pro', 'xiaomimimo-v2.5-pro']
  )
})

test('multi group keys union models from each selected group', () => {
  assert.deepEqual(
    filterModelsForDesktopApiKey(models, key({ group: '1.10x DeepSeek / Xiaomi MIMO官方,1.60 OpenAI官方线路' })).map((item) => item.value),
    ['gpt-5.5', 'deepseek-v4-flash', 'deepseek-v4-pro', 'mimo-v2.5-pro', 'xiaomimimo-v2.5-pro']
  )
})

test('model limits still narrow the selected group model list', () => {
  assert.deepEqual(
    filterModelsForDesktopApiKey(models, key({
      group: '1.10x DeepSeek / Xiaomi MIMO官方',
      model_limits_enabled: true,
      model_limits: 'deepseek-v4-pro,xiaomimimo-v2.5-pro',
    })).map((item) => item.value),
    ['deepseek-v4-pro', 'xiaomimimo-v2.5-pro']
  )
})
