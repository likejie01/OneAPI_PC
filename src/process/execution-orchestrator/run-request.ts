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

export function buildExecutionCycleEvents(_input: ExecutionCycleInput): TimelineEvent[] {
  return []
}
