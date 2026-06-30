// @ts-nocheck
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildClaudePlanStateFromRecords, buildCodexPlanStateFromRecords } from '../src/lib/cli-plan.ts'
import { isClaudeAssistantTerminalMessage } from '../src/lib/cli-history-filter.ts'
import { extractCliUserTask } from '../src/lib/cli-prompt.ts'

const CODEX_SESSION_META_SCAN_BYTES = 64 * 1024
const CODEX_SESSION_META_SCAN_LINES = 80

function exportedContentPartsToText(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (typeof part !== 'object' || !part) {
        return ''
      }

      if ('text' in part && typeof part.text === 'string') {
        return part.text
      }

      if ('content' in part && typeof part.content === 'string') {
        return part.content
      }

      if ('type' in part && part.type === 'tool_result' && 'content' in part) {
        const contentValue = (part as { content?: unknown }).content
        if (typeof contentValue === 'string') {
          return contentValue
        }
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function shouldIgnoreCodexMessage(text: string) {
  const normalized = text.trim()
  return (
    !normalized ||
    normalized.startsWith('<permissions instructions>') ||
    normalized.startsWith('<app-context>') ||
    normalized.startsWith('<collaboration_mode>') ||
    normalized.startsWith('<skills_instructions>') ||
    normalized.startsWith('<plugins_instructions>') ||
    normalized.startsWith('<environment_context>') ||
    normalized.startsWith('<model_switch>')
  )
}

function exportedExtractFilePathFromText(text: string) {
  const match = text.match(/(?:[A-Za-z]:)?[\\/][^\n\r<>:"|?*]+/)
  return match?.[0]?.trim().replace(/[),.;]+$/, '') || ''
}

export function extractCodexAssistantTextFromEvent(parsed: Record<string, unknown>) {
  if (
    parsed.type === 'response_item' &&
    typeof parsed.payload === 'object' &&
    parsed.payload
  ) {
    const payload = parsed.payload as Record<string, unknown>
    if (payload.type === 'message' && payload.role === 'assistant') {
      const assistantText = exportedContentPartsToText(payload.content)
      if (assistantText.trim() && !shouldIgnoreCodexMessage(assistantText)) {
        return assistantText
      }
    }
  }

  if (parsed.type === 'item.completed' && typeof parsed.item === 'object' && parsed.item) {
    const item = parsed.item as Record<string, unknown>
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      const assistantText = item.text.trim()
      if (assistantText && !shouldIgnoreCodexMessage(assistantText)) {
        return assistantText
      }
    }
  }

  return ''
}

export function extractCodexFileChanges(lines: string[]) {
  const fileChanges = new Map<string, CliFileChange>()

  for (const line of lines) {
    if (!line.includes('patch_apply_end') && !line.includes('apply_patch') && !line.includes('changes')) {
      continue
    }

    try {
      const parsed = JSON.parse(line) as {
        type?: string
        changes?: Record<string, { type?: string; unified_diff?: string }>
        stdout?: string
      }

      if (parsed.changes && typeof parsed.changes === 'object') {
        for (const [pathName, change] of Object.entries(parsed.changes)) {
          if (!pathName) {
            continue
          }
          fileChanges.set(pathName, {
            path: pathName,
            kind:
              change.type === 'create'
                ? 'created'
                : change.type === 'delete'
                  ? 'deleted'
                  : change.type === 'rename'
                    ? 'renamed'
                    : 'modified',
            diff: change.unified_diff || '',
          })
        }
      }

      if (typeof parsed.stdout === 'string' && parsed.stdout.trim()) {
        const filePath = exportedExtractFilePathFromText(parsed.stdout)
        if (filePath && !fileChanges.has(filePath)) {
          fileChanges.set(filePath, {
            path: filePath,
            kind: 'unknown',
            content: parsed.stdout.trim(),
          })
        }
      }
    } catch {
      continue
    }
  }

  return [...fileChanges.values()]
}

export function extractClaudeFileChanges(lines: string[]) {
  const fileChanges = new Map<string, CliFileChange>()

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        toolUseResult?: {
          filePath?: string
          file?: {
            filePath?: string
            content?: string
          }
          structuredPatch?: string
        }
      }

      const filePath =
        parsed.toolUseResult?.file?.filePath?.trim() ||
        parsed.toolUseResult?.filePath?.trim() ||
        ''

      if (!filePath) {
        continue
      }

      fileChanges.set(filePath, {
        path: filePath,
        kind: parsed.toolUseResult?.structuredPatch ? 'modified' : 'unknown',
        content: parsed.toolUseResult?.file?.content || '',
        diff: parsed.toolUseResult?.structuredPatch || '',
      })
    } catch {
      continue
    }
  }

  return [...fileChanges.values()]
}

export function mergeFileChanges(left: CliFileChange[], right: CliFileChange[]) {
  const seen = new Set<string>()
  return [...left, ...right].filter((item) => {
    const key = `${item.path}:${item.kind}:${item.diff || item.content || ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function createCliHistoryServices(deps) {
  const { readJsonLines, walkFiles } = deps

async function readCodexSessionMetaLine(filePath: string) {
  let buffered = ''
  let scannedLines = 0
  const stream = createReadStream(filePath, { encoding: 'utf8', end: CODEX_SESSION_META_SCAN_BYTES - 1 })

  try {
    for await (const chunk of stream) {
      buffered += chunk
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ''

      for (const line of lines) {
        scannedLines += 1
        if (line.includes('"type":"session_meta"')) {
          return line
        }
        if (scannedLines >= CODEX_SESSION_META_SCAN_LINES) {
          return ''
        }
      }
    }
  } catch {
    return ''
  }

  return buffered.includes('"type":"session_meta"') ? buffered : ''
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function sanitizeCliUserPrompt(raw: string) {
  return extractCliUserTask(raw)
}

function toEpochSeconds(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
    }

    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000)
    }
  }

  return 0
}

function contentPartsToText(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (typeof part !== 'object' || !part) {
        return ''
      }

      if ('text' in part && typeof part.text === 'string') {
        return part.text
      }

      if ('content' in part && typeof part.content === 'string') {
        return part.content
      }

      if ('type' in part && part.type === 'tool_result' && 'content' in part) {
        const contentValue = (part as { content?: unknown }).content
        if (typeof contentValue === 'string') {
          return contentValue
        }
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function shouldIgnoreClaudeMessage(text: string) {
  const normalized = text.trim()
  return (
    !normalized ||
    normalized.startsWith('Launching skill:') ||
    normalized.startsWith('Base directory for this skill:') ||
    normalized.startsWith('Todos have been modified successfully.') ||
    normalized.startsWith('<turn_aborted>') ||
    normalized === 'No files found' ||
    normalized.startsWith('File created successfully at:') ||
    normalized.startsWith('File updated successfully at:') ||
    normalized.startsWith('File deleted successfully at:') ||
    normalized.startsWith('Updated task #') ||
    normalized.startsWith('Created task #') ||
    normalized.startsWith('[{') ||
    normalized.includes('"tool_use_id"') ||
    normalized.includes('"tool_result"') ||
    normalized.includes('"toolUseResult"') ||
    normalized.startsWith('Tool execution') ||
    normalized.startsWith('Command completed')
  )
}

function shouldIgnoreClaudeContent(content: unknown) {
  if (!Array.isArray(content) || content.length === 0) {
    return false
  }

  return content.every((part) => {
    if (!part || typeof part !== 'object') {
      return false
    }

    const typedPart = part as {
      type?: string
      isMeta?: boolean
      name?: string
    }

    if (typedPart.isMeta) {
      return true
    }

    if (
      typedPart.type === 'thinking' ||
      typedPart.type === 'tool_use' ||
      typedPart.type === 'tool_result' ||
      typedPart.type === 'progress' ||
      typedPart.type === 'queue-operation'
    ) {
      return true
    }

    return typedPart.name === 'queue-operation'
  })
}

function hasClaudeToolContent(content: unknown) {
  if (!Array.isArray(content) || content.length === 0) {
    return false
  }

  return content.some((part) => {
    if (!part || typeof part !== 'object') {
      return false
    }

    const typedPart = part as {
      type?: string
      name?: string
    }

    return (
      typedPart.type === 'tool_use' ||
      typedPart.type === 'tool_result' ||
      typedPart.type === 'progress' ||
      typedPart.type === 'queue-operation' ||
      typedPart.name === 'queue-operation'
    )
  })
}

function shouldIgnoreCodexMessage(text: string) {
  const normalized = text.trim()
  return (
    !normalized ||
    normalized.startsWith('<permissions instructions>') ||
    normalized.startsWith('<app-context>') ||
    normalized.startsWith('<collaboration_mode>') ||
    normalized.startsWith('<skills_instructions>') ||
    normalized.startsWith('<plugins_instructions>') ||
    normalized.startsWith('<environment_context>') ||
    normalized.startsWith('<model_switch>')
  )
}

function extractCodexAssistantTextFromEvent(parsed: Record<string, unknown>) {
  if (
    parsed.type === 'response_item' &&
    typeof parsed.payload === 'object' &&
    parsed.payload
  ) {
    const payload = parsed.payload as Record<string, unknown>
    if (payload.type === 'message' && payload.role === 'assistant') {
      const assistantText = contentPartsToText(payload.content)
      if (assistantText.trim() && !shouldIgnoreCodexMessage(assistantText)) {
        return assistantText
      }
    }
  }

  if (parsed.type === 'item.completed' && typeof parsed.item === 'object' && parsed.item) {
    const item = parsed.item as Record<string, unknown>
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      const assistantText = item.text.trim()
      if (assistantText && !shouldIgnoreCodexMessage(assistantText)) {
        return assistantText
      }
    }
  }

  return ''
}

function uniqueMessages(messages: CliSessionMessage[]) {
  const seen = new Set<string>()
  return messages.filter((item) => {
    const key = `${item.role}:${item.createdAt}:${item.content}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function extractFilePathFromText(text: string) {
  const match = text.match(/(?:[A-Za-z]:)?[\\/][^\n\r<>:"|?*]+/)
  return match?.[0]?.trim().replace(/[),.;]+$/, '') || ''
}

function extractCodexFileChanges(lines: string[]) {
  const fileChanges = new Map<string, CliFileChange>()

  for (const line of lines) {
    if (!line.includes('patch_apply_end') && !line.includes('apply_patch') && !line.includes('changes')) {
      continue
    }

    try {
      const parsed = JSON.parse(line) as {
        type?: string
        changes?: Record<string, { type?: string; unified_diff?: string }>
        stdout?: string
      }

      if (parsed.changes && typeof parsed.changes === 'object') {
        for (const [pathName, change] of Object.entries(parsed.changes)) {
          if (!pathName) {
            continue
          }
          fileChanges.set(pathName, {
            path: pathName,
            kind:
              change.type === 'create'
                ? 'created'
                : change.type === 'delete'
                  ? 'deleted'
                  : change.type === 'rename'
                    ? 'renamed'
                    : 'modified',
            diff: change.unified_diff || '',
          })
        }
      }

      if (typeof parsed.stdout === 'string' && parsed.stdout.trim()) {
        const filePath = extractFilePathFromText(parsed.stdout)
        if (filePath && !fileChanges.has(filePath)) {
          fileChanges.set(filePath, {
            path: filePath,
            kind: 'unknown',
            content: parsed.stdout.trim(),
          })
        }
      }
    } catch {
      continue
    }
  }

  return [...fileChanges.values()]
}

function extractClaudeFileChanges(lines: string[]) {
  const fileChanges = new Map<string, CliFileChange>()

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        toolUseResult?: {
          filePath?: string
          file?: {
            filePath?: string
            content?: string
          }
          structuredPatch?: string
        }
      }

      const filePath =
        parsed.toolUseResult?.file?.filePath?.trim() ||
        parsed.toolUseResult?.filePath?.trim() ||
        ''

      if (!filePath) {
        continue
      }

      fileChanges.set(filePath, {
        path: filePath,
        kind: parsed.toolUseResult?.structuredPatch ? 'modified' : 'unknown',
        content: parsed.toolUseResult?.file?.content || '',
        diff: parsed.toolUseResult?.structuredPatch || '',
      })
    } catch {
      continue
    }
  }

  return [...fileChanges.values()]
}

async function buildCodexSessionMap() {
  const sessionRoot = path.join(os.homedir(), '.codex', 'sessions')
  const files = await walkFiles(sessionRoot, (filePath) => filePath.endsWith('.jsonl'))
  const stats = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      stat: await fs.stat(filePath),
    }))
  )

  const latestFiles = stats
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
    .slice(0, 40)

  const sessionMap = new Map<string, { projectPath: string; filePath: string; mtimeMs: number }>()

  for (const file of latestFiles) {
    const sessionMetaLine = await readCodexSessionMetaLine(file.filePath)
    if (!sessionMetaLine) {
      continue
    }
    try {
      const parsed = JSON.parse(sessionMetaLine) as {
        payload?: { id?: string; cwd?: string }
      }
      if (parsed.payload?.id && parsed.payload.cwd) {
        sessionMap.set(parsed.payload.id, {
          projectPath: parsed.payload.cwd,
          filePath: file.filePath,
          mtimeMs: file.stat.mtimeMs,
        })
      }
    } catch {
      continue
    }
  }

  return sessionMap
}

async function getLatestCodexSessionFile(sessionId: string) {
  const sessionRoot = path.join(os.homedir(), '.codex', 'sessions')
  const files = await walkFiles(
    sessionRoot,
    (filePath) => filePath.endsWith('.jsonl') && filePath.includes(sessionId)
  )

  if (files.length === 0) {
    return ''
  }

  const stats = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      stat: await fs.stat(filePath),
    }))
  )

  return stats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0]?.filePath ?? ''
}

function mergeFileChanges(left: CliFileChange[], right: CliFileChange[]) {
  const seen = new Set<string>()
  return [...left, ...right].filter((item) => {
    const key = `${item.path}:${item.kind}:${item.diff || item.content || ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function parseCodexSession(lines: string[]): {
  messages: CliSessionMessage[]
  fileChanges: CliFileChange[]
  plan: CliPlanState | null
} {
  const messages: CliSessionMessage[] = []
  const fileChanges: CliFileChange[] = []
  const planRecords: Array<Record<string, unknown>> = []

  for (const [index, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string
        timestamp?: string
        message?: { role?: string; content?: unknown }
        payload?: {
          type?: string
          role?: string
          phase?: string
          content?: unknown
          message?: { role?: string; content?: unknown }
        }
        changes?: Record<string, { type?: string; unified_diff?: string }>
      }

      planRecords.push(parsed as Record<string, unknown>)

      if (parsed.changes && typeof parsed.changes === 'object') {
        for (const [pathName, change] of Object.entries(parsed.changes)) {
          if (!pathName) {
            continue
          }
          fileChanges.push({
            path: pathName,
            kind:
              change.type === 'create'
                ? 'created'
                : change.type === 'delete'
                  ? 'deleted'
                  : change.type === 'rename'
                    ? 'renamed'
                    : 'modified',
            diff: change.unified_diff || '',
          })
        }
      }

      if (parsed.type === 'response_item' && parsed.payload?.type === 'message') {
        const role = parsed.payload.role
        if (role !== 'user' && role !== 'assistant') {
          continue
        }
        if (role === 'assistant' && typeof parsed.payload.phase === 'string' && parsed.payload.phase !== 'final_answer') {
          continue
        }
        if (role === 'user' && typeof parsed.payload.phase === 'string' && parsed.payload.phase !== 'input') {
          continue
        }

        const rawContent = contentPartsToText(parsed.payload.content)
        const content = role === 'user' ? sanitizeCliUserPrompt(rawContent) : rawContent
        if (shouldIgnoreCodexMessage(content)) {
          continue
        }

        messages.push({
          id: `${role}-${messages.length}-${toEpochSeconds(parsed.timestamp)}`,
          role,
          content,
          createdAt: toEpochSeconds(parsed.timestamp),
          modelLabel: role === 'assistant' ? 'Codex' : undefined,
          sourceLineNumber: index + 1,
          sourceTimestamp: parsed.timestamp,
        })
      }
    } catch {
      continue
    }
  }

  return {
    messages: uniqueMessages(messages),
    fileChanges: mergeFileChanges([], fileChanges),
    plan: buildCodexPlanStateFromRecords(planRecords),
  }
}

async function listCodexHistory(limit = 0): Promise<CliHistoryEntry[]> {
  const lines = await readJsonLines(path.join(os.homedir(), '.codex', 'history.jsonl'))
  const sessionMap = await buildCodexSessionMap()
  const grouped = new Map<string, CliHistoryEntry>()

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        session_id?: string
        ts?: number
        text?: string
      }

      if (!parsed.session_id || !parsed.text || !parsed.ts) {
        continue
      }

      const previous = grouped.get(parsed.session_id)
      if (!previous || previous.updatedAt < parsed.ts) {
        const metadata = sessionMap.get(parsed.session_id)
        const projectPath = metadata?.projectPath ?? ''
        const projectName = projectPath ? path.basename(projectPath) : '未命名项目'
        grouped.set(parsed.session_id, {
          id: parsed.session_id,
          title: projectPath ? path.basename(projectPath) : `Codex 会话 ${parsed.session_id.slice(0, 8)}`,
          preview: normalizeWhitespace(sanitizeCliUserPrompt(parsed.text)),
          updatedAt: parsed.ts,
          projectName,
          projectPath,
        })
      }
    } catch {
      continue
    }
  }

  for (const [sessionId, metadata] of sessionMap.entries()) {
    const previous = grouped.get(sessionId)
    grouped.set(sessionId, {
      id: sessionId,
      title: path.basename(metadata.projectPath || '') || previous?.title || `Codex 会话 ${sessionId.slice(0, 8)}`,
      preview: previous?.preview || '',
      updatedAt: Math.floor(metadata.mtimeMs / 1000) || previous?.updatedAt || 0,
      projectName: path.basename(metadata.projectPath || '') || previous?.projectName || '未命名项目',
      projectPath: metadata.projectPath || previous?.projectPath,
    })
  }

  const sorted = [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
  return limit > 0 ? sorted.slice(0, limit) : sorted
}

async function getCodexSession(sessionId: string): Promise<CliSessionDetails | null> {
  const filePath = await getLatestCodexSessionFile(sessionId)
  if (!filePath) {
    return null
  }

  const lines = await readJsonLines(filePath)
  const sessionMetaLine = lines.find((line) => line.includes('"type":"session_meta"'))
  let projectPath = ''

  if (sessionMetaLine) {
    try {
      const parsed = JSON.parse(sessionMetaLine) as {
        payload?: { cwd?: string }
      }
      projectPath = parsed.payload?.cwd ?? ''
    } catch {
      projectPath = ''
    }
  }

  const parsedSession = parseCodexSession(lines)
  return {
    id: sessionId,
    client: 'codex',
    preview: parsedSession.messages.at(-1)?.content ?? '',
    updatedAt: parsedSession.messages.at(-1)?.createdAt ?? 0,
    projectName: projectPath ? path.basename(projectPath) : '未命名项目',
    projectPath,
    messages: parsedSession.messages.map((message) => ({
      ...message,
      sourceFilePath: filePath,
      fileChanges: message.role === 'assistant' ? parsedSession.fileChanges : undefined,
    })),
    fileChanges: parsedSession.fileChanges,
    plan: parsedSession.plan,
  }
}

async function listClaudeHistory(limit = 0): Promise<CliHistoryEntry[]> {
  const lines = await readJsonLines(path.join(os.homedir(), '.claude', 'history.jsonl'))
  const grouped = new Map<string, CliHistoryEntry>()

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        display?: string
        timestamp?: number
        project?: string
        sessionId?: string
      }

      if (!parsed.sessionId || !parsed.display || !parsed.timestamp) {
        continue
      }

      const previous = grouped.get(parsed.sessionId)
      if (!previous || previous.updatedAt < parsed.timestamp) {
        grouped.set(parsed.sessionId, {
          id: parsed.sessionId,
          title: parsed.project ? path.basename(parsed.project) : `Claude 会话 ${parsed.sessionId.slice(0, 8)}`,
          preview: normalizeWhitespace(sanitizeCliUserPrompt(parsed.display)),
          updatedAt: Math.floor(parsed.timestamp / 1000),
          projectName: parsed.project ? path.basename(parsed.project) : '未命名项目',
          projectPath: parsed.project,
        })
      }
    } catch {
      continue
    }
  }

  const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
  const files = await walkFiles(
    projectsRoot,
    (filePath) => filePath.endsWith('.jsonl') && !filePath.includes(`${path.sep}subagents${path.sep}`)
  )
  const recentFiles = (
    await Promise.all(
      files.map(async (filePath) => ({
        filePath,
        stat: await fs.stat(filePath),
      }))
    )
  )
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)

  for (const file of recentFiles) {
    const sessionId = path.basename(file.filePath, '.jsonl')
    if (grouped.has(sessionId)) {
      continue
    }
    const projectPath = decodeClaudeProjectPathFromFilePath(file.filePath)
    const projectName = projectPath ? path.basename(projectPath) : '未命名项目'
    grouped.set(sessionId, {
      id: sessionId,
      title: projectName !== '未命名项目' ? projectName : `Claude 会话 ${sessionId.slice(0, 8)}`,
      preview: '',
      updatedAt: Math.floor(file.stat.mtimeMs / 1000),
      projectName,
      projectPath,
    })
  }

  const sorted = [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
  return limit > 0 ? sorted.slice(0, limit) : sorted
}

async function getClaudeSessionFile(sessionId: string) {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
  const files = await walkFiles(
    projectsRoot,
    (filePath) =>
      filePath.endsWith('.jsonl') &&
      path.basename(filePath) === `${sessionId}.jsonl` &&
      !filePath.includes(`${path.sep}subagents${path.sep}`)
  )
  return files[0] ?? ''
}

function decodeClaudeProjectPathFromFilePath(filePath: string) {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
  const relative = path.relative(projectsRoot, filePath)
  if (!relative || relative.startsWith('..')) {
    return ''
  }

  const [encodedRoot] = relative.split(path.sep)
  if (!encodedRoot?.trim()) {
    return ''
  }

  const segments = encodedRoot.split('--').filter(Boolean)
  if (!segments.length) {
    return ''
  }

  if (segments[0].length === 1) {
    return `${segments[0]}:\\${segments.slice(1).join('\\')}`
  }

  return segments.join(path.sep)
}

function parseClaudeSession(lines: string[]): {
  messages: CliSessionMessage[]
  fileChanges: CliFileChange[]
  plan: CliPlanState | null
} {
  const messages: CliSessionMessage[] = []
  const fileChanges: CliFileChange[] = []
  const planRecords: Array<Record<string, unknown>> = []

  for (const [index, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string
        timestamp?: string
        cwd?: string
        isApiErrorMessage?: boolean
        message?: {
          role?: string
          model?: string
          content?: unknown
          stop_reason?: unknown
        }
        toolUseResult?: {
          filePath?: string
          file?: {
            filePath?: string
            content?: string
          }
          structuredPatch?: string
        }
      }

      planRecords.push(parsed as Record<string, unknown>)

      if (parsed.type !== 'user' && parsed.type !== 'assistant') {
        continue
      }

      const role = parsed.message?.role
      if (role !== 'user' && role !== 'assistant') {
        continue
      }
      if (role === 'user' && parsed.toolUseResult) {
        continue
      }
      if (role === 'user' && hasClaudeToolContent(parsed.message?.content)) {
        continue
      }
      if (shouldIgnoreClaudeContent(parsed.message?.content)) {
        continue
      }

      const toolResultPath =
        parsed.toolUseResult?.file?.filePath?.trim() ||
        parsed.toolUseResult?.filePath?.trim() ||
        ''
      if (toolResultPath) {
        fileChanges.push({
          path: toolResultPath,
          kind: parsed.toolUseResult?.structuredPatch ? 'modified' : 'unknown',
          content: parsed.toolUseResult?.file?.content || '',
          diff: parsed.toolUseResult?.structuredPatch || '',
        })
      }

      const rawContent = contentPartsToText(parsed.message?.content)
      const content = role === 'user' ? sanitizeCliUserPrompt(rawContent) : rawContent
      if (shouldIgnoreClaudeMessage(content)) {
        continue
      }
      if (
        role === 'assistant' &&
        !isClaudeAssistantTerminalMessage({
          role,
          stopReason: parsed.message?.stop_reason,
          isApiErrorMessage: !!parsed.isApiErrorMessage,
        })
      ) {
        continue
      }

      messages.push({
        id: `${role}-${messages.length}-${toEpochSeconds(parsed.timestamp)}`,
        role,
        content,
        createdAt: toEpochSeconds(parsed.timestamp),
        modelLabel: role === 'assistant' ? parsed.message?.model || 'Claude' : undefined,
        sourceLineNumber: index + 1,
        sourceTimestamp: parsed.timestamp,
      })
    } catch {
      continue
    }
  }

  return {
    messages: uniqueMessages(messages),
    fileChanges: mergeFileChanges([], fileChanges),
    plan: buildClaudePlanStateFromRecords(planRecords),
  }
}

async function getClaudeSession(sessionId: string): Promise<CliSessionDetails | null> {
  const filePath = await getClaudeSessionFile(sessionId)
  if (!filePath) {
    return null
  }

  const lines = await readJsonLines(filePath)
  let projectPath = ''

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { cwd?: string }
      if (parsed.cwd) {
        projectPath = parsed.cwd
        break
      }
    } catch {
      continue
    }
  }

  if (!projectPath) {
    projectPath = decodeClaudeProjectPathFromFilePath(filePath)
  }

  const parsedSession = parseClaudeSession(lines)
  return {
    id: sessionId,
    client: 'claude',
    preview: parsedSession.messages.at(-1)?.content ?? '',
    updatedAt: parsedSession.messages.at(-1)?.createdAt ?? 0,
    projectName: projectPath ? path.basename(projectPath) : '未命名项目',
    projectPath,
    messages: parsedSession.messages.map((message) => ({
      ...message,
      sourceFilePath: filePath,
      fileChanges: message.role === 'assistant' ? parsedSession.fileChanges : undefined,
    })),
    fileChanges: parsedSession.fileChanges,
    plan: parsedSession.plan,
  }
}

  return {
    normalizeWhitespace,
    sanitizeCliUserPrompt,
    getLatestCodexSessionFile,
    listCodexHistory,
    getCodexSession,
    listClaudeHistory,
    getClaudeSessionFile,
    getClaudeSession,
  }
}
