import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
  Tray,
  type WebContents,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import type { ChatCompletionResponse } from '../src/shared/contracts'
import type {
  CliExtensionEntry,
  CliExtensionInstallRequest,
  CliExtensionInstallResult,
  CliPlanState,
  DesktopChatStreamPayload,
  DesktopChatStreamRequest,
  DesktopDeleteCliMessageRequest,
  DesktopDeleteCliSessionsRequest,
  DesktopExportTextFileRequest,
} from '../src/shared/desktop'
import { parseDesktopChatStreamDataLine } from '../src/lib/chat-reasoning.ts'
import {
  buildClaudePlanStateFromRecords,
  buildCodexPlanStateFromRecords,
  parseClaudePlanMutationFromRecord,
  parseCodexPlanStateFromRecord,
} from '../src/lib/cli-plan.ts'
import { buildCliExtensionDedupeKey, parseMarkdownFrontmatterMeta } from '../src/lib/cli-extensions.ts'
import {
  buildBundledCodexCuratedSkillEntries,
  buildBundledMarketplaceEntries,
  type BundledCodexCuratedSkillCatalog,
  type BundledPluginMarketplaceCatalog,
} from '../src/lib/cli-marketplace-catalog.ts'
import { resolveCliProbeResult, shouldUseWindowsCommandShimForPath } from '../src/lib/desktop-service.ts'

const DEFAULT_SERVER_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_BASE_URL = 'https://ai.oneapi.center/v1'
const DEFAULT_CLAUDE_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_MODEL = 'gpt-5.5'
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-7'
const WINDOW_CHROME_HEIGHT = 25
const DESKTOP_PARTITION = 'persist:oneapi-desktop'
const isDev = !!process.env.VITE_DEV_SERVER_URL
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ICON_PATH = isDev
  ? path.join(path.dirname(__dirname), 'public', 'Icon.png')
  : path.join(path.dirname(__dirname), 'dist', 'Icon.png')
const BUNDLED_CLI_CATALOG_DEV_ROOT = path.resolve(__dirname, '..', '..', 'shared-cli-catalog')
let mainWindow: BrowserWindow | null = null
let appTray: Tray | null = null
let isQuitting = false
let serverBaseUrl = DEFAULT_SERVER_BASE_URL
let activeTitleDrag:
  | {
      windowId: number
      offsetX: number
      offsetY: number
      timer: NodeJS.Timeout
    }
  | null = null
const activeApiRequests = new Map<string, AbortController>()
const activeCliProcesses = new Map<string, ChildProcess>()
const stoppedCliRequests = new Set<string>()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
type ThemeMode = 'light' | 'dark'
const bundledCliCatalogCache = new Map<string, unknown>()

function applyThemeMode(mode: ThemeMode) {
  nativeTheme.themeSource = mode
  const backgroundColor = '#00000000'
  mainWindow?.setBackgroundColor(backgroundColor)
}

function getServerConfigPath() {
  return path.join(app.getPath('userData'), 'server-base-url.json')
}

function getAssistantHistoryRoot(scope: AssistantHistoryScope) {
  return path.join(app.getPath('userData'), 'assistant-history', scope)
}

function getAssistantHistorySessionDirectory(scope: AssistantHistoryScope, sessionId: string) {
  return path.join(getAssistantHistoryRoot(scope), sessionId)
}

function getBundledCliCatalogRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'cli-catalog')
    : BUNDLED_CLI_CATALOG_DEV_ROOT
}

async function readBundledCliCatalogFile<T>(fileName: string) {
  if (bundledCliCatalogCache.has(fileName)) {
    return bundledCliCatalogCache.get(fileName) as T
  }

  const filePath = path.join(getBundledCliCatalogRoot(), fileName)
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    bundledCliCatalogCache.set(fileName, null)
    return null
  }

  try {
    const parsed = JSON.parse(raw) as T
    bundledCliCatalogCache.set(fileName, parsed)
    return parsed
  } catch {
    bundledCliCatalogCache.set(fileName, null)
    return null
  }
}

function normalizeServerBaseUrl(value?: string) {
  const normalized = (value || '').trim()
  if (!normalized) {
    return DEFAULT_SERVER_BASE_URL
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('服务地址必须以 http:// 或 https:// 开头。')
  }
  return normalized.replace(/\/+$/, '')
}

async function loadServerBaseUrl() {
  try {
    const raw = await fs.readFile(getServerConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as { serverBaseUrl?: string }
    serverBaseUrl = normalizeServerBaseUrl(parsed.serverBaseUrl)
  } catch {
    serverBaseUrl = DEFAULT_SERVER_BASE_URL
  }
}

async function persistServerBaseUrl(nextValue: string) {
  const normalized = normalizeServerBaseUrl(nextValue)
  await fs.mkdir(path.dirname(getServerConfigPath()), { recursive: true })
  await fs.writeFile(
    getServerConfigPath(),
    JSON.stringify({ serverBaseUrl: normalized }, null, 2),
    'utf8'
  )
  serverBaseUrl = normalized
  return normalized
}

function resolveWorkspaceTitle(projectName?: string) {
  const normalized = projectName?.trim()
  return `OneAPI Workspace - ${normalized || 'empty'}`
}

function getDesktopSession() {
  return session.fromPartition(DESKTOP_PARTITION)
}

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type CliClient = 'codex' | 'claude'
type AssistantHistoryScope = 'chat' | 'draw'
type DeployStatus = 'pending' | 'running' | 'success' | 'error'
type CliLogKind = 'intent' | 'command' | 'stdout' | 'stderr' | 'result' | 'tool' | 'status' | 'error'

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
  sourceFilePath?: string
  sourceLineNumber?: number
  sourceTimestamp?: string | number
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
  plan?: CliPlanState | null
}

interface CliStatus {
  client: CliClient
  installed: boolean
  version: string
  executablePath: string
  configPath: string
  dataPath: string
  hasConfig: boolean
  baseUrl?: string
  hasApiKey?: boolean
  managedByDesktop?: boolean
  hasDataDirectory: boolean
  brokenInstallation?: boolean
}

interface ClaudeInstalledPluginsDocument {
  version?: number
  plugins?: Record<string, Array<{
    scope?: string
    installPath?: string
    version?: string
    installedAt?: string
    lastUpdated?: string
    gitCommitSha?: string
  }>>
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

interface CliRuntimeDiagnostics {
  networkIssue?: boolean
  sessionIssue?: boolean
  authIssue?: boolean
  configIssue?: boolean
  sessionFileFound?: boolean
  sessionReadAttempts?: number
  probableCause?: string
}

interface CliProgressPayload {
  client: CliClient
  requestId: string
  sessionId?: string
  kind: 'status' | 'partial' | 'error'
  logKind?: CliLogKind
  sourceKind?: string
  message: string
  createdAt: number
  done?: boolean
  files?: CliFileChange[]
  detail?: string
  command?: string
  exitCode?: number
  plan?: CliPlanState | null
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
  step: 'detect' | 'node' | 'install' | 'config' | 'diagnose' | 'test' | 'complete'
  status: DeployStatus
  message: string
  createdAt: number
  kind?: 'info' | 'command' | 'stdout' | 'stderr' | 'result'
  detail?: string
  command?: string
  exitCode?: number
}

interface DesktopAttachmentSaveRequest {
  name: string
  mimeType?: string
  dataBase64: string
}

interface DesktopImageEditRequest {
  userId?: string
  model: string
  prompt: string
  imageName: string
  mimeType?: string
  dataBase64: string
  size?: string
  quality?: string
}

interface AssistantHistorySnapshotEntry {
  id: string
  title: string
  updatedAt: number
  data: string
}

interface DesktopSaveImageRequest {
  suggestedName: string
  sourceUrl?: string
  dataBase64?: string
}

interface DesktopCopyImageRequest {
  sourceUrl?: string
  dataBase64?: string
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

function isCliClient(value: string): value is CliClient {
  return value === 'codex' || value === 'claude'
}

interface NodeRuntimeInfo {
  source: 'system' | 'managed'
  nodePath: string
  npmPath: string
  npmCliPath: string
  version: string
  prefixPath: string
}

const NODEJS_MIRROR_BASE_URL = 'https://npmmirror.com/mirrors/node'

function buildTrayIcon() {
  const icon = nativeImage.createFromPath(APP_ICON_PATH)
  if (icon.isEmpty()) {
    return icon
  }
  return icon.resize({ width: 18, height: 18 })
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.setSkipTaskbar(false)
  mainWindow.moveTop()
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(false)
}

function ensureTray() {
  if (appTray) {
    return appTray
  }

  appTray = new Tray(buildTrayIcon())
  appTray.setToolTip('OneAPI Center')
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => restoreMainWindow(),
      },
      {
        type: 'separator',
      },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
  )
  appTray.on('click', () => restoreMainWindow())
  appTray.on('double-click', () => restoreMainWindow())
  return appTray
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(APP_ICON_PATH)
  const win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1240,
    minHeight: 780,
    title: resolveWorkspaceTitle(),
    frame: false,
    backgroundColor: '#00000000',
    transparent: true,
    icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: DESKTOP_PARTITION,
    },
  })

  win.setMenuBarVisibility(false)
  win.removeMenu()
  mainWindow = win
  ensureTray()
  applyThemeMode('light')
  win.on('blur', () => {
    stopActiveTitleDrag(win.id)
  })
  win.on('closed', () => {
    stopActiveTitleDrag(win.id)
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
  attachContextMenu(win)
  win.on('close', (event) => {
    if (isQuitting) {
      return
    }
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void app.whenReady().then(() => {
      restoreMainWindow()
    })
  })
}

function getAppMeta() {
  return {
    platform: process.platform,
    productName: app.name,
    serverBaseUrl,
    iconPath: APP_ICON_PATH,
  }
}

function attachContextMenu(win: BrowserWindow) {
  win.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = []
    const hasSelection = params.selectionText.trim().length > 0
    const hasLink = params.linkURL.trim().length > 0
    const hasImage = params.mediaType === 'image' && params.srcURL.trim().length > 0

    if (params.isEditable) {
      template.push(
        { label: '撤销', role: 'undo', enabled: params.editFlags.canUndo },
        { label: '重做', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: '剪切', role: 'cut', enabled: params.editFlags.canCut },
        { label: '复制', role: 'copy', enabled: params.editFlags.canCopy },
        { label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: '全选', role: 'selectAll' }
      )
    } else {
      if (hasSelection) {
        template.push({ label: '复制', role: 'copy' })
        template.push({
          label: '翻译选中文本',
          click: () => {
            win.webContents.send('desktop:translate-selection-requested', {
              text: params.selectionText.trim(),
            })
          },
        })
      }
      template.push({
        label: '全选',
        click: () => {
          void selectBubbleContentsAtPoint(win, params.x, params.y)
        },
      })
    }

    if (hasLink) {
      if (template.length) {
        template.push({ type: 'separator' })
      }
      template.push(
        {
          label: '打开链接',
          click: () => {
            void shell.openExternal(params.linkURL)
          },
        },
        {
          label: '复制链接',
          click: () => clipboard.writeText(params.linkURL),
        }
      )
    }

    if (hasImage) {
      if (template.length) {
        template.push({ type: 'separator' })
      }
      template.push(
        {
          label: '打开图片',
          click: () => {
            void shell.openExternal(params.srcURL)
          },
        },
        {
          label: '复制图片地址',
          click: () => clipboard.writeText(params.srcURL),
        }
      )
    }

    while (template.length && template.at(-1)?.type === 'separator') {
      template.pop()
    }

    if (!template.length) {
      return
    }

    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

async function selectBubbleContentsAtPoint(win: BrowserWindow, x: number, y: number) {
  try {
    const selectedBubble = await win.webContents.executeJavaScript(
      `
      (() => {
        const target = document.elementFromPoint(${x}, ${y});
        const bubble = target instanceof HTMLElement
          ? target.closest('.message-bubble, .cli-log-bubble')
          : null;
        if (!bubble) {
          return false;
        }
        const selection = window.getSelection();
        if (!selection) {
          return false;
        }
        const range = document.createRange();
        range.selectNodeContents(bubble);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      })()
      `,
      true
    )

    if (!selectedBubble) {
      win.webContents.selectAll()
    }
  } catch {
    win.webContents.selectAll()
  }
}

function buildUrl(requestPath: string, query?: DesktopApiRequest['query']) {
  const target = requestPath.startsWith('http')
    ? requestPath
    : `${serverBaseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`
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

function normalizeCodexBaseUrl(value?: string) {
  const normalized = (value || '').trim()
  if (!normalized) {
    return DEFAULT_CODEX_BASE_URL
  }
  if (/^http:\/\/ai\.oneapi\.center\/?v1\/?$/i.test(normalized)) {
    return DEFAULT_CODEX_BASE_URL
  }
  if (/^https:\/\/ai\.oneapi\.center\/?$/i.test(normalized)) {
    return DEFAULT_CODEX_BASE_URL
  }
  return normalized.endsWith('/v1') ? normalized : `${normalized.replace(/\/+$/, '')}/v1`
}

function normalizeClaudeBaseUrl(value?: string) {
  const normalized = (value || '').trim()
  if (!normalized) {
    return DEFAULT_CLAUDE_BASE_URL
  }
  if (/^http:\/\/ai\.oneapi\.center\/?$/i.test(normalized)) {
    return DEFAULT_CLAUDE_BASE_URL
  }
  return normalized.replace(/\/+$/, '')
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  const text = await response.text()
  return text.length > 0 ? text : null
}

function getResponseErrorMessage(data: unknown, status: number, fallback?: string) {
  if (typeof data === 'object' && data) {
    if ('message' in data && typeof data.message === 'string') {
      return data.message
    }

    if (
      'error' in data &&
      typeof data.error === 'object' &&
      data.error &&
      'message' in data.error &&
      typeof data.error.message === 'string'
    ) {
      return data.error.message
    }
  }

  if (typeof data === 'string' && data.trim()) {
    return data.trim()
  }

  return fallback || `请求失败（${status}）`
}

function emitChatStream(sender: WebContents, payload: DesktopChatStreamPayload) {
  sender.send('desktop:chat-stream', payload)
}

async function requestChatStream(sender: WebContents, input: DesktopChatStreamRequest) {
  const controller = new AbortController()
  activeApiRequests.set(input.requestId, controller)

  try {
    const response = await getDesktopSession().fetch(buildUrl('/pg/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.userId ? { 'New-Api-User': input.userId } : {}),
      },
      body: JSON.stringify({
        model: input.model,
        group: input.group,
        reasoning_effort: input.reasoningEffort,
        messages: input.messages,
        temperature: input.temperature,
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const data = await parseResponse(response)
      emitChatStream(sender, {
        requestId: input.requestId,
        type: 'error',
        status: response.status,
        message: getResponseErrorMessage(data, response.status),
      })
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      emitChatStream(sender, {
        requestId: input.requestId,
        type: 'error',
        message: '当前环境不支持流式响应。',
      })
      return
    }

    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let usage: ChatCompletionResponse['usage'] | undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''

      for (const rawEvent of events) {
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())

        for (const line of dataLines) {
          const parsedLine = parseDesktopChatStreamDataLine(line)
          if (!parsedLine) {
            continue
          }

          if (parsedLine.deltaText) {
            emitChatStream(sender, {
              requestId: input.requestId,
              type: 'delta',
              text: parsedLine.deltaText,
            })
          }
          if (parsedLine.reasoningText) {
            emitChatStream(sender, {
              requestId: input.requestId,
              type: 'reasoning',
              text: parsedLine.reasoningText,
            })
          }
          if (parsedLine.usage) {
            usage = parsedLine.usage
          }
          if (parsedLine.done) {
            emitChatStream(sender, {
              requestId: input.requestId,
              type: 'done',
              usage,
            })
            return
          }
        }
      }
    }

    emitChatStream(sender, {
      requestId: input.requestId,
      type: 'done',
      usage,
    })
  } catch (error) {
    emitChatStream(sender, {
      requestId: input.requestId,
      type: 'error',
      status: controller.signal.aborted ? 499 : 500,
      message: controller.signal.aborted
        ? '请求已取消'
        : error instanceof Error
          ? error.message
          : '聊天请求失败',
    })
  } finally {
    activeApiRequests.delete(input.requestId)
  }
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

function getToolchainRoot() {
  return path.join(app.getPath('userData'), 'toolchains')
}

function getManagedNodeRoot() {
  return path.join(getToolchainRoot(), 'node-runtime')
}

function getManagedNpmPrefix() {
  return path.join(getToolchainRoot(), 'npm-global')
}

function getManagedPrefixBin(prefixPath = getManagedNpmPrefix()) {
  return process.platform === 'win32' ? prefixPath : path.join(prefixPath, 'bin')
}

function getManagedCliExecutableCandidates(command: string) {
  const binRoot = getManagedPrefixBin()
  if (process.platform === 'win32') {
    return [
      path.join(binRoot, `${command}.cmd`),
      path.join(binRoot, `${command}.exe`),
      path.join(binRoot, command),
    ]
  }

  return [path.join(binRoot, command)]
}

function getManagedNodeExecutableCandidates() {
  const root = getManagedNodeRoot()
  if (process.platform === 'win32') {
    return [path.join(root, 'node.exe')]
  }

  return [path.join(root, 'bin', 'node')]
}

function getManagedNpmExecutableCandidates() {
  const root = getManagedNodeRoot()
  if (process.platform === 'win32') {
    return [path.join(root, 'npm.cmd'), path.join(root, 'npm')]
  }

  return [path.join(root, 'bin', 'npm')]
}

function getNpmCliScriptCandidates(nodePath: string) {
  const nodeDir = path.dirname(nodePath)
  if (process.platform === 'win32') {
    return [path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  }

  return [
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
}

async function firstExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }
  return ''
}

async function resolveNpmCliScriptPath(nodePath: string) {
  if (!nodePath) {
    return ''
  }
  return firstExistingPath(getNpmCliScriptCandidates(nodePath))
}

function buildNpmInvocation(runtime: NodeRuntimeInfo, args: string[]) {
  if (runtime.npmCliPath) {
    return {
      command: runtime.nodePath,
      args: [runtime.npmCliPath, ...args],
    }
  }

  return {
    command: runtime.npmPath,
    args,
  }
}

async function clearDirectory(targetPath: string) {
  await fs.rm(targetPath, { recursive: true, force: true })
  await fs.mkdir(targetPath, { recursive: true })
}

async function flattenSingleNestedDirectory(
  targetPath: string,
  logger?: ReturnType<typeof createDeployLogger>
) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  const childFiles = entries.filter((entry) => entry.isFile())
  const childDirs = entries.filter((entry) => entry.isDirectory())

  if (childFiles.length > 0 || childDirs.length !== 1) {
    return false
  }

  const nestedRoot = path.join(targetPath, childDirs[0].name)
  logger?.info('node', 'running', '检测到 Node.js 压缩包包含顶层目录，正在整理安装结构', nestedRoot)

  const nestedEntries = await fs.readdir(nestedRoot, { withFileTypes: true })
  for (const entry of nestedEntries) {
    await fs.rename(path.join(nestedRoot, entry.name), path.join(targetPath, entry.name))
  }

  await fs.rm(nestedRoot, { recursive: true, force: true })
  logger?.info('node', 'success', 'Node.js 安装结构整理完成', targetPath)
  return true
}

async function describeDirectoryEntries(targetPath: string) {
  if (!(await pathExists(targetPath))) {
    return '目录不存在'
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  if (!entries.length) {
    return '目录为空'
  }

  return entries
    .map((entry) => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`)
    .join('\n')
}

function shouldUseWindowsCommandShim(command: string) {
  return shouldUseWindowsCommandShimForPath(command, process.platform)
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
    stdinData?: string
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
    let stdout = ''
    let stderr = ''
    let child: ChildProcess
    try {
      child = spawn(spawnCommand, spawnArgs, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        windowsHide: true,
      })
    } catch (error) {
      resolve({
        stdout,
        stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`.trim(),
        exitCode: -1,
      })
      return
    }
    options.onSpawn?.(child)

    let settled = false
    const stdoutConsumer = createLineConsumer(options.onStdoutLine)
    const stderrConsumer = createLineConsumer(options.onStderrLine)

    const timer = setTimeout(() => {
      stderr += `\n命令执行超时（${timeoutMs}ms）`
      child.kill()
    }, timeoutMs)

    try {
      if (typeof options.stdinData === 'string') {
        child.stdin?.end(options.stdinData)
      } else {
        child.stdin?.end()
      }
    } catch {
      /* empty */
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
      stdoutConsumer.push(chunk)
    })

    child.stderr?.on('data', (chunk) => {
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

async function locateSystemExecutable(command: string) {
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

async function locateExecutable(command: string) {
  if (command === 'node') {
    const managedNode = await firstExistingPath(getManagedNodeExecutableCandidates())
    if (managedNode) {
      return managedNode
    }
  }

  if (command === 'npm' || command === 'npm.cmd') {
    const managedNpm = await firstExistingPath(getManagedNpmExecutableCandidates())
    if (managedNpm) {
      return managedNpm
    }
  }

  if (isCliClient(command)) {
    const managedCli = await firstExistingPath(getManagedCliExecutableCandidates(command))
    if (managedCli) {
      return managedCli
    }
  }

  return locateSystemExecutable(command)
}

function resolveCliSpawnCommand(command: string, executablePath: string) {
  const normalized = executablePath.trim()
  if (!normalized) {
    return command
  }
  return normalized
}

async function inspectCli(client: CliClient): Promise<CliStatus> {
  const executablePath = await locateExecutable(client)
  const managedRuntime = await readManagedNodeRuntime()
  const versionResult = executablePath
    ? await runCommand(executablePath, ['--version'], {
        timeoutMs: 15000,
        env: managedRuntime ? buildRuntimeEnv(managedRuntime) : undefined,
      })
    : null

  const version =
    versionResult?.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) ?? ''
  const probeResult = resolveCliProbeResult({
    executablePath,
    version,
    versionExitCode: versionResult?.exitCode,
  })

  const configPath = cliConfig[client].configPath
  const dataPath = cliConfig[client].dataPath
  const hasConfig = await pathExists(configPath)
  const hasDataDirectory = await pathExists(dataPath)
  let baseUrl = ''
  let hasApiKey = false
  let managedByDesktop = false

  if (hasConfig) {
    try {
      const currentConfig = client === 'codex'
        ? await readCurrentCodexConfig()
        : await readCurrentClaudeConfig()
      baseUrl = currentConfig.baseUrl
      hasApiKey = !!currentConfig.apiKey.trim()
      managedByDesktop = !!currentConfig.managedByDesktop
    } catch {
      /* ignore parse errors and surface raw file presence only */
    }
  }

  return {
    client,
    installed: probeResult.installed,
    version: probeResult.version,
    executablePath,
    configPath,
    dataPath,
    hasConfig,
    baseUrl,
    hasApiKey,
    managedByDesktop,
    hasDataDirectory,
    brokenInstallation: probeResult.brokenInstallation,
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
  const sanitizedName = path
    .basename(input.name || 'clipboard-file', extension)
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      if ('<>:"/\\|?*'.includes(char) || code <= 31) {
        return '_'
      }
      return char
    })
    .join('')
  const safeBaseName =
    sanitizedName ||
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

async function requestImageEdit(input: DesktopImageEditRequest) {
  const headers = new Headers()
  if (input.userId?.trim()) {
    headers.set('New-Api-User', input.userId.trim())
  }

  const formData = new FormData()
  formData.append('model', input.model)
  formData.append('prompt', input.prompt)
  if (input.size?.trim()) {
    formData.append('size', input.size.trim())
  }
  if (input.quality?.trim()) {
    formData.append('quality', input.quality.trim())
  }
  formData.append(
    'image',
    new Blob([Buffer.from(input.dataBase64, 'base64')], {
      type: input.mimeType?.trim() || 'image/png',
    }),
    input.imageName || 'image.png'
  )

  const response = await getDesktopSession().fetch(buildUrl('/v1/images/edits'), {
    method: 'POST',
    headers,
    body: formData,
  })

  const data = await parseResponse(response)
  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : `图片编辑失败（${response.status}）`
    throw new Error(message)
  }

  return data
}

async function syncAssistantHistory(
  scope: AssistantHistoryScope,
  entries: AssistantHistorySnapshotEntry[]
) {
  const root = getAssistantHistoryRoot(scope)
  await fs.mkdir(root, { recursive: true })

  const normalizedEntries = entries.filter((item) => item.id.trim())
  const validIds = new Set(normalizedEntries.map((item) => item.id))
  const existingEntries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])

  await Promise.all(
    existingEntries.map(async (item) => {
      if (!item.isDirectory() || validIds.has(item.name)) {
        return
      }
      await fs.rm(path.join(root, item.name), { recursive: true, force: true })
    })
  )

  await Promise.all(
    normalizedEntries.map(async (item) => {
      const sessionDirectory = getAssistantHistorySessionDirectory(scope, item.id)
      await fs.mkdir(sessionDirectory, { recursive: true })
      await fs.writeFile(
        path.join(sessionDirectory, 'session.json'),
        JSON.stringify(
          {
            id: item.id,
            title: item.title,
            updatedAt: item.updatedAt,
            data: JSON.parse(item.data),
          },
          null,
          2
        ),
        'utf8'
      )
    })
  )
}

async function openAssistantHistoryFolder(scope: AssistantHistoryScope, sessionId: string) {
  const sessionDirectory = getAssistantHistorySessionDirectory(scope, sessionId)
  if (!(await pathExists(sessionDirectory))) {
    throw new Error('当前会话还没有对应的本地记录目录。')
  }

  const error = await shell.openPath(sessionDirectory)
  if (error) {
    throw new Error(error)
  }
}

async function openCliSessionFolder(client: CliClient, sessionId: string) {
  const sessionFilePath =
    client === 'codex'
      ? await getLatestCodexSessionFile(sessionId)
      : await getClaudeSessionFile(sessionId)

  if (sessionFilePath) {
    const error = await shell.openPath(path.dirname(sessionFilePath))
    if (error) {
      throw new Error(error)
    }
    return
  }

  const details = client === 'codex' ? await getCodexSession(sessionId) : await getClaudeSession(sessionId)
  if (details?.projectPath) {
    const error = await shell.openPath(details.projectPath)
    if (error) {
      throw new Error(error)
    }
    return
  }

  throw new Error('当前会话没有可打开的目录。')
}

async function exportTextFile(input: DesktopExportTextFileRequest) {
  const suggestedName = path.basename(input.suggestedName || `oneapi-session-${Date.now()}.md`)
  const saveResult = await dialog.showSaveDialog({
    title: input.title || '导出会话',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (saveResult.canceled || !saveResult.filePath) {
    throw new Error('已取消导出。')
  }

  await fs.mkdir(path.dirname(saveResult.filePath), { recursive: true })
  await fs.writeFile(saveResult.filePath, input.content, 'utf8')
  return {
    path: saveResult.filePath,
  }
}

async function saveImageToUserPath(input: DesktopSaveImageRequest) {
  const defaultName = path.basename(input.suggestedName || `oneapi-image-${Date.now()}.png`)
  const saveResult = await dialog.showSaveDialog({
    title: '保存图片',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [
      { name: 'PNG 图片', extensions: ['png'] },
      { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
      { name: 'WEBP 图片', extensions: ['webp'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })

  if (saveResult.canceled || !saveResult.filePath) {
    return {
      path: '',
    }
  }

  let buffer: Buffer
  if (input.dataBase64?.trim()) {
    buffer = Buffer.from(input.dataBase64.trim(), 'base64')
  } else if (input.sourceUrl?.trim()) {
    const response = await getDesktopSession().fetch(input.sourceUrl.trim())
    if (!response.ok) {
      throw new Error(`下载图片失败（${response.status}）`)
    }
    buffer = Buffer.from(await response.arrayBuffer())
  } else {
    throw new Error('缺少可保存的图片数据。')
  }

  await fs.writeFile(saveResult.filePath, buffer)
  return {
    path: saveResult.filePath,
  }
}

async function copyImageToClipboard(input: DesktopCopyImageRequest) {
  let image = nativeImage.createEmpty()

  if (input.dataBase64?.trim()) {
    image = nativeImage.createFromBuffer(Buffer.from(input.dataBase64.trim(), 'base64'))
  } else if (input.sourceUrl?.trim()) {
    const sourceUrl = input.sourceUrl.trim()
    if (sourceUrl.startsWith('data:')) {
      image = nativeImage.createFromDataURL(sourceUrl)
    } else {
      const response = await getDesktopSession().fetch(sourceUrl)
      if (!response.ok) {
        throw new Error(`复制图片失败（${response.status}）`)
      }
      image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()))
    }
  } else {
    throw new Error('缺少可复制的图片数据。')
  }

  if (image.isEmpty()) {
    throw new Error('图片数据无效，无法复制到剪贴板。')
  }

  clipboard.writeImage(image)
}

async function readCurrentCodexConfig() {
  const targetPath = cliConfig.codex.configPath
  const raw = await fs.readFile(targetPath, 'utf8')
  const parsed = parseTomlDocument(raw)
  const model = readTomlTopLevelString(parsed.preamble, 'model') || DEFAULT_CODEX_MODEL
  const provider = readTomlTopLevelString(parsed.preamble, 'model_provider') || 'oneapi_desktop'
  const credentialsStore = readTomlTopLevelString(parsed.preamble, 'cli_auth_credentials_store')
  const providerSection =
    parsed.sections.find((section) => section.header === `model_providers.${provider}`) ||
    parsed.sections.find((section) => section.header === 'model_providers.oneapi_desktop')
  const apiKey = providerSection ? readCodexProviderToken(providerSection.lines) : ''
  const baseUrl = providerSection ? readTomlSectionString(providerSection.lines, 'base_url') : ''

  return {
    client: 'codex' as const,
    apiKey: apiKey?.trim() || '',
    model: model.trim() || DEFAULT_CODEX_MODEL,
    baseUrl: normalizeCodexBaseUrl(baseUrl),
    managedByDesktop: provider === 'oneapi_desktop' && credentialsStore === 'file',
  }
}

type ClaudeSettingsDocument = {
  env?: Record<string, string>
  model?: string
  permissions?: Record<string, unknown>
  [key: string]: unknown
}

type TomlSectionBlock = {
  header: string
  lines: string[]
}

function parseTomlDocument(raw: string) {
  const normalized = raw.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const preamble: string[] = []
  const sections: TomlSectionBlock[] = []
  let currentHeader = ''
  let currentLines: string[] | null = null

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (match) {
      if (currentLines && currentHeader) {
        sections.push({
          header: currentHeader,
          lines: currentLines,
        })
      }
      currentHeader = match[1].trim()
      currentLines = [line]
      continue
    }

    if (currentLines) {
      currentLines.push(line)
    } else {
      preamble.push(line)
    }
  }

  if (currentLines && currentHeader) {
    sections.push({
      header: currentHeader,
      lines: currentLines,
    })
  }

  return {
    preamble,
    sections,
  }
}

function readTomlTopLevelString(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`)
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) {
      return match[1]
    }
  }
  return ''
}

function readTomlSectionString(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`)
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) {
      return match[1]
    }
  }
  return ''
}

function readCodexProviderToken(lines: string[]) {
  return (
    readTomlSectionString(lines, 'experimental_bearer_token') ||
    readTomlSectionString(lines, 'api_key')
  )
}

function createCodexProviderSection(apiKey: string, baseUrl: string): TomlSectionBlock {
  const resolvedBaseUrl = normalizeCodexBaseUrl(baseUrl)
  return {
    header: 'model_providers.oneapi_desktop',
    lines: [
      '[model_providers.oneapi_desktop]',
      'name = "oneapi_desktop"',
      `base_url = "${resolvedBaseUrl}"`,
      `experimental_bearer_token = "${apiKey}"`,
      'wire_api = "responses"',
    ],
  }
}

function createCodexWindowsSection(): TomlSectionBlock {
  return {
    header: 'windows',
    lines: [
      '[windows]',
      'sandbox = "unelevated"',
    ],
  }
}

function getCodexBundledMarketplaceSourcePath() {
  return `\\\\?\\${path.join(os.homedir(), '.codex', '.tmp', 'bundled-marketplaces', 'openai-bundled')}`
}

function createCodexMarketplaceSection(): TomlSectionBlock {
  return {
    header: 'marketplaces.openai-bundled',
    lines: [
      '[marketplaces.openai-bundled]',
      `last_updated = "${new Date().toISOString()}"`,
      'source_type = "local"',
      `source = '${getCodexBundledMarketplaceSourcePath()}'`,
    ],
  }
}

function renameCodexProviderSection(block: TomlSectionBlock, nextHeader: string, nextName: string): TomlSectionBlock {
  return {
    header: nextHeader,
    lines: block.lines.map((line, index) => {
      if (index === 0) {
        return `[${nextHeader}]`
      }
      if (/^\s*name\s*=/.test(line)) {
        return `name = "${nextName}"`
      }
      return line
    }),
  }
}

function serializeTomlDocument(preamble: string[], sections: TomlSectionBlock[]) {
  const blocks = [
    preamble.join('\n').trimEnd(),
    ...sections.map((section) => section.lines.join('\n').trimEnd()).filter(Boolean),
  ].filter(Boolean)

  return `${blocks.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function isCodexProviderDifferent(section: TomlSectionBlock, apiKey: string, baseUrl: string) {
  return (
    readCodexProviderToken(section.lines).trim() !== apiKey.trim() ||
    normalizeCodexBaseUrl(readTomlSectionString(section.lines, 'base_url')) !==
      normalizeCodexBaseUrl(baseUrl)
  )
}

function mergeCodexConfig(raw: string, apiKey: string, model: string, baseUrl: string) {
  const parsed = parseTomlDocument(raw)
  const resolvedBaseUrl = normalizeCodexBaseUrl(baseUrl)
  const nextProviderBlock = createCodexProviderSection(apiKey, resolvedBaseUrl)
  const filteredPreamble = parsed.preamble.filter(
    (line) =>
      !/^\s*model\s*=/.test(line) &&
      !/^\s*model_provider\s*=/.test(line) &&
      !/^\s*model_reasoning_effort\s*=/.test(line) &&
      !/^\s*cli_auth_credentials_store\s*=/.test(line)
  )

  const nextPreamble = [
    `model = "${model}"`,
    'model_provider = "oneapi_desktop"',
    'model_reasoning_effort = "high"',
    'cli_auth_credentials_store = "file"',
    '',
    ...filteredPreamble,
  ]

  const sections: TomlSectionBlock[] = []
  const existingOneApiDesktop = parsed.sections.find(
    (section) => section.header === 'model_providers.oneapi_desktop'
  )
  const existingOriginalBackup = parsed.sections.find(
    (section) => section.header === 'model_providers.oneapi_desktop_original'
  )
  const shouldInsertBackup =
    !!existingOneApiDesktop &&
    !existingOriginalBackup &&
    isCodexProviderDifferent(existingOneApiDesktop, apiKey, resolvedBaseUrl)
  let insertedProvider = false
  let insertedBackup = false
  let insertedWindows = false
  let insertedMarketplace = false

  for (const section of parsed.sections) {
    if (section.header === 'model_providers.oneapi_desktop') {
      if (!insertedProvider) {
        sections.push(nextProviderBlock)
        insertedProvider = true
        if (shouldInsertBackup && existingOneApiDesktop && !insertedBackup) {
          sections.push(
            renameCodexProviderSection(
              existingOneApiDesktop,
              'model_providers.oneapi_desktop_original',
              'oneapi_desktop_original'
            )
          )
          insertedBackup = true
        }
      }
      continue
    }

    if (section.header === 'model_providers.oneapi_desktop_original') {
      if (!insertedBackup) {
        sections.push(section)
        insertedBackup = true
      }
      continue
    }

    if (section.header === 'windows') {
      if (!insertedWindows) {
        sections.push(section)
        insertedWindows = true
      }
      continue
    }

    if (section.header === 'marketplaces.openai-bundled') {
      if (!insertedMarketplace) {
        sections.push(createCodexMarketplaceSection())
        insertedMarketplace = true
      }
      continue
    }

    if (!insertedProvider && section.header.startsWith('model_providers.')) {
      sections.push(nextProviderBlock)
      insertedProvider = true
      if (shouldInsertBackup && existingOneApiDesktop && !insertedBackup) {
        sections.push(
          renameCodexProviderSection(
            existingOneApiDesktop,
            'model_providers.oneapi_desktop_original',
            'oneapi_desktop_original'
          )
        )
        insertedBackup = true
      }
    }

    sections.push(section)
  }

  if (!insertedProvider) {
    sections.push(nextProviderBlock)
  }

  if (shouldInsertBackup && existingOneApiDesktop && !insertedBackup) {
    sections.push(
      renameCodexProviderSection(
        existingOneApiDesktop,
        'model_providers.oneapi_desktop_original',
        'oneapi_desktop_original'
      )
    )
  }

  if (!insertedWindows) {
    sections.push(createCodexWindowsSection())
  }

  if (!insertedMarketplace) {
    sections.push(createCodexMarketplaceSection())
  }

  return serializeTomlDocument(nextPreamble, sections)
}

function resolveDesktopCliKeyRecord(apiKey: string) {
  return apiKey.startsWith('sk-') ? apiKey : `sk-${apiKey}`
}

function maskSensitiveText(value?: string) {
  if (!value) {
    return ''
  }

  return value.replace(/sk-[^\s"'`]+/g, (token) => {
    if (token.length <= 14) {
      return `${token.slice(0, 4)}****`
    }
    return `${token.slice(0, 6)}****${token.slice(-4)}`
  })
}

async function readCurrentClaudeConfig() {
  const targetPath = cliConfig.claude.configPath
  const parsed = await readResolvedClaudeSettingsDocument(targetPath)
  const env = parsed.env || {}
  const managedByDesktop =
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1' ||
    typeof env.ONEAPI_ORIGINAL_ANTHROPIC_API_KEY === 'string' ||
    typeof env.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN === 'string'

  return {
    client: 'claude' as const,
    apiKey: pickClaudeApiKey(env),
    model: parsed.model?.trim() || DEFAULT_CLAUDE_MODEL,
    baseUrl: normalizeClaudeBaseUrl(env.ANTHROPIC_BASE_URL),
    managedByDesktop,
  }
}

async function readCurrentClaudeSettingsDocument(targetPath = cliConfig.claude.configPath) {
  const raw = await fs.readFile(targetPath, 'utf8')
  return JSON.parse(raw) as ClaudeSettingsDocument
}

async function readClaudeAuthDocument(targetPath = path.join(cliConfig.claude.dataPath, 'auth.json')) {
  const raw = await fs.readFile(targetPath, 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

function pickClaudeApiKey(env?: Record<string, string>) {
  return env?.ANTHROPIC_AUTH_TOKEN?.trim() || env?.ANTHROPIC_API_KEY?.trim() || ''
}

function pickClaudeApiKeyFromUnknown(input: unknown) {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const source = input as Record<string, unknown>
  return (
    (typeof source.ANTHROPIC_AUTH_TOKEN === 'string' && source.ANTHROPIC_AUTH_TOKEN.trim()) ||
    (typeof source.ANTHROPIC_API_KEY === 'string' && source.ANTHROPIC_API_KEY.trim()) ||
    ''
  )
}

async function resolveClaudeFallbackApiKey() {
  const claudeAuth = await readClaudeAuthDocument().catch(() => null)
  const fromClaudeAuth = pickClaudeApiKeyFromUnknown(claudeAuth)
  if (fromClaudeAuth) {
    return resolveDesktopCliKeyRecord(fromClaudeAuth)
  }

  const codexAuthPath = path.join(cliConfig.codex.dataPath, 'auth.json')
  const codexAuthRaw = await fs.readFile(codexAuthPath, 'utf8').catch(() => '')
  if (codexAuthRaw.trim()) {
    try {
      const parsed = JSON.parse(codexAuthRaw) as Record<string, unknown>
      const token =
        (typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY.trim()) ||
        (typeof parsed.ANTHROPIC_AUTH_TOKEN === 'string' && parsed.ANTHROPIC_AUTH_TOKEN.trim()) ||
        ''
      if (token) {
        return resolveDesktopCliKeyRecord(token)
      }
    } catch {
      /* ignore invalid codex auth backup */
    }
  }

  const codexRaw = await fs.readFile(cliConfig.codex.configPath, 'utf8').catch(() => '')
  if (codexRaw.trim()) {
    const parsedToml = parseTomlDocument(codexRaw)
    const provider = readTomlTopLevelString(parsedToml.preamble, 'model_provider') || 'oneapi_desktop'
    const providerSection =
      parsedToml.sections.find((section) => section.header === `model_providers.${provider}`) ||
      parsedToml.sections.find((section) => section.header === 'model_providers.oneapi_desktop')
    const token = providerSection ? readCodexProviderToken(providerSection.lines).trim() : ''
    if (token) {
      return resolveDesktopCliKeyRecord(token)
    }
  }

  return ''
}

async function readResolvedClaudeSettingsDocument(targetPath = cliConfig.claude.configPath) {
  const parsed = await readCurrentClaudeSettingsDocument(targetPath).catch(() => ({} as ClaudeSettingsDocument))
  const currentEnv = (typeof parsed.env === 'object' && parsed.env ? parsed.env : {}) as Record<string, string>
  const currentKey = pickClaudeApiKey(currentEnv)
  if (currentKey) {
    return {
      ...parsed,
      env: {
        ...currentEnv,
        ANTHROPIC_API_KEY: resolveDesktopCliKeyRecord(currentKey),
        ANTHROPIC_AUTH_TOKEN: resolveDesktopCliKeyRecord(currentKey),
      },
    } satisfies ClaudeSettingsDocument
  }

  const fallbackKey = await resolveClaudeFallbackApiKey()
  if (!fallbackKey) {
    return {
      ...parsed,
      env: currentEnv,
    } satisfies ClaudeSettingsDocument
  }

  const nextDocument: ClaudeSettingsDocument = {
    ...parsed,
    env: {
      ...currentEnv,
      ANTHROPIC_API_KEY: fallbackKey,
      ANTHROPIC_AUTH_TOKEN: fallbackKey,
    },
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, JSON.stringify(nextDocument, null, 2), 'utf8')
  return nextDocument
}

function buildClaudeCliEnv(
  runtime: NodeRuntimeInfo | null,
  settings?: ClaudeSettingsDocument | null
) {
  const baseEnv: NodeJS.ProcessEnv = runtime ? buildRuntimeEnv(runtime) : { ...process.env }
  const nextEnv = { ...baseEnv }
  const configEnv = settings?.env || {}

  for (const [key, value] of Object.entries(configEnv)) {
    if (typeof value === 'string' && value.trim()) {
      nextEnv[key] = value
    }
  }

  const apiKey = pickClaudeApiKey(configEnv)
  if (apiKey) {
    const normalizedKey = resolveDesktopCliKeyRecord(apiKey)
    nextEnv.ANTHROPIC_API_KEY = normalizedKey
    nextEnv.ANTHROPIC_AUTH_TOKEN = normalizedKey
  }

  if (configEnv.ANTHROPIC_BASE_URL?.trim()) {
    nextEnv.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrl(configEnv.ANTHROPIC_BASE_URL)
  }

  return nextEnv
}

function normalizeCliExtensionId(
  client: 'codex' | 'claude',
  kind: 'skill' | 'command' | 'plugin',
  name: string,
  targetPath: string
) {
  return `${client}:${kind}:${name.trim().toLowerCase()}:${targetPath.trim().toLowerCase()}`
}

async function readPluginManifest(targetPath: string) {
  const raw = await fs.readFile(targetPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return null
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

type LocalClaudeMarketplaceManifest = {
  name?: string
  id?: string
  owner?: {
    name?: string
    email?: string
  }
  plugins?: Array<Record<string, unknown>>
}

type ClaudeMarketplaceInstallInfo = {
  scope?: string
  installPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

type CodexCuratedSkillCatalogEntry = {
  id: string
  name: string
  description: string
  sourceRoot: string
}

type CodexMarketplaceSource = {
  marketplace: string
  sourceRoot: string
}

function readTomlSectionBoolean(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, 'i')
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) {
      return match[1].toLowerCase() === 'true'
    }
  }
  return false
}

function isOfficialAuthorName(value: unknown) {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return normalized === 'openai' || normalized === 'anthropic'
}

function readCodexEnabledPluginKeys(raw: string) {
  const parsed = parseTomlDocument(raw)
  const enabledKeys = new Set<string>()

  for (const section of parsed.sections) {
    const match = section.header.match(/^plugins\."(.+)"$/)
    if (!match) {
      continue
    }
    if (readTomlSectionBoolean(section.lines, 'enabled')) {
      enabledKeys.add(match[1].trim())
    }
  }

  return enabledKeys
}

function mergeCodexPluginEnabled(raw: string, installKey: string) {
  const parsed = parseTomlDocument(raw)
  const targetHeader = `plugins."${installKey}"`
  let updated = false
  const nextSections = parsed.sections.map((section) => {
    if (section.header !== targetHeader) {
      return section
    }
    updated = true
    return {
      header: targetHeader,
      lines: [`[${targetHeader}]`, 'enabled = true'],
    } satisfies TomlSectionBlock
  })

  if (!updated) {
    nextSections.push({
      header: targetHeader,
      lines: [`[${targetHeader}]`, 'enabled = true'],
    })
  }

  return serializeTomlDocument(parsed.preamble, nextSections)
}

function normalizeCliInstallName(value: string) {
  return value.trim().toLowerCase()
}

function buildCodexCuratedSkillInstallKey(name: string) {
  return `codex-curated-skill:${normalizeCliInstallName(name)}`
}

function isCodexCuratedSkillInstallKey(value?: string) {
  return value?.startsWith('codex-curated-skill:') || false
}

function normalizeCodexLocalPath(value: string) {
  return value.trim().replace(/^\\\\\?\\/, '').replace(/^['"]|['"]$/g, '')
}

function isPathInside(targetPath: string, parentPath: string) {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedParent = path.resolve(parentPath)
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}${path.sep}`)
}

async function readCodexCuratedSkillCatalog(): Promise<CodexCuratedSkillCatalogEntry[]> {
  const cachePath = path.join(cliConfig.codex.dataPath, 'vendor_imports', 'skills-curated-cache.json')
  const vendorRoot = path.join(cliConfig.codex.dataPath, 'vendor_imports', 'skills')
  const raw = await fs.readFile(cachePath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return []
  }

  let document: {
    skills?: Array<Record<string, unknown>>
  }
  try {
    document = JSON.parse(raw) as {
      skills?: Array<Record<string, unknown>>
    }
  } catch {
    return []
  }

  const skills = Array.isArray(document.skills) ? document.skills : []
  const resolved = await Promise.all(
    skills.map(async (item) => {
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : ''
      const id =
        (typeof item.id === 'string' && item.id.trim()) ||
        name
      const repoPath =
        (typeof item.repoPath === 'string' && item.repoPath.trim()) ||
        `skills/.curated/${id}`
      const sourceRoot = path.join(vendorRoot, repoPath)
      if (!name || !(await pathExists(sourceRoot))) {
        return null
      }
      return {
        id,
        name,
        description:
          (typeof item.description === 'string' && item.description.trim()) ||
          (typeof item.shortDescription === 'string' && item.shortDescription.trim()) ||
          '',
        sourceRoot,
      } satisfies CodexCuratedSkillCatalogEntry
    })
  )

  return resolved.filter((item): item is CodexCuratedSkillCatalogEntry => !!item)
}

async function readBundledCodexCuratedSkillCatalog() {
  return readBundledCliCatalogFile<BundledCodexCuratedSkillCatalog>('codex-curated-skills.json')
}

async function readBundledCodexPublicMarketplaceCatalog() {
  return readBundledCliCatalogFile<BundledPluginMarketplaceCatalog>('codex-public-marketplace.json')
}

async function readBundledClaudeOfficialMarketplaceCatalog() {
  return readBundledCliCatalogFile<BundledPluginMarketplaceCatalog>('claude-official-marketplace.json')
}

function readCodexMarketplaceSources(raw: string) {
  const parsed = parseTomlDocument(raw)
  const sources: CodexMarketplaceSource[] = []

  for (const section of parsed.sections) {
    const match = section.header.match(/^marketplaces\.(.+)$/)
    if (!match) {
      continue
    }
    const marketplace = match[1].trim()
    const sourceType = readTomlSectionString(section.lines, 'source_type').trim().toLowerCase()
    const sourceRoot = normalizeCodexLocalPath(readTomlSectionString(section.lines, 'source'))
    if (sourceType !== 'local' || !marketplace || !sourceRoot) {
      continue
    }
    sources.push({
      marketplace,
      sourceRoot,
    })
  }

  return sources
}

async function listCodexMarketplaceExtensionsFromSource(
  source: CodexMarketplaceSource,
  enabledPluginKeys: Set<string>
) {
  const manifestPath = path.join(source.sourceRoot, '.agents', 'plugins', 'marketplace.json')
  const raw = await fs.readFile(manifestPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return []
  }

  let document: {
    plugins?: Array<Record<string, unknown>>
  }
  try {
    document = JSON.parse(raw) as {
      plugins?: Array<Record<string, unknown>>
    }
  } catch {
    return []
  }

  const entries: CliExtensionEntry[] = []
  const plugins = Array.isArray(document.plugins) ? document.plugins : []
  for (const plugin of plugins) {
    const sourceValue = plugin.source
    const relativePath =
      typeof sourceValue === 'string'
        ? sourceValue.trim()
        : sourceValue && typeof sourceValue === 'object' && typeof (sourceValue as Record<string, unknown>).path === 'string'
          ? ((sourceValue as Record<string, unknown>).path as string).trim()
          : ''
    if (!relativePath) {
      continue
    }

    const pluginRoot = path.join(source.sourceRoot, relativePath)
    const pluginManifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json')
    if (!(await pathExists(pluginManifestPath))) {
      continue
    }

    const manifest = await readPluginManifest(pluginManifestPath)
    const meta = resolveCodexPluginMeta(manifest, pluginRoot, source.marketplace)
    const installed = enabledPluginKeys.has(meta.installKey)
    const pluginId = normalizeCliExtensionId('codex', 'plugin', meta.pluginName, meta.installKey)
    entries.push({
      id: pluginId,
      client: 'codex',
      kind: 'plugin',
      name: meta.manifestName,
      description: meta.description,
      path: pluginRoot,
      source: source.marketplace,
      marketplace: source.marketplace,
      installed,
      official: meta.official,
      installable: !installed,
      installKey: meta.installKey,
    })

    const skillsDir = path.join(pluginRoot, 'skills')
    if (await pathExists(skillsDir)) {
      entries.push(...await listSkillEntriesFromRoot({
        client: 'codex',
        root: skillsDir,
        sourceLabel: meta.manifestName,
        marketplace: source.marketplace,
        installed,
        official: meta.official,
        installable: !installed,
        installKey: meta.installKey,
        parentPluginId: pluginId,
        parentPluginName: meta.manifestName,
        relativeRootForFallback: skillsDir,
      }))
    }
  }

  return entries
}

async function listCodexCachedExtensions(enabledPluginKeys: Set<string>) {
  const pluginsCacheRoot = path.join(cliConfig.codex.dataPath, 'plugins', 'cache')
  const entries: CliExtensionEntry[] = []
  if (!(await pathExists(pluginsCacheRoot))) {
    return entries
  }

  const manifestPaths = await walkFiles(
    pluginsCacheRoot,
    (filePath) =>
      path.basename(filePath).toLowerCase() === 'plugin.json' &&
      filePath.toLowerCase().includes(`${path.sep}.codex-plugin${path.sep}`.toLowerCase())
  )

  for (const manifestPath of manifestPaths) {
    const pluginRoot = path.dirname(path.dirname(manifestPath))
    const marketplace = path.relative(pluginsCacheRoot, pluginRoot).split(/[\\/]/).filter(Boolean)[0] || 'cache'
    const manifest = await readPluginManifest(manifestPath)
    const meta = resolveCodexPluginMeta(manifest, pluginRoot, marketplace)
    const installed = enabledPluginKeys.has(meta.installKey)
    const pluginId = normalizeCliExtensionId('codex', 'plugin', meta.pluginName, meta.installKey)
    entries.push({
      id: pluginId,
      client: 'codex',
      kind: 'plugin',
      name: meta.manifestName,
      description: meta.description,
      path: pluginRoot,
      source: marketplace,
      marketplace,
      installed,
      official: meta.official,
      installable: !installed,
      installKey: meta.installKey,
    })

    const skillsDir = path.join(pluginRoot, 'skills')
    if (await pathExists(skillsDir)) {
      entries.push(...await listSkillEntriesFromRoot({
        client: 'codex',
        root: skillsDir,
        sourceLabel: meta.manifestName,
        marketplace,
        installed,
        official: meta.official,
        installable: !installed,
        installKey: meta.installKey,
        parentPluginId: pluginId,
        parentPluginName: meta.manifestName,
        relativeRootForFallback: skillsDir,
      }))
    }
  }

  return entries
}

async function listSkillEntriesFromRoot(options: {
  client: CliClient
  root: string
  sourceLabel: string
  marketplace?: string
  installed: boolean
  official: boolean
  installable: boolean
  installKey?: string
  parentPluginId?: string
  parentPluginName?: string
  relativeRootForFallback?: string
}) {
  const files = await walkFiles(options.root, (filePath) => path.basename(filePath).toUpperCase() === 'SKILL.MD')
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
      const meta = parseMarkdownFrontmatterMeta(raw)
      const relativePath = path.relative(options.relativeRootForFallback || options.root, filePath)
      const skillRoot = path.dirname(filePath)
      const fallbackName = relativePath.split(/[\\/]/).filter(Boolean).at(-2) || path.basename(skillRoot)
      return {
        id: normalizeCliExtensionId(options.client, 'skill', meta.name || fallbackName, skillRoot),
        client: options.client,
        kind: 'skill' as const,
        name: meta.name || fallbackName,
        description: meta.description,
        path: skillRoot,
        source: options.sourceLabel,
        marketplace: options.marketplace,
        installed: options.installed,
        official: options.official,
        installable: options.installable,
        installKey: options.installKey,
        parentPluginId: options.parentPluginId,
        parentPluginName: options.parentPluginName,
      } satisfies CliExtensionEntry
    })
  )

  return entries
}

async function listCommandEntriesFromRoot(options: {
  root: string
  sourceLabel: string
  marketplace?: string
  installed: boolean
  official: boolean
  installable: boolean
  installKey?: string
  parentPluginId?: string
  parentPluginName?: string
}) {
  const files = await walkFiles(options.root, (filePath) => path.extname(filePath).toLowerCase() === '.md')
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
      const meta = parseMarkdownFrontmatterMeta(raw)
      const commandName = meta.name || path.basename(filePath, path.extname(filePath))
      return {
        id: normalizeCliExtensionId('claude', 'command', commandName, filePath),
        client: 'claude' as const,
        kind: 'command' as const,
        name: commandName,
        description: meta.description,
        path: filePath,
        source: options.sourceLabel,
        marketplace: options.marketplace,
        installed: options.installed,
        official: options.official,
        installable: options.installable,
        installKey: options.installKey,
        parentPluginId: options.parentPluginId,
        parentPluginName: options.parentPluginName,
      } satisfies CliExtensionEntry
    })
  )

  return entries
}

function resolveCodexPluginMeta(
  manifest: Record<string, unknown> | null,
  pluginRoot: string,
  marketplace: string
) {
  const interfaceSection =
    manifest && typeof manifest.interface === 'object' && manifest.interface
      ? (manifest.interface as Record<string, unknown>)
      : null
  const authorSection =
    manifest && typeof manifest.author === 'object' && manifest.author
      ? (manifest.author as Record<string, unknown>)
      : null
  const manifestName =
    (interfaceSection && typeof interfaceSection.displayName === 'string' && interfaceSection.displayName.trim()) ||
    (manifest && typeof manifest.name === 'string' && manifest.name.trim()) ||
    path.basename(pluginRoot)
  const pluginName =
    (manifest && typeof manifest.name === 'string' && manifest.name.trim()) || manifestName
  const description =
    (interfaceSection && typeof interfaceSection.shortDescription === 'string' && interfaceSection.shortDescription.trim()) ||
    (manifest && typeof manifest.description === 'string' && manifest.description.trim()) ||
    ''
  const authorName =
    (interfaceSection && typeof interfaceSection.developerName === 'string' && interfaceSection.developerName.trim()) ||
    (authorSection && typeof authorSection.name === 'string' && authorSection.name.trim()) ||
    ''

  return {
    manifestName,
    pluginName,
    description,
    authorName,
    official: isOfficialAuthorName(authorName),
    installKey: `${pluginName}@${marketplace}`,
  }
}

async function listCodexExtensions(): Promise<CliExtensionEntry[]> {
  const configRaw = await fs.readFile(cliConfig.codex.configPath, 'utf8').catch(() => '')
  const enabledPluginKeys = readCodexEnabledPluginKeys(configRaw)
  const skillsRoot = path.join(cliConfig.codex.dataPath, 'skills')
  const entries: CliExtensionEntry[] = []
  const curatedCatalog = await readCodexCuratedSkillCatalog()
  const bundledCuratedCatalog = await readBundledCodexCuratedSkillCatalog()
  const curatedByKey = curatedCatalog.reduce<Map<string, CodexCuratedSkillCatalogEntry>>((map, item) => {
    map.set(normalizeCliInstallName(item.name), item)
    map.set(normalizeCliInstallName(path.basename(item.sourceRoot)), item)
    return map
  }, new Map())
  const installedCuratedKeys = new Set<string>()

  if (await pathExists(skillsRoot)) {
    const localSkillEntries = await listSkillEntriesFromRoot({
      client: 'codex',
      root: skillsRoot,
      sourceLabel: '本地技能',
      installed: true,
      official: false,
      installable: false,
      relativeRootForFallback: skillsRoot,
    })
    for (const entry of localSkillEntries) {
      if (entry.path.toLowerCase().includes(`${path.sep}.system${path.sep}`.toLowerCase())) {
        entry.source = '系统'
        entry.official = true
        continue
      }

      const curated =
        curatedByKey.get(normalizeCliInstallName(entry.name)) ||
        curatedByKey.get(normalizeCliInstallName(path.basename(entry.path)))
      if (curated) {
        entry.source = '官方技能'
        entry.official = true
        entry.installKey = buildCodexCuratedSkillInstallKey(curated.name)
        installedCuratedKeys.add(normalizeCliInstallName(curated.name))
      }
    }
    entries.push(...localSkillEntries)
  }

  for (const curated of curatedCatalog) {
    const curatedKey = normalizeCliInstallName(curated.name)
    if (installedCuratedKeys.has(curatedKey)) {
      continue
    }
    entries.push({
      id: normalizeCliExtensionId('codex', 'skill', curated.name, curated.sourceRoot),
      client: 'codex',
      kind: 'skill',
      name: curated.name,
      description: curated.description,
      path: curated.sourceRoot,
      source: '官方技能',
      installed: false,
      official: true,
      installable: true,
      installKey: buildCodexCuratedSkillInstallKey(curated.name),
    })
  }

  if (bundledCuratedCatalog) {
    entries.push(
      ...buildBundledCodexCuratedSkillEntries(
        bundledCuratedCatalog,
        installedCuratedKeys
      )
    )
  }

  for (const source of readCodexMarketplaceSources(configRaw)) {
    entries.push(...await listCodexMarketplaceExtensionsFromSource(source, enabledPluginKeys))
  }

  const bundledPublicMarketplace = await readBundledCodexPublicMarketplaceCatalog()
  if (bundledPublicMarketplace) {
    entries.push(...buildBundledMarketplaceEntries('codex', bundledPublicMarketplace, enabledPluginKeys))
  }

  entries.push(...await listCodexCachedExtensions(enabledPluginKeys))

  return entries
}

async function readInstalledClaudePluginsDocument() {
  const registryPath = path.join(cliConfig.claude.dataPath, 'plugins', 'installed_plugins.json')
  const raw = await fs.readFile(registryPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return {
      registryPath,
      document: {
        version: 2,
        plugins: {},
      } satisfies ClaudeInstalledPluginsDocument,
    }
  }

  try {
    return {
      registryPath,
      document: JSON.parse(raw) as ClaudeInstalledPluginsDocument,
    }
  } catch {
    return {
      registryPath,
      document: {
        version: 2,
        plugins: {},
      } satisfies ClaudeInstalledPluginsDocument,
    }
  }
}

async function listClaudeInstalledExtensions() {
  const entries: CliExtensionEntry[] = []
  const commandsRoot = path.join(cliConfig.claude.dataPath, 'commands')
  if (await pathExists(commandsRoot)) {
    entries.push(...await listCommandEntriesFromRoot({
      root: commandsRoot,
      sourceLabel: '本地命令',
      installed: true,
      official: false,
      installable: false,
    }))
  }

  const { document } = await readInstalledClaudePluginsDocument()
  const pluginGroups = document.plugins || {}
  for (const [pluginKey, installs] of Object.entries(pluginGroups)) {
    for (const [index, installInfo] of installs.entries()) {
      const installRoot = installInfo.installPath?.trim() || ''
      if (!installRoot) {
        continue
      }
      const manifest = await readPluginManifest(path.join(installRoot, '.claude-plugin', 'plugin.json'))
      const authorSection =
        manifest && typeof manifest.author === 'object' && manifest.author
          ? (manifest.author as Record<string, unknown>)
          : null
      const manifestName =
        (manifest && typeof manifest.name === 'string' && manifest.name.trim()) ||
        pluginKey.split('@')[0] ||
        path.basename(installRoot)
      const description =
        (manifest && typeof manifest.description === 'string' && manifest.description.trim()) || ''
      const authorName =
        (authorSection && typeof authorSection.name === 'string' && authorSection.name.trim()) || ''
      const [pluginName, marketplace = 'installed'] = pluginKey.split('@')
      const pluginId = normalizeCliExtensionId('claude', 'plugin', `${pluginName}:${index}`, installRoot)
      entries.push({
        id: pluginId,
        client: 'claude',
        kind: 'plugin',
        name: manifestName,
        description,
        path: installRoot,
        source: pluginKey,
        marketplace,
        installed: true,
        official: isOfficialAuthorName(authorName),
        installable: false,
        installKey: pluginKey,
      })

      const skillsDir = path.join(installRoot, 'skills')
      if (await pathExists(skillsDir)) {
        entries.push(...await listSkillEntriesFromRoot({
          client: 'claude',
          root: skillsDir,
          sourceLabel: manifestName,
          marketplace,
          installed: true,
          official: isOfficialAuthorName(authorName),
          installable: false,
          installKey: pluginKey,
          parentPluginId: pluginId,
          parentPluginName: manifestName,
          relativeRootForFallback: skillsDir,
        }))
      }

      const pluginCommandsDir = path.join(installRoot, 'commands')
      if (await pathExists(pluginCommandsDir)) {
        entries.push(...await listCommandEntriesFromRoot({
          root: pluginCommandsDir,
          sourceLabel: manifestName,
          marketplace,
          installed: true,
          official: isOfficialAuthorName(authorName),
          installable: false,
          installKey: pluginKey,
          parentPluginId: pluginId,
          parentPluginName: manifestName,
        }))
      }
    }
  }

  return entries
}

async function listClaudeMarketplaceExtensions() {
  const marketplacesRoot = path.join(cliConfig.claude.dataPath, 'plugins', 'marketplaces')
  const { document } = await readInstalledClaudePluginsDocument()
  const installedPluginKeys = new Set(Object.keys(document.plugins || {}))
  const entries: CliExtensionEntry[] = []
  if (await pathExists(marketplacesRoot)) {
    const marketplaceNames = await fs.readdir(marketplacesRoot).catch(() => [] as string[])

    for (const marketplaceName of marketplaceNames) {
      const marketplaceRoot = path.join(marketplacesRoot, marketplaceName)
      const marketplaceManifestPath = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json')
      if (!(await pathExists(marketplaceManifestPath))) {
        continue
      }
      const raw = await fs.readFile(marketplaceManifestPath, 'utf8').catch(() => '')
      if (!raw.trim()) {
        continue
      }

      const marketplaceManifest = (() => {
        try {
          return JSON.parse(raw) as LocalClaudeMarketplaceManifest
        } catch {
          return null
        }
      })()
      if (!marketplaceManifest?.plugins?.length) {
        continue
      }

      for (const plugin of marketplaceManifest.plugins) {
        const pluginName = typeof plugin.name === 'string' && plugin.name.trim() ? plugin.name.trim() : ''
        if (!pluginName) {
          continue
        }
        const installKey = `${pluginName}@${marketplaceName}`
        const installed = installedPluginKeys.has(installKey)
        const description = typeof plugin.description === 'string' ? plugin.description.trim() : ''
        const authorSection =
          typeof plugin.author === 'object' && plugin.author ? (plugin.author as Record<string, unknown>) : null
        const sourceValue = plugin.source
        const sourceLabel = `${marketplaceName}`
        const official =
          isOfficialAuthorName(authorSection?.name) ||
          (typeof sourceValue === 'string' && sourceValue.startsWith('./plugins/'))
        const pluginPathHint =
          typeof sourceValue === 'string' && sourceValue.trim()
            ? path.join(marketplaceRoot, sourceValue)
            : marketplaceRoot
        const pluginId = normalizeCliExtensionId('claude', 'plugin', pluginName, installKey)

        entries.push({
          id: pluginId,
          client: 'claude',
          kind: 'plugin',
          name: pluginName,
          description,
          path: pluginPathHint,
          source: sourceLabel,
          marketplace: marketplaceName,
          installed,
          official,
          installable: !installed,
          installKey,
        })

        if (installed) {
          continue
        }

        if (typeof sourceValue !== 'string' || !sourceValue.startsWith('./')) {
          continue
        }

        const sourceRoot = path.join(marketplaceRoot, sourceValue)
        const skillsDir = path.join(sourceRoot, 'skills')
        if (await pathExists(skillsDir)) {
          entries.push(...await listSkillEntriesFromRoot({
            client: 'claude',
            root: skillsDir,
            sourceLabel: pluginName,
            marketplace: marketplaceName,
            installed: false,
            official,
            installable: true,
            installKey,
            parentPluginId: pluginId,
            parentPluginName: pluginName,
            relativeRootForFallback: skillsDir,
          }))
        }

        const commandsDir = path.join(sourceRoot, 'commands')
        if (await pathExists(commandsDir)) {
          entries.push(...await listCommandEntriesFromRoot({
            root: commandsDir,
            sourceLabel: pluginName,
            marketplace: marketplaceName,
            installed: false,
            official,
            installable: true,
            installKey,
            parentPluginId: pluginId,
            parentPluginName: pluginName,
          }))
        }
      }
    }
  }

  const bundledOfficialMarketplace = await readBundledClaudeOfficialMarketplaceCatalog()
  if (bundledOfficialMarketplace) {
    entries.push(...buildBundledMarketplaceEntries('claude', bundledOfficialMarketplace, installedPluginKeys))
  }

  return entries
}

async function listCliExtensions(client: CliClient): Promise<CliExtensionEntry[]> {
  const entries = client === 'codex'
    ? await listCodexExtensions()
    : [...await listClaudeInstalledExtensions(), ...await listClaudeMarketplaceExtensions()]

  const unique = new Map<string, CliExtensionEntry>()
  for (const item of entries) {
    const dedupeKey = buildCliExtensionDedupeKey(item)
    const existing = unique.get(dedupeKey)
    if (!existing) {
      unique.set(dedupeKey, item)
      continue
    }
    const existingInstalled = existing.installed !== false
    const itemInstalled = item.installed !== false
    const existingInCache = isPathInside(existing.path, path.join(cliConfig.codex.dataPath, 'plugins', 'cache'))
    const itemInCache = isPathInside(item.path, path.join(cliConfig.codex.dataPath, 'plugins', 'cache'))
    if (!existingInstalled && itemInstalled) {
      unique.set(dedupeKey, item)
      continue
    }
    if (existingInstalled === itemInstalled && !existingInCache && itemInCache) {
      unique.set(dedupeKey, item)
      continue
    }
    if (existingInstalled === itemInstalled && !existing.official && !!item.official) {
      unique.set(dedupeKey, item)
    }
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function installCodexCuratedSkill(entry: CliExtensionEntry): Promise<CliExtensionInstallResult> {
  const sourceRoot = entry.path.trim()
  const skillFilePath = path.join(sourceRoot, 'SKILL.md')
  let resolvedSourceRoot = sourceRoot
  let tempRoot = ''

  try {
    if (!resolvedSourceRoot || !(await pathExists(skillFilePath))) {
      const catalogSource = entry.catalogSource
      if (!catalogSource?.repoUrl || !catalogSource.subdir) {
        return {
          success: false,
          message: '未找到可安装的官方技能目录。',
        }
      }
      tempRoot = path.join(os.tmpdir(), 'oneapi-codex-skill-install', randomUUID())
      resolvedSourceRoot = await cloneGitRepoSubdir(catalogSource.repoUrl, tempRoot, {
        ref: catalogSource.sha || catalogSource.ref,
        subdir: catalogSource.subdir,
      })
    }

    const targetDirName = path.basename(resolvedSourceRoot)
    const targetRoot = path.join(cliConfig.codex.dataPath, 'skills', targetDirName)
    await fs.rm(targetRoot, { recursive: true, force: true })
    await fs.mkdir(path.dirname(targetRoot), { recursive: true })
    await fs.cp(resolvedSourceRoot, targetRoot, { recursive: true })
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return {
    success: true,
    message: '安装完成。下次发送消息时将自动生效，无需重启当前客户端。',
  }
}

async function installCodexMarketplacePlugin(entry: CliExtensionEntry): Promise<CliExtensionInstallResult> {
  const installKey = entry.installKey?.trim() || ''
  if (!installKey) {
    return {
      success: false,
      message: '缺少可安装的插件标识。',
    }
  }

  let sourceRoot = entry.path.trim()
  const cacheRoot = path.join(cliConfig.codex.dataPath, 'plugins', 'cache')
  let tempRoot = ''
  try {
    const manifestPath = path.join(sourceRoot, '.codex-plugin', 'plugin.json')
    if (!sourceRoot || !(await pathExists(manifestPath))) {
      const catalogSource = entry.catalogSource
      if (!catalogSource?.repoUrl || !catalogSource.subdir) {
        return {
          success: false,
          message: '未找到可安装的插件目录。',
        }
      }
      tempRoot = path.join(os.tmpdir(), 'oneapi-codex-plugin-install', randomUUID())
      sourceRoot = await cloneGitRepoSubdir(catalogSource.repoUrl, tempRoot, {
        ref: catalogSource.sha || catalogSource.ref,
        subdir: catalogSource.subdir,
      })
    }

    if (sourceRoot && !isPathInside(sourceRoot, cacheRoot)) {
      const manifest = await readPluginManifest(path.join(sourceRoot, '.codex-plugin', 'plugin.json'))
      const pluginName =
        (manifest && typeof manifest.name === 'string' && manifest.name.trim()) ||
        installKey.split('@')[0] ||
        path.basename(sourceRoot)
      const versionToken =
        (entry.catalogSource?.sha?.trim()) ||
        (manifest && typeof manifest.version === 'string' && manifest.version.trim()) ||
        path.basename(sourceRoot) ||
        `${Date.now()}`
      const marketplace = entry.marketplace?.trim() || installKey.split('@')[1] || 'marketplace'
      const installPath = path.join(cacheRoot, marketplace, pluginName, versionToken)
      await fs.rm(installPath, { recursive: true, force: true })
      await fs.mkdir(path.dirname(installPath), { recursive: true })
      await fs.cp(sourceRoot, installPath, { recursive: true })
    }
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const currentRaw = await fs.readFile(cliConfig.codex.configPath, 'utf8').catch(() => '')
  const nextRaw = mergeCodexPluginEnabled(currentRaw, installKey)
  await fs.mkdir(path.dirname(cliConfig.codex.configPath), { recursive: true })
  await fs.writeFile(cliConfig.codex.configPath, nextRaw, 'utf8')
  return {
    success: true,
    message: '安装完成。下次发送消息时将自动生效，无需重启当前客户端。',
  }
}

function normalizeMarketplaceGitUrl(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return normalized
  }
  if (/^(https?:\/\/|git@)/i.test(normalized)) {
    return normalized
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    return `https://github.com/${normalized}.git`
  }
  return normalized
}

function isGitCommitish(value: string) {
  return /^[0-9a-f]{7,40}$/i.test(value.trim())
}

async function cloneGitRepoSubdir(
  repoUrl: string,
  tempRoot: string,
  options: {
    ref?: string
    subdir?: string
  } = {}
) {
  const normalizedUrl = normalizeMarketplaceGitUrl(repoUrl)
  if (!normalizedUrl) {
    throw new Error('缺少可用的仓库地址。')
  }

  const cloneTarget = path.join(tempRoot, 'repo')
  await fs.mkdir(tempRoot, { recursive: true })
  const normalizedRef = options.ref?.trim() || ''
  const cloneArgs = ['clone', '--depth', '1']
  if (normalizedRef && !isGitCommitish(normalizedRef)) {
    cloneArgs.push('--branch', normalizedRef)
  }
  cloneArgs.push(normalizedUrl, cloneTarget)
  const cloneResult = await spawnCommandWithHandlers('git', cloneArgs, {
    timeoutMs: 180000,
  })
  if (cloneResult.exitCode !== 0) {
    throw new Error(cloneResult.stderr.trim() || '克隆仓库失败。')
  }

  if (normalizedRef && isGitCommitish(normalizedRef)) {
    const checkoutResult = await spawnCommandWithHandlers('git', ['-C', cloneTarget, 'checkout', normalizedRef], {
      timeoutMs: 180000,
    })
    if (checkoutResult.exitCode !== 0) {
      throw new Error(checkoutResult.stderr.trim() || '切换仓库版本失败。')
    }
  }

  const relativePath = options.subdir?.trim() ? options.subdir.trim() : ''
  return relativePath ? path.join(cloneTarget, relativePath) : cloneTarget
}

async function cloneClaudeMarketplaceSource(
  source: Record<string, unknown>,
  tempRoot: string
) {
  const rawUrl =
    (typeof source.url === 'string' && source.url.trim()) ||
    (typeof source.repo === 'string' && source.repo.trim()) ||
    ''
  const repoUrl = normalizeMarketplaceGitUrl(rawUrl)
  if (!repoUrl) {
    throw new Error('插件源缺少可用的仓库地址。')
  }
  const ref =
    (typeof source.sha === 'string' && source.sha.trim()) ||
    (typeof source.ref === 'string' && source.ref.trim()) ||
    ''
  const relativePath = typeof source.path === 'string' && source.path.trim() ? source.path.trim() : ''
  return cloneGitRepoSubdir(repoUrl, tempRoot, {
    ref,
    subdir: relativePath,
  })
}

async function resolveClaudeMarketplacePluginSource(pluginKey: string) {
  const [pluginName, marketplaceName] = pluginKey.split('@')
  if (!pluginName || !marketplaceName) {
    throw new Error('插件安装标识无效。')
  }

  const marketplaceRoot = path.join(cliConfig.claude.dataPath, 'plugins', 'marketplaces', marketplaceName)
  const marketplaceManifestPath = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json')
  const raw = await fs.readFile(marketplaceManifestPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    throw new Error('未找到插件市场清单。')
  }

  let marketplaceManifest: LocalClaudeMarketplaceManifest
  try {
    marketplaceManifest = JSON.parse(raw) as LocalClaudeMarketplaceManifest
  } catch {
    throw new Error('插件市场清单格式无效。')
  }

  const plugin = marketplaceManifest.plugins?.find((item) => {
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    return name === pluginName
  })
  if (!plugin) {
    throw new Error('未在插件市场中找到目标插件。')
  }

  const rawSource = plugin.source
  if (typeof rawSource === 'string' && rawSource.trim()) {
    const sourceRoot = path.join(marketplaceRoot, rawSource)
    return {
      plugin,
      pluginName,
      marketplaceName,
      sourceRoot,
      versionToken:
        (typeof plugin.version === 'string' && plugin.version.trim()) ||
        path.basename(sourceRoot) ||
        'local',
    }
  }

  if (rawSource && typeof rawSource === 'object') {
    const sourceSpec = rawSource as Record<string, unknown>
    const tempRoot = path.join(os.tmpdir(), 'oneapi-claude-plugin-install', randomUUID())
    const sourceRoot = await cloneClaudeMarketplaceSource(sourceSpec, tempRoot)
    return {
      plugin,
      pluginName,
      marketplaceName,
      sourceRoot,
      tempRoot,
      versionToken:
        (typeof sourceSpec.sha === 'string' && sourceSpec.sha.trim()) ||
        (typeof plugin.version === 'string' && plugin.version.trim()) ||
        (typeof sourceSpec.ref === 'string' && sourceSpec.ref.trim()) ||
        `${Date.now()}`,
    }
  }

  throw new Error('当前插件源不支持自动安装。')
}

async function resolveClaudeMarketplacePluginSourceFromCatalogEntry(entry: CliExtensionEntry) {
  const installKey = entry.installKey?.trim() || ''
  const [pluginName, marketplaceName] = installKey.split('@')
  const catalogSource = entry.catalogSource
  if (!pluginName || !marketplaceName || !catalogSource?.repoUrl) {
    return null
  }

  const rawSource = catalogSource.rawSource
  if (typeof rawSource === 'string' && rawSource.trim()) {
    const tempRoot = path.join(os.tmpdir(), 'oneapi-claude-plugin-install', randomUUID())
    const sourceRoot = await cloneGitRepoSubdir(catalogSource.repoUrl, tempRoot, {
      ref: catalogSource.sha || catalogSource.ref,
      subdir: catalogSource.subdir || rawSource,
    })
    return {
      pluginName,
      marketplaceName,
      sourceRoot,
      tempRoot,
      versionToken: catalogSource.sha || catalogSource.ref || `${Date.now()}`,
    }
  }

  if (rawSource && typeof rawSource === 'object') {
    const tempRoot = path.join(os.tmpdir(), 'oneapi-claude-plugin-install', randomUUID())
    const sourceRoot = await cloneClaudeMarketplaceSource(rawSource as Record<string, unknown>, tempRoot)
    const sourceSpec = rawSource as Record<string, unknown>
    return {
      pluginName,
      marketplaceName,
      sourceRoot,
      tempRoot,
      versionToken:
        (typeof sourceSpec.sha === 'string' && sourceSpec.sha.trim()) ||
        (typeof sourceSpec.ref === 'string' && sourceSpec.ref.trim()) ||
        catalogSource.sha ||
        catalogSource.ref ||
        `${Date.now()}`,
    }
  }

  return null
}

async function installClaudeMarketplacePlugin(entry: CliExtensionEntry): Promise<CliExtensionInstallResult> {
  const installKey = entry.installKey?.trim() || ''
  if (!installKey) {
    return {
      success: false,
      message: '缺少可安装的插件标识。',
    }
  }

  const resolved =
    (await resolveClaudeMarketplacePluginSourceFromCatalogEntry(entry)) ||
    (await resolveClaudeMarketplacePluginSource(installKey))
  const installPath = path.join(
    cliConfig.claude.dataPath,
    'plugins',
    'cache',
    resolved.marketplaceName,
    resolved.pluginName,
    resolved.versionToken
  )

  try {
    await fs.rm(installPath, { recursive: true, force: true })
    await fs.mkdir(path.dirname(installPath), { recursive: true })
    await fs.cp(resolved.sourceRoot, installPath, { recursive: true })
  } finally {
    if (resolved.tempRoot) {
      await fs.rm(resolved.tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const { registryPath, document } = await readInstalledClaudePluginsDocument()
  const currentInstalls = document.plugins?.[installKey] || []
  const nextInstall: ClaudeMarketplaceInstallInfo = {
    scope: 'user',
    installPath,
    version: resolved.versionToken,
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    gitCommitSha: resolved.versionToken,
  }
  const nextDocument: ClaudeInstalledPluginsDocument = {
    version: document.version || 2,
    plugins: {
      ...(document.plugins || {}),
      [installKey]: [nextInstall, ...currentInstalls.filter((item) => item.installPath !== installPath)],
    },
  }
  await fs.mkdir(path.dirname(registryPath), { recursive: true })
  await fs.writeFile(registryPath, JSON.stringify(nextDocument, null, 2), 'utf8')

  return {
    success: true,
    message: '安装完成。下次发送消息时将自动生效，无需重启当前客户端。',
  }
}

async function installCliExtension(request: CliExtensionInstallRequest): Promise<CliExtensionInstallResult> {
  const currentEntries = await listCliExtensions(request.client)
  const entry = currentEntries.find((item) => item.id === request.extensionId)
  if (!entry) {
    return {
      success: false,
      message: '未找到目标技能或插件。',
    }
  }

  const installTarget =
    (entry.parentPluginId && currentEntries.find((item) => item.id === entry.parentPluginId)) ||
    entry

  if (installTarget.installed !== false) {
    return {
      success: true,
      message: '该技能或插件已经可用。',
    }
  }

  if (!installTarget.installable || !installTarget.installKey) {
    return {
      success: false,
      message: '当前条目不支持直接安装。',
    }
  }

  if (request.client === 'codex') {
    return isCodexCuratedSkillInstallKey(installTarget.installKey)
      ? installCodexCuratedSkill(installTarget)
      : installCodexMarketplacePlugin(installTarget)
  }

  return installClaudeMarketplacePlugin(installTarget)
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

async function rewriteJsonLinesFile(
  filePath: string,
  shouldKeepLine: (line: string, lineNumber: number) => boolean | Promise<boolean>
) {
  const tempPath = `${filePath}.${Date.now()}.tmp`
  const reader = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  const writer = createWriteStream(tempPath, { encoding: 'utf8' })

  try {
    let lineNumber = 0
    for await (const line of reader) {
      lineNumber += 1
      if (await shouldKeepLine(line, lineNumber)) {
        writer.write(`${line}\n`)
      }
    }

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => reject(error)
      writer.once('error', handleError)
      writer.end(() => {
        writer.off('error', handleError)
        resolve()
      })
    })
    await fs.rename(tempPath, filePath)
  } catch (error) {
    writer.destroy()
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    reader.close()
  }
}

async function pruneEmptyParentDirectories(startDirectory: string, stopDirectory: string) {
  let current = path.resolve(startDirectory)
  const boundary = path.resolve(stopDirectory)
  while (current.startsWith(boundary) && current !== boundary) {
    const entries = await fs.readdir(current).catch(() => [])
    if (entries.length > 0) {
      return
    }
    await fs.rmdir(current).catch(() => undefined)
    current = path.dirname(current)
  }
}

async function listCliSessionFiles(client: CliClient, sessionId: string) {
  if (client === 'codex') {
    const sessionRoot = path.join(os.homedir(), '.codex', 'sessions')
    return walkFiles(
      sessionRoot,
      (filePath) => filePath.endsWith('.jsonl') && filePath.includes(sessionId)
    )
  }

  const target = await getClaudeSessionFile(sessionId)
  return target ? [target] : []
}

function isMatchingCodexMessageLine(
  line: string,
  input: DesktopDeleteCliMessageRequest['message']
) {
  try {
    const parsed = JSON.parse(line) as {
      type?: string
      timestamp?: string
      payload?: {
        type?: string
        role?: string
        phase?: string
        content?: unknown
      }
    }

    if (parsed.type !== 'response_item' || parsed.payload?.type !== 'message') {
      return false
    }

    const role = parsed.payload.role
    if (role !== input.role) {
      return false
    }

    if (role === 'assistant' && parsed.payload.phase !== 'final_answer') {
      return false
    }

    if (role === 'user' && typeof parsed.payload.phase === 'string' && parsed.payload.phase !== 'input') {
      return false
    }

    const rawContent = contentPartsToText(parsed.payload.content)
    const content = role === 'user' ? sanitizeCliUserPrompt(rawContent) : rawContent
    return content === input.content && toEpochSeconds(parsed.timestamp) * 1000 === input.createdAt
  } catch {
    return false
  }
}

function isMatchingClaudeMessageLine(
  line: string,
  input: DesktopDeleteCliMessageRequest['message']
) {
  try {
    const parsed = JSON.parse(line) as {
      type?: string
      timestamp?: string
      message?: {
        role?: string
        content?: unknown
      }
      toolUseResult?: unknown
    }

    if (parsed.type !== 'user' && parsed.type !== 'assistant') {
      return false
    }

    const role = parsed.message?.role
    if (role !== input.role) {
      return false
    }

    if (role === 'user' && parsed.toolUseResult) {
      return false
    }
    if (role === 'user' && hasClaudeToolContent(parsed.message?.content)) {
      return false
    }
    if (shouldIgnoreClaudeContent(parsed.message?.content)) {
      return false
    }

    const rawContent = contentPartsToText(parsed.message?.content)
    const content = role === 'user' ? sanitizeCliUserPrompt(rawContent) : rawContent
    if (shouldIgnoreClaudeMessage(content)) {
      return false
    }

    return content === input.content && toEpochSeconds(parsed.timestamp) * 1000 === input.createdAt
  } catch {
    return false
  }
}

async function deleteCliHistoryEntry(input: DesktopDeleteCliMessageRequest['message'], client: CliClient, sessionId: string) {
  if (input.role !== 'user') {
    return
  }

  const historyFilePath =
    client === 'codex'
      ? path.join(os.homedir(), '.codex', 'history.jsonl')
      : path.join(os.homedir(), '.claude', 'history.jsonl')

  if (!(await pathExists(historyFilePath))) {
    return
  }

  let deleted = false
  await rewriteJsonLinesFile(historyFilePath, (line) => {
    if (deleted) {
      return true
    }

    try {
      const parsed = JSON.parse(line) as {
        session_id?: string
        text?: string
        ts?: number
        sessionId?: string
        display?: string
        timestamp?: number
      }

      if (client === 'codex') {
        const matches =
          parsed.session_id === sessionId &&
          sanitizeCliUserPrompt(parsed.text || '') === input.content &&
          Math.abs((Number(parsed.ts) || 0) * 1000 - input.createdAt) <= 1000

        if (matches) {
          deleted = true
          return false
        }
        return true
      }

      const matches =
        parsed.sessionId === sessionId &&
        sanitizeCliUserPrompt(parsed.display || '') === input.content &&
        Math.abs((Number(parsed.timestamp) || 0) - input.createdAt) <= 1000

      if (matches) {
        deleted = true
        return false
      }
      return true
    } catch {
      return true
    }
  })
}

async function deleteCliMessage(input: DesktopDeleteCliMessageRequest) {
  const filePath =
    input.message.sourceFilePath?.trim() ||
    (input.client === 'codex'
      ? await getLatestCodexSessionFile(input.sessionId)
      : await getClaudeSessionFile(input.sessionId))

  if (!filePath) {
    throw new Error('未找到对应的会话文件。')
  }

  const explicitLineNumber = Number(input.message.sourceLineNumber || 0)
  let deleted = false

  await rewriteJsonLinesFile(filePath, (line, lineNumber) => {
    if (explicitLineNumber > 0) {
      if (lineNumber === explicitLineNumber) {
        deleted = true
        return false
      }
      return true
    }

    if (deleted) {
      return true
    }

    const matches =
      input.client === 'codex'
        ? isMatchingCodexMessageLine(line, input.message)
        : isMatchingClaudeMessageLine(line, input.message)

    if (matches) {
      deleted = true
      return false
    }

    return true
  })

  if (!deleted) {
    throw new Error('未能在原始会话文件中定位这条消息。')
  }

  await deleteCliHistoryEntry(input.message, input.client, input.sessionId)
  return input.client === 'codex'
    ? getCodexSession(input.sessionId)
    : getClaudeSession(input.sessionId)
}

async function deleteCliSessionHistoryEntries(client: CliClient, sessionId: string) {
  const historyFilePath =
    client === 'codex'
      ? path.join(os.homedir(), '.codex', 'history.jsonl')
      : path.join(os.homedir(), '.claude', 'history.jsonl')

  if (!(await pathExists(historyFilePath))) {
    return
  }

  await rewriteJsonLinesFile(historyFilePath, (line) => {
    try {
      const parsed = JSON.parse(line) as {
        session_id?: string
        sessionId?: string
      }
      return client === 'codex'
        ? parsed.session_id !== sessionId
        : parsed.sessionId !== sessionId
    } catch {
      return true
    }
  })
}

async function deleteCliSessions(input: DesktopDeleteCliSessionsRequest) {
  const deletedSessionIds: string[] = []

  for (const sessionId of [...new Set(input.sessionIds.map((item) => item.trim()).filter(Boolean))]) {
    const sessionFiles = await listCliSessionFiles(input.client, sessionId)
    await Promise.all(
      sessionFiles.map(async (filePath) => {
        await fs.rm(filePath, { force: true }).catch(() => undefined)
        await pruneEmptyParentDirectories(path.dirname(filePath), input.client === 'codex'
          ? path.join(os.homedir(), '.codex', 'sessions')
          : path.join(os.homedir(), '.claude', 'projects'))
      })
    )
    await deleteCliSessionHistoryEntries(input.client, sessionId)
    deletedSessionIds.push(sessionId)
  }

  return {
    deletedCount: deletedSessionIds.length,
    deletedSessionIds,
  }
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

function sanitizeCliUserPrompt(raw: string) {
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ''
  }

  const policyMarker = '执行策略：'
  const taskMarker = '用户任务：'
  let next = normalized

  if (next.startsWith(policyMarker) && next.includes(taskMarker)) {
    next = next.slice(next.indexOf(taskMarker) + taskMarker.length).trim()
  }

  const attachmentIndex = next.indexOf('附件引用：')
  if (attachmentIndex >= 0) {
    next = next.slice(0, attachmentIndex).trim()
  }

  return next.trim()
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

function summarizeCliFailure(rawText: string, stderrText: string): CliRuntimeDiagnostics {
  const combined = `${rawText}\n${stderrText}`.trim()
  const networkIssue =
    /stream disconnected before completion/i.test(combined) ||
    /error sending request for url/i.test(combined) ||
    /reconnecting\.\.\./i.test(combined) ||
    /timed out/i.test(combined) ||
    /tls/i.test(combined) ||
    /certificate/i.test(combined) ||
    /dns/i.test(combined) ||
    /econnrefused/i.test(combined) ||
    /econnreset/i.test(combined)
  const sessionIssue =
    /failed to record rollout items/i.test(combined) ||
    /thread .* not found/i.test(combined) ||
    /session .* not found/i.test(combined)
  const authIssue =
    /authentication failed/i.test(combined) ||
    /request not allowed/i.test(combined) ||
    /forbidden/i.test(combined) ||
    /unauthorized/i.test(combined) ||
    /401/i.test(combined) ||
    /403/i.test(combined)
  const configIssue =
    /expected value at line/i.test(combined) ||
    /failed to parse/i.test(combined) ||
    /invalid toml/i.test(combined) ||
    (/json/i.test(combined) && /parse/i.test(combined))

  let probableCause = ''
  if (networkIssue) {
    probableCause = '网络 / 代理 / TLS / 反向代理流式转发异常'
  } else if (sessionIssue) {
    probableCause = '本地会话状态目录异常，或会话落盘未完成'
  } else if (authIssue) {
    probableCause = 'Key 或上游鉴权不通过'
  } else if (configIssue) {
    probableCause = '本地配置文件格式无效'
  }

  return {
    networkIssue,
    sessionIssue,
    authIssue,
    configIssue,
    probableCause,
  }
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
        if (role === 'assistant' && parsed.payload.phase !== 'final_answer') {
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
          preview: normalizeWhitespace(sanitizeCliUserPrompt(parsed.text)),
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

  for (const [sessionId, projectPath] of sessionMap.entries()) {
    if (grouped.has(sessionId)) {
      continue
    }

    const details = await getCodexSession(sessionId)
    if (!details?.messages.length) {
      continue
    }

    const lastUser = [...details.messages].reverse().find((item) => item.role === 'user')
    const preview = normalizeWhitespace(lastUser?.content || details.preview || '')
    grouped.set(sessionId, {
      id: sessionId,
      title: path.basename(projectPath || '') || `Codex 会话 ${sessionId.slice(0, 8)}`,
      preview,
      updatedAt: details.updatedAt,
      projectName: path.basename(projectPath || '') || details.projectName || '未命名项目',
      projectPath: projectPath || details.projectPath,
    })
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
      sourceFilePath: filePath,
      fileChanges: message.role === 'assistant' ? parsedSession.fileChanges : undefined,
    })),
    fileChanges: parsedSession.fileChanges,
    plan: parsedSession.plan,
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
    (filePath) => filePath.endsWith('.jsonl')
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
    .slice(0, 60)

  for (const file of recentFiles) {
    const sessionId = path.basename(file.filePath, '.jsonl')
    if (grouped.has(sessionId)) {
      continue
    }
    const details = await getClaudeSession(sessionId)
    if (!details?.messages.length) {
      continue
    }
    const lastUser = [...details.messages].reverse().find((item) => item.role === 'user')
    const preview = normalizeWhitespace(lastUser?.content || details.preview || '')
    grouped.set(sessionId, {
      id: sessionId,
      title: details.projectName || `Claude 会话 ${sessionId.slice(0, 8)}`,
      preview,
      updatedAt: details.updatedAt,
      projectName: details.projectName || '未命名项目',
      projectPath: details.projectPath,
    })
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
      sourceFilePath: filePath,
      fileChanges: message.role === 'assistant' ? parsedSession.fileChanges : undefined,
    })),
    fileChanges: parsedSession.fileChanges,
    plan: parsedSession.plan,
  }
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForCliSession(client: CliClient, sessionId?: string) {
  if (!sessionId) {
    return null
  }

  for (let index = 0; index < 40; index += 1) {
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
      input: {
        kind: CliProgressPayload['kind']
        message: string
        sessionId?: string
        done?: boolean
        files?: CliFileChange[]
        logKind?: CliLogKind
        sourceKind?: string
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
      }
    ) {
      const trimmed = input.message.trim()
      if (!trimmed) {
        return
      }

      webContents.send('desktop:cli-progress', {
        client,
        requestId,
        sessionId: input.sessionId,
        kind: input.kind,
        logKind: input.logKind,
        sourceKind: input.sourceKind,
        message: trimmed,
        createdAt: Date.now(),
        done: input.done,
        files: input.files,
        detail: input.detail,
        command: input.command,
        exitCode: input.exitCode,
        plan: input.plan,
      } satisfies CliProgressPayload)
    },
    status(
      message: string,
      sessionId?: string,
      done = false,
      files?: CliFileChange[],
      options: {
        logKind?: CliLogKind
        sourceKind?: string
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
      } = {}
    ) {
      this.send({ kind: 'status', message, sessionId, done, files, ...options })
    },
    error(
      message: string,
      sessionId?: string,
      done = false,
      files?: CliFileChange[],
      options: {
        logKind?: CliLogKind
        sourceKind?: string
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
      } = {}
    ) {
      this.send({
        kind: 'error',
        message,
        sessionId,
        done,
        files,
        logKind: options.logKind || 'error',
        sourceKind: options.sourceKind,
        detail: options.detail,
        command: options.command,
        exitCode: options.exitCode,
        plan: options.plan,
      })
    },
    partial(message: string, sessionId?: string, done = false, plan?: CliPlanState | null) {
      if (!message || message === lastPartial) {
        return
      }
      lastPartial = message
      this.send({ kind: 'partial', message, sessionId, done, plan })
    },
    intent(message: string, sessionId?: string, detail?: string, files?: CliFileChange[], sourceKind?: string) {
      this.status(message, sessionId, false, files, { logKind: 'intent', detail, sourceKind })
    },
    tool(message: string, sessionId?: string, detail?: string, files?: CliFileChange[], sourceKind?: string) {
      this.status(message, sessionId, false, files, { logKind: 'tool', detail, sourceKind })
    },
    command(message: string, command: string, sessionId?: string, detail?: string, files?: CliFileChange[], sourceKind?: string) {
      this.status(message, sessionId, false, files, { logKind: 'command', command, detail, sourceKind })
    },
    stdout(message: string, sessionId?: string, detail?: string, sourceKind?: string) {
      this.status(message, sessionId, false, undefined, { logKind: 'stdout', detail, sourceKind })
    },
    stderr(message: string, sessionId?: string, detail?: string, sourceKind?: string) {
      this.error(message, sessionId, false, undefined, { logKind: 'stderr', detail, sourceKind })
    },
    result(message: string, sessionId?: string, exitCode?: number, detail?: string, files?: CliFileChange[], sourceKind?: string) {
      this.status(message, sessionId, false, files, { logKind: 'result', exitCode, detail, sourceKind })
    },
    plan(message: string, plan: CliPlanState | null, sessionId?: string, sourceKind = 'plan.update') {
      this.status(message, sessionId, false, undefined, { logKind: 'status', sourceKind, plan })
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

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractCommandFromUnknown(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  const source = value as Record<string, unknown>
  const candidates = ['command', 'cmd', 'shell_command', 'script', 'raw_command']
  for (const key of candidates) {
    if (typeof source[key] === 'string' && source[key]?.trim()) {
      return source[key].trim()
    }
  }

  return ''
}

function extractCliFilesFromUnknown(value: unknown): CliFileChange[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const source = value as Record<string, unknown>
  const candidates = ['path', 'filePath', 'target_file', 'file', 'target']
  for (const key of candidates) {
    const raw = source[key]
    if (typeof raw === 'string' && raw.trim()) {
      return [{
        path: raw.trim(),
        kind: 'unknown',
      }]
    }
  }

  return []
}

function describeCliToolUse(name: string, input: unknown) {
  const command = extractCommandFromUnknown(input)
  const files = extractCliFilesFromUnknown(input)
  const detail = input && typeof input === 'object' ? safeStringify(input) : ''
  return {
    message: name ? `正在执行 ${name}` : '正在执行工具调用',
    command,
    detail,
    files,
  }
}

function extractToolUseEntries(content: unknown) {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') {
      return []
    }

    const typedPart = part as {
      type?: string
      name?: string
      input?: unknown
    }

    if (typedPart.type !== 'tool_use') {
      return []
    }

    return [{
      name: typedPart.name?.trim() || '',
      input: typedPart.input,
    }]
  })
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
  const args = ['exec']

  if (input.fullAccess) {
    args.push('--sandbox', 'danger-full-access', '--dangerously-bypass-approvals-and-sandbox')
  }

  if (input.sessionId) {
    args.push('resume', '--json', '--skip-git-repo-check', input.sessionId, '-')
  } else {
    args.push('--json', '-C', input.projectPath, '--skip-git-repo-check', '-')
  }

  if (input.model?.trim()) {
    args.splice(args.length - 1, 0, '--model', input.model.trim())
  }

  args.splice(
    args.length - 1,
    0,
    '--config',
    `model_reasoning_effort="${parseCodexReasoningEffort(input.reasoningEffort)}"`
  )

  const progress = createCliProgressEmitter(webContents, 'codex', input.requestId)
  let sessionId = input.sessionId
  let partialText = ''
  let planState: CliPlanState | null = null
  const runtimeDiagnostics: CliRuntimeDiagnostics = {}
  const executablePath = await locateExecutable('codex')
  const managedRuntime = await readManagedNodeRuntime()
  const spawnCommand = resolveCliSpawnCommand('codex', executablePath)

  progress.intent('Codex 已开始处理当前任务。', sessionId, undefined, undefined, 'request.started')

  const result = await spawnCommandWithHandlers(spawnCommand, args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    env: managedRuntime ? buildRuntimeEnv(managedRuntime) : undefined,
    stdinData: input.prompt,
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
        progress.intent('已连接到 Codex 会话。', sessionId, 'thread.started', undefined, 'thread.started')
        return
      }

      if (parsed.type === 'turn.started') {
        progress.intent('Codex 正在分析项目并准备执行。', sessionId, 'turn.started', undefined, 'turn.started')
        return
      }

      const payload =
        typeof parsed.payload === 'object' && parsed.payload
          ? parsed.payload as Record<string, unknown>
          : null

      const nextPlanState = parseCodexPlanStateFromRecord(parsed)
      if (nextPlanState) {
        planState = nextPlanState
        progress.plan(`计划已更新，共 ${nextPlanState.items.length} 项。`, planState, sessionId, 'plan.update_plan')
      }

      const streamedAssistantText = extractCodexAssistantTextFromEvent(parsed)
      if (streamedAssistantText) {
        partialText = streamedAssistantText
        progress.partial(partialText, sessionId, false, planState)
      }

      if (parsed.type === 'response_item' && payload?.type === 'message' && payload.role === 'assistant') {
        const assistantText = contentPartsToText(payload.content)
        if (assistantText.trim() && !shouldIgnoreCodexMessage(assistantText)) {
          partialText = assistantText
          progress.partial(partialText, sessionId, false, planState)
        }
      }

      const contentCandidates = [
        payload?.content,
        typeof payload?.message === 'object' && payload.message
          ? (payload.message as { content?: unknown }).content
          : undefined,
      ]

      for (const candidate of contentCandidates) {
        const toolEntries = extractToolUseEntries(candidate)
        for (const toolEntry of toolEntries) {
          const described = describeCliToolUse(toolEntry.name, toolEntry.input)
          const sourceKind = toolEntry.name?.trim() ? `tool_use.${toolEntry.name.trim()}` : 'tool_use'
          if (described.command) {
            progress.command(described.message, described.command, sessionId, described.detail, described.files, sourceKind)
          } else {
            progress.tool(described.message, sessionId, described.detail, described.files, sourceKind)
          }
        }
      }

      const lineFileChanges = extractCodexFileChanges([line])
      if (lineFileChanges.length > 0) {
        progress.result('已记录文件变更', sessionId, undefined, typeof parsed.type === 'string' ? parsed.type : '', lineFileChanges, typeof parsed.type === 'string' ? parsed.type : 'file_change')
        return
      }

      if (parsed.type === 'error' && typeof parsed.message === 'string') {
        progress.error(parsed.message, sessionId, false, undefined, { logKind: 'error', sourceKind: typeof parsed.type === 'string' ? parsed.type : 'error', detail: typeof parsed.type === 'string' ? parsed.type : '' })
      }
    },
    onStderrLine: (line) => {
      if (line.toLowerCase().includes('warn')) {
        progress.stderr('Codex 输出了警告信息', sessionId, line, 'stderr.warn')
        return
      }

      progress.stderr('Codex 输出了错误信息', sessionId, line, 'stderr')
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
  runtimeDiagnostics.sessionFileFound = !!session
  runtimeDiagnostics.sessionReadAttempts = 40
  const sessionOutput = session?.messages.filter((item) => item.role === 'assistant').at(-1)?.content ?? ''
  const output = sessionOutput || partialText.trim()
  Object.assign(runtimeDiagnostics, summarizeCliFailure(result.stdout, result.stderr))
  if (!session && output) {
    runtimeDiagnostics.sessionIssue = true
    runtimeDiagnostics.probableCause =
      runtimeDiagnostics.probableCause || 'CLI 已返回内容，但本地会话文件未能在等待窗口内落盘'
  }
  const success = !aborted && result.exitCode === 0 && output.length > 0

  if (success) {
    progress.partial(output, sessionId, true)
    progress.result('Codex 已完成本次回复。', sessionId, result.exitCode, output, fileChanges, 'turn.completed')
    progress.status('Codex 已完成本次回复。', sessionId, true, fileChanges, { logKind: 'status', sourceKind: 'turn.completed', plan: planState })
    if (!session) {
      progress.status(
        'Codex 已返回结果，但本地会话记录未及时落盘；最近会话可能暂时不可见。',
        sessionId,
        false,
        undefined,
        {
          logKind: 'status',
          sourceKind: 'session.persistence.warning',
          detail: runtimeDiagnostics.probableCause || '',
        }
      )
    }
  } else if (aborted) {
    progress.status('Codex 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
  } else if (result.stderr.trim()) {
    progress.error('Codex 执行失败', sessionId, true, fileChanges, {
      logKind: 'error',
      sourceKind: 'request.failed',
      detail: [result.stderr.trim(), runtimeDiagnostics.probableCause ? `推断原因：${runtimeDiagnostics.probableCause}` : ''].filter(Boolean).join('\n'),
      exitCode: result.exitCode,
      plan: planState,
    })
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
      plan: planState,
      diagnostics: runtimeDiagnostics,
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

  const progress = createCliProgressEmitter(webContents, 'claude', input.requestId)
  let sessionId = input.sessionId
  let partialText = ''
  let finalResult: Record<string, unknown> | null = null
  let planState: CliPlanState | null = null
  const planRecords: Array<Record<string, unknown>> = []
  const runtimeDiagnostics: CliRuntimeDiagnostics = {}
  const executablePath = await locateExecutable('claude')
  const managedRuntime = await readManagedNodeRuntime()
  const claudeSettings = await readResolvedClaudeSettingsDocument().catch(() => null)
  const spawnCommand = resolveCliSpawnCommand('claude', executablePath)

  progress.intent('Claude 已开始处理当前任务。', sessionId, undefined, undefined, 'request.started')

  const result = await spawnCommandWithHandlers(spawnCommand, args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    env: buildClaudeCliEnv(managedRuntime, claudeSettings),
    stdinData: input.prompt,
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
        progress.intent('已连接到 Claude 会话。', sessionId, 'session.connected', undefined, 'session.connected')
      }

      const planMutation = parseClaudePlanMutationFromRecord(parsed)
      if (planMutation) {
        planRecords.push(parsed)
        planState = buildClaudePlanStateFromRecords(planRecords)
        if (planState) {
          progress.plan(`计划已更新，共 ${planState.items.length} 项。`, planState, sessionId, 'plan.task_update')
        }
      }

      if (parsed.type === 'system') {
        if (parsed.subtype === 'init') {
          progress.intent('Claude 会话初始化完成。', sessionId, 'system.init', undefined, 'system.init')
          return
        }

        if (parsed.subtype === 'hook_started' && typeof parsed.hook_name === 'string') {
          progress.tool(`正在执行 ${parsed.hook_name}`, sessionId, safeStringify(parsed), undefined, `system.hook_started.${parsed.hook_name}`)
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
          const toolEntry = extractToolUseEntries(parsedMessage?.content)[0]
          const described = describeCliToolUse(toolName, toolEntry?.input)
          const sourceKind = `assistant.tool_use.${toolName}`
          if (described.command) {
            progress.command(described.message, described.command, sessionId, described.detail, described.files, sourceKind)
          } else {
            progress.tool(described.message, sessionId, described.detail, described.files, sourceKind)
          }
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
            const described = describeCliToolUse(block.name, block.input)
            const sourceKind = `stream.tool_use.${block.name}`
            if (described.command) {
              progress.command(described.message, described.command, sessionId, described.detail, described.files, sourceKind)
            } else {
              progress.tool(described.message, sessionId, described.detail, described.files, sourceKind)
            }
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
            progress.partial(partialText, sessionId, false, planState)
          }
        }
        return
      }

      if (parsed.type === 'result') {
        finalResult = parsed
      }
    },
    onStderrLine: (line) => {
      progress.stderr('Claude 输出了错误信息', sessionId, line, 'stderr')
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
  runtimeDiagnostics.sessionFileFound = !!session
  runtimeDiagnostics.sessionReadAttempts = 40
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
  Object.assign(runtimeDiagnostics, summarizeCliFailure(result.stdout, result.stderr))
  if (!session && output) {
    runtimeDiagnostics.sessionIssue = true
    runtimeDiagnostics.probableCause =
      runtimeDiagnostics.probableCause || 'CLI 已返回内容，但本地会话文件未能在等待窗口内落盘'
  }
  const success = !aborted && result.exitCode === 0 && output.length > 0

  if (success) {
    progress.partial(output, sessionId, true)
    progress.result('Claude 已完成本次回复。', sessionId, result.exitCode, output, fileChanges, 'result')
    progress.status('Claude 已完成本次回复。', sessionId, true, fileChanges, { logKind: 'status', sourceKind: 'result', plan: planState })
    if (!session) {
      progress.status(
        'Claude 已返回结果，但本地会话记录未及时落盘；最近会话可能暂时不可见。',
        sessionId,
        false,
        undefined,
        {
          logKind: 'status',
          sourceKind: 'session.persistence.warning',
          detail: runtimeDiagnostics.probableCause || '',
        }
      )
    }
  } else if (aborted) {
    progress.status('Claude 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
  } else if (result.stderr.trim()) {
    progress.error('Claude 执行失败', sessionId, true, fileChanges, {
      logKind: 'error',
      sourceKind: 'request.failed',
      detail: [result.stderr.trim(), runtimeDiagnostics.probableCause ? `推断原因：${runtimeDiagnostics.probableCause}` : ''].filter(Boolean).join('\n'),
      exitCode: result.exitCode,
      plan: planState,
    })
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
      plan: planState,
      diagnostics: runtimeDiagnostics,
    },
  }
}

async function writeCodexConfig(request: CliDeployRequest) {
  const targetPath = cliConfig.codex.configPath
  await fs.mkdir(cliConfig.codex.dataPath, { recursive: true })
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
      normalizeCodexBaseUrl(request.baseUrl)
    ),
    'utf8'
  )

  const authPath = path.join(cliConfig.codex.dataPath, 'auth.json')
  const authRaw = (await pathExists(authPath)) ? await fs.readFile(authPath, 'utf8') : ''
  let currentAuth: Record<string, unknown> = {}
  if (authRaw.trim()) {
    try {
      currentAuth = JSON.parse(authRaw) as Record<string, unknown>
    } catch {
      await backupIfNeeded(authPath)
    }
  }
  await fs.writeFile(
    authPath,
    JSON.stringify(
      {
        ...currentAuth,
        auth_mode: 'apikey',
        OPENAI_API_KEY: resolveDesktopCliKeyRecord(request.apiKey),
      },
      null,
      2
    ),
    'utf8'
  )
}

async function writeClaudeConfig(request: CliDeployRequest) {
  const targetPath = cliConfig.claude.configPath
  const authPath = path.join(cliConfig.claude.dataPath, 'auth.json')
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

  const resolvedApiKey = resolveDesktopCliKeyRecord(request.apiKey)
  const resolvedBaseUrl = normalizeClaudeBaseUrl(request.baseUrl)
  const resolvedModel = request.model?.trim() || DEFAULT_CLAUDE_MODEL

  const env = {
    ...currentEnv,
    ANTHROPIC_AUTH_TOKEN: resolvedApiKey,
    ANTHROPIC_API_KEY: resolvedApiKey,
    ANTHROPIC_BASE_URL: resolvedBaseUrl,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    API_TIMEOUT_MS: '600000',
    ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN:
      typeof currentEnv.ANTHROPIC_AUTH_TOKEN === 'string'
        ? currentEnv.ANTHROPIC_AUTH_TOKEN
        : typeof currentEnv.ANTHROPIC_API_KEY === 'string'
          ? currentEnv.ANTHROPIC_API_KEY
          : undefined,
    ONEAPI_ORIGINAL_ANTHROPIC_API_KEY:
      typeof currentEnv.ANTHROPIC_API_KEY === 'string' ? currentEnv.ANTHROPIC_API_KEY : undefined,
    ONEAPI_ORIGINAL_ANTHROPIC_BASE_URL:
      typeof currentEnv.ANTHROPIC_BASE_URL === 'string' ? currentEnv.ANTHROPIC_BASE_URL : undefined,
  }

  const nextConfig = {
    ...current,
    env,
    model: resolvedModel,
    permissions:
      typeof current.permissions === 'object' && current.permissions
        ? current.permissions
        : { allow: [], deny: [] },
  }

  await fs.writeFile(targetPath, JSON.stringify(nextConfig, null, 2), 'utf8')
  await fs.writeFile(
    authPath,
    JSON.stringify(
      {
        auth_mode: 'apikey',
        ANTHROPIC_API_KEY: resolvedApiKey,
        ANTHROPIC_AUTH_TOKEN: resolvedApiKey,
        ANTHROPIC_BASE_URL: resolvedBaseUrl,
        model: resolvedModel,
      },
      null,
      2
    ),
    'utf8'
  )

  const written = await readResolvedClaudeSettingsDocument(targetPath)
  const writtenKey = resolveDesktopCliKeyRecord(pickClaudeApiKey(written.env))
  const writtenBaseUrl = normalizeClaudeBaseUrl(written.env?.ANTHROPIC_BASE_URL)
  const writtenModel = written.model?.trim() || DEFAULT_CLAUDE_MODEL
  if (
    writtenKey !== resolvedApiKey ||
    writtenBaseUrl !== resolvedBaseUrl ||
    writtenModel !== resolvedModel
  ) {
    throw new Error('Claude 配置写入后校验失败。')
  }
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
  webContents.send('desktop:deploy-progress', {
    ...payload,
    createdAt: payload.createdAt || Date.now(),
    detail: maskSensitiveText(payload.detail),
    command: maskSensitiveText(payload.command),
  })
}

function createDeployLogger(
  webContents: WebContents,
  jobId: string,
  client: CliClient
) {
  return {
    emit(
      step: DeployProgressPayload['step'],
      status: DeployStatus,
      message: string,
      options: {
        kind?: DeployProgressPayload['kind']
        detail?: string
        command?: string
        exitCode?: number
      } = {}
    ) {
      sendDeployProgress(webContents, {
        jobId,
        client,
        step,
        status,
        message,
        createdAt: Date.now(),
        ...options,
      })
    },
    info(
      step: DeployProgressPayload['step'],
      status: DeployStatus,
      message: string,
      detail?: string
    ) {
      this.emit(step, status, message, { kind: 'info', detail })
    },
    command(
      step: DeployProgressPayload['step'],
      command: string,
      args: string[],
      cwd?: string
    ) {
      const rendered = [command, ...args].join(' ')
      this.emit(step, 'running', '执行命令', {
        kind: 'command',
        command: cwd ? `${rendered}\n[cwd] ${cwd}` : rendered,
      })
    },
    stdout(step: DeployProgressPayload['step'], line: string) {
      this.emit(step, 'running', 'stdout', {
        kind: 'stdout',
        detail: line,
      })
    },
    stderr(step: DeployProgressPayload['step'], line: string) {
      this.emit(step, 'running', 'stderr', {
        kind: 'stderr',
        detail: line,
      })
    },
    result(
      step: DeployProgressPayload['step'],
      exitCode: number,
      stdout: string,
      stderr: string
    ) {
      const detailParts = [
        stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
        stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
      ].filter(Boolean)

      this.emit(step, exitCode === 0 ? 'success' : 'error', exitCode === 0 ? '命令执行完成' : '命令执行失败', {
        kind: 'result',
        exitCode,
        detail: detailParts.join('\n\n'),
      })
    },
  }
}

async function runLoggedCommand(
  logger: ReturnType<typeof createDeployLogger>,
  step: DeployProgressPayload['step'],
  command: string,
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    stdinData?: string
  } = {}
) {
  logger.command(step, command, args, options.cwd)
  const result = await spawnCommandWithHandlers(command, args, {
    ...options,
    onStdoutLine: (line) => logger.stdout(step, line),
    onStderrLine: (line) => logger.stderr(step, line),
  })
  logger.result(step, result.exitCode, result.stdout, result.stderr)
  return result
}

async function verifyDirectoryWritable(targetPath: string) {
  try {
    await fs.mkdir(targetPath, { recursive: true })
    const probePath = path.join(targetPath, `.oneapi-write-test-${Date.now()}.tmp`)
    await fs.writeFile(probePath, 'ok', 'utf8')
    await fs.rm(probePath, { force: true })
    return {
      ok: true,
      detail: targetPath,
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readResponseTextSafely(response: Response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function diagnoseCodexEnvironment(
  logger: ReturnType<typeof createDeployLogger>,
  request: CliDeployRequest
) {
  const resolvedBaseUrl = normalizeCodexBaseUrl(request.baseUrl)
  const resolvedKey = resolveDesktopCliKeyRecord(request.apiKey)

  logger.info('diagnose', 'running', '开始检查 Codex 配置文件与数据目录')

  const writable = await verifyDirectoryWritable(cliConfig.codex.dataPath)
  logger.info(
    'diagnose',
    writable.ok ? 'success' : 'error',
    writable.ok ? 'Codex 数据目录可写' : 'Codex 数据目录不可写',
    writable.detail
  )

  try {
    const current = await readCurrentCodexConfig()
    const configMatches =
      current.baseUrl === resolvedBaseUrl &&
      resolveDesktopCliKeyRecord(current.apiKey) === resolvedKey
    logger.info(
      'diagnose',
      configMatches ? 'success' : 'error',
      configMatches ? 'Codex config.toml 校验通过' : 'Codex config.toml 与预期不一致',
      `baseUrl=${current.baseUrl}\nmodel=${current.model}\nproviderKeyMatched=${configMatches ? 'yes' : 'no'}`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex config.toml 读取或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }

  try {
    const authPath = path.join(cliConfig.codex.dataPath, 'auth.json')
    const raw = await fs.readFile(authPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const authKey =
      typeof parsed.OPENAI_API_KEY === 'string' ? resolveDesktopCliKeyRecord(parsed.OPENAI_API_KEY) : ''
    logger.info(
      'diagnose',
      authKey === resolvedKey ? 'success' : 'error',
      authKey === resolvedKey ? 'Codex auth.json 校验通过' : 'Codex auth.json 与预期不一致',
      authPath
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex auth.json 缺失或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }

  const modelsUrl = `${resolvedBaseUrl}/models`
  try {
    logger.info('diagnose', 'running', '开始检查 Codex 基础连通性', modelsUrl)
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
      },
    })
    const text = await readResponseTextSafely(response)
    logger.info(
      'diagnose',
      response.ok ? 'success' : 'error',
      response.ok ? 'Codex /models 连通性正常' : 'Codex /models 连通性失败',
      `status=${response.status}\n${text.slice(0, 500)}`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex /models 连通性异常',
      error instanceof Error ? error.message : String(error)
    )
  }

  const responsesUrl = `${resolvedBaseUrl}/responses`
  try {
    logger.info('diagnose', 'running', '开始检查 Codex /responses 流式响应', responsesUrl)
    const response = await fetch(responsesUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model?.trim() || DEFAULT_CODEX_MODEL,
        input: 'hello',
        max_output_tokens: 16,
        stream: true,
      }),
    })

    if (!response.ok) {
      const text = await readResponseTextSafely(response)
      logger.info(
        'diagnose',
        'error',
        'Codex /responses 流式请求失败',
        `status=${response.status}\n${text.slice(0, 500)}`
      )
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      logger.info('diagnose', 'error', 'Codex /responses 未返回可读流')
      return
    }

    const firstChunk = await reader.read()
    await reader.cancel().catch(() => undefined)
    if (firstChunk.done || !firstChunk.value?.length) {
      logger.info('diagnose', 'error', 'Codex /responses 流式连接建立成功，但没有收到任何数据块')
      return
    }

    logger.info(
      'diagnose',
      'success',
      'Codex /responses 流式响应正常',
      `首个数据块大小：${firstChunk.value.length} bytes`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex /responses 流式响应异常',
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function diagnoseClaudeEnvironment(
  logger: ReturnType<typeof createDeployLogger>,
  request: CliDeployRequest
) {
  const resolvedBaseUrl = normalizeClaudeBaseUrl(request.baseUrl)
  const resolvedKey = resolveDesktopCliKeyRecord(request.apiKey)

  logger.info('diagnose', 'running', '开始检查 Claude 配置文件与数据目录')

  const writable = await verifyDirectoryWritable(cliConfig.claude.dataPath)
  logger.info(
    'diagnose',
    writable.ok ? 'success' : 'error',
    writable.ok ? 'Claude 数据目录可写' : 'Claude 数据目录不可写',
    writable.detail
  )

  try {
    const current = await readCurrentClaudeConfig()
    const configMatches =
      current.baseUrl === resolvedBaseUrl &&
      resolveDesktopCliKeyRecord(current.apiKey) === resolvedKey
    logger.info(
      'diagnose',
      configMatches ? 'success' : 'error',
      configMatches ? 'Claude settings.json 校验通过' : 'Claude settings.json 与预期不一致',
      `baseUrl=${current.baseUrl}\nmodel=${current.model}\nproviderKeyMatched=${configMatches ? 'yes' : 'no'}`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Claude settings.json 读取或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }

  try {
    const parsed = await readClaudeAuthDocument()
    const authKey = resolveDesktopCliKeyRecord(pickClaudeApiKeyFromUnknown(parsed))
    logger.info(
      'diagnose',
      authKey === resolvedKey ? 'success' : 'error',
      authKey === resolvedKey ? 'Claude auth.json 校验通过' : 'Claude auth.json 与预期不一致',
      path.join(cliConfig.claude.dataPath, 'auth.json')
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Claude auth.json 缺失或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function buildNodeDownloadUrl(version: string) {
  const normalizedVersion = version.startsWith('v') ? version : `v${version}`

  if (process.platform === 'win32') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return `${NODEJS_MIRROR_BASE_URL}/${normalizedVersion}/node-${normalizedVersion}-win-${arch}.zip`
  }

  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return `${NODEJS_MIRROR_BASE_URL}/${normalizedVersion}/node-${normalizedVersion}-darwin-${arch}.tar.gz`
  }

  throw new Error(`当前平台暂未实现 Node.js 自动安装：${process.platform}`)
}

async function resolveLatestLtsNodeVersion() {
  const response = await fetch(`${NODEJS_MIRROR_BASE_URL}/index.json`)
  if (!response.ok) {
    throw new Error(`获取 Node.js 版本列表失败：${response.status}`)
  }

  const versions = (await response.json()) as Array<{
    version?: string
    lts?: string | false
  }>

  const latestLts = versions.find((item) => typeof item.lts === 'string' && item.version)
  if (!latestLts?.version) {
    throw new Error('未找到可用的 Node.js LTS 版本')
  }

  return latestLts.version
}

async function installManagedNodeRuntime(
  logger: ReturnType<typeof createDeployLogger>
) {
  const version = await resolveLatestLtsNodeVersion()
  const archiveUrl = buildNodeDownloadUrl(version)
  const downloadDir = path.join(getToolchainRoot(), 'downloads')
  const archiveName = path.basename(new URL(archiveUrl).pathname)
  const archivePath = path.join(downloadDir, archiveName)
  const extractRoot = getManagedNodeRoot()

  await fs.mkdir(downloadDir, { recursive: true })
  await clearDirectory(extractRoot)

  logger.info('node', 'running', `准备下载 Node.js ${version}`, archiveUrl)
  const response = await fetch(archiveUrl)
  if (!response.ok) {
    throw new Error(`下载 Node.js 失败：${response.status}`)
  }
  const archiveBuffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(archivePath, archiveBuffer)
  logger.info('node', 'success', `Node.js 安装包下载完成`, `${archivePath}\n${archiveBuffer.length} bytes`)

  if (process.platform === 'win32') {
    const extractCommand = 'powershell.exe'
    const extractArgs = [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
    ]
    const extractResult = await runLoggedCommand(logger, 'node', extractCommand, extractArgs, {
      timeoutMs: 10 * 60 * 1000,
    })
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || extractResult.stdout || '解压 Node.js 安装包失败')
    }
    await flattenSingleNestedDirectory(extractRoot, logger)
  } else {
    const extractResult = await runLoggedCommand(
      logger,
      'node',
      'tar',
      ['-xzf', archivePath, '-C', extractRoot, '--strip-components=1'],
      {
        timeoutMs: 10 * 60 * 1000,
      }
    )
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr || extractResult.stdout || '解压 Node.js 安装包失败')
    }
  }

  const managedNodePath = await firstExistingPath(getManagedNodeExecutableCandidates())
  const managedNpmPath = await firstExistingPath(getManagedNpmExecutableCandidates())
  const managedNpmCliPath = managedNodePath ? await resolveNpmCliScriptPath(managedNodePath) : ''
  if (!managedNodePath || !managedNpmPath) {
    const extractLayout = await describeDirectoryEntries(extractRoot)
    throw new Error(`Node.js 安装完成，但未找到 node/npm 可执行文件\n${extractLayout}`)
  }

  const runtime: NodeRuntimeInfo = {
    source: 'managed',
    nodePath: managedNodePath,
    npmPath: managedNpmPath,
    npmCliPath: managedNpmCliPath,
    version,
    prefixPath: getManagedNpmPrefix(),
  }

  const nodeVersionResult = await runLoggedCommand(logger, 'node', managedNodePath, ['--version'], {
    timeoutMs: 15000,
  })
  const npmVersionResult = await runLoggedNpmCommand(logger, 'node', runtime, ['--version'], {
    timeoutMs: 15000,
  })
  if (nodeVersionResult.exitCode !== 0 || npmVersionResult.exitCode !== 0) {
    throw new Error(
      `Node.js 安装后校验失败\nnode:\n${nodeVersionResult.stderr || nodeVersionResult.stdout}\n\nnpm:\n${npmVersionResult.stderr || npmVersionResult.stdout}`
    )
  }

  return runtime
}

async function ensureNodeRuntime(
  logger: ReturnType<typeof createDeployLogger>
): Promise<NodeRuntimeInfo> {
  const systemNodePath = await locateSystemExecutable('node')
  const systemNpmPath = await locateSystemExecutable(getNpmCommand())
  if (systemNodePath && systemNpmPath) {
    const systemRuntime: NodeRuntimeInfo = {
      source: 'system',
      nodePath: systemNodePath,
      npmPath: systemNpmPath,
      npmCliPath: await resolveNpmCliScriptPath(systemNodePath),
      version: '',
      prefixPath: getManagedNpmPrefix(),
    }
    const versionResult = await runLoggedCommand(logger, 'node', systemNodePath, ['--version'])
    const npmVersionResult = await runLoggedNpmCommand(logger, 'node', systemRuntime, ['--version'])
    if (versionResult.exitCode === 0 && npmVersionResult.exitCode === 0) {
      const version =
        versionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || ''
      logger.info('node', 'success', `已检测到系统 Node.js ${version || '未知版本'}`, systemNodePath)
      return {
        ...systemRuntime,
        version,
      }
    }
  }

  const managedNodePath = await firstExistingPath(getManagedNodeExecutableCandidates())
  const managedNpmPath = await firstExistingPath(getManagedNpmExecutableCandidates())
  if (managedNodePath && managedNpmPath) {
    const managedRuntime: NodeRuntimeInfo = {
      source: 'managed',
      nodePath: managedNodePath,
      npmPath: managedNpmPath,
      npmCliPath: await resolveNpmCliScriptPath(managedNodePath),
      version: '',
      prefixPath: getManagedNpmPrefix(),
    }
    const versionResult = await runLoggedCommand(logger, 'node', managedNodePath, ['--version'])
    const npmVersionResult = await runLoggedNpmCommand(logger, 'node', managedRuntime, ['--version'])
    if (versionResult.exitCode === 0 && npmVersionResult.exitCode === 0) {
      const version =
        versionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || ''
      logger.info('node', 'success', `已检测到内置 Node.js ${version || '未知版本'}`, managedNodePath)
      return {
        ...managedRuntime,
        version,
      }
    }
  }

  logger.info('node', 'running', '当前系统未检测到可用 Node.js，开始安装内置 Node.js')
  return installManagedNodeRuntime(logger)
}

function buildRuntimeEnv(runtime: NodeRuntimeInfo) {
  const nodeDir = path.dirname(runtime.nodePath)
  const prefixBin = getManagedPrefixBin(runtime.prefixPath)
  const pathSegments = [prefixBin, nodeDir, process.env.PATH || ''].filter(Boolean)

  return {
    ...process.env,
    PATH: pathSegments.join(process.platform === 'win32' ? ';' : ':'),
    npm_config_registry: 'https://registry.npmmirror.com',
    npm_config_prefix: runtime.prefixPath,
    npm_config_cache: path.join(getToolchainRoot(), 'npm-cache'),
  }
}

async function readManagedNodeRuntime() {
  const nodePath = await firstExistingPath(getManagedNodeExecutableCandidates())
  const npmPath = await firstExistingPath(getManagedNpmExecutableCandidates())
  if (!nodePath || !npmPath) {
    return null
  }
  const npmCliPath = await resolveNpmCliScriptPath(nodePath)

  const versionResult = await runCommand(nodePath, ['--version'], { timeoutMs: 15000 })
  const version =
    versionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || ''

  return {
    source: 'managed' as const,
    nodePath,
    npmPath,
    npmCliPath,
    version,
    prefixPath: getManagedNpmPrefix(),
  }
}

async function runLoggedNpmCommand(
  logger: ReturnType<typeof createDeployLogger>,
  step: DeployProgressPayload['step'],
  runtime: NodeRuntimeInfo,
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    stdinData?: string
  } = {}
) {
  const invocation = buildNpmInvocation(runtime, args)
  if (runtime.npmCliPath) {
    logger.info(step, 'running', '使用 node + npm-cli.js 执行 npm 命令', runtime.npmCliPath)
  }
  return runLoggedCommand(logger, step, invocation.command, invocation.args, options)
}

async function installCliPackage(
  client: CliClient,
  runtime: NodeRuntimeInfo,
  logger: ReturnType<typeof createDeployLogger>
) {
  await fs.mkdir(runtime.prefixPath, { recursive: true })
  return runLoggedNpmCommand(
    logger,
    'install',
    runtime,
    ['install', '-g', '--prefix', runtime.prefixPath, cliConfig[client].packageName],
    {
      timeoutMs: 10 * 60 * 1000,
      env: buildRuntimeEnv(runtime),
    }
  )
}

async function deployCli(webContents: WebContents, request: CliDeployRequest, jobId: string) {
  const client = request.client
  const logger = createDeployLogger(webContents, jobId, client)

  logger.info('detect', 'running', `正在检测 ${client} 与 Node.js 环境`)
  let runtime: NodeRuntimeInfo
  try {
    runtime = await ensureNodeRuntime(logger)
  } catch (error) {
    logger.info(
      'node',
      'error',
      'Node.js 环境准备失败',
      error instanceof Error ? error.message : String(error)
    )
    return
  }

  logger.info(
    'node',
    'success',
    `Node.js 环境已就绪（${runtime.source === 'system' ? '系统' : '内置'}）`,
    `${runtime.nodePath}\n${runtime.version || '未知版本'}`
  )

  const detected = await inspectCli(client)
  logger.info(
    'detect',
    'success',
    detected.installed
      ? `已检测到 ${client}，版本 ${detected.version || '未知'}`
      : detected.brokenInstallation
        ? `检测到损坏的 ${client} 安装，准备重装`
        : `未检测到 ${client}，准备安装`,
    detected.executablePath || '未找到可执行文件'
  )

  if (!detected.installed) {
    logger.info('install', 'running', `正在通过国内镜像安装 ${client}`)

    const installResult = await installCliPackage(client, runtime, logger)
    if (installResult.exitCode !== 0) {
      logger.info(
        'install',
        'error',
        `${client} 安装失败`,
        installResult.stderr || installResult.stdout
      )
      return
    }

    logger.info('install', 'success', `${client} 安装完成`)
  }

  logger.info('config', 'running', `正在写入 ${client} 配置`)

  try {
    if (client === 'codex') {
      await writeCodexConfig(request)
    } else {
      await writeClaudeConfig(request)
    }

    await fs.mkdir(cliConfig[client].dataPath, { recursive: true })

    logger.info('config', 'success', `${client} 配置写入完成`, cliConfig[client].configPath)
  } catch (error) {
    logger.info(
      'config',
      'error',
      `${client} 配置失败`,
      error instanceof Error ? error.message : String(error)
    )
    return
  }

  if (client === 'codex') {
    await diagnoseCodexEnvironment(logger, request)
  } else {
    await diagnoseClaudeEnvironment(logger, request)
  }

  logger.info('test', 'running', `正在验证 ${client} 连接`)

  const testProjectPath = path.join(os.homedir())
  const testResult =
    client === 'codex'
      ? await runCodexPrompt(webContents, {
          client,
          requestId: `${jobId}-test`,
          projectPath: testProjectPath,
          prompt: 'hello',
        })
      : await runClaudePrompt(webContents, {
          client,
          requestId: `${jobId}-test`,
          projectPath: testProjectPath,
          prompt: 'hello',
        })

  if (!testResult.success) {
    const runtimeDiagnostics =
      typeof testResult.metadata?.diagnostics === 'object' && testResult.metadata?.diagnostics
        ? testResult.metadata.diagnostics as CliRuntimeDiagnostics
        : null
    logger.info(
      'test',
      'error',
      `${client} 测试失败`,
      [
        testResult.error || testResult.raw,
        runtimeDiagnostics?.probableCause ? `推断原因：${runtimeDiagnostics.probableCause}` : '',
      ].filter(Boolean).join('\n')
    )
    return
  }

  logger.info('test', 'success', `${client} 测试通过`, testResult.output)
  if (typeof testResult.metadata?.diagnostics === 'object' && testResult.metadata?.diagnostics) {
    const runtimeDiagnostics = testResult.metadata.diagnostics as CliRuntimeDiagnostics
    if (runtimeDiagnostics.sessionIssue && !runtimeDiagnostics.networkIssue && !runtimeDiagnostics.authIssue) {
      logger.info(
        'test',
        'error',
        `${client} 运行成功，但本地会话持久化异常`,
        runtimeDiagnostics.probableCause || 'CLI 已返回结果，但客户端没有稳定读到本地会话记录。'
      )
      return
    }
  }

  logger.info('complete', 'success', `${client} 已可直接使用`)
}

app.whenReady().then(() => {
  return loadServerBaseUrl().then(() => {
    Menu.setApplicationMenu(null)
    createWindow()

    app.on('activate', () => {
      if (mainWindow) {
        restoreMainWindow()
        return
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})

function stopActiveTitleDrag(windowId?: number) {
  if (!activeTitleDrag) {
    return
  }
  if (typeof windowId === 'number' && activeTitleDrag.windowId !== windowId) {
    return
  }
  clearInterval(activeTitleDrag.timer)
  activeTitleDrag = null
}

function startActiveTitleDrag(targetWindow: BrowserWindow, screenX: number, screenY: number) {
  stopActiveTitleDrag()

  if (targetWindow.isDestroyed()) {
    return
  }

  let bounds = targetWindow.getBounds()
  if (targetWindow.isMaximized()) {
    const horizontalRatio = bounds.width > 0 ? Math.max(0, Math.min(1, (screenX - bounds.x) / bounds.width)) : 0.5
    targetWindow.unmaximize()
    bounds = targetWindow.getBounds()
    const nextX = Math.round(screenX - bounds.width * horizontalRatio)
    const nextY = Math.round(screenY - Math.min(Math.max(WINDOW_CHROME_HEIGHT / 2, 8), WINDOW_CHROME_HEIGHT - 4))
    targetWindow.setPosition(nextX, nextY)
    bounds = targetWindow.getBounds()
  }

  const offsetX = screenX - bounds.x
  const offsetY = screenY - bounds.y
  const windowId = targetWindow.id
  const timer = setInterval(() => {
    const movingWindow = BrowserWindow.fromId(windowId)
    if (!movingWindow || movingWindow.isDestroyed() || !movingWindow.isFocused()) {
      stopActiveTitleDrag(windowId)
      return
    }
    const cursorPoint = screen.getCursorScreenPoint()
    movingWindow.setPosition(
      Math.round(cursorPoint.x - offsetX),
      Math.round(cursorPoint.y - offsetY),
    )
  }, 8)

  activeTitleDrag = {
    windowId,
    offsetX,
    offsetY,
    timer,
  }
}

ipcMain.handle('app:get-platform', () => process.platform)
ipcMain.handle('app:get-meta', () => getAppMeta())
ipcMain.handle('app:get-server-base-url', () => serverBaseUrl)
ipcMain.handle('app:window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.handle('app:window-toggle-maximize', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow) {
    return {
      maximized: false,
    }
  }
  if (targetWindow.isMaximized()) {
    targetWindow.unmaximize()
  } else {
    targetWindow.maximize()
  }
  return {
    maximized: targetWindow.isMaximized(),
  }
})
ipcMain.handle('app:window-get-bounds', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      maximized: false,
    }
  }
  const bounds = targetWindow.getBounds()
  return {
    ...bounds,
    maximized: targetWindow.isMaximized(),
  }
})
ipcMain.handle('app:window-set-position', (event, payload: { x: number; y: number }) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow || targetWindow.isDestroyed()) {
    return
  }
  if (targetWindow.isMaximized()) {
    return
  }
  const nextX = Math.round(payload?.x ?? 0)
  const nextY = Math.round(payload?.y ?? 0)
  targetWindow.setPosition(nextX, nextY)
})
ipcMain.handle('app:window-start-drag', (event, payload: { screenX: number; screenY: number }) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow || targetWindow.isDestroyed()) {
    return
  }
  startActiveTitleDrag(targetWindow, Math.round(payload?.screenX ?? 0), Math.round(payload?.screenY ?? 0))
})
ipcMain.handle('app:window-end-drag', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  stopActiveTitleDrag(targetWindow?.id)
})
ipcMain.handle('app:window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})
ipcMain.handle('app:set-server-base-url', async (_event, nextValue: string) => {
  const normalized = await persistServerBaseUrl(nextValue)
  return {
    serverBaseUrl: normalized,
  }
})
ipcMain.handle('app:reset-server-base-url', async () => {
  const normalized = await persistServerBaseUrl(DEFAULT_SERVER_BASE_URL)
  return {
    serverBaseUrl: normalized,
  }
})
ipcMain.handle('desktop:api-request', async (_event, request: DesktopApiRequest) =>
  requestApi(request)
)
ipcMain.handle('desktop:chat-stream', async (event, request: DesktopChatStreamRequest) => {
  await requestChatStream(event.sender, request)
})
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
ipcMain.handle(
  'desktop:open-assistant-history-folder',
  async (_event, input: { scope: AssistantHistoryScope; sessionId: string }) => {
    return openAssistantHistoryFolder(input.scope, input.sessionId)
  }
)
ipcMain.handle(
  'desktop:sync-assistant-history',
  async (_event, input: { scope: AssistantHistoryScope; entries: AssistantHistorySnapshotEntry[] }) => {
    return syncAssistantHistory(input.scope, input.entries)
  }
)
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
ipcMain.handle('desktop:delete-cli-message', async (_event, input: DesktopDeleteCliMessageRequest) => {
  return deleteCliMessage(input)
})

ipcMain.handle('desktop:delete-cli-sessions', async (_event, input: DesktopDeleteCliSessionsRequest) => {
  return deleteCliSessions(input)
})

ipcMain.handle('desktop:export-text-file', async (_event, input: DesktopExportTextFileRequest) => {
  return exportTextFile(input)
})
ipcMain.handle(
  'desktop:open-cli-session-folder',
  async (_event, input: { client: CliClient; sessionId: string }) => {
    return openCliSessionFolder(input.client, input.sessionId)
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
ipcMain.handle('app:set-theme-mode', async (_event, mode: ThemeMode) => {
  applyThemeMode(mode)
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
ipcMain.handle('desktop:list-cli-extensions', async (_event, client: CliClient) => {
  return listCliExtensions(client)
})

ipcMain.handle('desktop:install-cli-extension', async (_event, request: CliExtensionInstallRequest) => {
  return installCliExtension(request)
})
ipcMain.handle('desktop:save-attachment', async (_event, input: DesktopAttachmentSaveRequest) => {
  return saveDesktopAttachment(input)
})
ipcMain.handle('desktop:image-edit', async (_event, input: DesktopImageEditRequest) => {
  return requestImageEdit(input)
})
ipcMain.handle('desktop:save-image', async (_event, input: DesktopSaveImageRequest) => {
  return saveImageToUserPath(input)
})
ipcMain.handle('desktop:copy-image', async (_event, input: DesktopCopyImageRequest) => {
  return copyImageToClipboard(input)
})
