import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  screen,
  session,
  shell,
  Tray,
  type WebContents,
} from 'electron'
import { NsisUpdater, type ProgressInfo, type UpdateDownloadedEvent } from 'electron-updater'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import type { ChatCompletionResponse } from '../src/shared/contracts'
import type {
  CliExtensionEntry,
  CliExtensionInstallRequest,
  CliExtensionInstallResult,
  CliInteractionPrompt,
  CliInteractionResponseRequest,
  CliPlanState,
  DesktopAppMeta,
  DesktopChatStreamPayload,
  DesktopChatStreamRequest,
  DesktopDeleteCliMessageRequest,
  DesktopDeleteCliSessionsRequest,
  DesktopReleaseManifest,
  DesktopReleasePlatform,
  DesktopUpdateState,
  DesktopExportTextFileRequest,
} from '../src/shared/desktop'
import {
  buildDesktopReleaseManifestUrlCandidates,
  compareDesktopVersions,
  resolveDesktopUpdateFeedUrl,
  resolveDesktopUpdateUrl,
} from '../src/lib/app-update.ts'
import {
  formatDesktopRequestTimeoutMessage,
  resolveDesktopRequestTimeoutMs,
} from '../src/lib/request-timeouts.ts'
import { parseDesktopChatStreamEventBlock, type DesktopChatStreamParsedLine } from '../src/lib/chat-reasoning.ts'
import {
  buildClaudePlanStateFromRecords,
  buildCodexPlanStateFromRecords,
  parseClaudePlanMutationFromRecord,
  parseCodexPlanStateFromRecord,
} from '../src/lib/cli-plan.ts'
import { isClaudeAssistantTerminalMessage } from '../src/lib/cli-history-filter.ts'
import { buildExecutionCycleEvents } from '../src/process/execution-orchestrator/run-request.ts'
import { buildFinalPrompt } from '../src/process/prompt-assembler/build-final-prompt.ts'
import { buildCliExtensionDedupeKey, parseMarkdownFrontmatterMeta } from '../src/lib/cli-extensions.ts'
import {
  buildBundledCodexCuratedSkillEntries,
  buildBundledMarketplaceEntries,
  type BundledCodexCuratedSkillCatalog,
  type BundledPluginMarketplaceCatalog,
} from '../src/lib/cli-marketplace-catalog.ts'
import {
  pickClaudeApiKeyFromUnknown,
  resolveClaudeDesktopEnv,
} from '../src/lib/claude-cli-config.ts'
import { extractCliUserTask } from '../src/lib/cli-prompt.ts'
import { isCliSessionReadyForLatestTurn } from '../src/lib/cli-session-readiness.ts'
import {
  MIN_DESKTOP_CLI_NODE_MAJOR,
  buildClaudePermissionArgs,
  buildCodexSandboxArgs,
  buildNodeBackedCliScriptPath,
  buildWindowsNodeExecutableCandidates,
  buildWindowsNpmGlobalCliCandidates,
  buildWindowsCommandShimArgs,
  isDesktopCliNodeVersionSupported,
  resolveWindowsCommandShimCommand,
  resolveCliProbeResult,
  sanitizeCliNpmEnvironment,
  shouldUseWindowsCommandShimForPath,
  supportsCodexAskForApprovalFlag,
} from '../src/lib/desktop-service.ts'
import {
  buildCliRetryOutputSnapshot,
  buildCliInteractionResponse,
  classifyCliStderrLine,
  detectCliInteractionFromText,
  detectCliInteractionFromToolUse,
  summarizeCliFailure,
  shouldAutoRetryCliRequest,
  type CliRuntimeDiagnostics as SharedCliRuntimeDiagnostics,
} from '../src/lib/cli-runtime.ts'
import {
  extractCodexCommandExecutionToolUseEntries,
  extractCodexFunctionCallToolUseEntries,
  normalizeCliToolInputForDetail,
} from '../src/lib/cli-tool-events.ts'
import { resolveInteractionDecision } from '../src/process/execution-orchestrator/interaction-policy.ts'

const DEFAULT_SERVER_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_BASE_URL = 'https://ai.oneapi.center/v1'
const DEFAULT_CLAUDE_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_MODEL = 'gpt-5.4'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'
const MOBILE_BRIDGE_LOOP_INTERVAL_MS = 5000
const MOBILE_BRIDGE_HEARTBEAT_INTERVAL_MS = 30000
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
const activeApiPowerSaveBlockers = new Map<string, number>()
const activeCliPowerSaveBlockers = new Map<string, number>()
let mobileBridgePowerSaveBlockerId: number | null = null
const mobileBridgeProgressMirrors = new Map<string, (payload: CliProgressPayload) => void>()
const activeCliRequestStates = new Map<string, {
  client: CliClient
  child: ChildProcess
  webContents: WebContents | null
  fullAccess: boolean
  autoApprove: boolean
  interactions: Map<string, CliInteractionPrompt>
  interactionKeys: Set<string>
}>()
const stoppedCliRequests = new Set<string>()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
type ThemeMode = 'light' | 'dark'
const bundledCliCatalogCache = new Map<string, unknown>()
let desktopUpdateState: DesktopUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
}
let updateDownloadPromise: Promise<DesktopUpdateState> | null = null
let windowsDesktopUpdater: NsisUpdater | null = null
let windowsDesktopUpdaterFeedUrl = ''
let desktopUpdateInstallStrategy: 'manual' | 'updater' | null = null
let mobileBridgeStarted = false
let mobileBridgeRunning = false
let mobileBridgeDeviceId = ''
let mobileBridgeLastHeartbeatAt = 0
let mobileBridgeLastSnapshotSignature = ''

function startCliPowerSaveBlocker(requestId: string) {
  if (!requestId || activeCliPowerSaveBlockers.has(requestId)) {
    return
  }
  const id = powerSaveBlocker.start('prevent-display-sleep')
  activeCliPowerSaveBlockers.set(requestId, id)
}

function stopCliPowerSaveBlocker(requestId: string) {
  const id = activeCliPowerSaveBlockers.get(requestId)
  if (typeof id === 'number') {
    activeCliPowerSaveBlockers.delete(requestId)
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id)
    }
  }
}

function startApiPowerSaveBlocker(requestId: string) {
  if (!requestId || activeApiPowerSaveBlockers.has(requestId)) {
    return
  }
  const id = powerSaveBlocker.start('prevent-display-sleep')
  activeApiPowerSaveBlockers.set(requestId, id)
}

function stopApiPowerSaveBlocker(requestId: string) {
  const id = activeApiPowerSaveBlockers.get(requestId)
  if (typeof id === 'number') {
    activeApiPowerSaveBlockers.delete(requestId)
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id)
    }
  }
}

function shouldKeepAwakeForApiPath(pathname: string) {
  const normalized = pathname.split('?', 1)[0]
  return normalized === '/pg/chat/completions' ||
    normalized === '/pg/images/generations' ||
    normalized === '/v1/images/generations' ||
    normalized === '/v1/images/edits'
}

function setMobileBridgePowerSaveBlocker(active: boolean) {
  if (active) {
    if (mobileBridgePowerSaveBlockerId === null) {
      mobileBridgePowerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
    return
  }
  if (mobileBridgePowerSaveBlockerId !== null) {
    const id = mobileBridgePowerSaveBlockerId
    mobileBridgePowerSaveBlockerId = null
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id)
    }
  }
}

interface MobileBridgeExtensionRef {
  id: string
  kind: 'command' | 'skill' | 'plugin'
  name: string
  description?: string
  client?: string
}

interface MobileBridgeJob {
  job_id?: string
  jobId?: string
  device_id?: string
  deviceId?: string
  client?: string
  session_id?: string
  sessionId?: string
  prompt?: string
  model?: string
  reasoning_effort?: string
  reasoningEffort?: string
  permission_mode?: string
  permissionMode?: string
  extension_refs?: MobileBridgeExtensionRef[]
  extensionRefs?: MobileBridgeExtensionRef[]
}

interface MobileBridgeInteractionResponse {
  responseId: string
  jobId: string
  interactionId: string
  action: CliInteractionResponseRequest['action']
}

function applyThemeMode(mode: ThemeMode) {
  nativeTheme.themeSource = mode
  const backgroundColor = '#00000000'
  mainWindow?.setBackgroundColor(backgroundColor)
}

function getServerConfigPath() {
  return path.join(app.getPath('userData'), 'server-base-url.json')
}

function getMobileBridgeConfigPath() {
  return path.join(app.getPath('userData'), 'mobile-bridge.json')
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

async function getMobileBridgeDeviceId() {
  if (mobileBridgeDeviceId) {
    return mobileBridgeDeviceId
  }
  try {
    const raw = await fs.readFile(getMobileBridgeConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as { deviceId?: string }
    if (parsed.deviceId?.trim()) {
      mobileBridgeDeviceId = parsed.deviceId.trim()
      return mobileBridgeDeviceId
    }
  } catch {
    /* empty */
  }

  mobileBridgeDeviceId = randomUUID()
  await fs.mkdir(path.dirname(getMobileBridgeConfigPath()), { recursive: true })
  await fs.writeFile(
    getMobileBridgeConfigPath(),
    JSON.stringify({ deviceId: mobileBridgeDeviceId }, null, 2),
    'utf8',
  )
  return mobileBridgeDeviceId
}

async function getMobileBridgeLocalDevice() {
  return {
    deviceId: await getMobileBridgeDeviceId(),
    name: os.hostname(),
    platform: process.platform,
    clientVersion: app.getVersion(),
  }
}

async function resetMobileBridgeDeviceId() {
  mobileBridgeDeviceId = randomUUID()
  mobileBridgeLastHeartbeatAt = 0
  mobileBridgeLastSnapshotSignature = ''
  await fs.mkdir(path.dirname(getMobileBridgeConfigPath()), { recursive: true })
  await fs.writeFile(
    getMobileBridgeConfigPath(),
    JSON.stringify({ deviceId: mobileBridgeDeviceId }, null, 2),
    'utf8',
  )
  await registerMobileBridgeDevice().catch(() => undefined)
  return getMobileBridgeLocalDevice()
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
  timeoutMs?: number
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

interface CliRuntimeDiagnostics extends SharedCliRuntimeDiagnostics {
  sessionFileFound?: boolean
  sessionReadAttempts?: number
}

interface CliProgressPayload {
  client: CliClient
  requestId: string
  sessionId?: string
  kind: 'status' | 'partial' | 'error'
  logKind?: CliLogKind
  sourceKind?: string
  message: string
  assistantChunk?: string
  indentLevel?: number
  createdAt: number
  done?: boolean
  files?: CliFileChange[]
  detail?: string
  command?: string
  exitCode?: number
  plan?: CliPlanState | null
  interaction?: CliInteractionPrompt
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
  apiKey?: string
  model: string
  prompt: string
  imageName: string
  mimeType?: string
  dataBase64: string
  size?: string
  quality?: string
  response_format?: 'url' | 'b64_json'
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
  filePath?: string
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

function getAppMeta(): DesktopAppMeta {
  return {
    platform: process.platform,
    productName: app.name,
    serverBaseUrl,
    iconPath: APP_ICON_PATH,
    version: app.getVersion(),
  }
}

function getUpdateCacheDirectory() {
  return path.join(app.getPath('userData'), 'updates')
}

function emitDesktopUpdateState() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('desktop:update-state', desktopUpdateState)
  }
}

function setDesktopUpdateState(next: Partial<DesktopUpdateState>) {
  desktopUpdateState = {
    ...desktopUpdateState,
    ...next,
    currentVersion: app.getVersion(),
  }
  emitDesktopUpdateState()
  return desktopUpdateState
}

function getDesktopReleaseForCurrentPlatform(
  manifest: DesktopReleaseManifest
): DesktopReleasePlatform | undefined {
  return process.platform === 'darwin' ? manifest.macos : manifest.windows
}

function normalizeDesktopAnnouncements(manifest: DesktopReleaseManifest) {
  const raw = Array.isArray(manifest.announcements) ? manifest.announcements : []
  return raw
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const title = typeof entry.title === 'string' ? entry.title.trim() : ''
      const content = typeof entry.content === 'string' ? entry.content.trim() : ''
      const publishedAt = typeof entry.published_at === 'string' ? entry.published_at.trim() : ''
      const id =
        typeof entry.id === 'string' && entry.id.trim()
          ? entry.id.trim()
          : `${publishedAt || 'announcement'}:${title || `item-${index + 1}`}`

      if (!title && !content) {
        return null
      }

      return {
        id,
        title: title || `公告 ${index + 1}`,
        content,
        published_at: publishedAt || undefined,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

async function fetchDesktopReleaseManifest(): Promise<DesktopReleaseManifest> {
  const candidates = buildDesktopReleaseManifestUrlCandidates(serverBaseUrl, DEFAULT_SERVER_BASE_URL)
  let lastError: Error | null = null

  for (const targetUrl of candidates) {
    try {
      const absoluteTargetUrl = resolveDesktopUpdateUrl(targetUrl, serverBaseUrl, DEFAULT_SERVER_BASE_URL)
      if (!absoluteTargetUrl) {
        throw new Error(`版本清单地址无效：${targetUrl}`)
      }
      const response = await fetch(absoluteTargetUrl, {
        headers: {
          'User-Agent': 'OneAPI-Desktop',
        },
      })
      if (!response.ok) {
        const data = await parseResponse(response)
        throw new Error(getResponseErrorMessage(data, response.status, '获取版本清单失败'))
      }

      const data = await parseResponse(response)
      const manifest =
        typeof data === 'object' &&
        data &&
        'data' in data &&
        typeof data.data === 'object' &&
        data.data
          ? (data.data as DesktopReleaseManifest)
          : (data as DesktopReleaseManifest)

      return manifest
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('获取版本清单失败')
    }
  }

  throw lastError || new Error('获取版本清单失败')
}

function resolveReleasePackageFileName(release: DesktopReleasePlatform | undefined) {
  const rawUrl = release?.installer?.url || ''
  const configured = release?.installer?.file_name?.trim()
  if (configured) {
    return configured
  }
  try {
    const target = new URL(rawUrl)
    return decodeURIComponent(path.basename(target.pathname)) || 'desktop-update.bin'
  } catch {
    return rawUrl ? path.basename(rawUrl) : 'desktop-update.bin'
  }
}

function canUseDifferentialDesktopUpdate(release: DesktopReleasePlatform | undefined) {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return false
  }
  return Boolean(resolveDesktopUpdateFeedUrl(release?.installer?.url?.trim() || ''))
}

function setDesktopUpdateErrorState(error: unknown, fallbackMessage: string) {
  return setDesktopUpdateState({
    status: 'error',
    message: error instanceof Error ? error.message : fallbackMessage,
  })
}

function configureWindowsDesktopUpdater(release: DesktopReleasePlatform) {
  const installerUrl = resolveDesktopUpdateUrl(
    release.installer?.url?.trim() || '',
    serverBaseUrl,
    DEFAULT_SERVER_BASE_URL
  )
  const feedUrl = resolveDesktopUpdateFeedUrl(installerUrl)
  if (!feedUrl) {
    throw new Error('当前更新包缺少可用的增量更新源。')
  }

  if (windowsDesktopUpdater && windowsDesktopUpdaterFeedUrl === feedUrl) {
    return windowsDesktopUpdater
  }

  const updater = new NsisUpdater({
    provider: 'generic',
    url: feedUrl,
    channel: 'latest',
    useMultipleRangeRequest: true,
  })
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.autoRunAppAfterInstall = true
  updater.disableWebInstaller = true
  updater.logger = null
  updater.on('download-progress', (progress: ProgressInfo) => {
    setDesktopUpdateState({
      status: 'downloading',
      latestVersion: desktopUpdateState.latestVersion,
      downloadedBytes: progress.transferred,
      totalBytes: progress.total,
      progress: progress.percent,
      message: '正在自动下载增量更新包...',
    })
  })
  updater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
    desktopUpdateInstallStrategy = 'updater'
    setDesktopUpdateState({
      status: 'downloaded',
      latestVersion: event.version || desktopUpdateState.latestVersion,
      installerPath: event.downloadedFile,
      downloadedBytes: desktopUpdateState.totalBytes || desktopUpdateState.downloadedBytes || 0,
      totalBytes: desktopUpdateState.totalBytes || desktopUpdateState.downloadedBytes || 0,
      progress: 100,
      message: '增量更新包已下载完成。',
    })
  })
  updater.on('error', (error: Error) => {
    setDesktopUpdateErrorState(error, '增量更新失败')
  })

  windowsDesktopUpdater = updater
  windowsDesktopUpdaterFeedUrl = feedUrl
  return updater
}

async function startDifferentialDesktopUpdateDownload(release: DesktopReleasePlatform) {
  const updater = configureWindowsDesktopUpdater(release)
  desktopUpdateInstallStrategy = 'updater'
  setDesktopUpdateState({
    status: 'downloading',
    latestVersion: release.version?.trim() || desktopUpdateState.latestVersion,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    message: '正在自动下载增量更新包...',
  })

  const result = await updater.checkForUpdates()
  if (!result?.isUpdateAvailable) {
    throw new Error('增量更新源未返回可用版本信息。')
  }

  await updater.downloadUpdate(result.cancellationToken)
  return desktopUpdateState
}

async function checkForDesktopUpdate(options: {
  userInitiated?: boolean
} = {}) {
  setDesktopUpdateState({
    status: 'checking',
    message: options.userInitiated ? '正在检查更新...' : undefined,
    checkedAt: Date.now(),
  })

  try {
    const manifest = await fetchDesktopReleaseManifest()
    const release = getDesktopReleaseForCurrentPlatform(manifest)
    const latestVersion = release?.version?.trim() || ''
    const minimumCheckHour = manifest.minimum_check_hour ?? 12
    const announcements = normalizeDesktopAnnouncements(manifest)

    if (!release || !latestVersion) {
      desktopUpdateInstallStrategy = null
      return setDesktopUpdateState({
        status: options.userInitiated ? 'error' : 'idle',
        latestVersion: '',
        release: undefined,
        announcements,
        minimumCheckHour,
        message: options.userInitiated ? '后台尚未配置当前平台的版本清单。' : undefined,
        installerPath: '',
      })
    }

    const currentVersion = app.getVersion()
    const comparison = compareDesktopVersions(currentVersion, latestVersion)
    const installerPath = desktopUpdateState.installerPath || ''
    const hasDownloadedInstaller =
      comparison < 0 &&
      installerPath &&
      desktopUpdateState.latestVersion === latestVersion

    if (comparison >= 0) {
      desktopUpdateInstallStrategy = null
      return setDesktopUpdateState({
        status: 'up_to_date',
        latestVersion,
        release,
        announcements,
        minimumCheckHour,
        installerPath: '',
        progress: 100,
        message: '当前已是最新版。',
      })
    }

    const nextState = setDesktopUpdateState({
      status: hasDownloadedInstaller ? 'downloaded' : 'available',
      latestVersion,
      release,
      announcements,
      minimumCheckHour,
      progress: hasDownloadedInstaller ? 100 : 0,
      message: hasDownloadedInstaller ? '更新包已下载完成。' : '发现新版本，可后台下载。',
    })

    if (hasDownloadedInstaller) {
      return nextState
    }

    return startDesktopUpdateDownload()
  } catch (error) {
    return setDesktopUpdateState({
      status: 'error',
      message: error instanceof Error ? error.message : '检查更新失败',
    })
  }
}

async function startDesktopUpdateDownload() {
  if (desktopUpdateState.status === 'downloading' && updateDownloadPromise) {
    return updateDownloadPromise
  }

  const release = desktopUpdateState.release
  const downloadUrl = resolveDesktopUpdateUrl(
    release?.installer?.url?.trim() || '',
    serverBaseUrl,
    DEFAULT_SERVER_BASE_URL
  )
  const latestVersion = release?.version?.trim() || desktopUpdateState.latestVersion || ''
  if (!downloadUrl || !latestVersion) {
    throw new Error('当前没有可下载的更新包。')
  }

  updateDownloadPromise = (async () => {
    try {
      if (canUseDifferentialDesktopUpdate(release)) {
        try {
          return await startDifferentialDesktopUpdateDownload(release as DesktopReleasePlatform)
        } catch {
          desktopUpdateInstallStrategy = null
        }
      }

      desktopUpdateInstallStrategy = 'manual'
      const fileName = resolveReleasePackageFileName(release)
      const targetDir = path.join(getUpdateCacheDirectory(), latestVersion)
      const targetPath = path.join(targetDir, fileName)
      await fs.mkdir(targetDir, { recursive: true })

      setDesktopUpdateState({
        status: 'downloading',
        latestVersion,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        message: '正在后台下载更新包...',
      })

      const response = await getDesktopSession().fetch(buildUrl(downloadUrl))
      if (!response.ok) {
        const data = await parseResponse(response)
        throw new Error(getResponseErrorMessage(data, response.status, '下载更新包失败'))
      }

      const totalBytes = Number.parseInt(response.headers.get('content-length') || '0', 10) || 0
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('当前环境不支持更新包下载。')
      }

      const writer = createWriteStream(targetPath)
      let downloadedBytes = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          if (!value) {
            continue
          }
          downloadedBytes += value.length
          writer.write(Buffer.from(value))
          setDesktopUpdateState({
            status: 'downloading',
            latestVersion,
            downloadedBytes,
            totalBytes,
            progress: totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0,
            message: '正在后台下载更新包...',
          })
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          writer.once('error', reject)
          writer.end(() => resolve())
        })
      }

      return setDesktopUpdateState({
        status: 'downloaded',
        latestVersion,
        installerPath: targetPath,
        downloadedBytes,
        totalBytes: totalBytes || downloadedBytes,
        progress: 100,
        message: '更新包已下载完成。',
      })
    } catch (error) {
      return setDesktopUpdateErrorState(error, '下载更新包失败')
    } finally {
      updateDownloadPromise = null
    }
  })()

  return updateDownloadPromise
}

async function installDesktopUpdate() {
  if (process.platform === 'win32' && desktopUpdateInstallStrategy === 'updater' && windowsDesktopUpdater) {
    isQuitting = true
    windowsDesktopUpdater.quitAndInstall(false, true)
    return
  }

  const installerPath = desktopUpdateState.installerPath?.trim() || ''
  if (!installerPath) {
    throw new Error('更新包尚未下载完成。')
  }

  await fs.access(installerPath)
  if (process.platform === 'darwin') {
    const openResult = await shell.openPath(installerPath)
    if (openResult) {
      throw new Error(openResult)
    }
    return
  }

  const child = spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  isQuitting = true
  app.quit()
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
  const baseUrl = /^https?:\/\//i.test(serverBaseUrl) ? serverBaseUrl : DEFAULT_SERVER_BASE_URL
  const target = requestPath.startsWith('http')
    ? requestPath
    : `${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`
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

function emitParsedChatStreamLine(
  sender: WebContents,
  requestId: string,
  parsedLine: DesktopChatStreamParsedLine,
  usage: ChatCompletionResponse['usage'] | undefined
) {
  if (parsedLine.deltaText) {
    emitChatStream(sender, {
      requestId,
      type: 'delta',
      text: parsedLine.deltaText,
    })
  }
  if (parsedLine.reasoningText) {
    emitChatStream(sender, {
      requestId,
      type: 'reasoning',
      text: parsedLine.reasoningText,
    })
  }

  const nextUsage = parsedLine.usage || usage
  if (parsedLine.done) {
    emitChatStream(sender, {
      requestId,
      type: 'done',
      usage: nextUsage,
    })
  }

  return {
    done: parsedLine.done,
    usage: nextUsage,
  }
}

async function requestChatStream(sender: WebContents, input: DesktopChatStreamRequest) {
  const controller = new AbortController()
  activeApiRequests.set(input.requestId, controller)
  startApiPowerSaveBlocker(input.requestId)

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
        prompt_cache_key: input.promptCacheKey,
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
        for (const parsedLine of parseDesktopChatStreamEventBlock(rawEvent)) {
          const emitted = emitParsedChatStreamLine(sender, input.requestId, parsedLine, usage)
          usage = emitted.usage
          if (emitted.done) {
            return
          }
        }
      }
    }

    if (buffer.trim()) {
      for (const parsedLine of parseDesktopChatStreamEventBlock(buffer)) {
        const emitted = emitParsedChatStreamLine(sender, input.requestId, parsedLine, usage)
        usage = emitted.usage
        if (emitted.done) {
          return
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
    stopApiPowerSaveBlocker(input.requestId)
  }
}

async function requestApi(input: DesktopApiRequest): Promise<DesktopApiResponse> {
  const headers = new Headers(input.headers ?? {})
  let body: string | undefined
  const timeoutMs =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? input.timeoutMs
      : resolveDesktopRequestTimeoutMs(input.path)
  const controller = input.requestId || timeoutMs > 0 ? new AbortController() : null
  const timer = timeoutMs > 0 && controller ? setTimeout(() => controller.abort(), timeoutMs) : null

  if (input.body !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
  }

  if (input.requestId && controller) {
    activeApiRequests.set(input.requestId, controller)
  }
  const powerSaveRequestId = input.requestId || (shouldKeepAwakeForApiPath(input.path) ? `api-${randomUUID()}` : '')
  if (powerSaveRequestId) {
    startApiPowerSaveBlocker(powerSaveRequestId)
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
        status: timeoutMs > 0 ? 408 : 499,
        headers: {},
        data: {
          success: false,
          message: timeoutMs > 0 ? formatDesktopRequestTimeoutMessage(timeoutMs) : '请求已取消',
        },
      }
    }
    throw error
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    if (input.requestId) {
      activeApiRequests.delete(input.requestId)
    }
    if (powerSaveRequestId) {
      stopApiPowerSaveBlocker(powerSaveRequestId)
    }
  }
}

function getCommandLocator() {
  return process.platform === 'win32' ? 'where' : 'which'
}

async function registerMobileBridgeDevice(status = 'online', lastError = '') {
  const deviceId = await getMobileBridgeDeviceId()
  await requestMobileBridgeJson({
    method: 'POST',
    path: '/api/mobile/desktop-devices/register',
    body: {
      deviceId,
      name: os.hostname(),
      platform: process.platform,
      clientVersion: app.getVersion(),
      status,
      lastError,
    },
  })
}

async function heartbeatMobileBridgeDevice(status = 'online', lastError = '') {
  const now = Date.now()
  if (now - mobileBridgeLastHeartbeatAt < MOBILE_BRIDGE_HEARTBEAT_INTERVAL_MS) {
    return
  }
  mobileBridgeLastHeartbeatAt = now
  const deviceId = await getMobileBridgeDeviceId()
  await requestMobileBridgeJson({
    method: 'POST',
    path: `/api/mobile/desktop-devices/${encodeURIComponent(deviceId)}/heartbeat`,
    body: {
      deviceId,
      name: os.hostname(),
      platform: process.platform,
      clientVersion: app.getVersion(),
      status,
      lastError,
    },
  })
}

async function syncMobileBridgeExtensionsSnapshot() {
  const deviceId = await getMobileBridgeDeviceId()
  const [codexExtensions, claudeExtensions] = await Promise.all([
    listCliExtensions('codex').catch(() => [] as CliExtensionEntry[]),
    listCliExtensions('claude').catch(() => [] as CliExtensionEntry[]),
  ])
  const entries = [...codexExtensions, ...claudeExtensions].map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.description,
    client: item.client,
  }))
  const signature = JSON.stringify(entries)
  if (signature === mobileBridgeLastSnapshotSignature) {
    return
  }
  mobileBridgeLastSnapshotSignature = signature
  await requestMobileBridgeJson({
    method: 'POST',
    path: '/api/mobile/desktop-extensions/snapshot',
    query: {
      device_id: deviceId,
    },
    body: entries,
  })
}

async function syncMobileBridgeAssistantsSnapshot() {
  const deviceId = await getMobileBridgeDeviceId()
  const raw = await getRendererStorageValue('oneapi-desktop-assistants')
  let parsed: Array<Record<string, unknown>> = []
  try {
    parsed = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : []
  } catch {
    parsed = []
  }
  const assistants = parsed
    .filter((item) => typeof item?.name === 'string' && String(item.name).trim())
    .map((item) => ({
      id: String(item.id || item.name || ''),
      scope: 'chat',
      name: String(item.name || ''),
      description: String(item.description || ''),
      prompt: String(item.prompt || ''),
      model: String(item.model || ''),
      temperature: typeof item.temperature === 'number' ? item.temperature : 0.35,
    }))
  await requestMobileBridgeJson({
    method: 'POST',
    path: '/api/mobile/desktop-assistants/snapshot',
    query: {
      device_id: deviceId,
      scope: 'chat',
    },
    body: assistants,
  })
}

async function readBridgeClientProjectPath(client: CliClient) {
  const raw = await getRendererStorageValue(`oneapi-desktop-${client}-last-project-path`)
  try {
    return raw ? JSON.parse(raw) as string : ''
  } catch {
    return ''
  }
}

async function postMobileBridgeJobEvent(jobId: string, event: Record<string, unknown>) {
  await requestMobileBridgeJson({
    method: 'POST',
    path: `/api/mobile/desktop-jobs/${encodeURIComponent(jobId)}/events`,
    body: event,
  })
}

async function runMobileBridgeInteractionLoop(requestId: string, jobId: string, state: { done: boolean }) {
  const deviceId = await getMobileBridgeDeviceId()
  while (!state.done || activeCliRequestStates.has(requestId)) {
    try {
      const responses = await requestMobileBridgeJson<MobileBridgeInteractionResponse[]>({
        method: 'GET',
        path: '/api/mobile/desktop-interactions/pending',
        query: {
          device_id: deviceId,
        },
      })
      for (const item of responses.filter((entry) => entry.jobId === jobId)) {
        const accepted = writeCliInteractionResponse(requestId, item.interactionId, item.action)
        if (accepted) {
          await requestMobileBridgeJson({
            method: 'POST',
            path: `/api/mobile/desktop-interactions/${encodeURIComponent(item.responseId)}/ack`,
          })
        }
      }
    } catch {
      /* empty */
    }
    await wait(1500)
  }
}

async function executeMobileBridgeJob(rawJob: MobileBridgeJob) {
  const job = normalizeMobileBridgeJob(rawJob)
  if (!job.jobId || (job.client !== 'codex' && job.client !== 'claude')) {
    return
  }
  const deviceId = await getMobileBridgeDeviceId()
  await requestMobileBridgeJson({
    method: 'POST',
    path: `/api/mobile/desktop-jobs/${encodeURIComponent(job.jobId)}/claim`,
    query: {
      device_id: deviceId,
    },
  })

  const requestedSessionId = job.sessionId || `mobile-${job.client}-${job.jobId}`
  const requestId = `mobile-${job.jobId}`
  const projectPath = (await readBridgeClientProjectPath(job.client)).trim() || os.homedir()
  const projectName = path.basename(projectPath) || projectPath
  const fullAccess = job.permissionMode === 'full' || job.permissionMode === 'full_access'
  const promptSnapshot = buildFinalPrompt({
    prompt: job.prompt,
    client: job.client,
    projectPath,
    fullAccess,
    extensions: job.extensionRefs.map((item) => ({
      client: job.client,
      kind: item.kind,
      name: item.name,
    })),
  })

  await postMobileBridgeJobEvent(job.jobId, {
    id: `${requestId}-project`,
    type: 'project',
    phase: 'project',
    level: 0,
    title: projectName,
    body: projectPath,
    createdAt: Date.now(),
  })

  for (const event of buildExecutionCycleEvents({
    sessionId: requestedSessionId,
    requestId,
    intent: job.prompt,
    finalPrompt: promptSnapshot.finalPrompt,
    commandTitle: '扩展与上下文准备',
  })) {
    await postMobileBridgeJobEvent(job.jobId, {
      id: event.id,
      type: event.phase === 'intent' ? 'intent' : 'log',
      phase: event.phase,
      level: event.severity === 'error' ? 2 : 0,
      title: event.title,
      body: event.detail,
      command: event.command,
      parentId: event.parentId,
      indentLevel: event.indentLevel,
      interactionStatus: event.interaction?.status,
      createdAt: event.createdAt,
    })
  }

  mobileBridgeProgressMirrors.set(requestId, (payload) => {
    const mapped = mapCliPayloadToMobileBridgeEvent(job.jobId, payload)
    if (!mapped) {
      return
    }
    void postMobileBridgeJobEvent(job.jobId, mapped).catch(() => undefined)
  })

  const interactionState = { done: false }
  const interactionLoop = runMobileBridgeInteractionLoop(requestId, job.jobId, interactionState)
  try {
    const runner = job.client === 'codex' ? runCodexPrompt : runClaudePrompt
    const result = await runner(mainWindow?.webContents || null, {
      client: job.client,
      requestId,
      projectPath,
      prompt: promptSnapshot.finalPrompt,
      sessionId: requestedSessionId,
      model: job.model,
      reasoningEffort: job.reasoningEffort,
      fullAccess,
    })

    if (result.output.trim()) {
      await postMobileBridgeJobEvent(job.jobId, {
        id: `${requestId}-assistant-final`,
        type: 'message',
        role: 'assistant',
        text: result.output.trim(),
        createdAt: Date.now(),
      })
    }

    if (!result.success) {
      await postMobileBridgeJobEvent(job.jobId, {
        id: `${requestId}-failed`,
        type: 'error',
        phase: 'error',
        level: 2,
        title: '执行失败',
        body: result.error || 'CLI 执行未返回成功结果。',
        createdAt: Date.now(),
      })
    } else {
      await postMobileBridgeJobEvent(job.jobId, {
        id: `${requestId}-complete`,
        type: 'complete',
        phase: 'complete',
        level: 0,
        title: `${job.client === 'codex' ? 'Codex' : 'Claude'} 输出已结束`,
        body: '',
        createdAt: Date.now(),
      })
    }
  } finally {
    interactionState.done = true
    mobileBridgeProgressMirrors.delete(requestId)
    await interactionLoop.catch(() => undefined)
  }
}

async function startMobileBridgeLoop() {
  if (mobileBridgeStarted) {
    return
  }
  mobileBridgeStarted = true
  while (!isQuitting) {
    if (mobileBridgeRunning) {
      await wait(MOBILE_BRIDGE_LOOP_INTERVAL_MS)
      continue
    }
    mobileBridgeRunning = true
    try {
      const userId = await getDesktopUserHeaderValue()
      if (!userId) {
        setMobileBridgePowerSaveBlocker(false)
        await wait(MOBILE_BRIDGE_LOOP_INTERVAL_MS)
        continue
      }
      setMobileBridgePowerSaveBlocker(true)

      await registerMobileBridgeDevice()
      await heartbeatMobileBridgeDevice()
      await syncMobileBridgeExtensionsSnapshot()
      await syncMobileBridgeAssistantsSnapshot()

      const jobs = await requestMobileBridgeJson<MobileBridgeJob[]>({
        method: 'GET',
        path: '/api/mobile/desktop-jobs/pending',
        query: {
          device_id: await getMobileBridgeDeviceId(),
        },
      })

      for (const job of jobs) {
        await executeMobileBridgeJob(job)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await heartbeatMobileBridgeDevice('degraded', message).catch(() => undefined)
    } finally {
      mobileBridgeRunning = false
    }
    await wait(MOBILE_BRIDGE_LOOP_INTERVAL_MS)
  }
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

async function getRendererStorageValue(key: string) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return ''
  }
  try {
    const value = await mainWindow.webContents.executeJavaScript(
      `window.localStorage.getItem(${JSON.stringify(key)}) ?? ''`,
      true,
    )
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

async function getDesktopUserHeaderValue() {
  return (await getRendererStorageValue('uid')).trim()
}

async function requestMobileBridgeApi(input: DesktopApiRequest) {
  const userId = await getDesktopUserHeaderValue()
  return requestApi({
    ...input,
    headers: {
      ...(input.headers || {}),
      ...(userId ? { 'New-Api-User': userId } : {}),
      'X-Desktop-Device': await getMobileBridgeDeviceId(),
    },
  })
}

async function requestMobileBridgeJson<T>(input: DesktopApiRequest) {
  const response = await requestMobileBridgeApi(input)
  if (!response.ok) {
    const message =
      typeof response.data === 'object' &&
      response.data &&
      'message' in response.data &&
      typeof response.data.message === 'string'
        ? response.data.message
        : `请求失败（${response.status}）`
    throw new Error(message)
  }
  const payload =
    typeof response.data === 'object' &&
    response.data &&
    'data' in response.data
      ? (response.data as { data: T }).data
      : response.data as T
  return payload
}

function normalizeMobileBridgeJob(raw: MobileBridgeJob) {
  return {
    jobId: raw.jobId || raw.job_id || '',
    deviceId: raw.deviceId || raw.device_id || '',
    client: (raw.client || '').trim().toLowerCase() as CliClient,
    sessionId: raw.sessionId || raw.session_id || '',
    prompt: raw.prompt || '',
    model: raw.model || '',
    reasoningEffort: raw.reasoningEffort || raw.reasoning_effort || '',
    permissionMode: raw.permissionMode || raw.permission_mode || '',
    extensionRefs: (raw.extensionRefs || raw.extension_refs || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      description: item.description,
    })),
  }
}

function resolveMobileBridgePhase(payload: Pick<CliProgressPayload, 'logKind' | 'sourceKind' | 'kind' | 'interaction'>) {
  if (payload.interaction?.status === 'pending') {
    return 'interaction_required'
  }
  const sourceKind = (payload.sourceKind || '').trim().toLowerCase()
  if (sourceKind.startsWith('orchestrator.')) {
    return sourceKind.slice('orchestrator.'.length)
  }
  if (sourceKind.startsWith('intent.') || payload.logKind === 'intent') {
    return 'intent'
  }
  if (payload.logKind === 'command' || payload.logKind === 'tool') {
    return 'invoke'
  }
  if (payload.logKind === 'stdout' || sourceKind.includes('prepare') || sourceKind.includes('thread.started') || sourceKind.includes('session.connected')) {
    return 'prepare'
  }
  if (payload.logKind === 'result') {
    return 'result'
  }
  if (payload.kind === 'error' || payload.logKind === 'error' || payload.logKind === 'stderr') {
    return 'error'
  }
  return 'prepare'
}

function mapCliPayloadToMobileBridgeEvent(
  jobId: string,
  payload: CliProgressPayload,
): Record<string, unknown> | null {
  const assistantChunk = payload.assistantChunk
  if (payload.kind === 'partial' && !assistantChunk?.trim()) {
    return null
  }
  if (assistantChunk?.trim()) {
    return {
      id: `${jobId}-${payload.requestId}-${payload.createdAt}-${payload.kind}-assistant`,
      type: 'message_delta',
      phase: 'assistant',
      role: 'assistant',
      text: assistantChunk,
      createdAt: payload.createdAt,
    }
  }
  const phase = resolveMobileBridgePhase(payload)
  const type =
    payload.interaction?.status === 'pending'
      ? 'interaction_required'
      : phase === 'intent'
        ? 'intent'
        : payload.kind === 'error'
          ? 'error'
          : payload.done && payload.logKind === 'status'
            ? 'complete'
            : 'log'
  return {
    id: `${jobId}-${payload.requestId}-${payload.createdAt}-${payload.kind}-${phase}`,
    type,
    phase,
    level: payload.kind === 'error' ? 2 : payload.logKind === 'stderr' ? 1 : 0,
    title: payload.message,
    body: payload.detail || payload.assistantChunk || payload.message,
    command: payload.command,
    interactionId: payload.interaction?.id,
    interactionStatus: payload.interaction?.status,
    indentLevel: payload.indentLevel || 0,
    createdAt: payload.createdAt,
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
    keepStdinOpen?: boolean
  } = {}
) {
  const timeoutMs = options.timeoutMs ?? 30000
  const useWindowsCommandShim = shouldUseWindowsCommandShim(command)
  const spawnEnv = { ...process.env, ...options.env }
  const spawnCommand = useWindowsCommandShim ? resolveWindowsCommandShimCommand(spawnEnv) : command
  const spawnArgs = useWindowsCommandShim
    ? buildWindowsCommandShimArgs(command, args)
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
        env: spawnEnv,
        shell: false,
        windowsVerbatimArguments: useWindowsCommandShim,
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
        if (options.keepStdinOpen) {
          child.stdin?.write(options.stdinData)
        } else {
          child.stdin?.end(options.stdinData)
        }
      } else if (!options.keepStdinOpen) {
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

function writeChildStdinSafely(child: ChildProcess | null | undefined, value: string) {
  const stdin = child?.stdin
  if (!stdin || stdin.destroyed || stdin.closed || stdin.writableEnded || !stdin.writable) {
    return false
  }

  try {
    return stdin.write(value)
  } catch {
    return false
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
    const commonNode = await firstExistingPath(buildWindowsNodeExecutableCandidates(process.env))
    if (commonNode) {
      return commonNode
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
    const userNpmCli = await firstExistingPath(buildWindowsNpmGlobalCliCandidates(command, process.env))
    if (userNpmCli) {
      return userNpmCli
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

async function resolveNodeBackedCliInvocation(
  client: CliClient,
  executablePath: string,
  runtime: NodeRuntimeInfo | null,
  args: string[]
) {
  if (process.platform !== 'win32' || !executablePath.trim()) {
    return {
      command: resolveCliSpawnCommand(client, executablePath),
      args,
    }
  }

  const scriptPath = buildNodeBackedCliScriptPath(client, executablePath)
  if (!scriptPath || !(await pathExists(scriptPath))) {
    return {
      command: resolveCliSpawnCommand(client, executablePath),
      args,
    }
  }

  const localNodePath = path.join(path.dirname(executablePath), 'node.exe')
  let nodePath = await firstExistingPath([
    localNodePath,
    runtime?.nodePath || '',
  ])
  if (!nodePath) {
    nodePath = await locateExecutable('node')
  }

  if (!nodePath) {
    return {
      command: resolveCliSpawnCommand(client, executablePath),
      args,
    }
  }

  return {
    command: nodePath,
    args: [scriptPath, ...args],
  }
}

async function inspectCli(client: CliClient): Promise<CliStatus> {
  const executablePath = await locateExecutable(client)
  const managedRuntime = await readManagedNodeRuntime()
  const versionResult = executablePath
    ? await runCommand(executablePath, ['--version'], {
        timeoutMs: 15000,
        env: buildCliExecutionEnv(managedRuntime),
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

async function statDesktopPath(targetPath: string) {
  const resolved = path.resolve(targetPath)
  try {
    const stat = await fs.stat(resolved)
    return {
      path: resolved,
      kind: stat.isDirectory() ? 'directory' : 'file',
    } as const
  } catch {
    return {
      path: resolved,
      kind: 'missing',
    } as const
  }
}

async function requestImageEdit(input: DesktopImageEditRequest) {
  const headers = new Headers()
  if (input.apiKey?.trim()) {
    headers.set('Authorization', `Bearer ${input.apiKey.trim()}`)
  }
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
  if (input.response_format?.trim()) {
    formData.append('response_format', input.response_format.trim())
  }
  formData.append(
    'image',
    new Blob([Buffer.from(input.dataBase64, 'base64')], {
      type: input.mimeType?.trim() || 'image/png',
    }),
    input.imageName || 'image.png'
  )

  const timeoutMs = resolveDesktopRequestTimeoutMs('/v1/images/edits')
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timer = timeoutMs > 0 && controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  const powerSaveRequestId = `image-edit-${randomUUID()}`
  startApiPowerSaveBlocker(powerSaveRequestId)

  let response: Response
  try {
    response = await getDesktopSession().fetch(buildUrl('/v1/images/edits'), {
      method: 'POST',
      headers,
      body: formData,
      signal: controller?.signal,
    })
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(formatDesktopRequestTimeoutMessage(timeoutMs), { cause: error })
    }
    throw error
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    stopApiPowerSaveBlocker(powerSaveRequestId)
  }

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
  let image: ReturnType<typeof nativeImage.createEmpty>

  if (input.filePath?.trim()) {
    image = nativeImage.createFromPath(input.filePath.trim())
  } else if (input.dataBase64?.trim()) {
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
      `api_key = "${apiKey}"`,
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
  const claudeAuth = await readClaudeAuthDocument().catch(() => null)
  const fallbackKey = await resolveClaudeFallbackApiKey()
  const resolvedEnv = resolveClaudeDesktopEnv({
    currentEnv,
    authDocument: claudeAuth,
    fallbackApiKey: fallbackKey,
    defaultBaseUrl: DEFAULT_CLAUDE_BASE_URL,
  })
  const changed = JSON.stringify(resolvedEnv) !== JSON.stringify(currentEnv)
  const nextDocument: ClaudeSettingsDocument = {
    ...parsed,
    env: resolvedEnv,
  }

  if (changed) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, JSON.stringify(nextDocument, null, 2), 'utf8')
  }

  return nextDocument
}

function buildClaudeCliEnv(
  runtime: NodeRuntimeInfo | null,
  settings?: ClaudeSettingsDocument | null
) {
  const baseEnv: NodeJS.ProcessEnv = buildCliExecutionEnv(runtime)
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
    if (installed && await pathExists(skillsDir)) {
      entries.push(...await listSkillEntriesFromRoot({
        client: 'codex',
        root: skillsDir,
        sourceLabel: meta.manifestName,
        marketplace: source.marketplace,
        installed,
        official: meta.official,
        installable: false,
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
    if (installed && await pathExists(skillsDir)) {
      entries.push(...await listSkillEntriesFromRoot({
        client: 'codex',
        root: skillsDir,
        sourceLabel: meta.manifestName,
        marketplace,
        installed,
        official: meta.official,
        installable: false,
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

        // 未安装的市场插件只展示插件本体。子技能/命令只有安装后才是可调用对象，
        // 提前展开会造成同名 configure 等条目重复出现，并让安装状态看起来互相串联。
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

function parseGitHubRepoSlug(repoUrl: string) {
  const normalized = repoUrl.trim().replace(/\.git(?:[#?].*)?$/i, '')
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/#?].*)?$/i)
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    }
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/#?]+)$/i)
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    }
  }

  const shortMatch = normalized.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
    }
  }

  return null
}

function encodeGitHubArchiveRef(ref: string) {
  return ref
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function buildGitHubArchiveUrl(repoUrl: string, ref: string, archiveType: 'tar.gz' | 'zip') {
  const slug = parseGitHubRepoSlug(repoUrl)
  const normalizedRef = ref.trim()
  if (!slug || !normalizedRef) {
    return ''
  }

  return `https://codeload.github.com/${slug.owner}/${slug.repo}/${archiveType}/${encodeGitHubArchiveRef(normalizedRef)}`
}

async function downloadUrlToFile(url: string, targetPath: string, timeoutMs = 180000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OneAPI-Desktop',
      },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    if (response.body) {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(targetPath))
      return
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(targetPath, buffer)
  } finally {
    clearTimeout(timer)
  }
}

async function extractTarGzArchive(archivePath: string, extractRoot: string) {
  await clearDirectory(extractRoot)
  const extractResult = await spawnCommandWithHandlers(
    'tar',
    ['-xzf', archivePath, '-C', extractRoot, '--strip-components=1'],
    {
      timeoutMs: 300000,
    }
  )
  if (extractResult.exitCode !== 0) {
    throw new Error(extractResult.stderr.trim() || extractResult.stdout.trim() || '解压 tar.gz 归档失败。')
  }
}

async function extractZipArchive(archivePath: string, extractRoot: string) {
  await clearDirectory(extractRoot)
  if (process.platform === 'win32') {
    const extractResult = await spawnCommandWithHandlers(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
      ],
      {
        timeoutMs: 300000,
      }
    )
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr.trim() || extractResult.stdout.trim() || '解压 zip 归档失败。')
    }
    await flattenSingleNestedDirectory(extractRoot)
    return
  }

  const extractResult = await spawnCommandWithHandlers('unzip', ['-q', archivePath, '-d', extractRoot], {
    timeoutMs: 300000,
  })
  if (extractResult.exitCode !== 0) {
    throw new Error(extractResult.stderr.trim() || extractResult.stdout.trim() || '解压 zip 归档失败。')
  }
  await flattenSingleNestedDirectory(extractRoot)
}

async function downloadGitHubArchiveSubdir(
  repoUrl: string,
  tempRoot: string,
  options: {
    ref?: string
    subdir?: string
  } = {}
) {
  const normalizedRef = options.ref?.trim() || ''
  if (!parseGitHubRepoSlug(repoUrl) || !normalizedRef) {
    return null
  }

  const extractRoot = path.join(tempRoot, 'repo-archive')
  const tarArchivePath = path.join(tempRoot, 'repo.tar.gz')
  const tarArchiveUrl = buildGitHubArchiveUrl(repoUrl, normalizedRef, 'tar.gz')
  try {
    await downloadUrlToFile(tarArchiveUrl, tarArchivePath)
    await extractTarGzArchive(tarArchivePath, extractRoot)
  } catch (tarError) {
    const zipArchivePath = path.join(tempRoot, 'repo.zip')
    const zipArchiveUrl = buildGitHubArchiveUrl(repoUrl, normalizedRef, 'zip')
    try {
      await downloadUrlToFile(zipArchiveUrl, zipArchivePath)
      await extractZipArchive(zipArchivePath, extractRoot)
    } catch (zipError) {
      throw new Error(
        `下载或解压 GitHub 归档失败。tar.gz: ${tarError instanceof Error ? tarError.message : String(tarError)}；zip: ${
          zipError instanceof Error ? zipError.message : String(zipError)
        }`,
        { cause: zipError }
      )
    }
  }

  const relativePath = options.subdir?.trim() ? options.subdir.trim() : ''
  const resolvedRoot = relativePath ? path.join(extractRoot, relativePath) : extractRoot
  if (!(await pathExists(resolvedRoot))) {
    throw new Error(`GitHub 归档中未找到目录：${relativePath || '.'}`)
  }
  return resolvedRoot
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

  const normalizedRef = options.ref?.trim() || ''
  let archiveError = ''
  try {
    const archiveSourceRoot = await downloadGitHubArchiveSubdir(normalizedUrl, tempRoot, {
      ref: normalizedRef,
      subdir: options.subdir,
    })
    if (archiveSourceRoot) {
      return archiveSourceRoot
    }
  } catch (error) {
    archiveError = error instanceof Error ? error.message : String(error)
  }

  const cloneTarget = path.join(tempRoot, 'repo')
  await fs.mkdir(tempRoot, { recursive: true })
  const cloneArgs = ['clone', '--depth', '1']
  if (normalizedRef && !isGitCommitish(normalizedRef)) {
    cloneArgs.push('--branch', normalizedRef)
  }
  cloneArgs.push(normalizedUrl, cloneTarget)
  const cloneResult = await spawnCommandWithHandlers('git', cloneArgs, {
    timeoutMs: 180000,
  })
  if (cloneResult.exitCode !== 0) {
    const gitError = cloneResult.stderr.trim() || cloneResult.stdout.trim() || '克隆仓库失败。'
    throw new Error(archiveError ? `${gitError}\n归档下载也失败：${archiveError}` : gitError)
  }

  if (normalizedRef && isGitCommitish(normalizedRef)) {
    let checkoutResult = await spawnCommandWithHandlers('git', ['-C', cloneTarget, 'checkout', normalizedRef], {
      timeoutMs: 180000,
    })
    if (checkoutResult.exitCode !== 0) {
      const fetchResult = await spawnCommandWithHandlers('git', ['-C', cloneTarget, 'fetch', '--depth', '1', 'origin', normalizedRef], {
        timeoutMs: 180000,
      })
      if (fetchResult.exitCode === 0) {
        checkoutResult = await spawnCommandWithHandlers('git', ['-C', cloneTarget, 'checkout', 'FETCH_HEAD'], {
          timeoutMs: 180000,
        })
      }
    }
    if (checkoutResult.exitCode !== 0) {
      throw new Error(checkoutResult.stderr.trim() || checkoutResult.stdout.trim() || '切换仓库版本失败。')
    }
  }

  const relativePath = options.subdir?.trim() ? options.subdir.trim() : ''
  const resolvedRoot = relativePath ? path.join(cloneTarget, relativePath) : cloneTarget
  if (!(await pathExists(resolvedRoot))) {
    throw new Error(`仓库中未找到目录：${relativePath || '.'}`)
  }
  return resolvedRoot
}

async function cloneClaudeMarketplaceSource(
  source: Record<string, unknown>,
  tempRoot: string,
  fallbackPath = ''
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
  const relativePath = typeof source.path === 'string' && source.path.trim() ? source.path.trim() : fallbackPath.trim()
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
    const fallbackPath = typeof plugin.subdir === 'string' ? plugin.subdir.trim() : ''
    const sourceRoot = await cloneClaudeMarketplaceSource(sourceSpec, tempRoot, fallbackPath)
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
    const sourceRoot = await cloneClaudeMarketplaceSource(
      rawSource as Record<string, unknown>,
      tempRoot,
      catalogSource.subdir || ''
    )
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
    plan: (() => {
      const plan = buildCodexPlanStateFromRecords(planRecords)
      const lastAssistantMessage = [...messages].reverse().find((item) => item.role === 'assistant')
      if (plan && lastAssistantMessage && lastAssistantMessage.createdAt >= plan.updatedAt) {
        return null
      }
      return plan
    })(),
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
    plan: (() => {
      const plan = buildClaudePlanStateFromRecords(planRecords)
      const lastAssistantMessage = [...messages].reverse().find((item) => item.role === 'assistant')
      if (plan && lastAssistantMessage && lastAssistantMessage.createdAt >= plan.updatedAt) {
        return null
      }
      return plan
    })(),
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

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeCliSessionUserContent(value: string) {
  return normalizeWhitespace(sanitizeCliUserPrompt(value))
}

async function waitForCliSession(
  client: CliClient,
  sessionId?: string,
  options: {
    expectedUserContent?: string
    minUpdatedAtMs?: number
  } = {}
) {
  if (!sessionId) {
    return null
  }

  for (let index = 0; index < 40; index += 1) {
    const details =
      client === 'codex'
        ? await getCodexSession(sessionId)
        : await getClaudeSession(sessionId)

    if (details?.messages.length && isCliSessionReadyForLatestTurn(details, {
      expectedUserContent: options.expectedUserContent,
      minUpdatedAtMs: options.minUpdatedAtMs || 0,
      normalizeUserContent: normalizeCliSessionUserContent,
    })) {
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
  webContents: WebContents | null,
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
        assistantChunk?: string
        indentLevel?: number
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
        interaction?: CliInteractionPrompt
      }
    ) {
      const trimmed = input.message.trim()
      if (!trimmed) {
        return
      }

      const payload = {
        client,
        requestId,
        sessionId: input.sessionId,
        kind: input.kind,
        logKind: input.logKind,
        sourceKind: input.sourceKind,
        message: trimmed,
        assistantChunk: input.assistantChunk?.trim() || undefined,
        indentLevel: input.indentLevel,
        createdAt: Date.now(),
        done: input.done,
        files: input.files,
        detail: input.detail,
        command: input.command,
        exitCode: input.exitCode,
        plan: input.plan,
        interaction: input.interaction,
      } satisfies CliProgressPayload
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('desktop:cli-progress', payload)
      }
      mobileBridgeProgressMirrors.get(requestId)?.(payload)
    },
    status(
      message: string,
      sessionId?: string,
      done = false,
      files?: CliFileChange[],
      options: {
        logKind?: CliLogKind
        sourceKind?: string
        assistantChunk?: string
        indentLevel?: number
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
        interaction?: CliInteractionPrompt
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
        assistantChunk?: string
        indentLevel?: number
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
        interaction?: CliInteractionPrompt
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
        assistantChunk: options.assistantChunk,
        indentLevel: options.indentLevel,
        interaction: options.interaction,
      })
    },
    partial(message: string, sessionId?: string, done = false, plan?: CliPlanState | null) {
      if (!message || message === lastPartial) {
        return
      }
      lastPartial = message
      this.send({ kind: 'partial', message, sessionId, done, plan })
    },
    intent(
      message: string,
      sessionId?: string,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      assistantChunk?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, {
        logKind: 'intent',
        detail,
        sourceKind,
        assistantChunk,
        indentLevel,
      })
    },
    tool(
      message: string,
      sessionId?: string,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, { logKind: 'tool', detail, sourceKind, indentLevel })
    },
    command(
      message: string,
      command: string,
      sessionId?: string,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, { logKind: 'command', command, detail, sourceKind, indentLevel })
    },
    stdout(message: string, sessionId?: string, detail?: string, sourceKind?: string) {
      this.status(message, sessionId, false, undefined, { logKind: 'stdout', detail, sourceKind })
    },
    stderr(message: string, sessionId?: string, detail?: string, sourceKind?: string) {
      this.error(message, sessionId, false, undefined, { logKind: 'stderr', detail, sourceKind })
    },
    result(
      message: string,
      sessionId?: string,
      exitCode?: number,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, { logKind: 'result', exitCode, detail, sourceKind, indentLevel })
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

function normalizeCliLogText(value: string, maxLength = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
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

function extractPurposeFromUnknown(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  const source = value as Record<string, unknown>
  const candidates = [
    'description',
    'purpose',
    'reason',
    'summary',
    'explanation',
    'task',
    'prompt',
    'query',
  ]
  for (const key of candidates) {
    if (typeof source[key] === 'string' && source[key]?.trim()) {
      return normalizeCliLogText(source[key].trim())
    }
  }

  return ''
}

function summarizeCommandForCliLog(command: string, maxLength = 88) {
  const normalized = normalizeCliLogText(command, maxLength)
  if (!normalized) {
    return ''
  }
  return normalized
}

function normalizeCliToolDetail(detail: string) {
  const normalized = detail.trim()
  if (!normalized || normalized === '{}' || normalized === '[]' || normalized === 'null') {
    return ''
  }
  return normalized
}

function buildCliFailureDetail(stderrText: string, probableCause?: string) {
  const normalizedProbableCause = probableCause?.trim() || ''
  if (normalizedProbableCause) {
    return `推断原因：${normalizedProbableCause}`
  }

  const firstUsefulLine = stderrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/warning:\s*no stdin data received in 3s/i.test(line))

  return firstUsefulLine || stderrText.trim()
}

function summarizeCliIntentForLog(value: string, maxLength = 260) {
  const normalized = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^```/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized || shouldIgnoreCodexMessage(normalized)) {
    return ''
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

function summarizeCliIntentStep(value: string, maxLength = 120) {
  const normalized = summarizeCliIntentForLog(value, maxLength * 2)
  if (!normalized) {
    return ''
  }
  const segments = normalized
    .split(/(?<=[。！？；;.!?])\s*|(?<=\))\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const lastSegment = segments.at(-1) || normalized
  return lastSegment.length <= maxLength ? lastSegment : `${lastSegment.slice(0, maxLength - 1).trim()}…`
}

function describeCliToolUse(name: string, input: unknown) {
  const command = extractCommandFromUnknown(input)
  const files = extractCliFilesFromUnknown(input)
  const purpose = extractPurposeFromUnknown(input) || summarizeCommandForCliLog(command)
  const detail = normalizeCliToolDetail(
    input && typeof input === 'object'
      ? safeStringify(normalizeCliToolInputForDetail(input))
      : ''
  )
  return {
    message: `${name ? `正在执行 ${name}` : '正在执行工具调用'}${purpose ? `：${purpose}` : ''}`,
    command,
    detail,
    files,
    purpose,
    meaningful: !!(command || detail || files.length || purpose),
  }
}

function buildCliToolUseEventKey(name: string, described: ReturnType<typeof describeCliToolUse>) {
  return [
    name.trim(),
    described.command.trim(),
    described.detail.trim(),
    described.files.map((item) => item.path).join('|'),
  ].join('::')
}

function buildCliInteractionKey(input: {
  kind: string
  title: string
  message: string
  command?: string
}) {
  return [
    input.kind.trim(),
    input.title.trim(),
    input.message.trim(),
    input.command?.trim() || '',
  ].join('::')
}

function cloneCliInteractionPrompt(
  interaction: Omit<CliInteractionPrompt, 'status'> & { status?: CliInteractionPrompt['status'] }
): CliInteractionPrompt {
  return {
    ...interaction,
    status: interaction.status || 'pending',
  }
}

function writeCliInteractionResponse(
  requestId: string,
  interactionId: string,
  action: CliInteractionResponseRequest['action']
) {
  const state = activeCliRequestStates.get(requestId)
  const interaction = state?.interactions.get(interactionId)
  if (!state?.child.stdin || !interaction) {
    return false
  }

  if (!writeChildStdinSafely(state.child, buildCliInteractionResponse(action))) {
    return false
  }

  if (action === 'approve_always') {
    state.autoApprove = true
  }
  state.interactions.delete(interactionId)
  return true
}

function emitCliInteractionPrompt(input: {
  client: CliClient
  requestId: string
  sessionId?: string
  progress: ReturnType<typeof createCliProgressEmitter>
  interaction: Omit<CliInteractionPrompt, 'id' | 'status'>
}) {
  const state = activeCliRequestStates.get(input.requestId)
  if (!state) {
    return
  }

  const interactionKey = buildCliInteractionKey(input.interaction)
  if (state.interactionKeys.has(interactionKey)) {
    return
  }
  state.interactionKeys.add(interactionKey)

  if (
    resolveInteractionDecision({
      fullAccess: state.fullAccess,
      autoApproveEligible: !!input.interaction.autoApproveEligible,
      command: input.interaction.command,
    }) === 'auto_approve'
  ) {
    input.progress.status('全权限模式已自动确认本次权限请求。', input.sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'interaction.auto_approved',
      detail: input.interaction.message,
      command: input.interaction.command,
      interaction: {
        ...cloneCliInteractionPrompt({
          ...input.interaction,
          id: `${input.requestId}-auto-${Date.now()}`,
          status: 'auto_approved',
        }),
      },
    })
    writeChildStdinSafely(state.child, buildCliInteractionResponse('approve'))
    return
  }

  if (state.autoApprove && input.interaction.autoApproveEligible) {
    input.progress.status('已按“持续确认”设置自动放行本次权限请求。', input.sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'interaction.auto_approved.always',
      detail: input.interaction.message,
      command: input.interaction.command,
      interaction: {
        ...cloneCliInteractionPrompt({
          ...input.interaction,
          id: `${input.requestId}-always-${Date.now()}`,
          status: 'approved_always',
        }),
      },
    })
    writeChildStdinSafely(state.child, buildCliInteractionResponse('approve'))
    return
  }

  const interactionId = `${input.requestId}-interaction-${Date.now()}-${state.interactions.size + 1}`
  const pendingInteraction = cloneCliInteractionPrompt({
    ...input.interaction,
    id: interactionId,
    status: 'pending',
  })
  state.interactions.set(interactionId, pendingInteraction)
  input.progress.status(input.interaction.title, input.sessionId, false, undefined, {
    logKind: 'status',
    sourceKind: 'interaction.pending',
    detail: input.interaction.message,
    command: input.interaction.command,
    interaction: pendingInteraction,
  })
}

function extractTextPartContent(part: unknown) {
  if (typeof part === 'string') {
    return part
  }
  if (!part || typeof part !== 'object') {
    return ''
  }

  const typedPart = part as {
    type?: string
    text?: unknown
    content?: unknown
  }

  if (typedPart.type === 'tool_use' || typedPart.type === 'tool_result' || typedPart.type === 'progress') {
    return ''
  }
  if (typeof typedPart.text === 'string') {
    return typedPart.text
  }
  if (typeof typedPart.content === 'string' && typedPart.type !== 'tool_result') {
    return typedPart.content
  }
  return ''
}

function extractToolUseEntries(content: unknown) {
  if (!Array.isArray(content)) {
    return []
  }

  let pendingText = ''

  return content.flatMap((part) => {
    const textPart = extractTextPartContent(part)
    if (textPart) {
      pendingText += textPart
      return []
    }

    if (!part || typeof part !== 'object') {
      return []
    }

    const typedPart = part as {
      id?: string
      type?: string
      name?: string
      input?: unknown
    }

    if (typedPart.type !== 'tool_use') {
      return []
    }

    const nextEntry = {
      id: typedPart.id?.trim() || '',
      name: typedPart.name?.trim() || '',
      input: typedPart.input,
      textBefore: pendingText.trim(),
    }
    pendingText = ''
    return [nextEntry]
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

function buildCodexExecArgs(
  input: CliRunRequest,
  resumeSessionId?: string,
  supportsAskForApproval = false,
  runtimeConfig?: {
    apiKey?: string
    baseUrl?: string
  }
) {
  const args = ['exec']

  if (runtimeConfig?.apiKey?.trim() && runtimeConfig.baseUrl?.trim()) {
    const apiKey = runtimeConfig.apiKey.trim()
    const baseUrl = normalizeCodexBaseUrl(runtimeConfig.baseUrl)
    args.push(
      '--ignore-user-config',
      '--config',
      'model_provider="oneapi_desktop"',
      '--config',
      'model_providers.oneapi_desktop.name="oneapi_desktop"',
      '--config',
      `model_providers.oneapi_desktop.base_url=${JSON.stringify(baseUrl)}`,
      '--config',
      `model_providers.oneapi_desktop.api_key=${JSON.stringify(apiKey)}`,
      '--config',
      `model_providers.oneapi_desktop.experimental_bearer_token=${JSON.stringify(apiKey)}`,
      '--config',
      'model_providers.oneapi_desktop.wire_api="responses"'
    )
  }

  args.push(...buildCodexSandboxArgs(!!input.fullAccess, supportsAskForApproval))

  if (input.model?.trim()) {
    args.push('--model', input.model.trim())
  }

  args.push(
    '--config',
    `model_reasoning_effort="${parseCodexReasoningEffort(input.reasoningEffort)}"`
  )

  if (resumeSessionId) {
    args.push('resume', '--json', '--skip-git-repo-check', resumeSessionId, input.prompt)
  } else {
    args.push('--json', '-C', input.projectPath, '--skip-git-repo-check', input.prompt)
  }

  return args
}

const codexAskForApprovalSupportCache = new Map<string, boolean>()

async function detectCodexAskForApprovalSupport(
  executablePath: string,
  managedRuntime?: NodeRuntimeInfo | null
) {
  const cacheKey = executablePath.trim()
  if (codexAskForApprovalSupportCache.has(cacheKey)) {
    return codexAskForApprovalSupportCache.get(cacheKey) || false
  }

  const helpResult = await runCommand(executablePath, ['exec', '--help'], {
    timeoutMs: 15000,
    env: buildCliExecutionEnv(managedRuntime),
  })
  const supported = helpResult.exitCode === 0 && supportsCodexAskForApprovalFlag(
    `${helpResult.stdout}\n${helpResult.stderr}`
  )
  codexAskForApprovalSupportCache.set(cacheKey, supported)
  return supported
}

function isCodexStaleResumeFailure(stdout: string, stderr: string) {
  const combined = `${stdout}\n${stderr}`
  return (
    /thread\/resume failed/i.test(combined) ||
    /no rollout found for thread id/i.test(combined) ||
    /state db returned stale rollout path/i.test(combined)
  )
}

function buildClaudePromptArgs(input: CliRunRequest, resumeSessionId?: string) {
  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    ...buildClaudePermissionArgs(!!input.fullAccess),
  ]

  if (input.model?.trim()) {
    args.push('--model', input.model.trim())
  }

  args.push('--effort', parseClaudeEffort(input.reasoningEffort))

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
  }

  args.push(input.prompt)

  return args
}

function isClaudeStaleResumeFailure(stdout: string, stderr: string) {
  const combined = `${stdout}\n${stderr}`
  return (
    /no conversation found/i.test(combined) ||
    /conversation .* not found/i.test(combined) ||
    /session .* not found/i.test(combined) ||
    /resume .* failed/i.test(combined)
  )
}

async function runCodexPrompt(
  webContents: WebContents | null,
  input: CliRunRequest
): Promise<CliRunResponse> {
  const requestStartedAtMs = Date.now()
  const progress = createCliProgressEmitter(webContents, 'codex', input.requestId)
  const requestedSessionId = input.sessionId?.trim()
  const resumeSessionId = requestedSessionId && await getLatestCodexSessionFile(requestedSessionId)
    ? requestedSessionId
    : undefined
  let sessionId = resumeSessionId || requestedSessionId
  let partialText = ''
  let planState: CliPlanState | null = null
  let lastToolIntentText = ''
  let consumedAssistantChars = 0
  let sawCodexCompletion = false
  let stoppedAfterCodexCompletion = false
  let sawCodexVisibleProgress = false
  const seenToolUseEvents = new Set<string>()
  let activeCodexChild: ChildProcess | null = null
  let codexCompletionStopTimer: NodeJS.Timeout | null = null
  const runtimeDiagnostics: CliRuntimeDiagnostics = {}
  const executablePath = await locateExecutable('codex')
  const managedRuntime = await readManagedNodeRuntime()
  const spawnCommand = resolveCliSpawnCommand('codex', executablePath)
  const supportsAskForApproval = await detectCodexAskForApprovalSupport(executablePath, managedRuntime)
  const currentConfig = await readCurrentCodexConfig().catch(() => null)
  let args = buildCodexExecArgs(input, resumeSessionId, supportsAskForApproval, currentConfig ?? undefined)
  const takeAssistantChunk = (snapshot: string, explicitChunk = '') => {
    const normalizedExplicitChunk = explicitChunk.trim()
    if (snapshot.length < consumedAssistantChars) {
      consumedAssistantChars = 0
    }
    if (normalizedExplicitChunk) {
      const matchedIndex = snapshot.indexOf(normalizedExplicitChunk, consumedAssistantChars)
      if (matchedIndex >= consumedAssistantChars) {
        consumedAssistantChars = matchedIndex + normalizedExplicitChunk.length
      }
      return normalizedExplicitChunk
    }

    const nextChunk = snapshot.slice(consumedAssistantChars).trim()
    consumedAssistantChars = snapshot.length
    return nextChunk
  }
  const clearCodexCompletionStopTimer = () => {
    if (codexCompletionStopTimer) {
      clearTimeout(codexCompletionStopTimer)
      codexCompletionStopTimer = null
    }
  }
  const stopCodexAfterCompletion = () => {
    if (codexCompletionStopTimer || !activeCodexChild?.pid) {
      return
    }
    codexCompletionStopTimer = setTimeout(() => {
      if (!activeCodexChild?.pid || activeCodexChild.exitCode !== null || activeCodexChild.killed) {
        return
      }
      stoppedAfterCodexCompletion = true
      void stopChildProcess(activeCodexChild)
    }, 1200)
  }
  const emitCodexToolUse = (
    toolName: string,
    toolInput: unknown,
    sourceKind: string,
    options: {
      assistantSnapshot?: string
      assistantChunk?: string
    } = {}
  ) => {
    const interaction = detectCliInteractionFromToolUse(toolName, toolInput)
    if (interaction) {
      emitCliInteractionPrompt({
        client: 'codex',
        requestId: input.requestId,
        sessionId,
        progress,
        interaction,
      })
    }

    const described = describeCliToolUse(toolName, toolInput)
    if (!described.meaningful) {
      return
    }
    const eventKey = buildCliToolUseEventKey(toolName, described)
    if (seenToolUseEvents.has(eventKey)) {
      return
    }
    seenToolUseEvents.add(eventKey)
    sawCodexVisibleProgress = true

    const assistantSnapshot = options.assistantSnapshot || partialText
    const assistantChunk = takeAssistantChunk(assistantSnapshot, options.assistantChunk || '')
    const intentText = summarizeCliIntentStep(assistantChunk || assistantSnapshot)
    if (intentText && intentText !== lastToolIntentText) {
      lastToolIntentText = intentText
      progress.intent(
        '执行意图',
        sessionId,
        intentText,
        undefined,
        toolName.trim() ? `intent.before_tool.${toolName.trim()}` : 'intent.before_tool',
        intentText
      )
    }
    if (described.command) {
      progress.command(described.message, described.command, sessionId, described.detail, described.files, sourceKind)
      return
    }
    progress.tool(described.message, sessionId, described.detail, described.files, sourceKind)
  }

  progress.intent('Codex 已开始处理当前任务。', sessionId, undefined, undefined, 'request.started')
  if (requestedSessionId && !resumeSessionId) {
    progress.status(
      '原 Codex 会话文件已不存在，已自动新建会话继续执行。',
      requestedSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.missing' }
    )
  }

  const runCodexOnce = () => spawnCommandWithHandlers(spawnCommand, args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    env: buildCliExecutionEnv(managedRuntime),
    keepStdinOpen: false,
    stdinData: '\n',
    onSpawn: (child) => {
      activeCodexChild = child
      activeCliProcesses.set(input.requestId, child)
      startCliPowerSaveBlocker(input.requestId)
      activeCliRequestStates.set(input.requestId, {
        client: 'codex',
        child,
        webContents,
        fullAccess: !!input.fullAccess,
        autoApprove: false,
        interactions: new Map(),
        interactionKeys: new Set(),
      })
    },
    onStdoutLine: (line) => {
      const parsed = parseJsonLine(line)
      if (!parsed) {
        const interaction = detectCliInteractionFromText(line)
        if (interaction) {
          emitCliInteractionPrompt({
            client: 'codex',
            requestId: input.requestId,
            sessionId,
            progress,
            interaction,
          })
        }
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

      if (parsed.type === 'turn.completed') {
        sawCodexCompletion = true
        stopCodexAfterCompletion()
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
        sawCodexVisibleProgress = true
        progress.partial(partialText, sessionId, false, planState)
      }

      if (parsed.type === 'response_item' && payload?.type === 'message' && payload.role === 'assistant') {
        const assistantText = contentPartsToText(payload.content)
        if (assistantText.trim() && !shouldIgnoreCodexMessage(assistantText)) {
          partialText = assistantText
          sawCodexVisibleProgress = true
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
          emitCodexToolUse(
            toolEntry.name,
            toolEntry.input,
            toolEntry.name?.trim() ? `tool_use.${toolEntry.name.trim()}` : 'tool_use',
            {
              assistantSnapshot: partialText,
              assistantChunk: toolEntry.textBefore,
            }
          )
        }
      }

      const functionCallToolEntries = extractCodexFunctionCallToolUseEntries(parsed)
      const commandExecutionEntries = extractCodexCommandExecutionToolUseEntries(parsed)
      for (const toolEntry of [...functionCallToolEntries, ...commandExecutionEntries]) {
        emitCodexToolUse(
          toolEntry.name,
          toolEntry.input,
          toolEntry.name?.trim() ? `codex.tool_use.${toolEntry.name.trim()}` : 'codex.tool_use',
          {
            assistantSnapshot: partialText,
            assistantChunk: toolEntry.textBefore,
          }
        )
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
      const interaction = detectCliInteractionFromText(line)
      if (interaction) {
        emitCliInteractionPrompt({
          client: 'codex',
          requestId: input.requestId,
          sessionId,
          progress,
          interaction,
        })
      }
      const classified = classifyCliStderrLine(line)
      progress.status(classified.title, sessionId, false, undefined, {
        logKind: classified.logKind,
        sourceKind: classified.sourceKind,
        detail: line,
      })
    },
  })
  let result = await runCodexOnce()
  clearCodexCompletionStopTimer()
  let attempt = 0
  if (
    resumeSessionId &&
    result.exitCode !== 0 &&
    !stoppedCliRequests.has(input.requestId) &&
    isCodexStaleResumeFailure(result.stdout, result.stderr)
  ) {
    progress.status(
      '原 Codex 会话状态已失效，已自动新建会话重试。',
      resumeSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.recovered' }
    )
    sessionId = undefined
    partialText = ''
    planState = null
    lastToolIntentText = ''
    consumedAssistantChars = 0
    sawCodexVisibleProgress = false
    seenToolUseEvents.clear()
    sawCodexCompletion = false
    stoppedAfterCodexCompletion = false
    activeCodexChild = null
    clearCodexCompletionStopTimer()
    args = buildCodexExecArgs(input, undefined, supportsAskForApproval, currentConfig ?? undefined)
    attempt += 1
    result = await runCodexOnce()
    clearCodexCompletionStopTimer()
  }
  let retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  if (
    shouldAutoRetryCliRequest({
      diagnostics: retryDiagnostics,
      attempt,
      aborted: stoppedCliRequests.has(input.requestId),
      exitCode: result.exitCode,
      output: buildCliRetryOutputSnapshot(
        partialText,
        sawCodexVisibleProgress ? '已产生 Codex 执行日志' : ''
      ),
    })
  ) {
    progress.status('检测到服务器瞬时异常，已自动重试一次。', sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'request.retry.transient',
      detail: retryDiagnostics.probableCause || '',
    })
    partialText = ''
    lastToolIntentText = ''
    consumedAssistantChars = 0
    seenToolUseEvents.clear()
    sawCodexCompletion = false
    stoppedAfterCodexCompletion = false
    activeCodexChild = null
    clearCodexCompletionStopTimer()
    result = await runCodexOnce()
    clearCodexCompletionStopTimer()
    retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  }
  activeCliProcesses.delete(input.requestId)
  activeCliRequestStates.delete(input.requestId)
  stopCliPowerSaveBlocker(input.requestId)
  const aborted = stoppedCliRequests.delete(input.requestId)
  if (!aborted) {
    progress.status('Codex 输出已结束，正在整理会话记录。', sessionId, true, undefined, {
      logKind: 'status',
      sourceKind: 'request.stream.completed',
      plan: planState,
    })
  }

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

  const session = await waitForCliSession('codex', sessionId, {
    expectedUserContent: input.prompt,
    minUpdatedAtMs: requestStartedAtMs,
  })
  runtimeDiagnostics.sessionFileFound = !!session
  runtimeDiagnostics.sessionReadAttempts = 40
  const sessionOutput = session?.messages.filter((item) => item.role === 'assistant').at(-1)?.content ?? ''
  const output = sessionOutput || partialText.trim()
  Object.assign(runtimeDiagnostics, retryDiagnostics)
  if (!session && output) {
    runtimeDiagnostics.sessionIssue = true
    runtimeDiagnostics.probableCause =
      runtimeDiagnostics.probableCause || 'CLI 已返回内容，但本地会话文件未能在等待窗口内落盘'
  }
  const completionReached = sawCodexCompletion || !!usageEvent
  const success =
    !aborted &&
    output.length > 0 &&
    (result.exitCode === 0 || (completionReached && stoppedAfterCodexCompletion))
  const completedWithWarnings = !aborted && !success && output.length > 0 && !!runtimeDiagnostics.policyIssue

  if (success) {
    progress.partial(output, sessionId, true)
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
  } else if (completedWithWarnings) {
    progress.partial(output, sessionId, true)
    progress.status('Codex 已返回回复，但部分命令被本地执行策略拦截。', sessionId, true, fileChanges, {
      logKind: 'status',
      sourceKind: 'turn.completed.with_warnings',
      detail: runtimeDiagnostics.probableCause || '',
      exitCode: result.exitCode,
      plan: planState,
    })
  } else if (aborted) {
    progress.status('Codex 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
  } else if (result.stderr.trim()) {
    progress.error('Codex 执行失败', sessionId, true, fileChanges, {
      logKind: 'error',
      sourceKind: 'request.failed',
      detail: buildCliFailureDetail(result.stderr.trim(), runtimeDiagnostics.probableCause),
      exitCode: result.exitCode,
      plan: planState,
    })
  }

  return {
    success: success || completedWithWarnings,
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
      completedWithWarnings,
    },
  }
}

async function runClaudePrompt(
  webContents: WebContents | null,
  input: CliRunRequest
): Promise<CliRunResponse> {
  const requestStartedAtMs = Date.now()
  const progress = createCliProgressEmitter(webContents, 'claude', input.requestId)
  const requestedSessionId = input.sessionId?.trim()
  const resumeSessionId = requestedSessionId && await getClaudeSessionFile(requestedSessionId)
    ? requestedSessionId
    : undefined
  let sessionId = resumeSessionId || requestedSessionId
  let partialText = ''
  let finalResult: Record<string, unknown> | null = null
  let planState: CliPlanState | null = null
  const planRecords: Array<Record<string, unknown>> = []
  const seenToolUseEvents = new Set<string>()
  const toolUseIndentLevels = new Map<string, number>()
  let lastToolIntentText = ''
  let consumedAssistantChars = 0
  let sawClaudeResult = false
  let stoppedAfterClaudeResult = false
  let activeClaudeChild: ChildProcess | null = null
  let claudeResultStopTimer: NodeJS.Timeout | null = null
  const runtimeDiagnostics: CliRuntimeDiagnostics = {}
  const executablePath = await locateExecutable('claude')
  const managedRuntime = await readManagedNodeRuntime()
  const claudeSettings = await readResolvedClaudeSettingsDocument().catch(() => null)
  let args = buildClaudePromptArgs(input, resumeSessionId)
  const takeAssistantChunk = (snapshot: string, explicitChunk = '') => {
    const normalizedExplicitChunk = explicitChunk.trim()
    if (snapshot.length < consumedAssistantChars) {
      consumedAssistantChars = 0
    }
    if (normalizedExplicitChunk) {
      const matchedIndex = snapshot.indexOf(normalizedExplicitChunk, consumedAssistantChars)
      if (matchedIndex >= consumedAssistantChars) {
        consumedAssistantChars = matchedIndex + normalizedExplicitChunk.length
      }
      return normalizedExplicitChunk
    }

    const nextChunk = snapshot.slice(consumedAssistantChars).trim()
    consumedAssistantChars = snapshot.length
    return nextChunk
  }
  const clearClaudeResultStopTimer = () => {
    if (claudeResultStopTimer) {
      clearTimeout(claudeResultStopTimer)
      claudeResultStopTimer = null
    }
  }
  const stopClaudeAfterResult = () => {
    if (claudeResultStopTimer || !activeClaudeChild?.pid) {
      return
    }
    claudeResultStopTimer = setTimeout(() => {
      if (!activeClaudeChild?.pid || activeClaudeChild.exitCode !== null || activeClaudeChild.killed) {
        return
      }
      stoppedAfterClaudeResult = true
      void stopChildProcess(activeClaudeChild)
    }, 1200)
  }

  const emitClaudeToolUse = (
    toolName: string,
    toolInput: unknown,
    sourceKind: string,
    options: {
      toolUseId?: string
      indentLevel?: number
      assistantSnapshot?: string
      assistantChunk?: string
    } = {}
  ) => {
    const described = describeCliToolUse(toolName, toolInput)
    if (!described.meaningful) {
      return
    }
    const eventKey = buildCliToolUseEventKey(toolName, described)
    if (seenToolUseEvents.has(eventKey)) {
      return
    }
    seenToolUseEvents.add(eventKey)
    const indentLevel = Math.max(0, options.indentLevel || 0)
    if (options.toolUseId) {
      toolUseIndentLevels.set(options.toolUseId, indentLevel)
    }
    const assistantChunk = takeAssistantChunk(options.assistantSnapshot || partialText, options.assistantChunk || '')
    const intentText = summarizeCliIntentStep(assistantChunk || options.assistantSnapshot || partialText)
    if (intentText && intentText !== lastToolIntentText) {
      lastToolIntentText = intentText
      progress.intent(
        '执行意图',
        sessionId,
        intentText,
        undefined,
        toolName.trim() ? `intent.before_tool.${toolName.trim()}` : 'intent.before_tool',
        intentText,
        indentLevel
      )
    }
    if (described.command) {
      progress.command(
        described.message,
        described.command,
        sessionId,
        described.detail,
        described.files,
        sourceKind,
        indentLevel
      )
      return
    }
    progress.tool(described.message, sessionId, described.detail, described.files, sourceKind, indentLevel)
  }

  progress.intent('Claude 已开始处理当前任务。', sessionId, undefined, undefined, 'request.started')
  if (requestedSessionId && !resumeSessionId) {
    progress.status(
      '原 Claude 会话文件已不存在，已自动新建会话继续执行。',
      requestedSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.missing' }
    )
  }

  const runClaudeOnce = async () => {
    const invocation = await resolveNodeBackedCliInvocation('claude', executablePath, managedRuntime, args)
    return spawnCommandWithHandlers(invocation.command, invocation.args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    env: buildClaudeCliEnv(managedRuntime, claudeSettings),
    keepStdinOpen: false,
    stdinData: '\n',
    onSpawn: (child) => {
      activeClaudeChild = child
      activeCliProcesses.set(input.requestId, child)
      startCliPowerSaveBlocker(input.requestId)
      activeCliRequestStates.set(input.requestId, {
        client: 'claude',
        child,
        webContents,
        fullAccess: !!input.fullAccess,
        autoApprove: false,
        interactions: new Map(),
        interactionKeys: new Set(),
      })
    },
    onStdoutLine: (line) => {
      const parsed = parseJsonLine(line)
      if (!parsed) {
        const interaction = detectCliInteractionFromText(line)
        if (interaction) {
          emitCliInteractionPrompt({
            client: 'claude',
            requestId: input.requestId,
            sessionId,
            progress,
            interaction,
          })
        }
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
        return
      }

      if (parsed.type === 'assistant') {
        const parsedMessage =
          typeof parsed.message === 'object' && parsed.message
            ? (parsed.message as { content?: unknown })
            : undefined
        const assistantText = extractClaudeTextFromMessage(parsedMessage?.content)
        if (assistantText) {
          partialText = assistantText
        }
        const toolEntries = extractToolUseEntries(parsedMessage?.content)
        for (const toolEntry of toolEntries) {
          if (!toolEntry.name) {
            continue
          }
          const interaction = detectCliInteractionFromToolUse(toolEntry.name, toolEntry.input)
          if (interaction) {
            emitCliInteractionPrompt({
              client: 'claude',
              requestId: input.requestId,
              sessionId,
              progress,
              interaction,
            })
          }
          emitClaudeToolUse(toolEntry.name, toolEntry.input, `assistant.tool_use.${toolEntry.name}`, {
            toolUseId: toolEntry.id,
            assistantSnapshot: partialText,
            assistantChunk: toolEntry.textBefore,
          })
        }
        return
      }

      if (parsed.type === 'progress' && typeof parsed.data === 'object' && parsed.data) {
        const progressData = parsed.data as Record<string, unknown>
        if (progressData.type === 'agent_progress') {
          const parentToolUseId = typeof parsed.parentToolUseID === 'string' ? parsed.parentToolUseID.trim() : ''
          const indentLevel = parentToolUseId ? (toolUseIndentLevels.get(parentToolUseId) ?? 0) + 1 : 1
          const nestedMessage =
            typeof progressData.message === 'object' && progressData.message
              ? progressData.message as Record<string, unknown>
              : null
          const nestedPrompt = typeof progressData.prompt === 'string' ? progressData.prompt.trim() : ''

          if (nestedPrompt) {
            progress.intent('子任务目标', sessionId, nestedPrompt, undefined, 'agent_progress.prompt', nestedPrompt, indentLevel)
          }

          if (nestedMessage?.type === 'assistant') {
            const nestedPayload =
              typeof nestedMessage.message === 'object' && nestedMessage.message
                ? nestedMessage.message as { content?: unknown }
                : undefined
            const nestedAssistantText = extractClaudeTextFromMessage(nestedPayload?.content)
            const nestedToolEntries = extractToolUseEntries(nestedPayload?.content)
            for (const toolEntry of nestedToolEntries) {
              if (!toolEntry.name) {
                continue
              }
              emitClaudeToolUse(toolEntry.name, toolEntry.input, `agent_progress.tool_use.${toolEntry.name}`, {
                toolUseId: toolEntry.id,
                indentLevel,
                assistantSnapshot: nestedAssistantText,
                assistantChunk: toolEntry.textBefore,
              })
            }
          }

          return
        }
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
            const interaction = detectCliInteractionFromToolUse(block.name, block.input)
            if (interaction) {
              emitCliInteractionPrompt({
                client: 'claude',
                requestId: input.requestId,
                sessionId,
                progress,
              interaction,
            })
          }
            emitClaudeToolUse(block.name, block.input, `stream.tool_use.${block.name}`, {
              toolUseId: typeof block.id === 'string' ? block.id : '',
              assistantSnapshot: partialText,
            })
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
        sawClaudeResult = true
        stopClaudeAfterResult()
      }
    },
    onStderrLine: (line) => {
      const interaction = detectCliInteractionFromText(line)
      if (interaction) {
        emitCliInteractionPrompt({
          client: 'claude',
          requestId: input.requestId,
          sessionId,
          progress,
          interaction,
        })
      }
      const classified = classifyCliStderrLine(line)
      progress.status(classified.title, sessionId, false, undefined, {
        logKind: classified.logKind,
        sourceKind: classified.sourceKind,
        detail: line,
      })
    },
    })
  }
  let result = await runClaudeOnce()
  clearClaudeResultStopTimer()
  let attempt = 0
  if (
    resumeSessionId &&
    result.exitCode !== 0 &&
    !stoppedCliRequests.has(input.requestId) &&
    isClaudeStaleResumeFailure(result.stdout, result.stderr)
  ) {
    progress.status(
      '原 Claude 会话状态已失效，已自动新建会话重试。',
      resumeSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.recovered' }
    )
    sessionId = undefined
    partialText = ''
    finalResult = null
    planState = null
    planRecords.length = 0
    seenToolUseEvents.clear()
    toolUseIndentLevels.clear()
    lastToolIntentText = ''
    consumedAssistantChars = 0
    sawClaudeResult = false
    stoppedAfterClaudeResult = false
    activeClaudeChild = null
    clearClaudeResultStopTimer()
    args = buildClaudePromptArgs(input)
    attempt += 1
    result = await runClaudeOnce()
    clearClaudeResultStopTimer()
  }
  let retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  if (
    shouldAutoRetryCliRequest({
      diagnostics: retryDiagnostics,
      attempt,
      aborted: stoppedCliRequests.has(input.requestId),
      exitCode: result.exitCode,
      output: buildCliRetryOutputSnapshot(
        partialText,
        seenToolUseEvents.size > 0 ? '已产生 Claude 执行日志' : ''
      ),
    })
  ) {
    progress.status('检测到服务器瞬时异常，已自动重试一次。', sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'request.retry.transient',
      detail: retryDiagnostics.probableCause || '',
    })
    partialText = ''
    finalResult = null
    planState = null
    planRecords.length = 0
    seenToolUseEvents.clear()
    toolUseIndentLevels.clear()
    lastToolIntentText = ''
    consumedAssistantChars = 0
    sawClaudeResult = false
    stoppedAfterClaudeResult = false
    activeClaudeChild = null
    clearClaudeResultStopTimer()
    result = await runClaudeOnce()
    clearClaudeResultStopTimer()
    retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  }
  activeCliProcesses.delete(input.requestId)
  activeCliRequestStates.delete(input.requestId)
  stopCliPowerSaveBlocker(input.requestId)
  const aborted = stoppedCliRequests.delete(input.requestId)

  if (!finalResult) {
    finalResult =
      [...parseJsonObjectsFromText(result.stdout)]
        .reverse()
        .find((item) => item.type === 'result') ?? null
  }
  if (finalResult) {
    sawClaudeResult = true
  }

  const fileChanges = mergeFileChanges([], extractClaudeFileChanges(result.stdout.split(/\r?\n/)))

  if (!sessionId && typeof finalResult?.session_id === 'string') {
    sessionId = finalResult.session_id
  }

  const session = await waitForCliSession('claude', sessionId, {
    expectedUserContent: input.prompt,
    minUpdatedAtMs: requestStartedAtMs,
  })
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
  Object.assign(runtimeDiagnostics, retryDiagnostics)
  if (!session && output) {
    runtimeDiagnostics.sessionIssue = true
    runtimeDiagnostics.probableCause =
      runtimeDiagnostics.probableCause || 'CLI 已返回内容，但本地会话文件未能在等待窗口内落盘'
  }
  const success =
    !aborted &&
    output.length > 0 &&
    (
      result.exitCode === 0 ||
      (sawClaudeResult && stoppedAfterClaudeResult) ||
      (sawClaudeResult && finalResult?.is_error !== true)
    )
  const completedWithWarnings = !aborted && !success && output.length > 0 && !!runtimeDiagnostics.policyIssue
  if (!aborted) {
    progress.status('Claude 输出已结束，正在整理会话记录。', sessionId, true, undefined, {
      logKind: 'status',
      sourceKind: 'request.stream.completed',
      plan: planState,
    })
  }

  if (success) {
    progress.partial(output, sessionId, true)
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
  } else if (completedWithWarnings) {
    progress.partial(output, sessionId, true)
    progress.status('Claude 已返回回复，但部分命令被本地执行策略拦截。', sessionId, true, fileChanges, {
      logKind: 'status',
      sourceKind: 'result.with_warnings',
      detail: runtimeDiagnostics.probableCause || '',
      exitCode: result.exitCode,
      plan: planState,
    })
  } else if (aborted) {
    progress.status('Claude 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
  } else if (result.stderr.trim()) {
    progress.error('Claude 执行失败', sessionId, true, fileChanges, {
      logKind: 'error',
      sourceKind: 'request.failed',
      detail: buildCliFailureDetail(result.stderr.trim(), runtimeDiagnostics.probableCause),
      exitCode: result.exitCode,
      plan: planState,
    })
  }

  return {
    success: success || completedWithWarnings,
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
      completedWithWarnings,
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
        OPENAI_BASE_URL: normalizeCodexBaseUrl(request.baseUrl),
        OPENAI_API_BASE: normalizeCodexBaseUrl(request.baseUrl),
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

function buildNodeDownloadUrls(version: string) {
  const mirrorUrl = buildNodeDownloadUrl(version)
  return [
    mirrorUrl,
    mirrorUrl.replace(NODEJS_MIRROR_BASE_URL, 'https://nodejs.org/dist'),
  ]
}

async function resolveLatestLtsNodeVersion() {
  const sources = [
    `${NODEJS_MIRROR_BASE_URL}/index.json`,
    'https://nodejs.org/dist/index.json',
  ]
  let lastError = ''
  let versions: Array<{
    version?: string
    lts?: string | false
  }> = []

  for (const source of sources) {
    try {
      const response = await fetch(source)
      if (!response.ok) {
        lastError = `${source}：${response.status}`
        continue
      }
      versions = (await response.json()) as Array<{
        version?: string
        lts?: string | false
      }>
      if (versions.length > 0) {
        break
      }
    } catch (error) {
      lastError = `${source}：${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (!versions.length) {
    throw new Error(`获取 Node.js 版本列表失败${lastError ? `：${lastError}` : ''}`)
  }

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
  const archiveUrls = buildNodeDownloadUrls(version)
  const downloadDir = path.join(getToolchainRoot(), 'downloads')
  const archiveName = path.basename(new URL(archiveUrls[0]).pathname)
  const archivePath = path.join(downloadDir, archiveName)
  const extractRoot = getManagedNodeRoot()

  await fs.mkdir(downloadDir, { recursive: true })
  await clearDirectory(extractRoot)

  let archiveBuffer: Buffer | null = null
  let lastDownloadError = ''
  for (const archiveUrl of archiveUrls) {
    logger.info('node', 'running', `准备下载 Node.js ${version}`, archiveUrl)
    try {
      const response = await fetch(archiveUrl)
      if (!response.ok) {
        lastDownloadError = `${archiveUrl}：${response.status}`
        continue
      }
      archiveBuffer = Buffer.from(await response.arrayBuffer())
      if (archiveBuffer.length > 0) {
        break
      }
      lastDownloadError = `${archiveUrl}：下载内容为空`
    } catch (error) {
      lastDownloadError = `${archiveUrl}：${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (!archiveBuffer) {
    throw new Error(`下载 Node.js 失败${lastDownloadError ? `：${lastDownloadError}` : ''}`)
  }
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
  const installedVersion =
    nodeVersionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || version
  if (!isDesktopCliNodeVersionSupported(installedVersion)) {
    throw new Error(
      `Node.js 安装后版本过低：${installedVersion}。Codex / Claude 一键部署需要 Node.js ${MIN_DESKTOP_CLI_NODE_MAJOR}+。`
    )
  }

  return {
    ...runtime,
    version: installedVersion,
  }
}

async function ensureNodeRuntime(
  logger: ReturnType<typeof createDeployLogger>
): Promise<NodeRuntimeInfo> {
  async function verifyRuntime(runtime: NodeRuntimeInfo, label: '系统' | '内置') {
    const versionResult = await runLoggedCommand(logger, 'node', runtime.nodePath, ['--version'])
    const npmVersionResult = await runLoggedNpmCommand(logger, 'node', runtime, ['--version'])
    const version =
      versionResult.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || ''
    if (versionResult.exitCode !== 0 || npmVersionResult.exitCode !== 0) {
      logger.info(
        'node',
        'running',
        `${label} Node.js 不完整，准备使用内置 Node.js`,
        [
          versionResult.stderr || versionResult.stdout,
          npmVersionResult.stderr || npmVersionResult.stdout,
        ].filter(Boolean).join('\n')
      )
      return null
    }

    if (!isDesktopCliNodeVersionSupported(version)) {
      logger.info(
        'node',
        'running',
        `${label} Node.js ${version || '未知版本'} 版本过低，准备使用内置 Node.js`,
        `Codex / Claude 一键部署需要 Node.js ${MIN_DESKTOP_CLI_NODE_MAJOR}+。`
      )
      return null
    }

    logger.info('node', 'success', `已检测到${label} Node.js ${version || '未知版本'}`, runtime.nodePath)
    return {
      ...runtime,
      version,
    }
  }

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
    const verified = await verifyRuntime(systemRuntime, '系统')
    if (verified) {
      return verified
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
    const verified = await verifyRuntime(managedRuntime, '内置')
    if (verified) {
      return verified
    }
  }

  logger.info('node', 'running', '当前未检测到可用 Node.js 18+，开始安装内置 Node.js')
  return installManagedNodeRuntime(logger)
}

function buildRuntimeEnv(runtime: NodeRuntimeInfo) {
  const nodeDir = path.dirname(runtime.nodePath)
  const prefixBin = getManagedPrefixBin(runtime.prefixPath)
  const pathSegments = [prefixBin, nodeDir, process.env.PATH || ''].filter(Boolean)
  const npmConfigPaths = ensureDesktopCliNpmConfigFiles()

  return {
    ...sanitizeCliNpmEnvironment(process.env, {
      registry: 'https://registry.npmmirror.com',
      prefix: runtime.prefixPath,
      cache: path.join(getToolchainRoot(), 'npm-cache'),
      userConfig: npmConfigPaths.userConfigPath,
      globalConfig: npmConfigPaths.globalConfigPath,
    }),
    PATH: pathSegments.join(process.platform === 'win32' ? ';' : ':'),
  }
}

function buildCliExecutionEnv(runtime?: NodeRuntimeInfo | null) {
  const npmConfigPaths = ensureDesktopCliNpmConfigFiles()
  if (runtime) {
    return buildRuntimeEnv(runtime)
  }

  return {
    ...sanitizeCliNpmEnvironment(process.env, {
      registry: 'https://registry.npmmirror.com',
      cache: path.join(getToolchainRoot(), 'npm-cache'),
      userConfig: npmConfigPaths.userConfigPath,
      globalConfig: npmConfigPaths.globalConfigPath,
    }),
  }
}

function ensureDesktopCliNpmConfigFiles() {
  const configDir = path.join(getToolchainRoot(), 'npm-config')
  const userConfigPath = path.join(configDir, 'user.npmrc')
  const globalConfigPath = path.join(configDir, 'global.npmrc')
  const content = [
    'registry=https://registry.npmmirror.com',
    'proxy=',
    'https-proxy=',
    'noproxy=*',
    'offline=false',
    'prefer-offline=false',
    'prefer-online=true',
  ].join('\n')

  mkdirSync(configDir, { recursive: true })
  writeFileSync(userConfigPath, content, 'utf8')
  writeFileSync(globalConfigPath, content, 'utf8')

  return {
    userConfigPath,
    globalConfigPath,
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
  if (versionResult.exitCode !== 0 || !isDesktopCliNodeVersionSupported(version)) {
    return null
  }

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

    const postInstallDetection = await inspectCli(client)
    if (!postInstallDetection.installed) {
      logger.info(
        'install',
        'error',
        `${client} 安装后仍未检测到可用可执行文件`,
        postInstallDetection.executablePath || '未找到可执行文件'
      )
      return
    }
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
    void startMobileBridgeLoop()

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
  setMobileBridgePowerSaveBlocker(false)
  for (const requestId of activeCliPowerSaveBlockers.keys()) {
    stopCliPowerSaveBlocker(requestId)
  }
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
ipcMain.handle('app:get-update-state', () => desktopUpdateState)
ipcMain.handle('app:check-update', async (_event, input?: { userInitiated?: boolean }) =>
  checkForDesktopUpdate(input)
)
ipcMain.handle('app:start-update-download', async () => startDesktopUpdateDownload())
ipcMain.handle('app:install-update', async () => installDesktopUpdate())
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
  stopApiPowerSaveBlocker(requestId)
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
ipcMain.handle('desktop:stat-path', async (_event, targetPath: string) => {
  return statDesktopPath(targetPath)
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

ipcMain.handle('desktop:get-mobile-bridge-device', async () => {
  return getMobileBridgeLocalDevice()
})

ipcMain.handle('desktop:reset-mobile-bridge-device', async () => {
  return resetMobileBridgeDeviceId()
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
  stopCliPowerSaveBlocker(requestId)
})
ipcMain.handle('desktop:respond-cli-interaction', async (_event, input: CliInteractionResponseRequest) => {
  const state = activeCliRequestStates.get(input.requestId)
  if (!state) {
    throw new Error('当前 CLI 任务已结束，无法再处理该确认请求。')
  }

  const interaction = state.interactions.get(input.interactionId)
  if (!interaction) {
    throw new Error('该确认请求已处理或不存在。')
  }

  const responded = writeCliInteractionResponse(input.requestId, input.interactionId, input.action)
  if (!responded) {
    throw new Error('CLI 交互响应发送失败。')
  }

  createCliProgressEmitter(state.webContents, state.client, input.requestId).status(
    input.action === 'reject'
      ? '已拒绝本次 CLI 确认请求。'
      : input.action === 'approve_always'
        ? '已确认本次请求，并对当前任务后续同类请求持续放行。'
        : '已确认本次 CLI 请求。',
    undefined,
    false,
    undefined,
    {
      logKind: 'status',
      sourceKind: 'interaction.responded',
      detail: interaction.message,
      command: interaction.command,
      interaction: {
        ...interaction,
        status:
          input.action === 'reject'
            ? 'rejected'
            : input.action === 'approve_always'
              ? 'approved_always'
              : 'approved',
      },
    }
  )
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
