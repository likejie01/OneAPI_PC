import type { TimelineEvent } from '../../entities/timeline/model.ts'

export interface ExecutionCycleInput {
  sessionId: string
  requestId: string
  intent: string
  finalPrompt: string
  commandTitle?: string
  command?: string
  resultDetail?: string
}

function createEvent(
  input: ExecutionCycleInput,
  phase: TimelineEvent['phase'],
  title: string,
  options: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id: `${input.requestId}-${phase}-${options.indentLevel ?? 0}-${title}`,
    sessionId: input.sessionId,
    requestId: input.requestId,
    phase,
    title,
    detail: options.detail,
    command: options.command,
    severity: options.severity || 'info',
    status: options.status || 'completed',
    indentLevel: options.indentLevel ?? 0,
    createdAt: options.createdAt || Date.now(),
    parentId: options.parentId,
    files: options.files,
    labels: options.labels,
    interaction: options.interaction,
  }
}

export function buildExecutionCycleEvents(input: ExecutionCycleInput): TimelineEvent[] {
  const rootId = `${input.requestId}-intent-root`
  return [
    {
      ...createEvent(input, 'intent', '执行意图', {
        detail: input.intent,
        status: 'running',
        labels: ['intent'],
      }),
      id: rootId,
    },
  ]
}
