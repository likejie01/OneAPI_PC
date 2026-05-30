import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCliHistoryTitleOverrides,
  appendCliFallbackAssistantMessage,
  buildCliAbortLogEntry,
  buildCliRecentSessions,
  buildCliTimeline,
  filterAssistantModels,
  filterModelsByVendor,
  resolveCompatibleModel,
} from './assistant-workspace.ts'

test('filterAssistantModels keeps only compatible CLI models', () => {
  const models = [
    { label: 'gpt-5.4', value: 'gpt-5.4' },
    { label: 'gpt-5.3-codex', value: 'gpt-5.3-codex' },
    { label: 'gpt-image-2', value: 'gpt-image-2' },
    { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
    { label: 'deepseek-v4-flash', value: 'deepseek-v4-flash' },
    { label: 'deepseek-chat', value: 'deepseek-chat' },
    { label: 'mimo-v2.5', value: 'mimo-v2.5' },
    { label: 'mimo-v2.5-pro', value: 'mimo-v2.5-pro' },
    { label: 'gemini-2.5-pro', value: 'gemini-2.5-pro' },
    { label: 'gemini-2.5-flash', value: 'gemini-2.5-flash' },
  ]

  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    ['gpt-5.4', 'gpt-5.3-codex']
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['claude-sonnet-4-6']
  )
  assert.deepEqual(
    filterAssistantModels('chat', models).map((item) => item.value),
    [
      'gpt-5.4',
      'gpt-5.3-codex',
      'claude-sonnet-4-6',
      'deepseek-v4-flash',
      'deepseek-chat',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ]
  )
  assert.deepEqual(
    filterAssistantModels('draw', models).map((item) => item.value),
    ['gpt-image-2']
  )
})

test('filterModelsByVendor exposes Gemini models under the Gemini filter', () => {
  const models = [
    { label: 'gemini-2.5-pro', value: 'gemini-2.5-pro' },
    { label: 'google-gemini-pro', value: 'google-gemini-pro' },
    { label: 'gpt-5.4', value: 'gpt-5.4' },
  ]

  assert.deepEqual(
    filterModelsByVendor(models, 'gemini').map((item) => item.value),
    ['gemini-2.5-pro', 'google-gemini-pro']
  )
})

test('filterAssistantModels does not treat compatible endpoints as the Claude or Codex brand', () => {
  const models = [
    {
      label: 'deepseek-chat-only',
      value: 'deepseek-chat-only',
      supportedEndpointTypes: ['openai'],
    },
    {
      label: 'deepseek-codex-compatible',
      value: 'deepseek-v4-pro',
      supportedEndpointTypes: ['openai-response'],
    },
    {
      label: 'mimo-claude-compatible',
      value: 'mimo-v2.5-pro',
      supportedEndpointTypes: ['anthropic', 'openai'],
    },
    {
      label: 'mimo-full',
      value: 'mimo-v2.5',
      supportedEndpointTypes: ['openai-response', 'openai'],
    },
    {
      label: 'mimo-chat-only',
      value: 'mimo-v2-pro',
      supportedEndpointTypes: ['openai'],
    },
    {
      label: 'deepseek-chat-legacy',
      value: 'deepseek-chat',
      supportedEndpointTypes: ['anthropic', 'openai-response', 'openai'],
    },
  ]

  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    []
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    []
  )
})

test('filterAssistantModels keeps OpenAI text and codex models visible for codex when metadata reports openai endpoints', () => {
  const models = [
    {
      label: 'gpt-5.4',
      value: 'gpt-5.4',
      supportedEndpointTypes: ['openai'],
    },
    {
      label: 'gpt-5-codex',
      value: 'gpt-5-codex',
      supportedEndpointTypes: ['openai-response'],
    },
    {
      label: 'deepseek-chat-only',
      value: 'deepseek-chat-only',
      supportedEndpointTypes: ['openai'],
    },
  ]

  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    ['gpt-5.4', 'gpt-5-codex']
  )
})

test('filterAssistantModels keeps chat mode on all non-image models when metadata is present', () => {
  const models = [
    {
      label: 'gpt-5.4',
      value: 'gpt-5.4',
      supportedEndpointTypes: ['openai-response'],
    },
    {
      label: 'claude-sonnet-4-6',
      value: 'claude-sonnet-4-6',
      supportedEndpointTypes: ['anthropic'],
    },
    {
      label: 'deepseek-chat',
      value: 'deepseek-chat',
      supportedEndpointTypes: ['openai'],
    },
    {
      label: 'gpt-image-2',
      value: 'gpt-image-2',
      supportedEndpointTypes: ['openai'],
    },
  ]

  assert.deepEqual(
    filterAssistantModels('chat', models).map((item) => item.value),
    ['gpt-5.4', 'claude-sonnet-4-6', 'deepseek-chat']
  )
})

test('filterAssistantModels does not infer Claude or Codex brand from DeepSeek and MIMO model names', () => {
  const models = [
    { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
    { label: 'deepseek-chat', value: 'deepseek-chat' },
    { label: 'mimo-v2.5-pro', value: 'mimo-v2.5-pro' },
    { label: 'mimo-v2.5', value: 'mimo-v2.5' },
    { label: 'mimo-v2-pro', value: 'mimo-v2-pro' },
  ]

  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    []
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    []
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

test('resolveCompatibleModel returns empty when no compatible model exists', () => {
  const models = [
    { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
    { label: 'mimo-v2.5-pro', value: 'mimo-v2.5-pro' },
  ]

  assert.equal(
    resolveCompatibleModel('claude', models, 'claude-sonnet-4-6', 'claude-sonnet-4-6'),
    ''
  )
})

test('buildCliTimeline sorts messages and logs by timestamp', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 10 },
      { id: 'assistant-1', role: 'assistant', content: 'world', createdAt: 30, modelLabel: 'Codex' },
    ],
    logs: [
      { id: 'log-1', level: 'status', content: 'running', createdAt: 20 },
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

  assert.equal(timeline.length, 1)
  assert.deepEqual(timeline[0], {
    id: 'log-1',
    kind: 'log',
    level: 'error',
    title: 'step 1',
    createdAt: 12000000,
    startedAt: 10000000,
    requestId: 'req-1',
    sessionId: undefined,
    files: [],
    events: [
      {
        id: 'log-1',
        level: 'status',
        kind: 'status',
        sourceKind: undefined,
        message: 'step 1',
        assistantChunk: undefined,
        indentLevel: undefined,
        createdAt: 10000000,
        detail: undefined,
        command: undefined,
        exitCode: undefined,
        files: [],
      },
      {
        id: 'log-2',
        level: 'status',
        kind: 'status',
        sourceKind: undefined,
        message: 'step 2',
        assistantChunk: undefined,
        indentLevel: undefined,
        createdAt: 11000000,
        detail: undefined,
        command: undefined,
        exitCode: undefined,
        files: [],
      },
      {
        id: 'log-3',
        level: 'error',
        kind: 'error',
        sourceKind: undefined,
        message: 'boom',
        assistantChunk: undefined,
        indentLevel: undefined,
        createdAt: 12000000,
        detail: undefined,
        command: undefined,
        exitCode: undefined,
        files: [],
      },
    ],
  })
})

test('buildCliTimeline inserts grouped logs before assistant reply of same turn', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'done', createdAt: 3, modelLabel: 'Claude' },
    ],
    logs: [
      { id: 'log-1', requestId: 'req-1', level: 'status', content: 'step 1', createdAt: 2 },
      { id: 'log-2', requestId: 'req-1', level: 'status', content: 'step 2', createdAt: 2.5 },
    ],
  })

  assert.deepEqual(
    timeline.map((item) => item.id),
    ['user-1', 'log-1', 'assistant-1']
  )
})

test('appendCliFallbackAssistantMessage persists CLI output when session hydration has no assistant message', () => {
  const messages = [
    { id: 'user-1', role: 'user' as const, content: 'hello', createdAt: 10, requestId: 'req-1' },
  ]

  const next = appendCliFallbackAssistantMessage(messages, {
    id: 'assistant-req-1',
    content: 'done',
    createdAt: 11,
    requestId: 'req-1',
    modelLabel: 'deepseek-v4-pro',
  })

  assert.deepEqual(
    next.map((item) => ({ id: item.id, role: item.role, content: item.content, requestId: item.requestId })),
    [
      { id: 'user-1', role: 'user', content: 'hello', requestId: 'req-1' },
      { id: 'assistant-req-1', role: 'assistant', content: 'done', requestId: 'req-1' },
    ]
  )
})

test('appendCliFallbackAssistantMessage does not duplicate hydrated assistant replies', () => {
  const messages = [
    { id: 'assistant-1', role: 'assistant' as const, content: 'done', createdAt: 12, requestId: 'req-1' },
  ]

  const next = appendCliFallbackAssistantMessage(messages, {
    id: 'assistant-req-1',
    content: 'done',
    createdAt: 13,
    requestId: 'req-1',
  })

  assert.equal(next, messages)
})

test('buildCliTimeline keeps grouped logs after the user bubble even when log timestamps skew earlier', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 100 },
      { id: 'assistant-1', role: 'assistant', content: 'done', createdAt: 300, modelLabel: 'Claude' },
    ],
    logs: [
      { id: 'log-1', requestId: 'req-1', level: 'status', content: 'step 1', createdAt: 90 },
      { id: 'log-2', requestId: 'req-1', level: 'status', content: 'step 2', createdAt: 120 },
    ],
  })

  assert.deepEqual(
    timeline.map((item) => item.id),
    ['user-1', 'log-1', 'assistant-1']
  )
})

test('buildCliTimeline strips assistant intent chunks already attached to logs', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 1, requestId: 'req-1' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '先检查项目结构。\n然后读取 package.json。\n已经完成修复。',
        createdAt: 4,
        modelLabel: 'Codex',
        requestId: 'req-1',
      },
    ],
    logs: [
      {
        id: 'log-1',
        requestId: 'req-1',
        level: 'status',
        content: '执行目的',
        assistantChunk: '先检查项目结构。',
        createdAt: 2,
      },
      {
        id: 'log-2',
        requestId: 'req-1',
        level: 'status',
        content: '执行目的',
        assistantChunk: '然后读取 package.json。',
        createdAt: 3,
      },
    ],
  })

  assert.deepEqual(
    timeline.map((item) => item.id),
    ['user-1', 'log-1', 'assistant-1']
  )
  assert.equal(
    timeline.find((item) => item.id === 'assistant-1' && item.kind === 'message')?.content,
    '已经完成修复。'
  )
})

test('buildCliAbortLogEntry creates a terminal stopped log for optimistic UI state', () => {
  assert.deepEqual(
    buildCliAbortLogEntry({
      client: 'codex',
      requestId: 'codex-1',
      sessionId: 'session-1',
      createdAt: 100,
    }),
    {
      id: 'codex-1-aborted-100',
      requestId: 'codex-1',
      sessionId: 'session-1',
      level: 'status',
      logKind: 'status',
      sourceKind: 'request.aborted',
      content: 'Codex 已停止本次回复。',
      createdAt: 100,
    }
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

test('applyCliHistoryTitleOverrides only overrides title and keeps preview intact', () => {
  const items = applyCliHistoryTitleOverrides(
    [
      {
        id: 'session-1',
        title: '旧标题',
        preview: '真实历史内容',
        updatedAt: 10,
        projectName: 'NewAPI',
        projectPath: 'D:/Workspace/NewAPI',
      },
    ],
    {
      'session-1': '自定义标题',
    }
  )

  assert.deepEqual(items, [
    {
      id: 'session-1',
      title: '自定义标题',
      preview: '真实历史内容',
      updatedAt: 10,
      projectName: 'NewAPI',
      projectPath: 'D:/Workspace/NewAPI',
    },
  ])
})
