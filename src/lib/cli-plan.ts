export type CliPlanStatus = 'pending' | 'in_progress' | 'completed'

export type CliPlanItem = {
  id: string
  step: string
  status: CliPlanStatus
}

export type CliPlanState = {
  explanation: string
  items: CliPlanItem[]
  updatedAt: number
}

export type ClaudePlanMutation =
  | {
      kind: 'create'
      taskId: string
      subject: string
      status: CliPlanStatus
      updatedAt: number
    }
  | {
      kind: 'status'
      taskId: string
      status: CliPlanStatus
      updatedAt: number
    }

type CliPlanAccumulator = {
  explanation: string
  updatedAt: number
  items: Map<string, CliPlanItem>
  order: string[]
}

function toTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
  }
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? Math.floor(numeric) : Math.floor(numeric * 1000)
    }
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}

function normalizePlanStatus(value: unknown): CliPlanStatus | null {
  if (typeof value !== 'string') {
    return null
  }
  switch (value.trim().toLowerCase()) {
    case 'pending':
      return 'pending'
    case 'in_progress':
    case 'in-progress':
    case 'active':
    case 'running':
      return 'in_progress'
    case 'completed':
    case 'complete':
    case 'done':
    case 'success':
      return 'completed'
    default:
      return null
  }
}

function createPlanAccumulator(): CliPlanAccumulator {
  return {
    explanation: '',
    updatedAt: 0,
    items: new Map<string, CliPlanItem>(),
    order: [],
  }
}

function snapshotPlanAccumulator(accumulator: CliPlanAccumulator): CliPlanState | null {
  if (accumulator.order.length === 0) {
    return null
  }
  return {
    explanation: accumulator.explanation,
    items: accumulator.order
      .map((id) => accumulator.items.get(id))
      .filter((item): item is CliPlanItem => !!item),
    updatedAt: accumulator.updatedAt || Date.now(),
  }
}

function setCodexPlanState(accumulator: CliPlanAccumulator, state: CliPlanState) {
  accumulator.explanation = state.explanation
  accumulator.updatedAt = state.updatedAt
  accumulator.items = new Map(state.items.map((item) => [item.id, item]))
  accumulator.order = state.items.map((item) => item.id)
}

function applyClaudePlanMutation(accumulator: CliPlanAccumulator, mutation: ClaudePlanMutation) {
  if (mutation.kind === 'create') {
    if (!accumulator.items.has(mutation.taskId)) {
      accumulator.order.push(mutation.taskId)
    }
    accumulator.items.set(mutation.taskId, {
      id: mutation.taskId,
      step: mutation.subject,
      status: mutation.status,
    })
    accumulator.updatedAt = mutation.updatedAt
    return
  }

  const current = accumulator.items.get(mutation.taskId)
  if (!current) {
    accumulator.order.push(mutation.taskId)
    accumulator.items.set(mutation.taskId, {
      id: mutation.taskId,
      step: `Task #${mutation.taskId}`,
      status: mutation.status,
    })
  } else {
    accumulator.items.set(mutation.taskId, {
      ...current,
      status: mutation.status,
    })
  }
  accumulator.updatedAt = mutation.updatedAt
}

export function parseCodexPlanStateFromRecord(record: Record<string, unknown>): CliPlanState | null {
  const payload =
    typeof record.payload === 'object' && record.payload
      ? record.payload as Record<string, unknown>
      : null

  if (!payload || payload.type !== 'function_call' || payload.name !== 'update_plan') {
    return null
  }

  let argumentsValue: unknown = payload.arguments
  if (typeof argumentsValue === 'string') {
    try {
      argumentsValue = JSON.parse(argumentsValue) as unknown
    } catch {
      return null
    }
  }

  if (!argumentsValue || typeof argumentsValue !== 'object') {
    return null
  }

  const source = argumentsValue as {
    explanation?: unknown
    plan?: unknown
  }

  if (!Array.isArray(source.plan)) {
    return null
  }

  const items = source.plan.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const typedItem = item as {
      step?: unknown
      status?: unknown
    }
    const step = typeof typedItem.step === 'string' ? typedItem.step.trim() : ''
    const status = normalizePlanStatus(typedItem.status)
    if (!step || !status) {
      return []
    }

    return [{
      id: step,
      step,
      status,
    }]
  })

  if (items.length === 0) {
    return null
  }

  return {
    explanation: typeof source.explanation === 'string' ? source.explanation.trim() : '',
    items,
    updatedAt: toTimestamp(record.timestamp),
  }
}

export function buildCodexPlanStateFromRecords(records: Array<Record<string, unknown>>) {
  const accumulator = createPlanAccumulator()
  for (const record of records) {
    const state = parseCodexPlanStateFromRecord(record)
    if (state) {
      setCodexPlanState(accumulator, state)
    }
  }
  return snapshotPlanAccumulator(accumulator)
}

export function parseClaudePlanMutationFromRecord(record: Record<string, unknown>): ClaudePlanMutation | null {
  const result =
    typeof record.toolUseResult === 'object' && record.toolUseResult
      ? record.toolUseResult as Record<string, unknown>
      : null
  if (!result) {
    return null
  }

  const updatedAt = toTimestamp(record.timestamp)
  const task =
    typeof result.task === 'object' && result.task
      ? result.task as Record<string, unknown>
      : null
  const taskId = typeof task?.id === 'string' ? task.id.trim() : ''
  const subject = typeof task?.subject === 'string' ? task.subject.trim() : ''
  if (taskId && subject) {
    return {
      kind: 'create',
      taskId,
      subject,
      status: normalizePlanStatus(result.status) || 'pending',
      updatedAt,
    }
  }

  const updatedTaskId = typeof result.taskId === 'string' ? result.taskId.trim() : ''
  const statusChange =
    typeof result.statusChange === 'object' && result.statusChange
      ? result.statusChange as Record<string, unknown>
      : null
  const nextStatus = normalizePlanStatus(statusChange?.to || result.status)
  if (updatedTaskId && nextStatus) {
    return {
      kind: 'status',
      taskId: updatedTaskId,
      status: nextStatus,
      updatedAt,
    }
  }

  return null
}

export function buildClaudePlanStateFromRecords(records: Array<Record<string, unknown>>) {
  const accumulator = createPlanAccumulator()
  for (const record of records) {
    const mutation = parseClaudePlanMutationFromRecord(record)
    if (mutation) {
      applyClaudePlanMutation(accumulator, mutation)
    }
  }
  return snapshotPlanAccumulator(accumulator)
}
