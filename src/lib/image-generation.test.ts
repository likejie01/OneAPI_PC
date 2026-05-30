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

test('resolveImageGenerationResult supports image_urls arrays inside top-level data items', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      data: [
        {
          image_urls: ['https://example.com/from-array.png'],
          revised_prompt: 'array prompt',
        },
      ],
    }, 'fallback'),
    {
      imageUrl: 'https://example.com/from-array.png',
      prompt: 'array prompt',
    }
  )
})

test('resolveImageGenerationResult supports binary_data_base64 arrays inside top-level data items', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      data: [
        {
          binary_data_base64: ['YWJj'],
        },
      ],
    }, 'fallback'),
    {
      imageUrl: 'data:image/png;base64,YWJj',
      prompt: 'fallback',
    }
  )
})

test('resolveImageGenerationResult supports responses-style image output result', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      output: [
        {
          type: 'image_generation_call',
          result: 'YWJj',
        },
      ],
    }, 'fallback'),
    {
      imageUrl: 'data:image/png;base64,YWJj',
      prompt: 'fallback',
    }
  )
})

test('resolveImageGenerationResult keeps responses-style result urls', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      output: [
        {
          type: 'image_generation_call',
          result: 'https://example.com/result-output.png',
        },
      ],
    }, 'fallback'),
    {
      imageUrl: 'https://example.com/result-output.png',
      prompt: 'fallback',
    }
  )
})

test('resolveImageGenerationResult supports nested images arrays', () => {
  assert.deepEqual(
    resolveImageGenerationResult({
      data: {
        images: [
          {
            url: 'https://example.com/nested-image.png',
          },
        ],
      },
    }, 'fallback'),
    {
      imageUrl: 'https://example.com/nested-image.png',
      prompt: 'fallback',
    }
  )
})
