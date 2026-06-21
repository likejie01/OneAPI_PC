import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePricingAndUserModels } from './model-options.ts'

test('mergePricingAndUserModels preserves pricing metadata and appends enabled user models missing from pricing', () => {
  const models = mergePricingAndUserModels(
    [
      {
        model_name: 'gpt-5.5',
        supported_endpoint_types: ['openai'],
      },
      {
        model_name: 'deepseek-chat',
        supported_endpoint_types: ['openai'],
      },
    ],
    ['gpt-5.5', 'gemini-2.5-pro', 'mimo-v2.5-pro']
  )

  assert.deepEqual(
    models.map((item) => item.value),
    ['gpt-5.5', 'deepseek-chat', 'gemini-2.5-pro', 'mimo-v2.5-pro']
  )
  assert.deepEqual(models[0].supportedEndpointTypes, ['openai'])
  assert.equal(models[2].supportedEndpointTypes, undefined)
})

test('mergePricingAndUserModels falls back to user models when pricing is unavailable', () => {
  const models = mergePricingAndUserModels([], ['gpt-5.5', 'gemini-2.5-pro'])

  assert.deepEqual(
    models.map((item) => item.value),
    ['gpt-5.5', 'gemini-2.5-pro']
  )
  assert.equal(models[0].supportedEndpointTypes, undefined)
})

test('mergePricingAndUserModels preserves models returned by the active api key even when pricing metadata is incomplete', () => {
  const models = mergePricingAndUserModels(
    [
      {
        model_name: 'deepseek-v4-flash',
        supported_endpoint_types: ['openai'],
        enable_groups: ['1.10x'],
      },
    ],
    [
      'deepseek-v4-flash',
      'deepseek-v4-flash-none',
      'deepseek-v4-flash-max',
      'deepseek-v4-pro',
      'deepseek-v4-pro-none',
      'deepseek-v4-pro-max',
      'mimo-v2.5',
      'mimo-v2.5-pro',
    ]
  )

  assert.deepEqual(
    models.map((item) => item.value),
    [
      'deepseek-v4-flash',
      'deepseek-v4-flash-none',
      'deepseek-v4-flash-max',
      'deepseek-v4-pro',
      'deepseek-v4-pro-none',
      'deepseek-v4-pro-max',
      'mimo-v2.5',
      'mimo-v2.5-pro',
    ]
  )
})
