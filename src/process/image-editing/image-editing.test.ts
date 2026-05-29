import test from 'node:test'
import assert from 'node:assert/strict'
import { buildImageEditRequest } from './build-edit-request.ts'
import { mapImageEditError } from './map-edit-error.ts'
import { resolveEditableModelCapability } from './resolve-model-capability.ts'

test('editable model capability detects supported models', () => {
  assert.equal(resolveEditableModelCapability('gpt-image-2').editable, true)
  assert.equal(resolveEditableModelCapability('deepseek-chat').editable, false)
})

test('image edit request falls back to supported model', () => {
  const request = buildImageEditRequest({
    apiKey: 'key',
    model: 'deepseek-chat',
    fallbackModel: 'gpt-image-2',
    prompt: '改成蓝色背景',
    imageName: 'demo.png',
    dataBase64: 'Zm9v',
  })

  assert.equal(request.model, 'gpt-image-2')
  assert.equal(request.response_format, 'b64_json')
})

test('image edit error maps timeout to readable cause', () => {
  assert.equal(mapImageEditError(new Error('upstream timeout 524')), '图片编辑上游超时')
})
