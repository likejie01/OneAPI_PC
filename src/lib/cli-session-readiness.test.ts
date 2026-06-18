import test from 'node:test'
import assert from 'node:assert/strict'
import type { CliSessionDetails } from '../shared/desktop.ts'
import { isCliSessionReadyForLatestTurn } from './cli-session-readiness.ts'

function createDetails(messages: CliSessionDetails['messages']): CliSessionDetails {
  return {
    id: 'session-1',
    client: 'codex',
    preview: '',
    updatedAt: messages.at(-1)?.createdAt || 0,
    projectName: 'demo',
    projectPath: 'D:\\demo',
    messages,
  }
}

function normalizeUserContent(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

test('isCliSessionReadyForLatestTurn rejects sessions that only contain the new user message', () => {
  const details = createDetails([
    {
      id: 'u1',
      role: 'user',
      content: '旧问题',
      createdAt: 1_700_000_000_000,
    },
    {
      id: 'a1',
      role: 'assistant',
      content: '旧回复',
      createdAt: 1_700_000_001_000,
    },
    {
      id: 'u2',
      role: 'user',
      content: '新问题',
      createdAt: 1_700_000_002_000,
    },
  ])

  assert.equal(
    isCliSessionReadyForLatestTurn(details, {
      expectedUserContent: '新问题',
      minUpdatedAtMs: 1_700_000_002_000,
      normalizeUserContent,
    }),
    false
  )
})

test('isCliSessionReadyForLatestTurn accepts sessions with an assistant reply after the matched user', () => {
  const details = createDetails([
    {
      id: 'u1',
      role: 'user',
      content: '旧问题',
      createdAt: 1_700_000_000_000,
    },
    {
      id: 'a1',
      role: 'assistant',
      content: '旧回复',
      createdAt: 1_700_000_001_000,
    },
    {
      id: 'u2',
      role: 'user',
      content: '用户任务：\n新问题',
      createdAt: 1_700_000_002_000,
    },
    {
      id: 'a2',
      role: 'assistant',
      content: '新回复',
      createdAt: 1_700_000_003_000,
    },
  ])

  assert.equal(
    isCliSessionReadyForLatestTurn(details, {
      expectedUserContent: '新问题',
      minUpdatedAtMs: 1_700_000_002_000,
      normalizeUserContent: (value) =>
        normalizeUserContent(value.replace(/^用户任务：\s*/, '')),
    }),
    true
  )
})
