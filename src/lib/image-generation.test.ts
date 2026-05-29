import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveImageGenerationResult, resolveImageMessageSource } from './image-generation.ts'

test('resolveImageMessageSource keeps normalized OpenAI image urls', () => {
  assert.equal(
    resolveImageMessageSource({ url: 'https://example.com/image.png' }),
    'https://example.com/image.png'
  )
})

test('resolveImageMessageSource converts normalized OpenAI base64 payloads', () => {
  assert.equal(
    resolveImageMessageSource({ b64_json: 'YWJj' }),
    'data:image/png;base64,YWJj'
  )
})

test('resolveImageGenerationResult supports raw upstream image_urls payloads', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      data: {
        image_urls: ['https://example.com/raw.png'],
      },
    }, 'fallback'),
    {
      imageUrl: 'https://example.com/raw.png',
      prompt: 'fallback',
    }
  )
})

test('resolveImageGenerationResult supports raw upstream base64 arrays', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      data: {
        binary_data_base64: ['YWJj'],
      },
    }, 'fallback'),
    {
      imageUrl: 'data:image/png;base64,YWJj',
      prompt: 'fallback',
    }
  )
})

test('resolveImageGenerationResult preserves revised prompts when available', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      data: [
        {
          url: 'https://example.com/result.png',
          revised_prompt: 'revised prompt',
        },
      ],
    }, 'fallback'),
    {
      imageUrl: 'https://example.com/result.png',
      prompt: 'revised prompt',
    }
  )
})
