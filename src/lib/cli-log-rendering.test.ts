import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildCliFileChangePreview,
  formatCliLogRunTitle,
  formatCliLogStatusSummary,
  formatCliNarrativeTitle,
  formatCliProcessHeadline,
  formatCliToolDisplayName,
  shouldRenderCliLogCommandBlock,
  shouldRenderCliLogEventRow,
  shouldRenderCliLogOutputEntry,
} from './cli-log-rendering.ts'

test('shouldRenderCliLogEventRow hides duplicated status rows with no visible content', () => {
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: true,
      hasExpandableContent: false,
      hasInteraction: false,
    }),
    false
  )
})

test('shouldRenderCliLogEventRow keeps rows that still expose details or interactions', () => {
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: true,
      hasExpandableContent: true,
      hasInteraction: false,
    }),
    true
  )
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: true,
      hasExpandableContent: false,
      hasInteraction: true,
    }),
    true
  )
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: false,
      hasExpandableContent: false,
      hasInteraction: false,
    }),
    true
  )
})

test('shouldRenderCliLogOutputEntry hides first child when it duplicates the output group title', () => {
  assert.equal(
    shouldRenderCliLogOutputEntry({
      outputIndex: 0,
      entryHeadline: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
      entryDetail: '',
      groupHeadline: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
    }),
    false
  )
})

test('shouldRenderCliLogOutputEntry keeps non-duplicated output and duplicated rows with detail', () => {
  assert.equal(
    shouldRenderCliLogOutputEntry({
      outputIndex: 1,
      entryHeadline: 'Wall time: 0.1 seconds',
      entryDetail: '',
      groupHeadline: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
    }),
    true
  )
  assert.equal(
    shouldRenderCliLogOutputEntry({
      outputIndex: 0,
      entryHeadline: 'Output:',
      entryDetail: 'fatal: not a git repository',
      groupHeadline: 'Output:',
    }),
    true
  )
})

test('shouldRenderCliLogCommandBlock hides command block when JSON detail already contains the same command', () => {
  assert.equal(
    shouldRenderCliLogCommandBlock({
      command: 'powershell.exe -Command "New-Item -ItemType Directory"',
      detail: '{\n  "command": "powershell.exe -Command \\"New-Item -ItemType Directory\\""\n}',
    }),
    false
  )
})

test('shouldRenderCliLogCommandBlock keeps command block when detail does not include it', () => {
  assert.equal(
    shouldRenderCliLogCommandBlock({
      command: 'npm test',
      detail: '退出码：0',
    }),
    true
  )
})

test('formatCliProcessHeadline converts lifecycle source kinds to concise process text', () => {
  assert.equal(
    formatCliProcessHeadline({
      message: 'Codex 正在执行',
      kind: 'status',
      sourceKind: 'request.started',
    }),
    '开始处理请求'
  )
  assert.equal(
    formatCliProcessHeadline({
      message: 'done',
      kind: 'result',
      sourceKind: 'result.with_warnings',
    }),
    '执行完成，有警告'
  )
})

test('formatCliProcessHeadline summarizes command and output rows without leaking noisy internals', () => {
  assert.equal(
    formatCliProcessHeadline({
      message: '已运行 if (Test-Path PROJECT_CONTEXT.md) { Get-Content -Raw PROJECT_CONTEXT.md }',
      kind: 'command',
      command: 'if (Test-Path PROJECT_CONTEXT.md) { Get-Content -Raw PROJECT_CONTEXT.md }',
    }),
    '运行 Shell 命令'
  )
  assert.equal(
    formatCliProcessHeadline({
      message: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
      kind: 'stderr',
      sourceKind: 'stderr.command',
      detail: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
    }),
    '执行诊断'
  )
  assert.equal(
    formatCliProcessHeadline({
      message: 'Wall time: 0.1 seconds',
      kind: 'stdout',
      sourceKind: 'stdout.command',
      detail: 'Wall time: 0.1 seconds',
      command: 'npm test',
    }),
    '命令输出'
  )
})

test('formatCliProcessHeadline names common Codex and Claude tool work precisely', () => {
  assert.equal(
    formatCliProcessHeadline({
      message: '正在执行 shell_command：npm test',
      kind: 'tool',
      sourceKind: 'codex.tool_use.shell_command',
      detail: '{"command":"npm test","workdir":"D:\\\\WorkSpace\\\\NewAPI\\\\OneAPI_PC"}',
    }),
    '运行 Shell 命令'
  )
  assert.equal(
    formatCliProcessHeadline({
      message: '正在执行 Read',
      kind: 'tool',
      sourceKind: 'assistant.tool_use.Read',
      detail: '{"file_path":"D:\\\\WorkSpace\\\\NewAPI\\\\OneAPI_PC\\\\src\\\\App.tsx"}',
    }),
    '读取文件 App.tsx'
  )
  assert.equal(
    formatCliProcessHeadline({
      message: '正在执行 Edit',
      kind: 'tool',
      sourceKind: 'assistant.tool_use.Edit',
      detail: '{"file_path":"D:\\\\WorkSpace\\\\NewAPI\\\\OneAPI_PC\\\\src\\\\styles\\\\polish.css"}',
    }),
    '编辑文件 polish.css'
  )
  assert.equal(
    formatCliProcessHeadline({
      message: '正在执行 Grep',
      kind: 'tool',
      sourceKind: 'agent_progress.tool_use.Grep',
      detail: '{"pattern":"cli-log-entry","path":"src"}',
    }),
    '搜索项目内容'
  )
})

test('formatCliNarrativeTitle keeps process headings short and filters structured noise', () => {
  assert.equal(
    formatCliNarrativeTitle({
      assistantChunk: '我会先检查日志结构，然后补充测试。',
      detail: '{"file_path":"App.tsx"}',
      message: 'fallback',
    }),
    '我会先检查日志结构，然后补充测试。'
  )
  assert.equal(
    formatCliNarrativeTitle({
      detail: '{"file_path":"App.tsx"}',
      message: '正在执行 Read',
      fallback: '执行 1',
    }),
    '正在执行 Read'
  )
  assert.equal(
    formatCliNarrativeTitle({
      message: 'a'.repeat(120),
    }),
    `${'a'.repeat(95)}...`
  )
})

test('formatCliLogRunTitle and status summary produce product-facing execution copy', () => {
  assert.equal(
    formatCliLogRunTitle({
      eventCount: 8,
      commandCount: 2,
      toolCount: 3,
      diagnosticCount: 1,
    }),
    '正在处理：2 个命令 · 3 次工具调用 · 1 条诊断'
  )
  assert.equal(
    formatCliLogRunTitle({
      eventCount: 4,
      statusTone: 'error',
      commandCount: 1,
    }),
    '执行过程出现异常'
  )
  assert.equal(
    formatCliLogStatusSummary({
      eventCount: 8,
      commandCount: 2,
      toolCount: 3,
      diagnosticCount: 1,
      interactionCount: 0,
      updatedAt: '10:32:18',
    }),
    '命令 2 · 工具 3 · 诊断 1 · 过程 8 · 更新 10:32:18'
  )
})

test('formatCliToolDisplayName hides raw cli tool identifiers in visible chips', () => {
  assert.equal(formatCliToolDisplayName('shell_command'), 'Shell')
  assert.equal(formatCliToolDisplayName('Read'), '读取')
  assert.equal(formatCliToolDisplayName('MultiEdit'), '编辑')
  assert.equal(formatCliToolDisplayName('Grep'), '搜索')
  assert.equal(formatCliToolDisplayName('todo_write'), '计划')
})

test('buildCliFileChangePreview counts additions and deletions from unified diff', () => {
  const preview = buildCliFileChangePreview({
    path: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC\\src\\styles\\polish.css',
    kind: 'modified',
    diff: [
      '--- a/src/styles/polish.css',
      '+++ b/src/styles/polish.css',
      '@@ -3148,4 +3148,4 @@',
      '-  justify-content: flex-end !important;',
      '+  justify-content: flex-start !important;',
      '   gap: 4px !important;',
      '-  max-width: min(42%, 360px) !important;',
      '+  max-width: none !important;',
    ].join('\n'),
  })

  assert.equal(preview.fileName, 'polish.css')
  assert.equal(preview.added, 2)
  assert.equal(preview.deleted, 2)
  assert.deepEqual(
    preview.lines.map((line) => line.type),
    ['meta', 'meta', 'hunk', 'delete', 'add', 'context', 'delete', 'add']
  )
})

test('buildCliFileChangePreview falls back to content for non-diff files', () => {
  const preview = buildCliFileChangePreview({
    path: 'index.html',
    kind: 'created',
    content: '<main>\n  Hello\n</main>',
  })

  assert.equal(preview.fileName, 'index.html')
  assert.equal(preview.added, 3)
  assert.equal(preview.deleted, 0)
  assert.deepEqual(preview.lines.map((line) => line.type), ['add', 'add', 'add'])
})
