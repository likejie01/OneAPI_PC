import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePricingAndUserModels } from './model-options.ts'

test('mergePricingAndUserModels keeps user models that do not have pricing metadata', () => {
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
    ['gpt-5.5', 'deepseek-chat', 'gemini-2.5-pro', 'gemini-2.5-flash']
  )
  assert.deepEqual(models[0].supportedEndpointTypes, ['openai'])
  assert.equal(models[2].supportedEndpointTypes, undefined)
})
