import type { ChatModelOption } from '../shared/contracts'
import type { CliHistoryEntry, CliLogKind, CliSessionMessage } from '../shared/desktop'

export type AssistantModeKey = 'chat' | 'draw' | 'codex' | 'claude'

export type CliLogEntryLike = {
  id: string
  requestId?: string
  sessionId?: string
  level: 'status' | 'error'
  logKind?: CliLogKind
  sourceKind?: string
  content: string
  createdAt: number
  files?: CliFileChange[]
  detail?: string
  command?: string
  exitCode?: number
}

export type CliTimelineLogEvent = {
  id: string
  level: 'status' | 'error'
  kind: CliLogKind
  sourceKind?: string
  message: string
  createdAt: number
  files: CliFileChange[]
  detail?: string
  command?: string
  exitCode?: number
}

export type CliFileChange = {
  path: string
  kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  content?: string
  diff?: string
}

export type CliTimelineEntry =
  | {
      id: string
      kind: 'message'
      role: 'user' | 'assistant'
      content: string
      createdAt: number
      modelLabel?: string
      attachments?: CliSessionMessage['attachments']
      fileChanges?: CliFileChange[]
    }
  | {
      id: string
      kind: 'log'
      level: 'status' | 'error'
      title: string
      createdAt: number
      startedAt: number
      requestId?: string
      sessionId?: string
      files: CliFileChange[]
      events: CliTimelineLogEvent[]
    }
  | {
      id: string
      kind: 'partial'
      role: 'assistant'
      content: string
      createdAt: number
      modelLabel: string
    }

function normalizeModelValue(value: string) {
  return value.trim().toLowerCase()
}

function toTimelineTimestamp(value: number) {
  if (!value) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

export function isCodexModel(value: string) {
  const normalized = normalizeModelValue(value)
  if (isImageGenerationModel(normalized)) {
    return false
  }
  return normalized.includes('codex') || normalized.startsWith('gpt-')
}

export function isClaudeModel(value: string) {
  return normalizeModelValue(value).includes('claude')
}

export function isImageGenerationModel(value: string) {
  return normalizeModelValue(value) === 'gpt-image-2'
}

function uniqueModels(items: ChatModelOption[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.value.trim()
    if (!key || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function filterAssistantModels(
  mode: AssistantModeKey,
  models: ChatModelOption[],
  fallbackModels: ChatModelOption[] = []
) {
  const source = uniqueModels([...models, ...fallbackModels])

  if (mode === 'codex') {
    return source.filter((item) => isCodexModel(item.value))
  }

  if (mode === 'claude') {
    return source.filter((item) => isClaudeModel(item.value))
  }

  if (mode === 'draw') {
    return source.filter((item) => isImageGenerationModel(item.value))
  }

  return source.filter((item) => !isImageGenerationModel(item.value))
}

export function resolveCompatibleModel(
  mode: AssistantModeKey,
  models: ChatModelOption[],
  selectedModel: string,
  preferredModel: string
) {
  const compatible = filterAssistantModels(mode, models)
  if (compatible.some((item) => item.value === selectedModel)) {
    return selectedModel
  }

  if (compatible.some((item) => item.value === preferredModel)) {
    return preferredModel
  }

  return compatible[0]?.value || preferredModel || selectedModel || ''
}

export function prioritizeFavoriteModels(models: ChatModelOption[]) {
  return [...models].sort((left, right) => {
    const leftRank = left.favorite ? 1 : 0
    const rightRank = right.favorite ? 1 : 0
    if (leftRank !== rightRank) {
      return rightRank - leftRank
    }
    return left.label.localeCompare(right.label, 'zh-Hans-CN')
  })
}

export function buildCliTimeline(input: {
  messages: CliSessionMessage[]
  logs: CliLogEntryLike[]
  partial?: string
  partialCreatedAt?: number
  partialModelLabel?: string
}) {
  const mergeLogFiles = (items: CliFileChange[]) => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const key = `${item.path}:${item.kind}:${item.diff || item.content || ''}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  const groupedLogs = input.logs.reduce<Array<{
    id: string
    kind: 'log'
    level: 'status' | 'error'
    title: string
    createdAt: number
    startedAt: number
    requestId?: string
    sessionId?: string
    files: CliFileChange[]
    events: CliTimelineLogEvent[]
  }>>((groups, item) => {
    const normalizedCreatedAt = toTimelineTimestamp(item.createdAt)
    const eventFiles = mergeLogFiles([...(item.files || [])])
    const nextEvent: CliTimelineLogEvent = {
      id: item.id,
      level: item.level,
      kind: item.logKind || (item.level === 'error' ? 'error' : 'status'),
      sourceKind: item.sourceKind,
      message: item.content,
      createdAt: normalizedCreatedAt,
      files: eventFiles,
      detail: item.detail,
      command: item.command,
      exitCode: item.exitCode,
    }
    const lastGroup = groups.at(-1)
    const sameRequest =
      !!lastGroup &&
      !!item.requestId &&
      lastGroup.requestId === item.requestId

    if (lastGroup && sameRequest) {
      lastGroup.createdAt = Math.max(lastGroup.createdAt, normalizedCreatedAt)
      lastGroup.files = mergeLogFiles([...lastGroup.files, ...eventFiles])
      lastGroup.events.push(nextEvent)
      if (nextEvent.level === 'error') {
        lastGroup.level = 'error'
      }
      return groups
    }

    groups.push({
      id: item.id,
      kind: 'log',
      level: item.level,
      title: item.content,
      createdAt: normalizedCreatedAt,
      startedAt: normalizedCreatedAt,
      requestId: item.requestId,
      sessionId: item.sessionId,
      files: eventFiles,
      events: [nextEvent],
    })
    return groups
  }, [])

  const entries: CliTimelineEntry[] = input.messages
    .map((item) => ({
      id: item.id,
      kind: 'message' as const,
      role: item.role,
      content: item.content,
      createdAt: toTimelineTimestamp(item.createdAt),
      modelLabel: item.modelLabel,
      attachments: item.attachments,
      fileChanges: item.fileChanges,
    }))
    .sort((left, right) => left.createdAt - right.createdAt)

  if (input.partial?.trim()) {
    entries.push({
      id: `partial-${input.partialCreatedAt || 0}`,
      kind: 'partial',
      role: 'assistant',
      content: input.partial.trim(),
      createdAt: toTimelineTimestamp(input.partialCreatedAt || Date.now()),
      modelLabel: input.partialModelLabel || 'Assistant',
    })
  }

  const sortedLogs = [...groupedLogs].sort((left, right) => left.startedAt - right.startedAt)
  const timeline: CliTimelineEntry[] = []
  let logIndex = 0

  for (const entry of entries.sort((left, right) => left.createdAt - right.createdAt)) {
    if (entry.kind === 'message' && entry.role === 'assistant') {
      while (logIndex < sortedLogs.length && sortedLogs[logIndex].startedAt <= entry.createdAt) {
        timeline.push(sortedLogs[logIndex])
        logIndex += 1
      }
    }
    timeline.push(entry)
  }

  while (logIndex < sortedLogs.length) {
    timeline.push(sortedLogs[logIndex])
    logIndex += 1
  }

  return timeline
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function resolvePreview(messages: CliSessionMessage[]) {
  const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant')
  const lastUser = [...messages].reverse().find((item) => item.role === 'user')
  return normalizeWhitespace(lastUser?.content || lastAssistant?.content || '')
}

function resolveUpdatedAt(messages: CliSessionMessage[], logs: CliLogEntryLike[]) {
  return Math.max(
    toTimelineTimestamp(messages.at(-1)?.createdAt || 0),
    toTimelineTimestamp(logs.at(-1)?.createdAt || 0)
  )
}

export function buildCliRecentSessions(input: {
  history: CliHistoryEntry[]
  sessionMessagesMap: Record<string, CliSessionMessage[]>
  sessionLogsMap: Record<string, CliLogEntryLike[]>
  sessionProjectPathMap: Record<string, string>
}) {
  const merged = new Map<string, CliHistoryEntry>()

  for (const item of input.history) {
    merged.set(item.id, item)
  }

  for (const [sessionId, messages] of Object.entries(input.sessionMessagesMap)) {
    if (!messages.length) {
      continue
    }

    const projectPath = input.sessionProjectPathMap[sessionId] || ''
    const preview = resolvePreview(messages)
    const updatedAt = resolveUpdatedAt(messages, input.sessionLogsMap[sessionId] || [])
    const title = preview || (projectPath ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) || '最近会话' : '最近会话')

    merged.set(sessionId, {
      id: sessionId,
      title,
      preview,
      updatedAt,
      projectName: projectPath ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) || '未命名项目' : '未命名项目',
      projectPath: projectPath || undefined,
    })
  }

  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}
