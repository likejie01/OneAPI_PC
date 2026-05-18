import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCliRecentSessions,
  buildCliTimeline,
  filterAssistantModels,
  resolveCompatibleModel,
} from './assistant-workspace'

test('filterAssistantModels keeps only compatible CLI models', () => {
  const models = [
    { label: 'gpt-5.4', value: 'gpt-5.4' },
    { label: 'gpt-5.3-codex', value: 'gpt-5.3-codex' },
    { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
  ]

  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    ['gpt-5.3-codex']
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['claude-sonnet-4-6']
  )
  assert.deepEqual(
    filterAssistantModels('chat', models).map((item) => item.value),
    ['gpt-5.4', 'gpt-5.3-codex', 'claude-sonnet-4-6']
  )
})

test('resolveCompatibleModel falls back to preferred compatible model', () => {
  const models = [
    { label: 'gpt-5.4', value: 'gpt-5.4' },
    { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
  ]

  assert.equal(
    resolveCompatibleModel('claude', models, 'gpt-5.4', 'claude-sonnet-4-6'),
    'claude-sonnet-4-6'
  )
})

test('buildCliTimeline sorts messages and logs by timestamp', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 10 },
      { id: 'assistant-1', role: 'assistant', content: 'world', createdAt: 30, modelLabel: 'Codex' },
    ],
    logs: [
      { id: 'log-1', level: 'status', content: 'running', createdAt: 20_000 },
    ],
  })

  assert.deepEqual(
    timeline.map((item) => item.id),
    ['user-1', 'log-1', 'assistant-1']
  )
})

test('buildCliTimeline groups adjacent logs from same request', () => {
  const timeline = buildCliTimeline({
    messages: [],
    logs: [
      { id: 'log-1', requestId: 'req-1', level: 'status', content: 'step 1', createdAt: 10_000 },
      { id: 'log-2', requestId: 'req-1', level: 'status', content: 'step 2', createdAt: 11_000 },
      { id: 'log-3', requestId: 'req-1', level: 'error', content: 'boom', createdAt: 12_000 },
    ],
  })

  assert.equal(timeline.length, 2)
  assert.deepEqual(timeline[0], {
    id: 'log-1',
    kind: 'log',
    level: 'status',
    content: ['step 1', 'step 2'],
    createdAt: 11000,
    startedAt: 10000,
    requestId: 'req-1',
    sessionId: undefined,
    title: 'step 1',
    files: [],
  })
})

test('buildCliTimeline inserts grouped logs before assistant reply of same turn', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'done', createdAt: 3, modelLabel: 'Claude' },
    ],
    logs: [
      { id: 'log-1', requestId: 'req-1', level: 'status', content: 'step 1', createdAt: 2_000 },
      { id: 'log-2', requestId: 'req-1', level: 'status', content: 'step 2', createdAt: 2_500 },
    ],
  })

  assert.deepEqual(
    timeline.map((item) => item.id),
    ['user-1', 'log-1', 'assistant-1']
  )
})

test('buildCliRecentSessions prefers live session snapshots', () => {
  const items = buildCliRecentSessions({
    history: [
      {
        id: 'session-1',
        title: '旧标题',
        preview: '旧内容',
        updatedAt: 5,
        projectName: 'Old',
        projectPath: 'D:/Old',
      },
    ],
    sessionMessagesMap: {
      'session-1': [
        { id: 'user-1', role: 'user', content: '新消息', createdAt: 10 },
      ],
    },
    sessionLogsMap: {},
    sessionProjectPathMap: {
      'session-1': 'D:/Workspace/NewAPI',
    },
  })

  assert.equal(items[0]?.id, 'session-1')
  assert.equal(items[0]?.preview, '新消息')
  assert.equal(items[0]?.projectName, 'NewAPI')
})
