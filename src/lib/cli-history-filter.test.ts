import test from 'node:test'
import assert from 'node:assert/strict'
import { isClaudeAssistantTerminalMessage } from './cli-history-filter.ts'

test('isClaudeAssistantTerminalMessage keeps final Claude replies', () => {
  assert.equal(
    isClaudeAssistantTerminalMessage({
      role: 'assistant',
      stopReason: 'end_turn',
    }),
    true
  )
})

test('isClaudeAssistantTerminalMessage filters intermediate Claude intent text', () => {
  assert.equal(
    isClaudeAssistantTerminalMessage({
      role: 'assistant',
      stopReason: null,
    }),
    false
  )
})

test('isClaudeAssistantTerminalMessage keeps Claude api error messages', () => {
  assert.equal(
    isClaudeAssistantTerminalMessage({
      role: 'assistant',
      stopReason: null,
      isApiErrorMessage: true,
    }),
    true
  )
})
