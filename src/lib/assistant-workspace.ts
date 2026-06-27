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
  done?: boolean
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
  done?: boolean
}

export function buildCliAbortLogEntry(input: {
  client: 'codex' | 'claude'
  requestId: string
  sessionId: string
  createdAt?: number
}): CliLogEntryLike {
  const createdAt = input.createdAt ?? Date.now()
  const clientLabel = input.client === 'codex' ? 'Codex' : 'Claude'
  return {
    id: `${input.requestId}-aborted-${createdAt}`,
    requestId: input.requestId,
    sessionId: input.sessionId,
    level: 'status',
    logKind: 'status',
    sourceKind: 'request.aborted',
    content: `${clientLabel} 已停止本次回复。`,
    createdAt,
  }
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

function normalizeProviderModelValue(value: string) {
  const normalized = normalizeModelValue(value)
  const parts = normalized.split('/').map((part) => part.trim()).filter(Boolean)
  return parts.at(-1) || normalized
}

function supportsEndpoint(model: ChatModelOption | undefined, endpoint: string) {
  const endpoints = model?.supportedEndpointTypes
  return Array.isArray(endpoints) && endpoints.includes(endpoint)
}

function hasEndpointMetadata(model: ChatModelOption | undefined) {
  return Array.isArray(model?.supportedEndpointTypes) && model.supportedEndpointTypes.length > 0
}

function isOpenAITextCompatibleModel(value: string) {
  const normalized = normalizeProviderModelValue(value)
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
  const normalized = normalizeProviderModelValue(value)
  return normalized.startsWith('deepseek-v4-flash') || normalized.startsWith('deepseek-v4-pro')
}

function isDeepSeekClaudeCompatibleModel(value: string) {
  return isDeepSeekCodexCompatibleModel(value)
}

function normalizeMimoModelFamily(value: string) {
  return normalizeProviderModelValue(value)
    .replace(/^xiaomi[-_]?mimo[-_]?/, 'mimo-')
    .replace(/^xiaomimimo[-_]?/, 'mimo-')
}

function isMimoCodexCompatibleModel(value: string) {
  const normalized = normalizeMimoModelFamily(value)
  return normalized === 'mimo-v2.5' || normalized.startsWith('mimo-v2.5-pro')
}

function isMimoClaudeCompatibleModel(value: string) {
  return normalizeMimoModelFamily(value).startsWith('mimo-v2.5-pro')
}

function isClaudeTextCompatibleModel(value: string) {
  const normalized = normalizeModelValue(value)
  return normalized.includes('claude')
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

function collapseRepeatedAdjacentAssistantParagraphs(content: string) {
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
  const collapsed: string[] = []

  for (const paragraph of paragraphs) {
    const normalized = normalizeMessageContent(paragraph)
    if (!normalized) {
      continue
    }
    const previous = collapsed.at(-1)
    if (previous && normalizeMessageContent(previous) === normalized) {
      continue
    }
    collapsed.push(paragraph.trim())
  }

  return collapsed.join('\n\n')
}

export function isCodexModel(model: ChatModelOption | string) {
  const normalized = normalizeProviderModelValue(typeof model === 'string' ? model : model.value)
  if (normalized.startsWith('deepseek')) {
    if (!isDeepSeekCodexCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && hasEndpointMetadata(model)) {
      return supportsEndpoint(model, 'openai-response') || supportsEndpoint(model, 'openai-response-compact')
    }
    return true
  }
  if (normalized.startsWith('mimo-') || normalized.includes('xiaomi') || normalized.includes('mimo')) {
    if (!isMimoCodexCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && hasEndpointMetadata(model)) {
      return supportsEndpoint(model, 'openai-response') || supportsEndpoint(model, 'openai-response-compact')
    }
    return true
  }

  if (typeof model !== 'string') {
    if (
      (supportsEndpoint(model, 'openai-response') || supportsEndpoint(model, 'openai-response-compact')) &&
      isOpenAITextCompatibleModel(model.value)
    ) {
      return !isImageGenerationModel(model.value)
    }
    if (supportsEndpoint(model, 'openai') && isOpenAITextCompatibleModel(model.value)) {
      return !isImageGenerationModel(model.value)
    }
    if (hasEndpointMetadata(model)) {
      return false
    }
  }
  if (isImageGenerationModel(normalized)) {
    return false
  }
  return isOpenAITextCompatibleModel(normalized)
}

export function isClaudeModel(model: ChatModelOption | string) {
  const normalized = normalizeProviderModelValue(typeof model === 'string' ? model : model.value)
  if (normalized.startsWith('deepseek')) {
    if (!isDeepSeekClaudeCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && hasEndpointMetadata(model)) {
      return supportsEndpoint(model, 'anthropic')
    }
    return true
  }
  if (normalized.startsWith('mimo-') || normalized.includes('xiaomi') || normalized.includes('mimo')) {
    if (!isMimoClaudeCompatibleModel(normalized)) {
      return false
    }
    if (typeof model !== 'string' && hasEndpointMetadata(model)) {
      return supportsEndpoint(model, 'anthropic')
    }
    return true
  }

  if (typeof model !== 'string') {
    if (supportsEndpoint(model, 'anthropic') && isClaudeTextCompatibleModel(model.value)) {
      return !isImageGenerationModel(model.value)
    }
    if (Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.length) {
      return false
    }
  }
  return isClaudeTextCompatibleModel(normalized)
}

export function isImageGenerationModel(value: string) {
  const normalized = normalizeModelValue(value)
  return normalized === 'gpt-image-2' || normalized === 'gpt-image-1' || normalized.startsWith('gpt-image-')
}

export function resolveModelVendorFilter(value: string): Exclude<ModelVendorFilter, 'all'> | null {
  const normalized = normalizeProviderModelValue(value)
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
  if (!compatible.length) {
    return ''
  }
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
      done: item.done,
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
      if (item.role === 'assistant') {
        content = collapseRepeatedAdjacentAssistantParagraphs(content)
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
  const requestUserTimes = new Map<string, number>()
  for (const item of entries) {
    if (item.kind === 'message' && item.role === 'user' && item.requestId) {
      requestUserTimes.set(item.requestId, item.createdAt)
    }
  }
  const requestLogs = sortedLogs.reduce<Map<string, typeof sortedLogs>>((map, item) => {
    if (!item.requestId) {
      return map
    }
    const previous = map.get(item.requestId) || []
    previous.push(item)
    map.set(item.requestId, previous)
    return map
  }, new Map<string, typeof sortedLogs>())
  const pushedLogIds = new Set<string>()
  const timeline: CliTimelineEntry[] = []
  let logIndex = 0
  const pushLog = (item: (typeof sortedLogs)[number]) => {
    if (pushedLogIds.has(item.id)) {
      return
    }
    timeline.push(item)
    pushedLogIds.add(item.id)
  }
  const pushRequestLogsBefore = (requestId: string | undefined, createdAt: number) => {
    if (!requestId) {
      return
    }
    for (const item of requestLogs.get(requestId) || []) {
      if (item.startedAt <= createdAt) {
        pushLog(item)
      }
    }
  }
  const pushChronologicalLogsBefore = (createdAt: number) => {
    while (logIndex < sortedLogs.length && sortedLogs[logIndex].startedAt <= createdAt) {
      const log = sortedLogs[logIndex]
      logIndex += 1
      const requestUserTime = log.requestId ? requestUserTimes.get(log.requestId) : undefined
      if (
        requestUserTime !== undefined &&
        log.startedAt < requestUserTime &&
        !pushedLogIds.has(log.id)
      ) {
        continue
      }
      pushLog(log)
    }
  }

  for (const entry of entries.sort((left, right) => left.createdAt - right.createdAt)) {
    if (entry.kind === 'message' && entry.role === 'assistant') {
      pushRequestLogsBefore(entry.requestId, entry.createdAt)
      pushChronologicalLogsBefore(entry.createdAt)
    }
    timeline.push(entry)
    if (entry.kind === 'message' && entry.role === 'user' && entry.requestId) {
      for (const item of requestLogs.get(entry.requestId) || []) {
        if (item.startedAt < entry.createdAt) {
          pushLog(item)
        }
      }
    }
  }

  while (logIndex < sortedLogs.length) {
    pushLog(sortedLogs[logIndex])
    logIndex += 1
  }

  const partialContent = input.partial || ''
  const hasVisiblePartial = partialContent === 'Coding...' || partialContent.trim().length > 0
  const partialDuplicate = hasVisiblePartial && entries.some((entry) => {
    if (entry.kind !== 'message' || entry.role !== 'assistant') {
      return false
    }
    return normalizeMessageContent(entry.content) === normalizeMessageContent(partialContent)
  })

  if (hasVisiblePartial && !partialDuplicate) {
    timeline.push({
      id: 'partial-response',
      kind: 'partial',
      role: 'assistant',
      content: partialContent,
      createdAt: toTimelineTimestamp(input.partialCreatedAt || Date.now()),
      modelLabel: input.partialModelLabel || 'Assistant',
    })
    timeline.sort((left, right) => left.createdAt - right.createdAt)
  }

  return timeline
}

export function resolveCliLogGroupStatus(
  events: Array<{
    kind: CliLogKind
    level: 'status' | 'error'
    sourceKind?: string
    interaction?: CliInteractionPrompt
    done?: boolean
  }>
) {
  const pendingInteraction = [...events].reverse().find((item) => item.interaction?.status === 'pending')
  if (pendingInteraction) {
    return { tone: 'warning', label: '等待确认' as const }
  }

  const terminal = [...events].reverse().find((item) => {
    const sourceKind = item.sourceKind || ''
    return (
      item.done ||
      item.level === 'error' ||
      sourceKind === 'request.failed' ||
      sourceKind === 'request.aborted' ||
      sourceKind === 'request.stream.completed' ||
      sourceKind === 'result' ||
      sourceKind === 'result.with_warnings' ||
      sourceKind === 'turn.completed' ||
      sourceKind === 'turn.completed.with_warnings'
    )
  })

  if (terminal?.sourceKind === 'request.aborted') {
    return { tone: 'aborted', label: '已停止' as const }
  }
  if (terminal?.sourceKind === 'result.with_warnings' || terminal?.sourceKind === 'turn.completed.with_warnings') {
    return { tone: 'warning', label: '已完成' as const }
  }
  if (terminal && (terminal.level === 'error' || terminal.sourceKind === 'request.failed')) {
    return { tone: 'error', label: '执行失败' as const }
  }
  if (
    terminal?.done ||
    terminal?.sourceKind === 'result' ||
    terminal?.sourceKind === 'turn.completed' ||
    terminal?.sourceKind === 'request.stream.completed'
  ) {
    return { tone: 'success', label: '已完成' as const }
  }

  return { tone: 'running', label: '进行中' as const }
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
  const messageUpdatedAt = messages.reduce(
    (latest, item) => Math.max(latest, toTimelineTimestamp(item.createdAt)),
    0
  )
  const logUpdatedAt = logs.reduce(
    (latest, item) => Math.max(latest, toTimelineTimestamp(item.createdAt)),
    0
  )
  return Math.max(messageUpdatedAt, logUpdatedAt)
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

  return [...merged.values()].sort(
    (left, right) => toTimelineTimestamp(right.updatedAt) - toTimelineTimestamp(left.updatedAt)
  )
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
