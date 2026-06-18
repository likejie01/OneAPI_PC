import type { CliInteractionPrompt } from '../../shared/desktop.ts'

export type TimelinePhase =
  | 'intent'
  | 'assembly'
  | 'prepare'
  | 'invoke'
  | 'result'
  | 'interaction_required'
  | 'warning'
  | 'error'
  | 'summary'

export type TimelineSeverity = 'info' | 'warning' | 'error'
export type TimelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked'

export interface TimelineEvent {
  id: string
  sessionId: string
  requestId: string
  parentId?: string
  phase: TimelinePhase
  title: string
  detail?: string
  command?: string
  severity: TimelineSeverity
  status: TimelineStatus
  indentLevel: number
  createdAt: number
  files?: Array<{ path: string; status?: string }>
  labels?: string[]
  interaction?: CliInteractionPrompt
}
