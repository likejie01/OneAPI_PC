import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveDesktopChatDisplayState,
  normalizeStoredDesktopChatMessage,
  parseDesktopChatStreamDataLine,
} from './chat-reasoning.ts'

test('deriveDesktopChatDisplayState extracts think tags into reasoning', () => {
  const result = deriveDesktopChatDisplayState(
    'Before<think>step one\nstep two</think>After',
    ''
  )

  assert.equal(result.visibleContent, 'BeforeAfter')
  assert.equal(result.reasoningContent, 'step one\nstep two')
  assert.equal(result.hasUnclosedReasoningTag, false)
})

test('deriveDesktopChatDisplayState keeps unclosed think tags pending', () => {
  const result = deriveDesktopChatDisplayState(
    'Answer<think>still thinking',
    ''
  )

  assert.equal(result.visibleContent, 'Answer')
  assert.equal(result.reasoningContent, 'still thinking')
  assert.equal(result.hasUnclosedReasoningTag, true)
})

test('deriveDesktopChatDisplayState prefers direct reasoning stream when present', () => {
  const result = deriveDesktopChatDisplayState(
    'Visible<think>tag reasoning</think>',
    'api reasoning'
  )

  assert.equal(result.visibleContent, 'Visible')
  assert.equal(result.reasoningContent, 'api reasoning')
})

test('normalizeStoredDesktopChatMessage strips think tags from stored content', () => {
  const normalized = normalizeStoredDesktopChatMessage({
    id: 'assistant-1',
    role: 'assistant',
    content: 'Hello<think>hidden chain</think>World',
    createdAt: 1,
  })

  assert.equal(normalized.content, 'HelloWorld')
  assert.equal(normalized.reasoningContent, 'hidden chain')
  assert.equal(normalized.reasoningPending, false)
})

test('parseDesktopChatStreamDataLine recognizes done sentinel', () => {
  const parsed = parseDesktopChatStreamDataLine('[DONE]')

  assert.equal(parsed?.done, true)
  assert.equal(parsed?.deltaText, '')
  assert.equal(parsed?.reasoningText, '')
})

test('parseDesktopChatStreamDataLine recognizes finish_reason completion', () => {
  const parsed = parseDesktopChatStreamDataLine(
    JSON.stringify({
      choices: [
        {
          delta: {
            content: 'done',
          },
          finish_reason: 'stop',
        },
      ],
    })
  )

  assert.equal(parsed?.deltaText, 'done')
  assert.equal(parsed?.done, true)
})

test('parseDesktopChatStreamDataLine joins array reasoning parts', () => {
  const parsed = parseDesktopChatStreamDataLine(
    JSON.stringify({
      choices: [
        {
          delta: {
            reasoning_content: [
              { text: 'first ' },
              'second',
            ],
          },
        },
      ],
    })
  )

  assert.equal(parsed?.reasoningText, 'first second')
  assert.equal(parsed?.done, false)
})
