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
  void input
  return []
}
