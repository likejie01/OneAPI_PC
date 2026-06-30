export function shouldRenderCliLogEventRow(input: {
  duplicatedPrimary: boolean
  hasExpandableContent: boolean
  hasInteraction: boolean
}) {
  return !input.duplicatedPrimary || input.hasExpandableContent || input.hasInteraction
}

function normalizeComparable(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function compactText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function extractJsonCommand(detail: string) {
  try {
    const parsed = JSON.parse(detail) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return ''
    }
    const command = (parsed as { command?: unknown }).command
    return typeof command === 'string' ? command : ''
  } catch {
    return ''
  }
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value
}

function extractToolName(sourceKind: string) {
  const match = sourceKind.match(/(?:^|\.)tool_use\.([^.\s]+)/i)
  return match?.[1]?.trim().toLowerCase() || ''
}

export function formatCliToolDisplayName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!normalized) {
    return ''
  }
  if (normalized.includes('shell') || normalized.includes('command') || normalized === 'bash') {
    return 'Shell'
  }
  if (['read', 'view', 'open', 'notebookread'].includes(normalized.replace(/\s+/g, ''))) {
    return '读取'
  }
  if (['edit', 'multiedit', 'write', 'notebookedit'].includes(normalized.replace(/\s+/g, ''))) {
    return '编辑'
  }
  if (normalized === 'grep' || normalized === 'glob' || normalized.includes('search')) {
    return '搜索'
  }
  if (normalized === 'ls' || normalized === 'list') {
    return '目录'
  }
  if (normalized.includes('fetch')) {
    return '网页'
  }
  if (normalized.includes('todo') || normalized.includes('plan')) {
    return '计划'
  }
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part ? `${part[0]?.toUpperCase() || ''}${part.slice(1)}` : '')
    .join(' ')
}

function readStringField(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) {
    return ''
  }
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function formatToolHeadline(input: {
  sourceKind: string
  command?: string
  detail?: string
}) {
  const toolName = extractToolName(input.sourceKind)
  const detailRecord = parseJsonRecord(input.detail?.trim() || '')
  const command = input.command?.trim() || readStringField(detailRecord, ['command'])
  if (toolName.includes('shell') || toolName.includes('command') || command) {
    return '运行 Shell 命令'
  }

  const filePath = readStringField(detailRecord, ['file_path', 'path', 'notebook_path'])
  const fileLabel = filePath ? ` ${basename(filePath)}` : ''
  if (['read', 'view', 'open', 'notebookread'].includes(toolName)) {
    return `读取文件${fileLabel}`
  }
  if (['edit', 'multiedit', 'write', 'notebookedit'].includes(toolName)) {
    return `编辑文件${fileLabel}`
  }
  if (['grep', 'glob', 'search'].includes(toolName) || toolName.includes('search')) {
    return '搜索项目内容'
  }
  if (['ls', 'list'].includes(toolName)) {
    return '查看目录'
  }
  if (toolName.includes('webfetch') || toolName.includes('fetch')) {
    return '读取网页内容'
  }
  if (toolName.includes('todowrite') || toolName.includes('update_plan')) {
    return '更新任务计划'
  }

  return ''
}

export function formatCliNarrativeTitle(input: {
  message?: string
  detail?: string
  assistantChunk?: string
  fallback?: string
}) {
  const candidates = [
    input.assistantChunk,
    input.detail,
    input.message,
    input.fallback,
  ]
  const value = candidates
    .map((item) => compactText(item || ''))
    .find((item) => item && !/^\{[\s\S]*\}$/.test(item) && !/^\[[\s\S]*\]$/.test(item))
  if (!value) {
    return input.fallback || '执行过程'
  }
  return value.length > 96 ? `${value.slice(0, 95)}...` : value
}

export function formatCliLogRunTitle(input: {
  eventCount: number
  statusTone?: string
  commandCount?: number
  toolCount?: number
  diagnosticCount?: number
  interactionCount?: number
}) {
  if (input.statusTone === 'error') {
    return '执行过程出现异常'
  }
  if (input.interactionCount && input.interactionCount > 0) {
    return '等待确认后继续执行'
  }
  if (input.commandCount || input.toolCount) {
    const parts = [
      input.commandCount ? `${input.commandCount} 个命令` : '',
      input.toolCount ? `${input.toolCount} 次工具调用` : '',
      input.diagnosticCount ? `${input.diagnosticCount} 条诊断` : '',
    ].filter(Boolean)
    return parts.length ? `正在处理：${parts.join(' · ')}` : '正在处理请求'
  }
  return input.eventCount > 0 ? '正在整理执行过程' : '准备处理请求'
}

export function formatCliLogStatusSummary(input: {
  eventCount: number
  commandCount?: number
  toolCount?: number
  diagnosticCount?: number
  interactionCount?: number
  updatedAt: string
}) {
  const parts = [
    input.commandCount ? `命令 ${input.commandCount}` : '',
    input.toolCount ? `工具 ${input.toolCount}` : '',
    input.diagnosticCount ? `诊断 ${input.diagnosticCount}` : '',
    input.interactionCount ? `确认 ${input.interactionCount}` : '',
    `过程 ${input.eventCount}`,
    `更新 ${input.updatedAt}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

export function shouldRenderCliLogCommandBlock(input: {
  command?: string
  detail?: string
}) {
  const command = input.command?.trim() || ''
  if (!command) {
    return false
  }
  const detailCommand = extractJsonCommand(input.detail?.trim() || '')
  if (!detailCommand) {
    return true
  }
  return normalizeComparable(detailCommand) !== normalizeComparable(command)
}

export function shouldRenderCliLogOutputEntry(input: {
  outputIndex: number
  entryHeadline: string
  entryDetail: string
  groupHeadline: string
}) {
  if (input.outputIndex !== 0) {
    return true
  }

  if (input.entryDetail.trim()) {
    return true
  }

  return normalizeComparable(input.entryHeadline) !== normalizeComparable(input.groupHeadline)
}

export type CliFileChangePreviewLine = {
  type: 'add' | 'delete' | 'context' | 'hunk' | 'meta'
  text: string
}

export function buildCliFileChangePreview(input: {
  path: string
  kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  content?: string
  diff?: string
}) {
  const fileName = basename(input.path)
  const raw = (input.diff || input.content || '').replace(/\r\n/g, '\n')
  const sourceLines = raw ? raw.split('\n') : []
  let added = 0
  let deleted = 0

  const lines: CliFileChangePreviewLine[] = sourceLines.map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) {
      return { type: 'meta', text: line }
    }
    if (line.startsWith('@@')) {
      return { type: 'hunk', text: line }
    }
    if (line.startsWith('+')) {
      added += 1
      return { type: 'add', text: line }
    }
    if (line.startsWith('-')) {
      deleted += 1
      return { type: 'delete', text: line }
    }
    if (!input.diff && input.content && input.kind === 'created') {
      added += 1
      return { type: 'add', text: line }
    }
    if (!input.diff && input.content && input.kind === 'deleted') {
      deleted += 1
      return { type: 'delete', text: line }
    }
    return { type: 'context', text: line }
  })

  return {
    fileName,
    added,
    deleted,
    lines,
  }
}

export function formatCliProcessHeadline(input: {
  message: string
  kind?: string
  sourceKind?: string
  command?: string
  detail?: string
}) {
  const sourceKind = (input.sourceKind || '').trim().toLowerCase()
  const kind = (input.kind || '').trim().toLowerCase()
  const message = input.message.trim()

  if (kind === 'stdout' || sourceKind.startsWith('stdout')) {
    return '命令输出'
  }
  if (kind === 'stderr' || kind === 'error' || sourceKind.startsWith('stderr')) {
    return '执行诊断'
  }
  if (
    sourceKind === 'request.started' ||
    sourceKind === 'thread.started' ||
    sourceKind === 'system.init'
  ) {
    return '开始处理请求'
  }
  if (sourceKind === 'session.connected') {
    return '会话已连接'
  }
  if (sourceKind === 'turn.started') {
    return '开始执行任务'
  }
  if (
    sourceKind === 'result.with_warnings' ||
    sourceKind === 'turn.completed.with_warnings'
  ) {
    return '执行完成，有警告'
  }
  if (
    sourceKind === 'result' ||
    sourceKind === 'turn.completed' ||
    sourceKind === 'request.stream.completed'
  ) {
    return '执行完成'
  }
  if (sourceKind === 'request.aborted') {
    return '已停止执行'
  }
  if (sourceKind === 'request.failed') {
    return '执行失败'
  }
  if (sourceKind === 'runtime.keepalive') {
    return '等待新的输出'
  }

  if (kind === 'command' || input.command?.trim()) {
    return '运行 Shell 命令'
  }
  const toolHeadline = formatToolHeadline({
    sourceKind,
    command: input.command,
    detail: input.detail,
  })
  if (toolHeadline) {
    return toolHeadline
  }
  if (kind === 'tool' || sourceKind.startsWith('tool.')) {
    return '调用工具'
  }
  if (kind === 'result') {
    return '执行结果'
  }

  if (/^\d{4}-\d{2}-\d{2}T.*\b(error|warn|info|debug)\b/i.test(message)) {
    return '执行细节'
  }
  if (/\b(codex_core|claude|stderr|stdout)::/i.test(message)) {
    return '执行细节'
  }

  return message || '执行进度'
}
