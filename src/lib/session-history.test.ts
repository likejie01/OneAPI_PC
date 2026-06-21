import test from 'node:test'
import assert from 'node:assert/strict'
import type { CliSessionMessage } from '../shared/desktop.ts'
import {
  buildChatSessionExportMarkdown,
  buildCliSessionExportMarkdown,
  buildSessionExportFileName,
  canDeleteCliMessageFromSessionFile,
  hasActiveCliPlan,
  mergeCliMessages,
} from './session-history.ts'

test('mergeCliMessages keeps stable source location from hydrated duplicate messages', () => {
  const draftOnly: CliSessionMessage = {
    id: 'draft-1',
    role: 'assistant',
    content: '我先检查一下。',
    createdAt: 1700000001000,
    modelLabel: 'Codex',
  }
  const hydrated: CliSessionMessage = {
    id: 'hydrated-1',
    role: 'assistant',
    content: '我先检查一下。',
    createdAt: 1700000001000,
    modelLabel: 'Codex',
    sourceFilePath: 'C:\\Users\\test\\.codex\\sessions\\abc.jsonl',
    sourceLineNumber: 42,
    sourceTimestamp: '2026-05-23T08:00:00.000Z',
  }

  const merged = mergeCliMessages([draftOnly], [hydrated])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].sourceFilePath, hydrated.sourceFilePath)
  assert.equal(merged[0].sourceLineNumber, 42)
  assert.equal(merged[0].sourceTimestamp, hydrated.sourceTimestamp)
})

test('mergeCliMessages keeps fallback assistant replies when later hydration only contains user messages', () => {
  const fallbackTranscript: CliSessionMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      content: '第一轮',
      createdAt: 1700000001000,
      requestId: 'req-1',
    },
    {
      id: 'assistant-req-1',
      role: 'assistant',
      content: '第一轮回复',
      createdAt: 1700000002000,
      requestId: 'req-1',
      modelLabel: 'mimo-v2.5-pro',
    },
  ]
  const hydratedMessages: CliSessionMessage[] = [
    {
      id: 'user-1-hydrated',
      role: 'user',
      content: '第一轮',
      createdAt: 1700000001000,
      sourceFilePath: 'session.jsonl',
      sourceLineNumber: 1,
    },
    {
      id: 'user-2-hydrated',
      role: 'user',
      content: '第二轮',
      createdAt: 1700000003000,
      sourceFilePath: 'session.jsonl',
      sourceLineNumber: 2,
    },
  ]

  const merged = mergeCliMessages(fallbackTranscript, hydratedMessages)

  assert.deepEqual(
    merged.map((item) => `${item.role}:${item.content}`),
    ['user:第一轮', 'assistant:第一轮回复', 'user:第二轮']
  )
  assert.equal(merged[0].sourceLineNumber, 1)
})

test('mergeCliMessages dedupes wrapped user prompts against sanitized session hydration', () => {
  const draftOnly: CliSessionMessage = {
    id: 'draft-user-1',
    role: 'user',
    content: '请修复更新失败',
    createdAt: 1700000001000,
    requestId: 'req-fix-update',
  }
  const hydrated: CliSessionMessage = {
    id: 'hydrated-user-1',
    role: 'user',
    content: `用户任务：
请修复更新失败

以下内容是执行约束，不是需要你单独回答的用户问题；请直接完成上面的用户任务，不要复述这些约束。

权限上下文：
当前为全权限模式，可在用户任务需要时执行项目外读写。

执行策略：
1. 先选择最小修改量、最高成功率、最少副作用的方案。`,
    createdAt: 1700000003000,
    requestId: 'req-fix-update',
    sourceLineNumber: 9,
  }

  const merged = mergeCliMessages([draftOnly], [hydrated])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].content, hydrated.content)
  assert.equal(merged[0].sourceLineNumber, 9)
})

test('hasActiveCliPlan hides fully completed plans', () => {
  assert.equal(
    hasActiveCliPlan({
      explanation: 'all done',
      updatedAt: Date.now(),
      items: [
        { id: '1', step: 'done', status: 'completed' },
        { id: '2', step: 'done too', status: 'completed' },
      ],
    }),
    false
  )

  assert.equal(
    hasActiveCliPlan({
      explanation: 'running',
      updatedAt: Date.now(),
      items: [
        { id: '1', step: 'done', status: 'completed' },
        { id: '2', step: 'next', status: 'in_progress' },
      ],
    }),
    true
  )
})

test('canDeleteCliMessageFromSessionFile only allows hydrated session-file messages', () => {
  assert.equal(canDeleteCliMessageFromSessionFile({ sourceFilePath: 'C:\\Users\\test\\.claude\\abc.jsonl' }), true)
  assert.equal(canDeleteCliMessageFromSessionFile({ sourceLineNumber: 12 }), true)
  assert.equal(canDeleteCliMessageFromSessionFile({ sourceFilePath: '', sourceLineNumber: 0 }), false)
  assert.equal(canDeleteCliMessageFromSessionFile({}), false)
})

test('buildChatSessionExportMarkdown includes think content and attachments', () => {
  const markdown = buildChatSessionExportMarkdown({
    title: '测试聊天',
    updatedAt: 1,
    messages: [
      {
        id: 'u1',
        role: 'user',
        content: '帮我看下这个错误',
        createdAt: 1,
        attachments: [
          {
            id: 'a1',
            name: 'error.log',
            filePath: 'C:\\tmp\\error.log',
            kind: 'file',
          },
        ],
      },
      {
        id: 'a1',
        role: 'assistant',
        content: '这是一个依赖问题。',
        createdAt: 2,
        reasoningContent: '先确认依赖版本。',
      },
    ],
  })

  assert.match(markdown, /### Think/)
  assert.match(markdown, /error\.log/)
  assert.match(markdown, /这是一个依赖问题/)
})

test('buildCliSessionExportMarkdown includes plan and logs', () => {
  const markdown = buildCliSessionExportMarkdown({
    client: 'codex',
    title: 'CLI 会话',
    details: {
      id: 's1',
      client: 'codex',
      preview: '检查构建',
      updatedAt: 2,
      projectName: 'demo',
      projectPath: 'D:\\demo',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: '检查构建失败',
          createdAt: 1,
        },
      ],
      plan: {
        explanation: '先看日志',
        updatedAt: 2,
        items: [{ id: 'p1', step: '读取日志', status: 'completed' }],
      },
    },
    logs: [
      {
        title: '读取文件',
        createdAt: 2,
        events: [
          {
            kind: 'tool',
            message: 'read_file package.json',
            sourceKind: 'assistant.tool_use.read_file',
          },
        ],
      },
    ],
  })

  assert.match(markdown, /## 计划/)
  assert.match(markdown, /## 执行日志/)
  assert.match(markdown, /read_file package\.json/)
})

test('buildSessionExportFileName sanitizes reserved filename characters', () => {
  assert.equal(
    buildSessionExportFileName('chat', '项目: 构建/排错?'),
    'chat-项目 构建 排错.md'
  )
})
