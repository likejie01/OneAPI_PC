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
  void _input
  // Synthetic orchestration logs should only describe runtime-only context.
  // Echoing the user's prompt here duplicates the conversation bubble and
  // pollutes both desktop and mobile execution timelines.
  return []
}
