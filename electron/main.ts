import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
  type WebContents,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const SERVER_BASE_URL = 'http://ai.oneapi.center'
const DEFAULT_CODEX_MODEL = 'gpt-5.5'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'
const DESKTOP_PARTITION = 'persist:oneapi-desktop'
const isDev = !!process.env.VITE_DEV_SERVER_URL
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ICON_PATH = isDev
  ? path.join(path.dirname(__dirname), 'public', 'Icon.png')
  : path.join(path.dirname(__dirname), 'dist', 'Icon.png')
let mainWindow: BrowserWindow | null = null
const activeApiRequests = new Map<string, AbortController>()
const activeCliProcesses = new Map<string, ChildProcess>()
const stoppedCliRequests = new Set<string>()

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
  requestId?: string
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
  fileChanges?: CliFileChange[]
}

interface CliFileChange {
  path: string
  kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  content?: string
  diff?: string
}

interface CliSessionDetails {
  id: string
  client: CliClient
  preview: string
  updatedAt: number
  projectName: string
  projectPath: string
  messages: CliSessionMessage[]
  fileChanges?: CliFileChange[]
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
  requestId: string
  projectPath: string
  prompt: string
  sessionId?: string
  model?: string
  reasoningEffort?: string
  fullAccess?: boolean
}

interface CliRunResponse {
  success: boolean
  requestId: string
  output: string
  error: string
  raw: string
  sessionId?: string
  metadata: Record<string, unknown>
}

interface CliProgressPayload {
  client: CliClient
  requestId: string
  sessionId?: string
  kind: 'status' | 'partial' | 'error'
  message: string
  createdAt: number
  done?: boolean
  files?: CliFileChange[]
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

interface DesktopAttachmentSaveRequest {
  name: string
  mimeType?: string
  dataBase64: string
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
  const appIcon = nativeImage.createFromPath(APP_ICON_PATH)
  const win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1240,
    minHeight: 780,
    title: resolveWorkspaceTitle(),
    backgroundColor: '#f3f2ed',
    icon: appIcon,
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
  const controller = input.requestId ? new AbortController() : null

  if (input.body !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
  }

  if (input.requestId && controller) {
    activeApiRequests.set(input.requestId, controller)
  }

  try {
    const response = await getDesktopSession().fetch(buildUrl(input.path, input.query), {
      method: input.method,
      headers,
      body,
      signal: controller?.signal,
    })

    return {
      ok: response.ok,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data: await parseResponse(response),
    }
  } catch (error) {
    if (controller?.signal.aborted) {
      return {
        ok: false,
        status: 499,
        headers: {},
        data: {
          success: false,
          message: '请求已取消',
        },
      }
    }
    throw error
  } finally {
    if (input.requestId) {
      activeApiRequests.delete(input.requestId)
    }
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

function createLineConsumer(listener?: (line: string) => void) {
  let buffer = ''

  return {
    push(chunk: Buffer | string) {
      if (!listener) {
        return
      }

      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) {
          listener(trimmed)
        }
      }
    },
    flush() {
      if (!listener) {
        return
      }

      const trimmed = buffer.trim()
      if (trimmed) {
        listener(trimmed)
      }
      buffer = ''
    },
  }
}

function spawnCommandWithHandlers(
  command: string,
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    onStdoutLine?: (line: string) => void
    onStderrLine?: (line: string) => void
    onSpawn?: (child: ChildProcess) => void
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
    options.onSpawn?.(child)

    let stdout = ''
    let stderr = ''
    let settled = false
    const stdoutConsumer = createLineConsumer(options.onStdoutLine)
    const stderrConsumer = createLineConsumer(options.onStderrLine)

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
      stdoutConsumer.push(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      stderrConsumer.push(chunk)
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      stdoutConsumer.flush()
      stderrConsumer.flush()
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
      stdoutConsumer.flush()
      stderrConsumer.flush()
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })
  })
}

async function stopChildProcess(child?: ChildProcess | null) {
  if (!child?.pid) {
    return
  }

  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      timeoutMs: 15000,
    })
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {
    /* empty */
  }

  await wait(300)

  try {
    if (!child.killed) {
      child.kill('SIGKILL')
    }
  } catch {
    /* empty */
  }
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
  return spawnCommandWithHandlers(command, args, options)
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

async function resolveOpenTarget(targetPath: string) {
  const normalized = targetPath.trim()
  if (!normalized) {
    return ''
  }

  if (await pathExists(normalized)) {
    const stat = await fs.stat(normalized)
    return stat.isDirectory() ? normalized : path.dirname(normalized)
  }

  const parentDirectory = path.dirname(normalized)
  if (await pathExists(parentDirectory)) {
    return parentDirectory
  }

  return ''
}

async function saveDesktopAttachment(input: DesktopAttachmentSaveRequest) {
  const extension = path.extname(input.name || '')
  const safeBaseName =
    path.basename(input.name || 'clipboard-file', extension).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') ||
    'clipboard-file'
  const targetDirectory = path.join(app.getPath('userData'), 'attachments')
  await fs.mkdir(targetDirectory, { recursive: true })
  const targetPath = path.join(
    targetDirectory,
    `${Date.now()}-${safeBaseName}${extension || ''}`
  )

  await fs.writeFile(targetPath, Buffer.from(input.dataBase64, 'base64'))
  return {
    path: targetPath,
  }
}

async function readFilePreview(targetPath: string) {
  const resolved = path.resolve(targetPath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) {
    throw new Error('当前路径不是文件。')
  }

  const buffer = await fs.readFile(resolved)
  const content = buffer.toString('utf8')
  return {
    path: resolved,
    name: path.basename(resolved),
    content,
  }
}

async function readCurrentCodexConfig() {
  const targetPath = cliConfig.codex.configPath
  const raw = await fs.readFile(targetPath, 'utf8')
  const apiKeyMatch = raw.match(/api_key\s*=\s*"([^"]+)"/)
  const modelMatch = raw.match(/model\s*=\s*"([^"]+)"/)
  const baseUrlMatch = raw.match(/base_url\s*=\s*"([^"]+)"/)

  return {
    client: 'codex' as const,
    apiKey: apiKeyMatch?.[1]?.trim() || '',
    model: modelMatch?.[1]?.trim() || DEFAULT_CODEX_MODEL,
    baseUrl: baseUrlMatch?.[1]?.trim().replace(/\/v1$/, '') || SERVER_BASE_URL,
  }
}

function extractTomlSection(raw: string, section: string) {
  const sectionStart = raw.indexOf(`[${section}]`)
  if (sectionStart < 0) {
    return ''
  }

  const nextSection = raw.slice(sectionStart + section.length + 2).search(/^\[[^\]]+\]/m)
  if (nextSection < 0) {
    return raw.slice(sectionStart).trimEnd()
  }

  return raw.slice(sectionStart, sectionStart + section.length + 2 + nextSection).trimEnd()
}

function mergeCodexConfig(raw: string, apiKey: string, model: string, baseUrl: string) {
  const preservedSections = [
    'skills',
    'plugins',
    'projects',
    'windows',
  ]
    .map((section) => extractTomlSection(raw, section))
    .filter(Boolean)

  const originalProviderSection = extractTomlSection(raw, 'model_providers.oneapi_desktop')
  const renamedOriginalProvider = originalProviderSection
    ? originalProviderSection
        .replace('[model_providers.oneapi_desktop]', '[model_providers.oneapi_desktop_original]')
        .replace(/name\s*=\s*"oneapi_desktop"/, 'name = "oneapi_desktop_original"')
    : ''

  const preservedBlocks = [renamedOriginalProvider, ...preservedSections].filter(Boolean)

  return [
    `model = "${model}"`,
    'model_provider = "oneapi_desktop"',
    'model_reasoning_effort = "high"',
    '',
    '[model_providers.oneapi_desktop]',
    'name = "oneapi_desktop"',
    `base_url = "${baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`}"`,
    `api_key = "${apiKey}"`,
    'wire_api = "responses"',
    '',
    ...preservedBlocks.flatMap((section) => [section, '']),
    '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function resolveDesktopCliKeyRecord(apiKey: string) {
  return apiKey.startsWith('sk-') ? apiKey : `sk-${apiKey}`
}

async function readCurrentClaudeConfig() {
  const targetPath = cliConfig.claude.configPath
  const raw = await fs.readFile(targetPath, 'utf8')
  const parsed = JSON.parse(raw) as {
    env?: Record<string, string>
    model?: string
  }

  return {
    client: 'claude' as const,
    apiKey: parsed.env?.ANTHROPIC_AUTH_TOKEN?.trim() || '',
    model: parsed.model?.trim() || DEFAULT_CLAUDE_MODEL,
    baseUrl: parsed.env?.ANTHROPIC_BASE_URL?.trim() || SERVER_BASE_URL,
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
  const normalized = text.trim()
  return (
    !normalized ||
    normalized.startsWith('Launching skill:') ||
    normalized.startsWith('Base directory for this skill:') ||
    normalized.startsWith('Todos have been modified successfully.') ||
    normalized.startsWith('<turn_aborted>') ||
    normalized === 'No files found' ||
    normalized.startsWith('File created successfully at:') ||
    normalized.startsWith('Updated task #') ||
    normalized.startsWith('Created task #') ||
    normalized.startsWith('[{') ||
    normalized.includes('"tool_use_id"') ||
    normalized.includes('"tool_result"')
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

function parseCodexSession(lines: string[]): { messages: CliSessionMessage[]; fileChanges: CliFileChange[] } {
  const messages: CliSessionMessage[] = []
  const fileChanges: CliFileChange[] = []

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
        changes?: Record<string, { type?: string; unified_diff?: string }>
      }

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
        if (role === 'assistant' && parsed.payload.phase !== 'final_answer') {
          continue
        }
        if (role === 'user' && typeof parsed.payload.phase === 'string' && parsed.payload.phase !== 'input') {
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

  return {
    messages: uniqueMessages(messages),
    fileChanges: mergeFileChanges([], fileChanges),
  }
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
      fileChanges: message.role === 'assistant' ? parsedSession.fileChanges : undefined,
    })),
    fileChanges: parsedSession.fileChanges,
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

function parseClaudeSession(lines: string[]): { messages: CliSessionMessage[]; fileChanges: CliFileChange[] } {
  const messages: CliSessionMessage[] = []
  const fileChanges: CliFileChange[] = []

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
        toolUseResult?: {
          filePath?: string
          file?: {
            filePath?: string
            content?: string
          }
          structuredPatch?: string
        }
      }

      if (parsed.type !== 'user' && parsed.type !== 'assistant') {
        continue
      }

      const role = parsed.message?.role
      if (role !== 'user' && role !== 'assistant') {
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

  return {
    messages: uniqueMessages(messages),
    fileChanges: mergeFileChanges([], fileChanges),
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

  const parsedSession = parseClaudeSession(lines)
  return {
    id: sessionId,
    client: 'claude',
    preview: parsedSession.messages.at(-1)?.content ?? '',
    updatedAt: parsedSession.messages.at(-1)?.createdAt ?? 0,
    projectName: projectPath ? path.basename(projectPath) : path.basename(path.dirname(filePath)) || '未命名项目',
    projectPath,
    messages: parsedSession.messages.map((message) => ({
      ...message,
      fileChanges: message.role === 'assistant' ? parsedSession.fileChanges : undefined,
    })),
    fileChanges: parsedSession.fileChanges,
  }
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForCliSession(client: CliClient, sessionId?: string) {
  if (!sessionId) {
    return null
  }

  for (let index = 0; index < 6; index += 1) {
    const details =
      client === 'codex'
        ? await getCodexSession(sessionId)
        : await getClaudeSession(sessionId)

    if (details?.messages.length) {
      return details
    }

    await wait(250)
  }

  return null
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

function createCliProgressEmitter(
  webContents: WebContents,
  client: CliClient,
  requestId: string
) {
  let lastPartial = ''

  return {
    send(
      kind: CliProgressPayload['kind'],
      message: string,
      sessionId?: string,
      done = false,
    ) {
      const trimmed = message.trim()
      if (!trimmed) {
        return
      }

      webContents.send('desktop:cli-progress', {
        client,
        requestId,
        sessionId,
        kind,
        message: trimmed,
        createdAt: Date.now(),
        done,
      } satisfies CliProgressPayload)
    },
    status(message: string, sessionId?: string, done = false) {
      this.send('status', message, sessionId, done)
    },
    error(message: string, sessionId?: string, done = false) {
      this.send('error', message, sessionId, done)
    },
    partial(message: string, sessionId?: string, done = false) {
      if (!message || message === lastPartial) {
        return
      }
      lastPartial = message
      this.send('partial', message, sessionId, done)
    },
  }
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

function parseJsonLine(line: string) {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractClaudeTextFromMessage(content: unknown) {
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((item) => {
      if (typeof item !== 'object' || !item) {
        return ''
      }
      if ('type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string') {
        return item.text
      }
      return ''
    })
    .join('')
    .trim()
}

function extractClaudeToolName(content: unknown) {
  if (!Array.isArray(content)) {
    return ''
  }

  const tool = content.find(
    (item) =>
      typeof item === 'object' &&
      item &&
      'type' in item &&
      item.type === 'tool_use' &&
      'name' in item &&
      typeof item.name === 'string'
  ) as { name?: string } | undefined

  return tool?.name?.trim() ?? ''
}

async function runCodexPrompt(
  webContents: WebContents,
  input: CliRunRequest
): Promise<CliRunResponse> {
  const args = input.sessionId
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', input.sessionId, input.prompt]
    : ['exec', '--json', '-C', input.projectPath, '--skip-git-repo-check', input.prompt]

  if (input.model?.trim()) {
    args.splice(args.length - 1, 0, '--model', input.model.trim())
  }

  if (input.fullAccess) {
    args.splice(
      args.length - 1,
      0,
      '--sandbox',
      'danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox'
    )
  }

  args.splice(
    args.length - 1,
    0,
    '--config',
    `model_reasoning_effort="${parseCodexReasoningEffort(input.reasoningEffort)}"`
  )

  const progress = createCliProgressEmitter(webContents, 'codex', input.requestId)
  let sessionId = input.sessionId

  progress.status('Codex 已开始处理当前任务。', sessionId)

  const result = await spawnCommandWithHandlers('codex', args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    onSpawn: (child) => {
      activeCliProcesses.set(input.requestId, child)
    },
    onStdoutLine: (line) => {
      const parsed = parseJsonLine(line)
      if (!parsed) {
        return
      }

      if (parsed.type === 'thread.started' && typeof parsed.thread_id === 'string') {
        sessionId = parsed.thread_id
        progress.status('已连接到 Codex 会话。', sessionId)
        return
      }

      if (parsed.type === 'turn.started') {
        progress.status('Codex 正在分析项目并准备执行。', sessionId)
        return
      }

      if (parsed.type === 'error' && typeof parsed.message === 'string') {
        progress.error(parsed.message, sessionId)
      }
    },
    onStderrLine: (line) => {
      if (line.toLowerCase().includes('warn')) {
        progress.status(line, sessionId)
        return
      }

      progress.error(line, sessionId)
    },
  })
  activeCliProcesses.delete(input.requestId)
  const aborted = stoppedCliRequests.delete(input.requestId)

  const events = parseJsonObjectsFromText(result.stdout)
  const threadEvent = events.find((item) => item.type === 'thread.started')
  const usageEvent = [...events]
    .reverse()
    .find((item) => item.type === 'turn.completed')
  const fileChanges = mergeFileChanges(
    [],
    extractCodexFileChanges(result.stdout.split(/\r?\n/))
  )
  if (!sessionId && typeof threadEvent?.thread_id === 'string') {
    sessionId = threadEvent.thread_id
  }

  const session = await waitForCliSession('codex', sessionId)
  const output = session?.messages.filter((item) => item.role === 'assistant').at(-1)?.content ?? ''
  const success = !aborted && result.exitCode === 0 && output.length > 0

  if (success) {
    progress.status('Codex 已完成本次回复。', sessionId, true)
  } else if (aborted) {
    progress.status('Codex 已停止本次回复。', sessionId, true)
  } else if (result.stderr.trim()) {
    progress.error(result.stderr.trim(), sessionId, true)
  }

  return {
    success,
    requestId: input.requestId,
    output,
    error: aborted ? '用户已停止当前回复' : result.stderr.trim(),
    raw: result.stdout,
    sessionId,
    metadata: {
      aborted,
      exitCode: result.exitCode,
      threadId: sessionId ?? '',
      usage: usageEvent?.usage ?? null,
      fileChanges,
    },
  }
}

async function runClaudePrompt(
  webContents: WebContents,
  input: CliRunRequest
): Promise<CliRunResponse> {
  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
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

  const progress = createCliProgressEmitter(webContents, 'claude', input.requestId)
  let sessionId = input.sessionId
  let partialText = ''
  let finalResult: Record<string, unknown> | null = null

  progress.status('Claude 已开始处理当前任务。', sessionId)

  const result = await spawnCommandWithHandlers('claude', args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    onSpawn: (child) => {
      activeCliProcesses.set(input.requestId, child)
    },
    onStdoutLine: (line) => {
      const parsed = parseJsonLine(line)
      if (!parsed) {
        return
      }

      if (
        typeof parsed.session_id === 'string' &&
        parsed.session_id &&
        sessionId !== parsed.session_id
      ) {
        sessionId = parsed.session_id
        progress.status('已连接到 Claude 会话。', sessionId)
      }

      if (parsed.type === 'system') {
        if (parsed.subtype === 'init') {
          progress.status('Claude 会话初始化完成。', sessionId)
          return
        }

        if (parsed.subtype === 'hook_started' && typeof parsed.hook_name === 'string') {
          progress.status(`正在执行 ${parsed.hook_name}`, sessionId)
        }
        return
      }

      if (parsed.type === 'assistant') {
        const parsedMessage =
          typeof parsed.message === 'object' && parsed.message
            ? (parsed.message as { content?: unknown })
            : undefined
        const toolName = extractClaudeToolName(
          parsedMessage?.content
        )
        if (toolName) {
          progress.status(`Claude 正在调用 ${toolName}`, sessionId)
        }
        return
      }

      if (parsed.type === 'stream_event' && typeof parsed.event === 'object' && parsed.event) {
        const event = parsed.event as Record<string, unknown>
        if (
          event.type === 'content_block_start' &&
          typeof event.content_block === 'object' &&
          event.content_block
        ) {
          const block = event.content_block as Record<string, unknown>
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            progress.status(`Claude 正在调用 ${block.name}`, sessionId)
          }
        }

        if (
          event.type === 'content_block_delta' &&
          typeof event.delta === 'object' &&
          event.delta
        ) {
          const delta = event.delta as Record<string, unknown>
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            partialText += delta.text
            progress.partial(partialText, sessionId)
          }
        }
        return
      }

      if (parsed.type === 'result') {
        finalResult = parsed
      }
    },
    onStderrLine: (line) => {
      progress.error(line, sessionId)
    },
  })
  activeCliProcesses.delete(input.requestId)
  const aborted = stoppedCliRequests.delete(input.requestId)

  if (!finalResult) {
    finalResult =
      [...parseJsonObjectsFromText(result.stdout)]
        .reverse()
        .find((item) => item.type === 'result') ?? null
  }

  const fileChanges = mergeFileChanges([], extractClaudeFileChanges(result.stdout.split(/\r?\n/)))

  if (!sessionId && typeof finalResult?.session_id === 'string') {
    sessionId = finalResult.session_id
  }

  const session = await waitForCliSession('claude', sessionId)
  const transcriptOutput =
    session?.messages.filter((item) => item.role === 'assistant').at(-1)?.content ?? ''
  const parsedOutput =
    typeof finalResult?.result === 'string'
      ? finalResult.result
      : extractClaudeTextFromMessage(
          typeof finalResult?.message === 'object' && finalResult.message
            ? (finalResult.message as { content?: unknown }).content
            : undefined
        )
  const output = transcriptOutput || parsedOutput || partialText.trim()
  const success = !aborted && result.exitCode === 0 && output.length > 0

  if (success) {
    progress.partial(output, sessionId, true)
    progress.status('Claude 已完成本次回复。', sessionId, true)
  } else if (aborted) {
    progress.status('Claude 已停止本次回复。', sessionId, true)
  } else if (result.stderr.trim()) {
    progress.error(result.stderr.trim(), sessionId, true)
  }

  return {
    success,
    requestId: input.requestId,
    output,
    error: aborted ? '用户已停止当前回复' : result.stderr.trim(),
    raw: result.stdout,
    sessionId,
    metadata: {
      ...(finalResult ?? { exitCode: result.exitCode }),
      aborted,
      fileChanges,
    },
  }
}

async function writeCodexConfig(request: CliDeployRequest) {
  const targetPath = cliConfig.codex.configPath
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const raw = (await pathExists(targetPath)) ? await fs.readFile(targetPath, 'utf8') : ''
  if (raw) {
    await backupIfNeeded(targetPath)
  }
  await fs.writeFile(
    targetPath,
    mergeCodexConfig(
      raw,
      resolveDesktopCliKeyRecord(request.apiKey),
      request.model?.trim() || 'gpt-5.5',
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

  const currentEnv = (typeof current.env === 'object' && current.env
    ? current.env
    : {}) as Record<string, string>

  const env = {
    ...currentEnv,
    ANTHROPIC_AUTH_TOKEN: resolveDesktopCliKeyRecord(request.apiKey),
    ANTHROPIC_BASE_URL: request.baseUrl?.trim() || SERVER_BASE_URL,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    API_TIMEOUT_MS: '600000',
    ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN:
      typeof currentEnv.ANTHROPIC_AUTH_TOKEN === 'string' ? currentEnv.ANTHROPIC_AUTH_TOKEN : undefined,
    ONEAPI_ORIGINAL_ANTHROPIC_BASE_URL:
      typeof currentEnv.ANTHROPIC_BASE_URL === 'string' ? currentEnv.ANTHROPIC_BASE_URL : undefined,
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
      ? await runCodexPrompt(webContents, {
          client,
          requestId: `${jobId}-test`,
          projectPath: testProjectPath,
          prompt: '只回复：连接测试成功',
        })
      : await runClaudePrompt(webContents, {
          client,
          requestId: `${jobId}-test`,
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
ipcMain.handle('desktop:stop-api-request', async (_event, requestId: string) => {
  activeApiRequests.get(requestId)?.abort()
  activeApiRequests.delete(requestId)
})
ipcMain.handle('desktop:open-external', async (_event, url: string) => {
  await shell.openExternal(url)
})
ipcMain.handle('desktop:open-path', async (_event, targetPath: string) => {
  const resolved = await resolveOpenTarget(targetPath)
  if (!resolved) {
    throw new Error('目标路径当前不可打开。')
  }

  const error = await shell.openPath(resolved)
  if (error) {
    throw new Error(error)
  }
})
ipcMain.handle('desktop:pick-project', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })

  return result.canceled ? '' : result.filePaths[0] ?? ''
})
ipcMain.handle('desktop:file-preview', async (_event, targetPath: string) => {
  return readFilePreview(targetPath)
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
ipcMain.handle('desktop:run-cli', async (event, request: CliRunRequest) => {
  return request.client === 'codex'
    ? runCodexPrompt(event.sender, request)
    : runClaudePrompt(event.sender, request)
})
ipcMain.handle('desktop:stop-cli', async (_event, requestId: string) => {
  stoppedCliRequests.add(requestId)
  await stopChildProcess(activeCliProcesses.get(requestId))
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
ipcMain.handle('desktop:cli-deploy-preset', async (_event, client: CliClient) => {
  return client === 'codex'
    ? readCurrentCodexConfig()
    : readCurrentClaudeConfig()
})
ipcMain.handle('desktop:save-attachment', async (_event, input: DesktopAttachmentSaveRequest) => {
  return saveDesktopAttachment(input)
})
