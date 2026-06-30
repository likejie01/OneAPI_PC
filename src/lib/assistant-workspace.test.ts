import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCliHistoryTitleOverrides,
  appendCliFallbackAssistantMessage,
  buildCliAbortLogEntry,
  buildCliRecentSessions,
  buildCliTimeline,
  compactCliSessionLogsMap,
  filterAssistantModels,
  filterModelsByVendor,
  MAX_CLI_LOG_DETAIL_CHARS,
  MAX_CLI_LOG_ENTRIES_PER_SESSION,
  MAX_CLI_LOG_TEXT_CHARS,
  MAX_CLI_LOGGED_SESSIONS,
  resolveCompatibleModel,
  resolveCliLogGroupStatus,
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
    ['gpt-5.4', 'gpt-5.3-codex', 'deepseek-v4-flash', 'mimo-v2.5', 'mimo-v2.5-pro']
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['claude-sonnet-4-6', 'deepseek-v4-flash', 'mimo-v2.5-pro']
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

test('filterAssistantModels exposes only DeepSeek and MIMO models with compatible CLI endpoints', () => {
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
    ['deepseek-v4-pro', 'mimo-v2.5']
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['mimo-v2.5-pro']
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

test('filterAssistantModels uses the DeepSeek and MIMO CLI support matrix when metadata is absent', () => {
  const models = [
    { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
    { label: 'deepseek-chat', value: 'deepseek-chat' },
    { label: 'mimo-v2.5-pro', value: 'mimo-v2.5-pro' },
    { label: 'mimo-v2.5', value: 'mimo-v2.5' },
    { label: 'mimo-v2-pro', value: 'mimo-v2-pro' },
  ]

  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    ['deepseek-v4-pro', 'mimo-v2.5-pro', 'mimo-v2.5']
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['deepseek-v4-pro', 'mimo-v2.5-pro']
  )
})

test('filterAssistantModels recognizes XiaomiMIMO prefixed model names', () => {
  const models = [
    { label: 'xiaomimimo-v2.5-pro', value: 'xiaomimimo-v2.5-pro' },
    { label: 'xiaomi-mimo-v2.5', value: 'xiaomi-mimo-v2.5' },
    { label: 'xiaomimimo-v2-pro', value: 'xiaomimimo-v2-pro' },
  ]

  assert.deepEqual(
    filterModelsByVendor(models, 'xiaomimimo').map((item) => item.value),
    ['xiaomimimo-v2.5-pro', 'xiaomi-mimo-v2.5', 'xiaomimimo-v2-pro']
  )
  assert.deepEqual(
    filterAssistantModels('chat', models).map((item) => item.value),
    ['xiaomimimo-v2.5-pro', 'xiaomi-mimo-v2.5', 'xiaomimimo-v2-pro']
  )
  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    ['xiaomimimo-v2.5-pro', 'xiaomi-mimo-v2.5']
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['xiaomimimo-v2.5-pro']
  )
})

test('filterAssistantModels recognizes provider-prefixed DeepSeek and MIMO model names', () => {
  const models = [
    { label: 'deepseek-ai/deepseek-v4-pro', value: 'deepseek-ai/deepseek-v4-pro' },
    { label: 'deepseek-ai/deepseek-v4-flash', value: 'deepseek-ai/deepseek-v4-flash' },
    { label: 'deepseek-ai/deepseek-chat', value: 'deepseek-ai/deepseek-chat' },
    { label: 'xiaomi/mimo-v2.5-pro', value: 'xiaomi/mimo-v2.5-pro' },
    { label: 'xiaomi/mimo-v2.5', value: 'xiaomi/mimo-v2.5' },
  ]

  assert.deepEqual(
    filterModelsByVendor(models, 'deepseek').map((item) => item.value),
    ['deepseek-ai/deepseek-v4-pro', 'deepseek-ai/deepseek-v4-flash', 'deepseek-ai/deepseek-chat']
  )
  assert.deepEqual(
    filterModelsByVendor(models, 'xiaomimimo').map((item) => item.value),
    ['xiaomi/mimo-v2.5-pro', 'xiaomi/mimo-v2.5']
  )
  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    [
      'deepseek-ai/deepseek-v4-pro',
      'deepseek-ai/deepseek-v4-flash',
      'xiaomi/mimo-v2.5-pro',
      'xiaomi/mimo-v2.5',
    ]
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['deepseek-ai/deepseek-v4-pro', 'deepseek-ai/deepseek-v4-flash', 'xiaomi/mimo-v2.5-pro']
  )
})

test('filterAssistantModels keeps MIMO models appended without pricing endpoint metadata', () => {
  const models = [
    {
      label: 'gpt-5.5',
      value: 'gpt-5.5',
      supportedEndpointTypes: ['openai-response'],
    },
    { label: 'mimo-v2.5-pro', value: 'mimo-v2.5-pro' },
    { label: 'mimo-v2.5', value: 'mimo-v2.5' },
  ]

  assert.deepEqual(
    filterAssistantModels('codex', models).map((item) => item.value),
    ['gpt-5.5', 'mimo-v2.5-pro', 'mimo-v2.5']
  )
  assert.deepEqual(
    filterAssistantModels('claude', models).map((item) => item.value),
    ['mimo-v2.5-pro']
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
    { label: 'deepseek-chat', value: 'deepseek-chat' },
    { label: 'mimo-v2-pro', value: 'mimo-v2-pro' },
  ]

  assert.equal(
    resolveCompatibleModel('claude', models, 'claude-sonnet-4-6', 'claude-sonnet-4-6'),
    ''
  )
})

test('compactCliSessionLogsMap bounds retained sessions and log payload size', () => {
  const logsBySession: Record<string, Array<{
    id: string
    level: 'status' | 'error'
    content: string
    createdAt: number
    detail?: string
    command?: string
  }>> = {}

  for (let sessionIndex = 0; sessionIndex < MAX_CLI_LOGGED_SESSIONS + 4; sessionIndex += 1) {
    const sessionId = `session-${sessionIndex}`
    logsBySession[sessionId] = Array.from({ length: MAX_CLI_LOG_ENTRIES_PER_SESSION + 6 }, (_, logIndex) => ({
      id: `${sessionId}-log-${logIndex}`,
      level: 'status',
      content: `content-${sessionIndex}-${logIndex}-${'x'.repeat(MAX_CLI_LOG_TEXT_CHARS + 20)}`,
      detail: `detail-${'d'.repeat(MAX_CLI_LOG_DETAIL_CHARS + 20)}`,
      command: `command-${'c'.repeat(MAX_CLI_LOG_DETAIL_CHARS + 20)}`,
      createdAt: sessionIndex * 1000 + logIndex,
    }))
  }

  const compacted = compactCliSessionLogsMap(logsBySession)
  const sessionIds = Object.keys(compacted)

  assert.equal(sessionIds.length, MAX_CLI_LOGGED_SESSIONS)
  assert.ok(!sessionIds.includes('session-0'))
  assert.ok(sessionIds.includes(`session-${MAX_CLI_LOGGED_SESSIONS + 3}`))

  for (const entries of Object.values(compacted)) {
    assert.equal(entries.length, MAX_CLI_LOG_ENTRIES_PER_SESSION)
    assert.ok(entries.every((entry) => entry.content.length <= MAX_CLI_LOG_TEXT_CHARS))
    assert.ok(entries.every((entry) => !entry.detail || entry.detail.length <= MAX_CLI_LOG_DETAIL_CHARS))
    assert.ok(entries.every((entry) => !entry.command || entry.command.length <= MAX_CLI_LOG_DETAIL_CHARS))
    assert.ok(entries.every((entry) => !entry.content.includes('x'.repeat(MAX_CLI_LOG_TEXT_CHARS + 1))))
  }
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
        done: undefined,
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
        done: undefined,
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
        done: undefined,
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

test('buildCliTimeline anchors each request log group after its own user message', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'first', createdAt: 100, requestId: 'req-1' },
      { id: 'user-2', role: 'user', content: 'second', createdAt: 120, requestId: 'req-2' },
    ],
    logs: [
      { id: 'log-1', requestId: 'req-1', level: 'status', content: 'first log', createdAt: 90 },
      { id: 'log-2', requestId: 'req-2', level: 'status', content: 'second log', createdAt: 95 },
    ],
  })

  assert.deepEqual(
    timeline.map((item) => item.id),
    ['user-1', 'log-1', 'user-2', 'log-2']
  )
})

test('buildCliTimeline preserves chronology when a request log is newer than the next user message', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'first', createdAt: 100, requestId: 'req-1' },
      { id: 'user-2', role: 'user', content: 'second', createdAt: 120, requestId: 'req-2' },
    ],
    logs: [
      { id: 'log-1', requestId: 'req-1', level: 'status', content: 'first log', createdAt: 200 },
      { id: 'log-2', requestId: 'req-2', level: 'status', content: 'second log', createdAt: 210 },
    ],
  })

  assert.deepEqual(
    timeline.map((item) => item.id),
    ['user-1', 'user-2', 'log-1', 'log-2']
  )
})

test('buildCliTimeline collapses repeated adjacent assistant paragraphs from streamed codex deltas', () => {
  const repeated = 'Let me write the JavaScript in a few batches. Good, now I need to add the JavaScript section.'
  const timeline = buildCliTimeline({
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [repeated, repeated, repeated, '最终改用 Python 写入文件。'].join('\n\n'),
        createdAt: 100,
        modelLabel: 'Codex',
        requestId: 'req-1',
      },
    ],
    logs: [],
  })

  assert.equal(
    timeline.find((item) => item.id === 'assistant-1' && item.kind === 'message')?.content,
    [repeated, '最终改用 Python 写入文件。'].join('\n\n')
  )
})

test('buildCliTimeline collapses repeated assistant sentence runs inside one paragraph', () => {
  const repeatedSentence = '好的，文件已经成功创建了。现在让我验证一下文件是否正确创建，并查看其内容。'
  const timeline = buildCliTimeline({
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: `${repeatedSentence} ${repeatedSentence} ${repeatedSentence}`,
        createdAt: 100,
        modelLabel: 'Codex',
        requestId: 'req-1',
      },
    ],
    logs: [],
  })

  assert.equal(
    timeline.find((item) => item.id === 'assistant-1' && item.kind === 'message')?.content,
    repeatedSentence
  )
})

test('buildCliTimeline splits request logs by assistant intent chunks for interleaved process flow', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'build page', createdAt: 1, requestId: 'req-1' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '我先创建文件。\n然后检查内容。\n最后总结结果。',
        createdAt: 10,
        modelLabel: 'Codex',
        requestId: 'req-1',
      },
    ],
    logs: [
      {
        id: 'log-intent-1',
        requestId: 'req-1',
        level: 'status',
        logKind: 'intent',
        sourceKind: 'intent.before_tool.Write',
        content: '执行意图',
        assistantChunk: '我先创建文件。',
        createdAt: 2,
      },
      {
        id: 'log-tool-1',
        requestId: 'req-1',
        level: 'status',
        logKind: 'tool',
        sourceKind: 'assistant.tool_use.Write',
        content: '写入文件',
        createdAt: 3,
      },
      {
        id: 'log-intent-2',
        requestId: 'req-1',
        level: 'status',
        logKind: 'intent',
        sourceKind: 'intent.before_tool.Read',
        content: '执行意图',
        assistantChunk: '然后检查内容。',
        createdAt: 4,
      },
      {
        id: 'log-tool-2',
        requestId: 'req-1',
        level: 'status',
        logKind: 'tool',
        sourceKind: 'assistant.tool_use.Read',
        content: '读取文件',
        createdAt: 5,
      },
    ],
  })

  const logs = timeline.filter((item): item is Extract<typeof item, { kind: 'log' }> => item.kind === 'log')
  assert.equal(logs.length, 2)
  assert.deepEqual(logs.map((item) => item.id), ['log-intent-1', 'log-intent-2'])
  assert.deepEqual(logs.map((item) => item.events.map((event) => event.id)), [
    ['log-intent-1', 'log-tool-1'],
    ['log-intent-2', 'log-tool-2'],
  ])
  assert.equal(
    timeline.find((item) => item.id === 'assistant-1' && item.kind === 'message')?.content,
    '最后总结结果。'
  )
})

test('buildCliTimeline carries selected skills and plugins onto each request log segment', () => {
  const timeline = buildCliTimeline({
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: 'fix bug',
        createdAt: 1,
        requestId: 'req-1',
        selectedExtensions: [
          {
            id: 'skill-debugging',
            client: 'codex',
            kind: 'skill',
            name: 'systematic-debugging',
            description: 'Debug systematically',
            path: 'skills/systematic-debugging/SKILL.md',
          },
          {
            id: 'plugin-browser',
            client: 'codex',
            kind: 'plugin',
            name: 'browser',
            description: 'Browser plugin',
            path: 'plugins/browser',
          },
        ],
      },
    ],
    logs: [
      {
        id: 'log-intent-1',
        requestId: 'req-1',
        level: 'status',
        logKind: 'intent',
        sourceKind: 'intent.before_tool.Read',
        content: '读取文件',
        assistantChunk: '我先读取文件。',
        createdAt: 2,
      },
      {
        id: 'log-intent-2',
        requestId: 'req-1',
        level: 'status',
        logKind: 'intent',
        sourceKind: 'intent.before_tool.Edit',
        content: '修改文件',
        assistantChunk: '然后修改文件。',
        createdAt: 3,
      },
    ],
  })

  const logs = timeline.filter((item): item is Extract<typeof item, { kind: 'log' }> => item.kind === 'log')
  assert.equal(logs.length, 2)
  assert.deepEqual(
    logs.map((item) => item.selectedExtensions?.map((extension) => `${extension.kind}:${extension.name}`)),
    [
      ['skill:systematic-debugging', 'plugin:browser'],
      ['skill:systematic-debugging', 'plugin:browser'],
    ],
  )
})

test('buildCliTimeline marks earlier split log segments completed when the same request has a terminal event', () => {
  const timeline = buildCliTimeline({
    messages: [
      { id: 'user-1', role: 'user', content: 'open file', createdAt: 1, requestId: 'req-1' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '我先检查文件。\n然后打开文件。\n完成了。',
        createdAt: 10,
        modelLabel: 'Codex',
        requestId: 'req-1',
      },
    ],
    logs: [
      {
        id: 'log-intent-1',
        requestId: 'req-1',
        level: 'status',
        logKind: 'intent',
        sourceKind: 'intent.before_tool.Read',
        content: '执行意图',
        assistantChunk: '我先检查文件。',
        createdAt: 2,
      },
      {
        id: 'log-intent-2',
        requestId: 'req-1',
        level: 'status',
        logKind: 'intent',
        sourceKind: 'intent.before_tool.Open',
        content: '执行意图',
        assistantChunk: '然后打开文件。',
        createdAt: 3,
      },
      {
        id: 'log-done',
        requestId: 'req-1',
        level: 'status',
        logKind: 'status',
        sourceKind: 'turn.completed',
        content: 'Codex 已完成本次回复。',
        done: true,
        createdAt: 4,
      },
    ],
  })

  const logs = timeline.filter((item): item is Extract<typeof item, { kind: 'log' }> => item.kind === 'log')
  assert.equal(logs.length, 2)
  assert.deepEqual(logs.map((item) => resolveCliLogGroupStatus(item.events, item.requestTerminalEvent)), [
    { tone: 'success', label: '已完成' },
    { tone: 'success', label: '已完成' },
  ])
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

test('resolveCliLogGroupStatus treats stream completion as a terminal completed state', () => {
  assert.deepEqual(
    resolveCliLogGroupStatus([
      {
        kind: 'status',
        level: 'status',
        sourceKind: 'request.started',
      },
      {
        kind: 'status',
        level: 'status',
        sourceKind: 'request.stream.completed',
      },
    ]),
    { tone: 'success', label: '已完成' }
  )

  assert.deepEqual(
    resolveCliLogGroupStatus([
      {
        kind: 'status',
        level: 'status',
        sourceKind: 'request.stream.completed',
      },
      {
        kind: 'error',
        level: 'error',
        sourceKind: 'request.failed',
      },
    ]),
    { tone: 'error', label: '执行失败' }
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

test('buildCliRecentSessions sorts by hydrated session messages over stale history timestamps', () => {
  const items = buildCliRecentSessions({
    history: [
      {
        id: 'stale-history',
        title: '错误时间',
        preview: '旧内容',
        updatedAt: 1_779_999_999,
        projectName: 'Old',
        projectPath: 'D:/Old',
      },
      {
        id: 'real-latest',
        title: '真实最新',
        preview: '旧内容',
        updatedAt: 1_700_000_000,
        projectName: 'New',
        projectPath: 'D:/New',
      },
    ],
    sessionMessagesMap: {
      'stale-history': [
        { id: 'user-old', role: 'user', content: '旧消息', createdAt: 1_700_000_000_000 },
      ],
      'real-latest': [
        { id: 'user-new', role: 'user', content: '新消息', createdAt: 1_800_000_000_000 },
      ],
    },
    sessionLogsMap: {},
    sessionProjectPathMap: {},
  })

  assert.equal(items[0]?.id, 'real-latest')
  assert.equal(items[0]?.preview, '新消息')
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
