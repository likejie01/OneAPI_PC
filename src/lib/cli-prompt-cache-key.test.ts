import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCliPromptCacheKey,
  injectCliPromptCacheKeyIntoJsonBody,
  normalizeCliPromptCacheProjectPath,
} from './cli-prompt-cache-key.ts'

test('buildCliPromptCacheKey is stable for the same client project and session', () => {
  const first = buildCliPromptCacheKey({
    client: 'codex',
    projectPath: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC\\',
    sessionId: 'thread-123',
  })
  const second = buildCliPromptCacheKey({
    client: 'codex',
    projectPath: 'D:/WorkSpace/NewAPI/OneAPI_PC',
    sessionId: 'thread-123',
  })

  assert.equal(first, second)
  assert.match(first, /^[a-f0-9]{32}$/)
})

test('buildCliPromptCacheKey separates clients projects and sessions', () => {
  const base = buildCliPromptCacheKey({
    client: 'codex',
    projectPath: 'D:/WorkSpace/NewAPI/OneAPI_PC',
    sessionId: 'thread-123',
  })

  assert.notEqual(base, buildCliPromptCacheKey({
    client: 'claude',
    projectPath: 'D:/WorkSpace/NewAPI/OneAPI_PC',
    sessionId: 'thread-123',
  }))
  assert.notEqual(base, buildCliPromptCacheKey({
    client: 'codex',
    projectPath: 'D:/WorkSpace/NewAPI/OneAPI_MAC',
    sessionId: 'thread-123',
  }))
  assert.notEqual(base, buildCliPromptCacheKey({
    client: 'codex',
    projectPath: 'D:/WorkSpace/NewAPI/OneAPI_PC',
    sessionId: 'thread-456',
  }))
})

test('normalizeCliPromptCacheProjectPath hides raw path from generated key source output', () => {
  assert.equal(
    normalizeCliPromptCacheProjectPath('D:\\WorkSpace\\NewAPI\\OneAPI_PC\\'),
    'd:/workspace/newapi/oneapi_pc'
  )

  const key = buildCliPromptCacheKey({
    client: 'codex',
    projectPath: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC\\',
    sessionId: 'thread-123',
  })
  assert.equal(key.includes('WorkSpace'), false)
  assert.equal(key.includes('OneAPI_PC'), false)
})

test('injectCliPromptCacheKeyIntoJsonBody adds prompt_cache_key without changing existing fields', () => {
  const original = {
    model: 'gpt-5.5',
    input: 'hello',
    conversation: 'conv_123',
    previous_response_id: 'resp_123',
    metadata: { source: 'codex' },
  }

  const next = injectCliPromptCacheKeyIntoJsonBody(JSON.stringify(original), 'cache-key-123')

  assert.deepEqual(JSON.parse(next), {
    ...original,
    prompt_cache_key: 'cache-key-123',
  })
})

test('injectCliPromptCacheKeyIntoJsonBody preserves official prompt_cache_key when present', () => {
  const original = {
    model: 'gpt-5.5',
    input: 'hello',
    prompt_cache_key: 'official-cache-key',
  }

  const next = injectCliPromptCacheKeyIntoJsonBody(JSON.stringify(original), 'desktop-cache-key')

  assert.deepEqual(JSON.parse(next), original)
})
