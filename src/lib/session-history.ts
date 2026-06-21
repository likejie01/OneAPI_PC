import dayjs from 'dayjs'
import type { ChatMessage } from '../shared/contracts'
import type {
  CliClient,
  CliLogKind,
  CliPlanState,
  CliSessionDetails,
  CliSessionMessage,
} from '../shared/desktop'
import { extractCliUserTask } from './cli-prompt.ts'

type ExportAttachment = NonNullable<ChatMessage['attachments']>[number]

export type ExportChatSession = {
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

export type ExportDrawSession = {
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

export type ExportCliLogEvent = {
  kind?: CliLogKind
  sourceKind?: string
  message: string
  command?: string
  detail?: string
  exitCode?: number
}

export type ExportCliLogGroup = {
  title: string
  createdAt: number
  events: ExportCliLogEvent[]
}

function normalizeTimestampMs(value: number) {
  if (!value) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

function normalizeCliMergeContent(message: Pick<CliSessionMessage, 'role' | 'content'>) {
  const rawContent = message.content.trim()
  if (message.role !== 'user') {
    return rawContent
  }
  return extractCliUserTask(rawContent).trim() || rawContent
}

function buildCliMessageKey(message: Pick<CliSessionMessage, 'role' | 'createdAt' | 'content'>) {
  return `${message.role}:${normalizeTimestampMs(message.createdAt)}:${message.content}`
}

function buildCliRequestKey(message: Pick<CliSessionMessage, 'role' | 'requestId'>) {
  return message.requestId?.trim() ? `${message.role}:request:${message.requestId.trim()}` : ''
}

function preferDefined<T>(primary: T | undefined, fallback: T | undefined) {
  return primary ?? fallback
}

function mergeCliMessagePair(left: CliSessionMessage, right: CliSessionMessage) {
  const leftAttachmentCount = left.attachments?.length || 0
  const rightAttachmentCount = right.attachments?.length || 0
  const leftExtensionCount = left.selectedExtensions?.length || 0
  const rightExtensionCount = right.selectedExtensions?.length || 0
  const leftFileChangeCount = left.fileChanges?.length || left.files?.length || 0
  const rightFileChangeCount = right.fileChanges?.length || right.files?.length || 0

  return {
    ...left,
    ...right,
    createdAt: normalizeTimestampMs(preferDefined(right.createdAt, left.createdAt) || 0),
    requestId: preferDefined(right.requestId, left.requestId),
    modelLabel: preferDefined(right.modelLabel, left.modelLabel),
    sourceFilePath: preferDefined(right.sourceFilePath, left.sourceFilePath),
    sourceLineNumber: preferDefined(right.sourceLineNumber, left.sourceLineNumber),
    sourceTimestamp: preferDefined(right.sourceTimestamp, left.sourceTimestamp),
    attachments: rightAttachmentCount >= leftAttachmentCount ? right.attachments : left.attachments,
    selectedExtensions:
      rightExtensionCount >= leftExtensionCount ? right.selectedExtensions : left.selectedExtensions,
    fileChanges: rightFileChangeCount >= leftFileChangeCount ? right.fileChanges : left.fileChanges,
    files: rightFileChangeCount >= leftFileChangeCount ? right.files : left.files,
  } satisfies CliSessionMessage
}

export function mergeCliMessages(left: CliSessionMessage[], right: CliSessionMessage[]) {
  const merged = new Map<string, CliSessionMessage>()
  const userContentIndex = new Map<string, string>()

  for (const item of [...left, ...right]) {
    const normalizedItem = {
      ...item,
      createdAt: normalizeTimestampMs(item.createdAt),
    } satisfies CliSessionMessage
    let key = ''
    if (normalizedItem.role === 'user') {
      const contentKey = `user:content:${normalizeCliMergeContent(normalizedItem)}`
      const existingKey = userContentIndex.get(contentKey)
      if (existingKey) {
        const existingMessage = merged.get(existingKey)
        if (existingMessage && Math.abs(existingMessage.createdAt - normalizedItem.createdAt) <= 30_000) {
          key = existingKey
        }
      }
      if (!key) {
        key = buildCliRequestKey(normalizedItem) || buildCliMessageKey(normalizedItem)
        userContentIndex.set(contentKey, key)
      }
    }
    if (!key) {
      key = buildCliRequestKey(normalizedItem) || buildCliMessageKey(normalizedItem)
    }
    const existing = merged.get(key)
    merged.set(key, existing ? mergeCliMessagePair(existing, normalizedItem) : normalizedItem)
  }

  return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt)
}

export function hasActiveCliPlan(plan?: CliPlanState | null) {
  return !!plan?.items?.some((item) => item.status !== 'completed')
}

export function canDeleteCliMessageFromSessionFile(message: Pick<CliSessionMessage, 'sourceFilePath' | 'sourceLineNumber'>) {
  return !!message.sourceFilePath?.trim() || Number(message.sourceLineNumber || 0) > 0
}

function formatExportTimestamp(value: number) {
  const normalized = normalizeTimestampMs(value)
  if (!normalized) {
    return '未知时间'
  }
  return dayjs(normalized).format('YYYY-MM-DD HH:mm:ss')
}

function formatAttachmentList(attachments?: ExportAttachment[]) {
  if (!attachments?.length) {
    return ''
  }

  return [
    '附件：',
    ...attachments.map((item) => `- [${item.kind === 'image' ? '图片' : '文件'}] ${item.name} (${item.filePath})`),
  ].join('\n')
}

function formatUsageSummary(usage?: ChatMessage['usage']) {
  if (!usage) {
    return ''
  }
  const cacheHitTokens = Math.max(
    Number(usage.prompt_tokens_details?.cached_tokens || 0),
    Number(usage.input_tokens_details?.cached_tokens || 0),
    Number(usage.prompt_cache_hit_tokens || 0)
  )
  const totalTokens = Number(usage.total_tokens || 0)
  const promptTokens = Number(usage.prompt_tokens || 0)
  const cacheHitRatioBase = totalTokens > 0 ? totalTokens : promptTokens
  const cacheHitRatio = cacheHitTokens > 0 && cacheHitRatioBase > 0
    ? Math.max(0, Math.min(100, (cacheHitTokens / cacheHitRatioBase) * 100))
    : 0
  const parts = [
    typeof usage.prompt_tokens === 'number' ? `prompt ${usage.prompt_tokens}` : '',
    typeof usage.completion_tokens === 'number' ? `completion ${usage.completion_tokens}` : '',
    typeof usage.total_tokens === 'number' ? `total ${usage.total_tokens}` : '',
    cacheHitTokens > 0 ? `cache ${cacheHitRatio.toFixed(cacheHitRatio >= 10 ? 0 : 1)}%` : '',
  ].filter(Boolean)
  return parts.length ? `Token：${parts.join(' / ')}` : ''
}

function formatChatMessageBlock(message: ChatMessage) {
  const sections = [
    `## ${message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '系统'} · ${formatExportTimestamp(message.createdAt)}`,
    message.reasoningContent?.trim()
      ? ['### Think', message.reasoningContent.trim()].join('\n\n')
      : '',
    message.content?.trim() ? message.content.trim() : '',
    message.imageUrl ? `图片：${message.imageUrl}` : '',
    formatAttachmentList(message.attachments),
    formatUsageSummary(message.usage),
  ].filter(Boolean)

  return sections.join('\n\n')
}

export function buildChatSessionExportMarkdown(session: ExportChatSession) {
  return [
    `# ${session.title || '聊天会话'}`,
    '',
    `导出时间：${formatExportTimestamp(Date.now())}`,
    `会话更新时间：${formatExportTimestamp(session.updatedAt)}`,
    '',
    ...session.messages.map((item) => formatChatMessageBlock(item)),
  ].join('\n')
}

export function buildDrawSessionExportMarkdown(session: ExportDrawSession) {
  return [
    `# ${session.title || '绘图会话'}`,
    '',
    `导出时间：${formatExportTimestamp(Date.now())}`,
    `会话更新时间：${formatExportTimestamp(session.updatedAt)}`,
    '',
    ...session.messages.map((item) => formatChatMessageBlock(item)),
  ].join('\n')
}

function formatCliPlan(plan?: CliPlanState | null) {
  if (!plan?.items.length) {
    return ''
  }

  return [
    '## 计划',
    plan.explanation ? `${plan.explanation}\n` : '',
    ...plan.items.map((item) => `- ${item.status === 'completed' ? '✔' : item.status === 'in_progress' ? '◔' : '○'} ${item.step}`),
  ].join('\n')
}

function formatCliExtensions(message: CliSessionMessage) {
  if (!message.selectedExtensions?.length) {
    return ''
  }

  return [
    '扩展：',
    ...message.selectedExtensions.map((item) => `- ${item.kind}: ${item.note ? `${item.name} · ${item.note}` : item.name}`),
  ].join('\n')
}

function formatCliFileChanges(message: CliSessionMessage) {
  const items = message.fileChanges || message.files || []
  if (!items.length) {
    return ''
  }

  return [
    '涉及文件：',
    ...items.map((item) => `- [${item.kind}] ${item.path}`),
  ].join('\n')
}

function formatCliMessageBlock(message: CliSessionMessage) {
  return [
    `## ${message.role === 'user' ? '用户' : message.modelLabel || '助手'} · ${formatExportTimestamp(message.createdAt)}`,
    message.content.trim(),
    formatAttachmentList(message.attachments),
    formatCliExtensions(message),
    formatCliFileChanges(message),
  ].filter(Boolean).join('\n\n')
}

function formatCliLogEvent(event: ExportCliLogEvent) {
  return [
    `- ${event.kind || 'status'}: ${event.message}`,
    event.sourceKind ? `  sourceKind: ${event.sourceKind}` : '',
    event.command ? `  command:\n\n\`\`\`\n${event.command}\n\`\`\`` : '',
    event.detail ? `  detail:\n\n\`\`\`\n${event.detail}\n\`\`\`` : '',
    typeof event.exitCode === 'number' ? `  exitCode: ${event.exitCode}` : '',
  ].filter(Boolean).join('\n')
}

function formatCliLogs(logs?: ExportCliLogGroup[]) {
  if (!logs?.length) {
    return ''
  }

  return [
    '## 执行日志',
    ...logs.map((group) => [
      `### ${group.title} · ${formatExportTimestamp(group.createdAt)}`,
      ...group.events.map((event) => formatCliLogEvent(event)),
    ].join('\n\n')),
  ].join('\n\n')
}

export function buildCliSessionExportMarkdown(input: {
  client: CliClient
  title: string
  details: CliSessionDetails
  logs?: ExportCliLogGroup[]
}) {
  const { client, title, details, logs } = input
  return [
    `# ${title || `${client === 'codex' ? 'Codex' : 'Claude'} 会话`}`,
    '',
    `客户端：${client === 'codex' ? 'Codex' : 'Claude'}`,
    `导出时间：${formatExportTimestamp(Date.now())}`,
    `会话更新时间：${formatExportTimestamp(details.updatedAt)}`,
    details.projectName ? `项目：${details.projectName}` : '',
    details.projectPath ? `项目路径：${details.projectPath}` : '',
    '',
    formatCliPlan(details.plan),
    ...details.messages.map((message) => formatCliMessageBlock(message)),
    formatCliLogs(logs),
  ].filter(Boolean).join('\n\n')
}

function slugifyFileName(value: string) {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || 'session'
}

export function buildSessionExportFileName(prefix: string, title: string) {
  return `${prefix}-${slugifyFileName(title)}.md`
}
