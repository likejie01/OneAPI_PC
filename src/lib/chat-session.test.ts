import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAssistantSelectionToEmptyChatSession,
  resolveChatSessionAssistant,
  shouldCreateAssistantSwitchChatSession,
} from './chat-session.ts'

test('shouldCreateAssistantSwitchChatSession forks only when switching away from a non-empty session', () => {
  assert.equal(shouldCreateAssistantSwitchChatSession(null, 'assistant-b'), true)
  assert.equal(
    shouldCreateAssistantSwitchChatSession(
      { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 10, messages: [] },
      'assistant-b'
    ),
    false
  )
  assert.equal(
    shouldCreateAssistantSwitchChatSession(
      { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 10, messages: [{}] },
      'assistant-b'
    ),
    true
  )
  assert.equal(
    shouldCreateAssistantSwitchChatSession(
      { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 10, messages: [{}] },
      'assistant-a'
    ),
    false
  )
})

test('applyAssistantSelectionToEmptyChatSession updates assistant binding without shrinking timestamp', () => {
  const updated = applyAssistantSelectionToEmptyChatSession(
    { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 20, messages: [] },
    'assistant-b',
    'deepseek-chat',
    'vip',
    15
  )

  assert.deepEqual(updated, {
    assistantId: 'assistant-b',
    model: 'deepseek-chat',
    group: 'vip',
    updatedAt: 20,
    messages: [],
  })
})

test('resolveChatSessionAssistant prefers the assistant bound to the active session', () => {
  const assistants = [
    { id: 'assistant-global', name: 'global' },
    { id: 'assistant-session', name: 'session' },
  ]

  assert.equal(
    resolveChatSessionAssistant(
      assistants,
      { assistantId: 'assistant-session' },
      'assistant-global'
    )?.id,
    'assistant-session'
  )
})

test('resolveChatSessionAssistant falls back to global assistant and first assistant', () => {
  const assistants = [
    { id: 'assistant-first', name: 'first' },
    { id: 'assistant-global', name: 'global' },
  ]

  assert.equal(resolveChatSessionAssistant(assistants, null, 'assistant-global')?.id, 'assistant-global')
  assert.equal(resolveChatSessionAssistant(assistants, { assistantId: 'missing' }, 'missing')?.id, 'assistant-first')
})
