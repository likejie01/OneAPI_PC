import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePricingAndUserModels } from './model-options.ts'

test('mergePricingAndUserModels trusts pricing as authoritative when pricing exists', () => {
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
    ['gpt-5.5', 'gemini-2.5-pro', 'gemini-2.5-flash']
  )

  assert.deepEqual(
    models.map((item) => item.value),
    ['gpt-5.5', 'deepseek-chat']
  )
  assert.deepEqual(models[0].supportedEndpointTypes, ['openai'])
})

test('mergePricingAndUserModels falls back to user models when pricing is unavailable', () => {
  const models = mergePricingAndUserModels([], ['gpt-5.5', 'gemini-2.5-pro'])

  assert.deepEqual(
    models.map((item) => item.value),
    ['gpt-5.5', 'gemini-2.5-pro']
  )
  assert.equal(models[0].supportedEndpointTypes, undefined)
})
