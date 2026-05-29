import type { TimelineEvent } from '../../entities/timeline/model.ts'

export interface ExecutionCycleInput {
  sessionId: string
  requestId: string
  intent: string
  finalPrompt: string
  commandTitle?: string
  command?: string
  resultDetail?: string
  extensions?: Array<{
    kind: 'command' | 'skill' | 'plugin'
    name: string
  }>
}

function formatExtensionSummary(
  items: Array<{
    kind: 'command' | 'skill' | 'plugin'
    name: string
  }>
) {
  if (!items.length) {
    return '未显式指定技能或插件，按当前任务自动判断。'
  }

  return items
    .map((item) => {
      const prefix =
        item.kind === 'skill'
          ? '技能'
          : item.kind === 'plugin'
            ? '插件'
            : '命令'
      return `${prefix} ${item.name}`
    })
    .join(' · ')
}

export function buildExecutionCycleEvents(input: ExecutionCycleInput): TimelineEvent[] {
  const now = Date.now()
  const base = {
    sessionId: input.sessionId,
    requestId: input.requestId,
    severity: 'info' as const,
    status: 'running' as const,
  }

  return [
    {
      ...base,
      id: `${input.requestId}-analysis`,
      phase: 'intent',
      title: '分析需求',
      detail: '正在核对任务目标、项目上下文与实际改动范围。',
      indentLevel: 0,
      createdAt: now,
    },
    {
      ...base,
      id: `${input.requestId}-extensions`,
      phase: 'intent',
      title: '选择技能/插件',
      detail: formatExtensionSummary(input.extensions || []),
      indentLevel: 0,
      createdAt: now + 1,
    },
    {
      ...base,
      id: `${input.requestId}-prepare`,
      phase: 'prepare',
      title: input.commandTitle?.trim() || '准备执行',
      detail: '已组装目录、权限、附件与扩展上下文，准备启动 CLI 执行。',
      command: input.command?.trim() || undefined,
      indentLevel: 0,
      createdAt: now + 2,
    },
  ]
}
