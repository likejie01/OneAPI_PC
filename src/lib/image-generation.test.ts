import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveImageGenerationResult,
  resolveImageMessageSource,
  resolveImagePendingPollUrl,
  resolveImagePendingStatus,
} from './image-generation.ts'

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

test('resolveImageGenerationResult supports responses image generation output blocks', () => {
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

test('resolveImagePendingPollUrl reads async image task poll urls', () => {
  assert.equal(
    resolveImagePendingPollUrl({
      id: 'img_task_123',
      status: 'queued',
      poll_url: 'https://api.example.com/v1/images/tasks/img_task_123',
      message: 'Image task accepted. Poll poll_url with the same Authorization header.',
    }),
    'https://api.example.com/v1/images/tasks/img_task_123'
  )
})

test('resolveImagePendingStatus recognizes in-progress and failed image task responses', () => {
  assert.equal(resolveImagePendingStatus({ status: 'in_progress' }), 'pending')
  assert.equal(resolveImagePendingStatus({ status: 'queued' }), 'pending')
  assert.equal(resolveImagePendingStatus({ status: 'failed' }), 'failed')
})

test('resolveImageResponseErrorMessage reads nested upstream errors', async () => {
  const mod = await import('./image-generation.ts')
  assert.equal(
    mod.resolveImageResponseErrorMessage({
      error: {
        message: 'upstream did not return any image output',
        type: 'upstream_error',
      },
    }),
    'upstream did not return any image output'
  )
})
