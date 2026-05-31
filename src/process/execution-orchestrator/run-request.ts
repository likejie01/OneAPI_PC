import type { TimelineEvent } from '../../entities/timeline/model.ts'

export interface ExecutionCycleInput {
  sessionId: string
  requestId: string
  intent: string
  finalPrompt: string
  commandTitle?: string
  command?: string
  resultDetail?: string
  extensions?: Array<{ kind: string; name: string }>
}

export function buildExecutionCycleEvents(input: ExecutionCycleInput): TimelineEvent[] {
  // Synthetic orchestration logs should only describe runtime-only context.
  // Echoing the user's prompt here duplicates the conversation bubble and
  // pollutes both desktop and mobile execution timelines.
  const now = Date.now()
  const extensionNames = (input.extensions || [])
    .map((item) => `${item.kind}:${item.name}`.trim())
    .filter(Boolean)
  const detailParts = [
    extensionNames.length ? `已启用扩展：${extensionNames.join('、')}` : '',
    input.finalPrompt !== input.intent ? '已合并附件、扩展和执行策略。' : '使用原始任务内容进入执行阶段。',
  ].filter(Boolean)

  return [
    {
      id: `${input.requestId}-orchestrator-intent`,
      sessionId: input.sessionId,
      requestId: input.requestId,
      phase: 'intent',
      title: '分析需求',
      detail: '已接收任务，开始准备执行上下文。',
      severity: 'info',
      status: 'completed',
      indentLevel: 0,
      createdAt: now,
    },
    {
      id: `${input.requestId}-orchestrator-assembly`,
      sessionId: input.sessionId,
      requestId: input.requestId,
      phase: 'assembly',
      title: input.commandTitle || '扩展与上下文准备',
      detail: detailParts.join('\n'),
      severity: 'info',
      status: 'completed',
      indentLevel: 0,
      createdAt: now + 1,
    },
    {
      id: `${input.requestId}-orchestrator-invoke`,
      sessionId: input.sessionId,
      requestId: input.requestId,
      phase: 'invoke',
      title: '启动执行',
      detail: input.resultDetail || '正在等待 CLI 返回执行日志。',
      command: input.command,
      severity: 'info',
      status: 'running',
      indentLevel: 0,
      createdAt: now + 2,
    },
  ]
}
