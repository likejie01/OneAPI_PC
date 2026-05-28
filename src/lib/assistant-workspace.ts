import type { ChatCompletionResponse, ChatModelOption } from '../shared/contracts'
import type { CliHistoryEntry, CliInteractionPrompt, CliLogKind, CliSessionMessage } from '../shared/desktop'

export type AssistantModeKey = 'chat' | 'draw' | 'codex' | 'claude'
export type ModelVendorFilter = 'all' | 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'xiaomimimo'

export type CliLogEntryLike = {
  id: string
  requestId?: string
  sessionId?: string
  level: 'status' | 'error'
  logKind?: CliLogKind
  sourceKind?: string
  content: string
  assistantChunk?: string
  indentLevel?: number
  createdAt: number
  files?: CliFileChange[]
  detail?: string
  command?: string
  exitCode?: number
  interaction?: CliInteractionPrompt
}

export type CliTimelineLogEvent = {
  id: string
  level: 'status' | 'error'
  kind: CliLogKind
  sourceKind?: string
  message: string
  assistantChunk?: string
  indentLevel?: number
  createdAt: number
  files: CliFileChange[]
  detail?: string
  command?: string
  exitCode?: number
  interaction?: CliInteractionPrompt
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
      requestId?: string
      modelLabel?: string
      usage?: CliSessionMessage['usage']
      attachments?: CliSessionMessage['attachments']
      selectedExtensions?: CliSessionMessage['selectedExtensions']
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

function supportsEndpoint(model: ChatModelOption | undefined, endpoint: string) {
  const endpoints = model?.supportedEndpointTypes
  return Array.isArray(endpoints) && endpoints.includes(endpoint)
}

function isOpenAITextCompatibleModel(value: string) {
  const normalized = normalizeModelValue(value)
  return (
    normalized.includes('codex') ||
    normalized.startsWith('gpt-') ||
    normalized.startsWith('chatgpt') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  )
}

function isDeepSeekCodexCompatibleModel(value: string) {
  const normalized = normalizeModelValue(value)
  return normalized === 'deepseek-v4-flash' || normalized === 'deepseek-v4-pro'
}

function isDeepSeekClaudeCompatibleModel(value: string) {
  return isDeepSeekCodexCompatibleModel(value)
}

function isMimoCodexCompatibleModel(value: string) {
  const normalized = normalizeModelValue(value)
  return normalized === 'mimo-v2.5' || normalized === 'mimo-v2.5-pro'
}

function isMimoClaudeCompatibleModel(value: string) {
  return normalizeModelValue(value) === 'mimo-v2.5-pro'
}

function isGeminiModel(value: string) {
  const normalized = normalizeModelValue(value)
  return normalized.startsWith('gemini') || normalized.includes('google-gemini')
}

function toTimelineTimestamp(value: number) {
  if (!value) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripLeadingAssistantChunk(content: string, chunk: string) {
  const normalizedChunk = chunk.trim()
  if (!normalizedChunk) {
    return { content, stripped: false }
  }

  const prefixPattern = new RegExp(`^\\s*${escapeRegExp(normalizedChunk).replace(/\s+/g, '\\s+')}\\s*`)
  if (!prefixPattern.test(content)) {
    return { content, stripped: false }
  }

  return {
    content: content.replace(prefixPattern, '').trimStart(),
    stripped: true,
  }
}

function stripConsumedAssistantChunks(
  content: string,
  chunks: string[],
  startIndex: number
) {
  let nextContent = content
  let nextIndex = startIndex

  while (nextIndex < chunks.length) {
    const stripped = stripLeadingAssistantChunk(nextContent, chunks[nextIndex] || '')
    if (!stripped.stripped) {
      break
    }
    nextContent = stripped.content
    nextIndex += 1
  }

  return {
    content: nextContent,
    nextIndex,
  }
}

export function isCodexModel(model: ChatModelOption | string) {
  const normalized = normalizeModelValue(typeof model === 'string' ? model : model.value)
  if (normalized.startsWith('deepseek')) {
    if (!isDeepSeekCodexCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.length) {
      return (
        supportsEndpoint(model, 'openai-response') || supportsEndpoint(model, 'openai-response-compact')
      )
    }
    return true
  }
  if (normalized.startsWith('mimo-') || normalized.includes('xiaomi') || normalized.includes('mimo')) {
    if (!isMimoCodexCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.length) {
      return (
        supportsEndpoint(model, 'openai-response') || supportsEndpoint(model, 'openai-response-compact')
      )
    }
    return true
  }

  if (typeof model !== 'string') {
    if (
      supportsEndpoint(model, 'openai-response') ||
      supportsEndpoint(model, 'openai-response-compact')
    ) {
      return !isImageGenerationModel(model.value)
    }
    if (supportsEndpoint(model, 'openai') && isOpenAITextCompatibleModel(model.value)) {
      return !isImageGenerationModel(model.value)
    }
    if (Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.length) {
      return false
    }
  }
  if (isImageGenerationModel(normalized)) {
    return false
  }
  return isOpenAITextCompatibleModel(normalized)
}

export function isClaudeModel(model: ChatModelOption | string) {
  const normalized = normalizeModelValue(typeof model === 'string' ? model : model.value)
  if (normalized.startsWith('deepseek')) {
    if (!isDeepSeekClaudeCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.length) {
      return supportsEndpoint(model, 'anthropic')
    }
    return true
  }
  if (normalized.startsWith('mimo-') || normalized.includes('xiaomi') || normalized.includes('mimo')) {
    if (!isMimoClaudeCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.length) {
      return supportsEndpoint(model, 'anthropic')
    }
    return true
  }
  if (typeof model !== 'string') {
    if (supportsEndpoint(model, 'anthropic')) {
      return !isImageGenerationModel(model.value)
    }
    if (Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.length) {
      return false
    }
  }
  return normalized.includes('claude')
}

export function isImageGenerationModel(value: string) {
  return normalizeModelValue(value) === 'gpt-image-2'
}

export function resolveModelVendorFilter(value: string): Exclude<ModelVendorFilter, 'all'> | null {
  const normalized = normalizeModelValue(value)
  if (!normalized) {
    return null
  }
  if (normalized.startsWith('deepseek')) {
    return 'deepseek'
  }
  if (normalized.startsWith('mimo-') || normalized.includes('xiaomi') || normalized.includes('mimo')) {
    return 'xiaomimimo'
  }
  if (isGeminiModel(normalized)) {
    return 'gemini'
  }
  if (normalized.includes('claude')) {
    return 'anthropic'
  }
  if (
    isOpenAITextCompatibleModel(normalized)
  ) {
    return 'openai'
  }
  return null
}

export function filterModelsByVendor(models: ChatModelOption[], vendor: ModelVendorFilter) {
  if (vendor === 'all') {
    return models
  }
  return models.filter((item) => resolveModelVendorFilter(item.value) === vendor)
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
    return source.filter((item) => isCodexModel(item))
  }

  if (mode === 'claude') {
    return source.filter((item) => isClaudeModel(item))
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
      assistantChunk: item.assistantChunk,
      indentLevel: item.indentLevel,
      createdAt: normalizedCreatedAt,
      files: eventFiles,
      detail: item.detail,
      command: item.command,
      exitCode: item.exitCode,
      ...(item.interaction ? { interaction: item.interaction } : {}),
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

  const requestAssistantChunks = groupedLogs.reduce<Map<string, string[]>>((map, item) => {
    if (!item.requestId) {
      return map
    }

    const chunks = item.events
      .map((eventItem) => eventItem.assistantChunk?.trim() || '')
      .filter(Boolean)
    if (!chunks.length) {
      return map
    }

    const previous = map.get(item.requestId) || []
    map.set(item.requestId, [...previous, ...chunks])
    return map
  }, new Map<string, string[]>())

  const requestAssistantChunkCursor = new Map<string, number>()
  const entries: CliTimelineEntry[] = input.messages
    .map((item) => {
      let content = item.content
      if (item.role === 'assistant' && item.requestId) {
        const chunks = requestAssistantChunks.get(item.requestId) || []
        const cursor = requestAssistantChunkCursor.get(item.requestId) || 0
        if (chunks.length > cursor) {
          const stripped = stripConsumedAssistantChunks(content, chunks, cursor)
          content = stripped.content
          requestAssistantChunkCursor.set(item.requestId, stripped.nextIndex)
        }
      }

      return {
        id: item.id,
        kind: 'message' as const,
        role: item.role,
        content,
        createdAt: toTimelineTimestamp(item.createdAt),
        requestId: item.requestId,
        modelLabel: item.modelLabel,
        usage: item.usage,
        attachments: item.attachments,
        selectedExtensions: item.selectedExtensions,
        fileChanges: item.fileChanges,
      }
    })
    .filter((item) => {
      if (item.role !== 'assistant') {
        return true
      }
      return !!(
        item.content.trim() ||
        item.attachments?.length ||
        item.fileChanges?.length
      )
    })
    .sort((left, right) => left.createdAt - right.createdAt)

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

function normalizeMessageContent(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function appendCliFallbackAssistantMessage(
  messages: CliSessionMessage[],
  fallback: {
    id: string
    content: string
    createdAt: number
    requestId?: string
    modelLabel?: string
    fileChanges?: CliFileChange[]
    usage?: ChatCompletionResponse['usage']
  }
) {
  const content = fallback.content.trim()
  if (!content) {
    return messages
  }

  const normalizedContent = normalizeMessageContent(content)
  const exists = messages.some((message) => {
    if (message.role !== 'assistant') {
      return false
    }
    if (fallback.requestId && message.requestId === fallback.requestId) {
      return true
    }
    return normalizeMessageContent(message.content) === normalizedContent
  })

  if (exists) {
    return messages
  }

  return [
    ...messages,
    {
      id: fallback.id,
      role: 'assistant' as const,
      content,
      createdAt: fallback.createdAt,
      requestId: fallback.requestId,
      modelLabel: fallback.modelLabel,
      fileChanges: fallback.fileChanges,
      usage: fallback.usage,
    },
  ].sort((left, right) => toTimelineTimestamp(left.createdAt) - toTimelineTimestamp(right.createdAt))
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

    const existing = merged.get(sessionId)
    const projectPath = input.sessionProjectPathMap[sessionId] || existing?.projectPath || ''
    const projectName =
      (projectPath ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) : '') ||
      existing?.projectName ||
      '未命名项目'
    const preview = resolvePreview(messages)
    const updatedAt = resolveUpdatedAt(messages, input.sessionLogsMap[sessionId] || [])
    const title =
      existing?.title ||
      preview ||
      (projectPath ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) || '最近会话' : '最近会话')

    merged.set(sessionId, {
      id: sessionId,
      title,
      preview,
      updatedAt,
      projectName,
      projectPath: projectPath || undefined,
    })
  }

  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

export function applyCliHistoryTitleOverrides(
  history: CliHistoryEntry[],
  titleOverrides: Record<string, string>
) {
  return history.map((item) => ({
    ...item,
    title: titleOverrides[item.id] || item.title,
  }))
}
