import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCliResumeSessionId,
  isDraftCliSessionId,
  shouldAppendCliAssistantFallback,
} from './cli-session.ts'

test('isDraftCliSessionId recognizes generated draft ids only', () => {
  assert.equal(isDraftCliSessionId('draft-codex-1710000000000'), true)
  assert.equal(isDraftCliSessionId('draft-claude-1710000000000'), true)
  assert.equal(isDraftCliSessionId('thread_abc123'), false)
  assert.equal(isDraftCliSessionId(''), false)
  assert.equal(isDraftCliSessionId(undefined), false)
})

test('getCliResumeSessionId skips draft and empty ids', () => {
  assert.equal(getCliResumeSessionId(''), undefined)
  assert.equal(getCliResumeSessionId('   '), undefined)
  assert.equal(getCliResumeSessionId('draft-codex-1710000000000'), undefined)
  assert.equal(getCliResumeSessionId('draft-claude-1710000000000'), undefined)
  assert.equal(getCliResumeSessionId('thread_abc123'), 'thread_abc123')
})

test('shouldAppendCliAssistantFallback keeps output when transcript is not hydrated yet', () => {
  assert.equal(
    shouldAppendCliAssistantFallback({
      responseSessionId: '',
      responseAborted: false,
      hydratedSessionId: null,
    }),
    true
  )

  assert.equal(
    shouldAppendCliAssistantFallback({
      responseSessionId: 'thread_abc123',
      responseAborted: false,
      hydratedSessionId: null,
    }),
    true
  )

  assert.equal(
    shouldAppendCliAssistantFallback({
      responseSessionId: 'thread_abc123',
      responseAborted: false,
      hydratedSessionId: 'thread_abc123',
    }),
    false
  )

  assert.equal(
    shouldAppendCliAssistantFallback({
      responseSessionId: 'thread_abc123',
      responseAborted: true,
      hydratedSessionId: 'thread_abc123',
    }),
    true
  )
})
