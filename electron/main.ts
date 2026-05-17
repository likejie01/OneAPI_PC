import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type WebContents,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const SERVER_BASE_URL = 'http://ai.oneapi.center'
const DESKTOP_PARTITION = 'persist:oneapi-desktop'
const isDev = !!process.env.VITE_DEV_SERVER_URL
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
let mainWindow: BrowserWindow | null = null

function resolveWorkspaceTitle(projectName?: string) {
  const normalized = projectName?.trim()
  return `OneAPI Workspace - ${normalized || 'empty'}`
}

function getDesktopSession() {
  return session.fromPartition(DESKTOP_PARTITION)
}

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type CliClient = 'codex' | 'claude'
type DeployStatus = 'pending' | 'running' | 'success' | 'error'

interface DesktopApiRequest {
  method: ApiMethod
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  headers?: Record<string, string>
}

interface DesktopApiResponse {
  ok: boolean
  status: number
  headers: Record<string, string>
  data: unknown
}

interface CliHistoryEntry {
  id: string
  title: string
  preview: string
  updatedAt: number
  projectName: string
  projectPath?: string
}

interface CliSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  modelLabel?: string
}

interface CliSessionDetails {
  id: string
  client: CliClient
  preview: string
  updatedAt: number
  projectName: string
  projectPath: string
  messages: CliSessionMessage[]
}

interface CliStatus {
  client: CliClient
  installed: boolean
  version: string
  executablePath: string
  configPath: string
  dataPath: string
  hasConfig: boolean
  hasDataDirectory: boolean
}

interface CliRunRequest {
  client: CliClient
  projectPath: string
  prompt: string
  sessionId?: string
  model?: string
  reasoningEffort?: string
}

interface CliRunResponse {
  success: boolean
  output: string
  error: string
  raw: string
  sessionId?: string
  metadata: Record<string, unknown>
}

interface CliDeployRequest {
  client: CliClient
  apiKey: string
  model?: string
  baseUrl?: string
}

interface DeployProgressPayload {
  jobId: string
  client: CliClient
  step: 'detect' | 'install' | 'config' | 'test' | 'complete'
  status: DeployStatus
  message: string
  detail?: string
}

const cliConfig = {
  codex: {
    packageName: '@openai/codex',
    configPath: path.join(os.homedir(), '.codex', 'config.toml'),
    dataPath: path.join(os.homedir(), '.codex'),
  },
  claude: {
    packageName: '@anthropic-ai/claude-code',
    configPath: path.join(os.homedir(), '.claude', 'settings.json'),
    dataPath: path.join(os.homedir(), '.claude'),
  },
} satisfies Record<CliClient, { packageName: string; configPath: string; dataPath: string }>

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1240,
    minHeight: 780,
    title: resolveWorkspaceTitle(),
    backgroundColor: '#f3f2ed',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: DESKTOP_PARTITION,
    },
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })
}

function getAppMeta() {
  return {
    platform: process.platform,
    productName: app.name,
    serverBaseUrl: SERVER_BASE_URL,
  }
}

function buildUrl(requestPath: string, query?: DesktopApiRequest['query']) {
  const target = requestPath.startsWith('http')
    ? requestPath
    : `${SERVER_BASE_URL}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`
  const url = new URL(target)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  const text = await response.text()
  return text.length > 0 ? text : null
}

async function requestApi(input: DesktopApiRequest): Promise<DesktopApiResponse> {
  const headers = new Headers(input.headers ?? {})
  let body: string | undefined

  if (input.body !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
  }

  const response = await getDesktopSession().fetch(buildUrl(input.path, input.query), {
    method: input.method,
    headers,
    body,
  })

  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    data: await parseResponse(response),
  }
}

function getCommandLocator() {
  return process.platform === 'win32' ? 'where' : 'which'
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function shouldUseWindowsCommandShim(command: string) {
  if (process.platform !== 'win32') {
    return false
  }

  const normalized = path.basename(command).toLowerCase()
  return normalized === 'codex' || normalized === 'claude'
}

function quoteWindowsCommandArg(arg: string) {
  if (arg.length === 0) {
    return '""'
  }

  const escaped = arg.replace(/%/g, '%%').replace(/"/g, '""')
  return /[\s"&()<>^|]/.test(escaped) ? `"${escaped}"` : escaped
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
  } = {}
) {
  const timeoutMs = options.timeoutMs ?? 30000
  const useWindowsCommandShim = shouldUseWindowsCommandShim(command)
  const spawnCommand = useWindowsCommandShim ? 'cmd.exe' : command
  const spawnArgs = useWindowsCommandShim
    ? ['/d', '/s', '/c', [command, ...args].map(quoteWindowsCommandArg).join(' ')]
    : args

  return new Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>((resolve) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      stderr += `\n命令执行超时（${timeoutMs}ms）`
      child.kill()
    }, timeoutMs)

    try {
      child.stdin.end()
    } catch {
      /* empty */
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        exitCode: -1,
      })
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })
  })
}

async function locateExecutable(command: string) {
  const result = await runCommand(getCommandLocator(), [command], {
    timeoutMs: 10000,
  })
  if (result.exitCode !== 0) {
    return ''
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean)

  return firstLine ?? ''
}

async function inspectCli(client: CliClient): Promise<CliStatus> {
  const executablePath = await locateExecutable(client)
  const versionResult = executablePath
    ? await runCommand(client, ['--version'], { timeoutMs: 15000 })
    : null

  const version =
    versionResult?.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) ?? ''

  const configPath = cliConfig[client].configPath
  const dataPath = cliConfig[client].dataPath

  return {
    client,
    installed: executablePath.length > 0,
    version,
    executablePath,
    configPath,
    dataPath,
    hasConfig: await pathExists(configPath),
    hasDataDirectory: await pathExists(dataPath),
  }
}

async function pathExists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readJsonLines(filePath: string) {
  if (!(await pathExists(filePath))) {
    return []
  }

  const content = await fs.readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function walkFiles(root: string, matcher: (filePath: string) => boolean) {
  const results: string[] = []

  async function visit(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
      } else if (matcher(fullPath)) {
        results.push(fullPath)
      }
    }
  }

  if (await pathExists(root)) {
    await visit(root)
  }

  return results
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
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
  return (
    !text ||
    text.startsWith('Launching skill:') ||
    text.startsWith('Base directory for this skill:') ||
    text.startsWith('Todos have been modified successfully.') ||
    text.startsWith('<turn_aborted>')
  )
}

function shouldIgnoreCodexMessage(text: string) {
  return (
    !text ||
    text.startsWith('<permissions instructions>') ||
    text.startsWith('<app-context>') ||
    text.startsWith('<collaboration_mode>') ||
    text.startsWith('<skills_instructions>') ||
    text.startsWith('<plugins_instructions>') ||
    text.startsWith('<environment_context>')
  )
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

  const sessionMap = new Map<string, string>()

  for (const file of latestFiles) {
    const lines = await readJsonLines(file.filePath)
    const sessionMetaLine = lines.find((line) => line.includes('"type":"session_meta"'))
    if (!sessionMetaLine) {
      continue
    }
    try {
      const parsed = JSON.parse(sessionMetaLine) as {
        payload?: { id?: string; cwd?: string }
      }
      if (parsed.payload?.id && parsed.payload.cwd) {
        sessionMap.set(parsed.payload.id, parsed.payload.cwd)
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

function parseCodexSession(lines: string[]): CliSessionMessage[] {
  const messages: CliSessionMessage[] = []

  for (const line of lines) {
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
      }

      if (parsed.type === 'response_item' && parsed.payload?.type === 'message') {
        const role = parsed.payload.role
        if (role !== 'user' && role !== 'assistant') {
          continue
        }
        if (role === 'assistant' && parsed.payload.phase !== 'final_answer') {
          continue
        }

        const content = contentPartsToText(parsed.payload.content)
        if (shouldIgnoreCodexMessage(content)) {
          continue
        }

        messages.push({
          id: `${role}-${messages.length}-${toEpochSeconds(parsed.timestamp)}`,
          role,
          content,
          createdAt: toEpochSeconds(parsed.timestamp),
          modelLabel: role === 'assistant' ? 'Codex' : undefined,
        })
      }
    } catch {
      continue
    }
  }

  return uniqueMessages(messages)
}

async function listCodexHistory(limit = 12): Promise<CliHistoryEntry[]> {
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
        grouped.set(parsed.session_id, {
          id: parsed.session_id,
          title: sessionMap.get(parsed.session_id)
            ? path.basename(sessionMap.get(parsed.session_id) ?? '')
            : `Codex 会话 ${parsed.session_id.slice(0, 8)}`,
          preview: normalizeWhitespace(parsed.text),
          updatedAt: parsed.ts,
          projectName: sessionMap.get(parsed.session_id)
            ? path.basename(sessionMap.get(parsed.session_id) ?? '')
            : '未命名项目',
          projectPath: sessionMap.get(parsed.session_id),
        })
      }
    } catch {
      continue
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit)
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

  const messages = parseCodexSession(lines)
  return {
    id: sessionId,
    client: 'codex',
    preview: messages.at(-1)?.content ?? '',
    updatedAt: messages.at(-1)?.createdAt ?? 0,
    projectName: projectPath ? path.basename(projectPath) : '未命名项目',
    projectPath,
    messages,
  }
}

async function listClaudeHistory(limit = 12): Promise<CliHistoryEntry[]> {
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
          preview: normalizeWhitespace(parsed.display),
          updatedAt: Math.floor(parsed.timestamp / 1000),
          projectName: parsed.project ? path.basename(parsed.project) : '未命名项目',
          projectPath: parsed.project,
        })
      }
    } catch {
      continue
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit)
}

async function getClaudeSessionFile(sessionId: string) {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
  const files = await walkFiles(
    projectsRoot,
    (filePath) => filePath.endsWith('.jsonl') && path.basename(filePath) === `${sessionId}.jsonl`
  )
  return files[0] ?? ''
}

function parseClaudeSession(lines: string[]): CliSessionMessage[] {
  const messages: CliSessionMessage[] = []

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string
        timestamp?: string
        cwd?: string
        message?: {
          role?: string
          model?: string
          content?: unknown
        }
      }

      if (parsed.type !== 'user' && parsed.type !== 'assistant') {
        continue
      }

      const role = parsed.message?.role
      if (role !== 'user' && role !== 'assistant') {
        continue
      }

      const content = contentPartsToText(parsed.message?.content)
      if (shouldIgnoreClaudeMessage(content)) {
        continue
      }

      messages.push({
        id: `${role}-${messages.length}-${toEpochSeconds(parsed.timestamp)}`,
        role,
        content,
        createdAt: toEpochSeconds(parsed.timestamp),
        modelLabel: role === 'assistant' ? parsed.message?.model || 'Claude' : undefined,
      })
    } catch {
      continue
    }
  }

  return uniqueMessages(messages)
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

  const messages = parseClaudeSession(lines)
  return {
    id: sessionId,
    client: 'claude',
    preview: messages.at(-1)?.content ?? '',
    updatedAt: messages.at(-1)?.createdAt ?? 0,
    projectName: projectPath ? path.basename(projectPath) : path.basename(path.dirname(filePath)) || '未命名项目',
    projectPath,
    messages,
  }
}

function parseJsonObjectsFromText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
}

function parseCodexReasoningEffort(value?: string) {
  switch (value) {
    case '低':
    case 'low':
      return 'low'
    case '中':
    case 'medium':
      return 'medium'
    case '高':
    case 'high':
    default:
      return 'high'
  }
}

function parseClaudeEffort(value?: string) {
  switch (value) {
    case '低':
    case 'low':
      return 'low'
    case '中':
    case 'medium':
      return 'medium'
    case '高':
    case 'high':
      return 'high'
    case '极限':
    case 'max':
      return 'max'
    default:
      return 'high'
  }
}

async function runCodexPrompt(input: CliRunRequest): Promise<CliRunResponse> {
  const args = input.sessionId
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', input.sessionId, input.prompt]
    : ['exec', '--json', '-C', input.projectPath, '--skip-git-repo-check', input.prompt]

  if (input.model?.trim()) {
    args.splice(args.length - 1, 0, '--model', input.model.trim())
  }

  args.splice(
    args.length - 1,
    0,
    '--config',
    `model_reasoning_effort="${parseCodexReasoningEffort(input.reasoningEffort)}"`
  )

  const result = await runCommand('codex', args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
  })

  const events = parseJsonObjectsFromText(result.stdout)
  const messageEvent = [...events]
    .reverse()
    .find((item) => item.type === 'item.completed' || item.type === 'item.delta')
  const threadEvent = events.find((item) => item.type === 'thread.started')
  const usageEvent = [...events]
    .reverse()
    .find((item) => item.type === 'turn.completed')

  let output = ''
  if (messageEvent?.item && typeof messageEvent.item === 'object') {
    const item = messageEvent.item as { text?: string }
    output = item.text ?? ''
  }

  return {
    success: result.exitCode === 0 && output.length > 0,
    output,
    error: result.stderr.trim(),
    raw: result.stdout,
    sessionId: typeof threadEvent?.thread_id === 'string' ? threadEvent.thread_id : input.sessionId,
    metadata: {
      exitCode: result.exitCode,
      threadId: threadEvent?.thread_id ?? '',
      usage: usageEvent?.usage ?? null,
    },
  }
}

async function runClaudePrompt(input: CliRunRequest): Promise<CliRunResponse> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'bypassPermissions',
  ]

  if (input.model?.trim()) {
    args.push('--model', input.model.trim())
  }

  args.push('--effort', parseClaudeEffort(input.reasoningEffort))

  if (input.sessionId?.trim()) {
    args.push('--resume', input.sessionId.trim())
  }

  args.push(input.prompt)

  const result = await runCommand('claude', args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
  })

  let parsed: Record<string, unknown> | null
  try {
    parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>
  } catch {
    parsed = null
  }

  return {
    success: result.exitCode === 0 && typeof parsed?.result === 'string',
    output: typeof parsed?.result === 'string' ? parsed.result : '',
    error: result.stderr.trim(),
    raw: result.stdout,
    sessionId:
      typeof parsed?.session_id === 'string'
        ? parsed.session_id
        : input.sessionId,
    metadata: parsed ?? { exitCode: result.exitCode },
  }
}

function buildCodexConfig(apiKey: string, model: string, baseUrl: string) {
  const normalizedBaseUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`

  return [
    `model = "${model}"`,
    'model_provider = "oneapi_desktop"',
    'model_reasoning_effort = "high"',
    '',
    '[model_providers.oneapi_desktop]',
    'name = "oneapi_desktop"',
    `base_url = "${normalizedBaseUrl}"`,
    `api_key = "${apiKey}"`,
    'wire_api = "responses"',
    '',
    '[windows]',
    'sandbox = "unelevated"',
    '',
  ].join('\n')
}

async function writeCodexConfig(request: CliDeployRequest) {
  const targetPath = cliConfig.codex.configPath
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await backupIfNeeded(targetPath)
  await fs.writeFile(
    targetPath,
    buildCodexConfig(
      request.apiKey,
      request.model?.trim() || 'gpt-5.4',
      request.baseUrl?.trim() || SERVER_BASE_URL
    ),
    'utf8'
  )
}

async function writeClaudeConfig(request: CliDeployRequest) {
  const targetPath = cliConfig.claude.configPath
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const raw = (await pathExists(targetPath)) ? await fs.readFile(targetPath, 'utf8') : '{}'
  let current: Record<string, unknown>

  try {
    current = JSON.parse(raw) as Record<string, unknown>
  } catch {
    await backupIfNeeded(targetPath)
    current = {}
  }

  const env = {
    ...(typeof current.env === 'object' && current.env ? current.env : {}),
    ANTHROPIC_AUTH_TOKEN: request.apiKey,
    ANTHROPIC_BASE_URL: request.baseUrl?.trim() || SERVER_BASE_URL,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    API_TIMEOUT_MS: '600000',
  }

  const nextConfig = {
    ...current,
    env,
    model: request.model?.trim() || 'claude-sonnet-4-6',
    permissions:
      typeof current.permissions === 'object' && current.permissions
        ? current.permissions
        : { allow: [], deny: [] },
  }

  await fs.writeFile(targetPath, JSON.stringify(nextConfig, null, 2), 'utf8')
}

async function backupIfNeeded(filePath: string) {
  if (!(await pathExists(filePath))) {
    return
  }

  const parsed = path.parse(filePath)
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.oneapi-backup-${Date.now()}${parsed.ext}`
  )
  await fs.copyFile(filePath, backupPath)
}

function sendDeployProgress(webContents: WebContents, payload: DeployProgressPayload) {
  webContents.send('desktop:deploy-progress', payload)
}

async function installCliPackage(client: CliClient) {
  return runCommand(
    getNpmCommand(),
    ['install', '-g', '--registry=https://registry.npmmirror.com', cliConfig[client].packageName],
    {
      timeoutMs: 10 * 60 * 1000,
    }
  )
}

async function deployCli(webContents: WebContents, request: CliDeployRequest, jobId: string) {
  const client = request.client

  sendDeployProgress(webContents, {
    jobId,
    client,
    step: 'detect',
    status: 'running',
    message: `正在检测 ${client} 环境`,
  })

  const detected = await inspectCli(client)
  sendDeployProgress(webContents, {
    jobId,
    client,
    step: 'detect',
    status: 'success',
    message: detected.installed
      ? `已检测到 ${client}，版本 ${detected.version || '未知'}`
      : `未检测到 ${client}，准备安装`,
    detail: detected.executablePath,
  })

  if (!detected.installed) {
    sendDeployProgress(webContents, {
      jobId,
      client,
      step: 'install',
      status: 'running',
      message: `正在通过国内镜像安装 ${client}`,
    })

    const installResult = await installCliPackage(client)
    if (installResult.exitCode !== 0) {
      sendDeployProgress(webContents, {
        jobId,
        client,
        step: 'install',
        status: 'error',
        message: `${client} 安装失败`,
        detail: installResult.stderr || installResult.stdout,
      })
      return
    }

    sendDeployProgress(webContents, {
      jobId,
      client,
      step: 'install',
      status: 'success',
      message: `${client} 安装完成`,
    })
  }

  sendDeployProgress(webContents, {
    jobId,
    client,
    step: 'config',
    status: 'running',
    message: `正在写入 ${client} 配置`,
  })

  try {
    if (client === 'codex') {
      await writeCodexConfig(request)
    } else {
      await writeClaudeConfig(request)
    }

    await fs.mkdir(cliConfig[client].dataPath, { recursive: true })

    sendDeployProgress(webContents, {
      jobId,
      client,
      step: 'config',
      status: 'success',
      message: `${client} 配置写入完成`,
      detail: cliConfig[client].configPath,
    })
  } catch (error) {
    sendDeployProgress(webContents, {
      jobId,
      client,
      step: 'config',
      status: 'error',
      message: `${client} 配置失败`,
      detail: error instanceof Error ? error.message : String(error),
    })
    return
  }

  sendDeployProgress(webContents, {
    jobId,
    client,
    step: 'test',
    status: 'running',
    message: `正在验证 ${client} 连接`,
  })

  const testProjectPath = path.join(os.homedir())
  const testResult =
    client === 'codex'
      ? await runCodexPrompt({
          client,
          projectPath: testProjectPath,
          prompt: '只回复：连接测试成功',
        })
      : await runClaudePrompt({
          client,
          projectPath: testProjectPath,
          prompt: '只回复：连接测试成功',
        })

  if (!testResult.success) {
    sendDeployProgress(webContents, {
      jobId,
      client,
      step: 'test',
      status: 'error',
      message: `${client} 测试失败`,
      detail: testResult.error || testResult.raw,
    })
    return
  }

  sendDeployProgress(webContents, {
    jobId,
    client,
    step: 'test',
    status: 'success',
    message: `${client} 测试通过`,
    detail: testResult.output,
  })

  sendDeployProgress(webContents, {
    jobId,
    client,
    step: 'complete',
    status: 'success',
    message: `${client} 已可直接使用`,
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('app:get-platform', () => process.platform)
ipcMain.handle('app:get-meta', () => getAppMeta())
ipcMain.handle('desktop:api-request', async (_event, request: DesktopApiRequest) =>
  requestApi(request)
)
ipcMain.handle('desktop:open-external', async (_event, url: string) => {
  await shell.openExternal(url)
})
ipcMain.handle('desktop:pick-project', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })

  return result.canceled ? '' : result.filePaths[0] ?? ''
})
ipcMain.handle('desktop:cli-status', async () => {
  const [codex, claude] = await Promise.all([inspectCli('codex'), inspectCli('claude')])
  return {
    codex,
    claude,
  }
})
ipcMain.handle(
  'desktop:list-cli-history',
  async (_event, input: { client: CliClient; limit?: number }) => {
    return input.client === 'codex'
      ? listCodexHistory(input.limit)
      : listClaudeHistory(input.limit)
  }
)
ipcMain.handle(
  'desktop:get-cli-session',
  async (_event, input: { client: CliClient; sessionId: string }) => {
    return input.client === 'codex'
      ? getCodexSession(input.sessionId)
      : getClaudeSession(input.sessionId)
  }
)
ipcMain.handle('desktop:run-cli', async (_event, request: CliRunRequest) => {
  return request.client === 'codex'
    ? runCodexPrompt(request)
    : runClaudePrompt(request)
})
ipcMain.handle('desktop:set-window-title', async (_event, projectName?: string) => {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow
  targetWindow?.setTitle(resolveWorkspaceTitle(projectName))
})
ipcMain.handle('desktop:deploy-cli', async (event, request: CliDeployRequest) => {
  const jobId = randomUUID()
  void deployCli(event.sender, request, jobId)
  return { jobId }
})
