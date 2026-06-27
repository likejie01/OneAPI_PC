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
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'
import type { ChatCompletionResponse, ImageGenerationResponse } from '../src/shared/contracts'
import type {
  CliExtensionEntry,
  CliExtensionInstallRequest,
  CliInteractionPrompt,
  CliInteractionResponseRequest,
  CliPlanState,
  DesktopAppMeta,
  DesktopChatStreamPayload,
  DesktopChatStreamRequest,
  DesktopCustomChatCompletionRequest,
  DesktopCustomChatStreamRequest,
  DesktopCustomImageEditRequest,
  DesktopCustomImageGenerationRequest,
  DesktopCustomModelListRequest,
  DesktopDeleteCliMessageRequest,
  DesktopDeleteCliSessionsRequest,
  DesktopReleaseManifest,
  DesktopReleasePlatform,
  DesktopUpdateState,
  DesktopExportTextFileRequest,
  DesktopOpenHtmlRequest,
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
import {
  resolveImageGenerationResult,
  resolveImagePendingPollUrl,
  resolveImagePendingStatus,
  resolveImageResponseErrorMessage,
} from '../src/lib/image-generation.ts'
import {
  assertAllowedExternalUrl,
  createCliAccessDirectoryResolver,
  pathExists,
  readFilePreview,
  resolveOpenTarget,
} from './desktop-boundaries.ts'
import { parseDesktopChatStreamEventBlock, type DesktopChatStreamParsedLine } from '../src/lib/chat-reasoning.ts'
import { extractCliUserTask } from '../src/lib/cli-prompt.ts'
import { buildFinalPrompt } from '../src/process/prompt-assembler/build-final-prompt.ts'
import { buildExecutionCycleEvents } from '../src/process/execution-orchestrator/run-request.ts'
import {
  buildNodeBackedCliScriptPath,
  buildWindowsNodeExecutableCandidates,
  buildWindowsNpmGlobalCliCandidates,
  buildWindowsCommandShimArgs,
  resolveWindowsCommandShimCommand,
  resolveCliProbeResult,
  shouldUseWindowsCommandShimForPath,
} from '../src/lib/desktop-service.ts'
import {
  createMobileBridgeEventMapper,
  materializeMobileBridgeAttachments,
  normalizeMobileBridgeJob,
  resolveMobileBridgeExtensionRefs,
  type MobileBridgeJob,
} from './mobile-bridge.ts'
import { createCliServices } from './main-cli-services.ts'

const DEFAULT_SERVER_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_BASE_URL = 'https://ai.oneapi.center/v1'
const DEFAULT_CLAUDE_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_MODEL = 'gpt-5.4'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'
const MOBILE_BRIDGE_PENDING_JOB_ACTIVE_INTERVAL_MS = 1000
const MOBILE_BRIDGE_PENDING_JOB_IDLE_INTERVAL_MS = 2000
const MOBILE_BRIDGE_HEARTBEAT_INTERVAL_MS = 30000
const MOBILE_BRIDGE_AUX_SNAPSHOT_FALLBACK_INTERVAL_MS = 5 * 60 * 1000
const MOBILE_BRIDGE_SNAPSHOT_FALLBACK_INTERVAL_MS = 10 * 60 * 1000
const MOBILE_BRIDGE_MAX_SESSION_SNAPSHOTS = 20
const MOBILE_BRIDGE_MAX_SESSION_MESSAGES = 5
const MOBILE_BRIDGE_MAX_SESSION_LOGS = 5
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
  sessionId: string
  projectPath: string
  prompt: string
  startedAt: number
  fullAccess: boolean
  autoApprove: boolean
  interactions: Map<string, CliInteractionPrompt>
  interactionKeys: Set<string>
  mobileBridgeLogs: Array<Record<string, unknown>>
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
const mobileBridgeAuxSnapshotState = new Map<string, { signature: string; uploadedAt: number }>()
let mobileBridgeLastSessionsSnapshotSignature = ''
let mobileBridgeLastSessionsSnapshotAt = 0
let mobileBridgeLastModelSelectionErrorAt = 0
const assistantHistoryWriteSignatures = new Map<string, string>()
const cliAccessDirectories = createCliAccessDirectoryResolver(getDesktopAttachmentDirectory)
const activeMobileBridgeJobIds = new Set<string>()

function rememberCliAuthorizedDirectory(targetPath: string) {
  cliAccessDirectories.rememberDirectory(targetPath)
}

async function rememberCliAuthorizedOpenTarget(targetPath: string) {
  await cliAccessDirectories.rememberOpenTarget(targetPath)
}

function getDesktopAttachmentDirectory() {
  return path.join(app.getPath('userData'), 'attachments')
}

function resolveCliAdditionalAccessDirectories(projectPath: string) {
  return cliAccessDirectories.resolve(projectPath)
}

function openExternalSafely(url: string) {
  try {
    void shell.openExternal(assertAllowedExternalUrl(url)).catch(() => undefined)
  } catch {
    // Context-menu and window-open handlers cannot surface IPC errors to the renderer.
  }
}

function sanitizeHtmlFileName(value?: string) {
  const normalized = (value || 'alipay-checkout')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return normalized || 'alipay-checkout'
}

async function openHtmlInExternalBrowser(input: DesktopOpenHtmlRequest) {
  const html = String(input?.html || '').trim()
  if (!html || !/<form[\s>]/i.test(html)) {
    throw new Error('支付表单内容无效。')
  }
  const tempDir = path.join(app.getPath('temp'), 'oneapi-pc-payments')
  await fs.mkdir(tempDir, { recursive: true })
  const fileName = `${sanitizeHtmlFileName(input.suggestedName)}-${Date.now()}-${randomUUID()}.html`
  const filePath = path.join(tempDir, fileName)
  await fs.writeFile(filePath, html, { encoding: 'utf8', mode: 0o600 })
  await shell.openExternal(pathToFileURL(filePath).toString())
  setTimeout(() => {
    void fs.rm(filePath, { force: true }).catch(() => undefined)
  }, 10 * 60 * 1000)
}

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
  return normalized === '/pg/chat/completions' || isImageApiPath(normalized)
}

function isImageApiPath(pathname: string) {
  const normalized = pathname.split('?', 1)[0]
  return normalized === '/pg/images/generations' ||
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

interface MobileBridgeInteractionResponse {
  responseId: string
  jobId: string
  interactionId: string
  action: CliInteractionResponseRequest['action']
}

interface MobileBridgeModelSelection {
  selectionId?: string
  selection_id?: string
  client?: string
  model?: string
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
  mobileBridgeAuxSnapshotState.clear()
  mobileBridgeLastSessionsSnapshotSignature = ''
  mobileBridgeLastSessionsSnapshotAt = 0
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

interface CliFileChange {
  path: string
  kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  content?: string
  diff?: string
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

interface CliRunRequest {
  client: CliClient
  requestId: string
  projectPath: string
  prompt: string
  sessionId?: string
  model?: string
  reasoningEffort?: string
  fullAccess?: boolean
  apiKey?: string
  apiKeySource?: 'oneapi' | 'custom'
  baseUrl?: string
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
  projectPath?: string
  prompt?: string
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
  apiKeySource?: 'oneapi' | 'custom'
  model?: string
  baseUrl?: string
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
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
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
    openExternalSafely(url)
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
            openExternalSafely(params.linkURL)
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
            openExternalSafely(params.srcURL)
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

function buildOpenAICompatibleUrl(baseUrl: string, requestPath: string) {
  const normalizedBase = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalizedBase)) {
    throw new Error('自定义 API Base URL 必须以 http:// 或 https:// 开头。')
  }
  const baseWithVersion = /\/v1$/i.test(normalizedBase) ? normalizedBase : `${normalizedBase}/v1`
  const normalizedPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`
  return new URL(`${baseWithVersion}${normalizedPath}`).toString()
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

function normalizeDesktopChatReasoningEffort(value?: string) {
  switch ((value || '').trim()) {
    case '关闭':
    case 'off':
    case 'none':
      return 'none'
    case '低':
    case 'low':
      return 'low'
    case '中':
    case 'medium':
      return 'medium'
    case '高':
    case 'high':
      return 'high'
    case '极高':
    case '极限':
    case 'xhigh':
    case 'max':
      return 'xhigh'
    default:
      return undefined
  }
}

async function requestChatStream(sender: WebContents, input: DesktopChatStreamRequest) {
  const controller = new AbortController()
  activeApiRequests.set(input.requestId, controller)
  startApiPowerSaveBlocker(input.requestId)
  const reasoningEffort = normalizeDesktopChatReasoningEffort(input.reasoningEffort)

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
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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

async function requestCustomChatCompletion(input: DesktopCustomChatCompletionRequest) {
  const controller = input.requestId ? new AbortController() : null
  if (input.requestId && controller) {
    activeApiRequests.set(input.requestId, controller)
    startApiPowerSaveBlocker(input.requestId)
  }
  try {
    const response = await getDesktopSession().fetch(buildOpenAICompatibleUrl(input.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        stream: false,
      }),
      signal: controller?.signal,
    })
    const data = await parseResponse(response)
    if (!response.ok) {
      throw new Error(getResponseErrorMessage(data, response.status, '自定义 API 聊天请求失败'))
    }
    return data as ChatCompletionResponse
  } finally {
    if (input.requestId) {
      activeApiRequests.delete(input.requestId)
      stopApiPowerSaveBlocker(input.requestId)
    }
  }
}

async function requestCustomChatStream(sender: WebContents, input: DesktopCustomChatStreamRequest) {
  const controller = new AbortController()
  activeApiRequests.set(input.requestId, controller)
  startApiPowerSaveBlocker(input.requestId)

  try {
    const response = await getDesktopSession().fetch(buildOpenAICompatibleUrl(input.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
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
        message: getResponseErrorMessage(data, response.status, '自定义 API 聊天请求失败'),
      })
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      emitChatStream(sender, {
        requestId: input.requestId,
        type: 'error',
        message: '当前自定义 API 不支持流式响应。',
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
          : '自定义 API 聊天请求失败',
    })
  } finally {
    activeApiRequests.delete(input.requestId)
    stopApiPowerSaveBlocker(input.requestId)
  }
}

async function requestCustomImageGeneration(input: DesktopCustomImageGenerationRequest) {
  const controller = input.requestId ? new AbortController() : null
  const timeoutMs = resolveDesktopRequestTimeoutMs('/v1/images/generations')
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  if (input.requestId && controller) {
    activeApiRequests.set(input.requestId, controller)
    startApiPowerSaveBlocker(input.requestId)
  }
  try {
    const response = await getDesktopSession().fetch(buildOpenAICompatibleUrl(input.baseUrl, '/images/generations'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        n: input.n,
        size: input.size,
        quality: input.quality,
        response_format: input.response_format,
      }),
      signal: controller?.signal,
    })
    const data = await parseResponse(response)
    if (!response.ok) {
      throw new Error(getResponseErrorMessage(data, response.status, '自定义 API 图片生成失败'))
    }
    return resolveAsyncImageGenerationResponse(data, {
      authorization: `Bearer ${input.apiKey}`,
      pollBaseUrl: input.baseUrl,
      signal: controller?.signal,
      timeoutMessage: formatDesktopRequestTimeoutMessage(timeoutMs),
    })
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    if (input.requestId) {
      activeApiRequests.delete(input.requestId)
      stopApiPowerSaveBlocker(input.requestId)
    }
  }
}

const IMAGE_POLL_INTERVAL_MS = 2000

function sleep(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('请求已取消'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('请求已取消'))
    }, { once: true })
  })
}

async function resolveAsyncImageGenerationResponse(
  initialData: unknown,
  options: {
    authorization?: string
    pollBaseUrl?: string
    signal?: AbortSignal | null
    timeoutMessage?: string
  } = {}
): Promise<ImageGenerationResponse> {
  let data = initialData
  let pollUrl = resolveImagePendingPollUrl(data)

  for (let attempt = 0; attempt < 300 && pollUrl; attempt += 1) {
    if (resolveImageGenerationResult(data)) {
      return data as ImageGenerationResponse
    }

    const status = resolveImagePendingStatus(data)
    if (status === 'failed') {
      throw new Error(resolveImageResponseErrorMessage(data) || '图片任务执行失败')
    }
    if (status === 'completed') {
      throw new Error(resolveImageResponseErrorMessage(data) || '图片任务已完成但未返回可展示图片')
    }
    if (attempt > 0 || status === 'pending' || pollUrl) {
      await sleep(IMAGE_POLL_INTERVAL_MS, options.signal)
    }

    const response = await getDesktopSession().fetch(resolveImagePollUrl(pollUrl, options.pollBaseUrl), {
      method: 'GET',
      headers: {
        ...(options.authorization ? { Authorization: options.authorization } : {}),
      },
      signal: options.signal ?? undefined,
    })
    data = await parseResponse(response)
    if (!response.ok) {
      throw new Error(getResponseErrorMessage(data, response.status, '图片任务轮询失败'))
    }
    pollUrl = resolveImagePendingPollUrl(data) || pollUrl
  }

  if (resolveImageGenerationResult(data)) {
    return data as ImageGenerationResponse
  }

  if (pollUrl) {
    throw new Error(options.timeoutMessage || '图片任务超时')
  }

  return data as ImageGenerationResponse
}

function resolveImagePollUrl(pollUrl: string, pollBaseUrl?: string) {
  const normalizedPollUrl = pollUrl.trim()
  if (/^https?:\/\//i.test(normalizedPollUrl)) {
    return normalizedPollUrl
  }
  if (pollBaseUrl?.trim()) {
    return buildOpenAICompatibleUrl(pollBaseUrl, normalizedPollUrl)
  }
  return buildUrl(normalizedPollUrl)
}

async function requestCustomProviderModels(input: DesktopCustomModelListRequest) {
  const response = await getDesktopSession().fetch(buildOpenAICompatibleUrl(input.baseUrl, '/models'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
  })
  const data = await parseResponse(response)
  if (!response.ok) {
    throw new Error(getResponseErrorMessage(data, response.status, '读取自定义 API 模型列表失败'))
  }
  const records =
    data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: Array<{ id?: unknown }> }).data
      : []
  return records
    .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
    .filter(Boolean)
}

interface MobileBridgeSessionSnapshot {
  id: string
  client: CliClient
  sessionId: string
  title: string
  preview: string
  projectName: string
  projectPath: string
  model?: string
  status: string
  updatedAt: number
  purposes: string[]
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    text: string
    timestamp: number
  }>
  logs: Array<Record<string, unknown>>
  lastUploadedVersion?: string
  sessionUpdatedAt?: number
  messageCount?: number
  logCount?: number
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

    const data = await parseResponse(response)
    const resolvedData =
      response.ok && isImageApiPath(input.path)
        ? await resolveAsyncImageGenerationResponse(data, {
            authorization: headers.get('Authorization') || '',
            signal: controller?.signal,
            timeoutMessage: formatDesktopRequestTimeoutMessage(timeoutMs),
          })
        : data

    return {
      ok: response.ok,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data: resolvedData,
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

function shouldUploadMobileBridgeAuxSnapshot(kind: string, signature: string) {
  const now = Date.now()
  const state = mobileBridgeAuxSnapshotState.get(kind)
  if (state?.signature === signature && now - state.uploadedAt < MOBILE_BRIDGE_AUX_SNAPSHOT_FALLBACK_INTERVAL_MS) {
    return false
  }
  mobileBridgeAuxSnapshotState.set(kind, {
    signature,
    uploadedAt: now,
  })
  return true
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
  if (!shouldUploadMobileBridgeAuxSnapshot('extensions', signature)) {
    return
  }
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
    // Keep the empty fallback initialized above.
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
  const signature = JSON.stringify(assistants)
  if (!shouldUploadMobileBridgeAuxSnapshot('assistants', signature)) {
    return
  }
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

function cliTimestampToMillis(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now()
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

function updateActiveCliSessionState(requestId: string, sessionId?: string) {
  const clean = sessionId?.trim()
  if (!requestId || !clean) {
    return
  }
  const state = activeCliRequestStates.get(requestId)
  if (state) {
    state.sessionId = clean
  }
}

function activeCliSnapshotForSession(client: CliClient, sessionId: string) {
  const cleanSessionId = sessionId.trim()
  if (!cleanSessionId) {
    return null
  }
  for (const [requestId, state] of activeCliRequestStates.entries()) {
    if (state.client === client && state.sessionId.trim() === cleanSessionId) {
      return { requestId, state }
    }
  }
  return null
}

function limitMobileBridgeSessionPayload(session: MobileBridgeSessionSnapshot): MobileBridgeSessionSnapshot {
  const messages = session.messages.slice(-MOBILE_BRIDGE_MAX_SESSION_MESSAGES)
  const logs = session.logs.slice(-MOBILE_BRIDGE_MAX_SESSION_LOGS)
  const sessionUpdatedAt = Number(session.updatedAt || Date.now())
  const messageCount = session.messages.length
  const logCount = session.logs.length
  const lastUploadedVersion = JSON.stringify({
    id: session.id,
    client: session.client,
    sessionId: session.sessionId,
    sessionUpdatedAt,
    messageCount,
    logCount,
    lastMessage: messages.at(-1)?.id || messages.at(-1)?.timestamp || '',
    lastLog: JSON.stringify(logs.at(-1) || {}).slice(0, 240),
    status: session.status,
    model: session.model || '',
    projectPath: session.projectPath,
  })
  return {
    ...session,
    updatedAt: sessionUpdatedAt,
    messages,
    logs,
    sessionUpdatedAt,
    messageCount,
    logCount,
    lastUploadedVersion,
  }
}

function shouldUploadMobileBridgeSessionsSnapshot(signature: string, force: boolean) {
  const now = Date.now()
  if (!force && signature === mobileBridgeLastSessionsSnapshotSignature && now - mobileBridgeLastSessionsSnapshotAt < MOBILE_BRIDGE_SNAPSHOT_FALLBACK_INTERVAL_MS) {
    return false
  }
  mobileBridgeLastSessionsSnapshotSignature = signature
  mobileBridgeLastSessionsSnapshotAt = now
  return true
}

function buildActiveMobileBridgeSessionSnapshot(requestId: string, state: NonNullable<ReturnType<typeof activeCliSnapshotForSession>>['state']): MobileBridgeSessionSnapshot {
  const projectPath = state.projectPath.trim()
  const projectName = projectPath ? path.basename(projectPath) || projectPath : '本机项目'
  const sessionId = state.sessionId.trim() || `running-${state.client}-${requestId}`
  const prompt = normalizeWhitespace(extractCliUserTask(state.prompt) || state.prompt)
  return {
    id: sessionId,
    client: state.client,
    sessionId,
    title: projectName,
    preview: prompt || `${state.client === 'codex' ? 'Codex' : 'Claude'} 正在执行`,
    projectName,
    projectPath,
    model: '',
    status: 'running',
    updatedAt: Date.now(),
    purposes: [],
    messages: prompt ? [{
      id: `running-${requestId}-prompt`,
      role: 'user',
      text: prompt,
      timestamp: state.startedAt,
    }] : [],
    logs: state.mobileBridgeLogs.slice(-MOBILE_BRIDGE_MAX_SESSION_LOGS),
  }
}

async function buildMobileBridgeSessionSnapshot(client: CliClient, entry: CliHistoryEntry): Promise<MobileBridgeSessionSnapshot | null> {
  const details = client === 'codex'
    ? await getCodexSession(entry.id).catch(() => null)
    : await getClaudeSession(entry.id).catch(() => null)
  if (!details && !entry.projectPath && !entry.preview.trim()) {
    return null
  }

  const messages = (details?.messages || []).map((message: {
    id: string
    role: 'user' | 'assistant'
    content: string
    createdAt: number
  }) => ({
    id: message.id,
    role: message.role,
    text: message.content,
    timestamp: cliTimestampToMillis(message.createdAt),
  }))
  const preview = normalizeWhitespace(
    messages.at(-1)?.text ||
    entry.preview ||
    details?.preview ||
    ''
  )
  const projectPath = details?.projectPath || entry.projectPath || ''
  const projectName =
    details?.projectName ||
    entry.projectName ||
    (projectPath ? path.basename(projectPath) : '') ||
    '本机项目'
  const updatedAt = cliTimestampToMillis(details?.updatedAt || entry.updatedAt)
  const model = [...(details?.messages || [])]
    .reverse()
    .map((message) => message.modelLabel?.trim() || '')
    .find((value) => value && value.toLowerCase() !== client)
  const selectedModelRaw = await getRendererStorageValue(`oneapi-desktop-${client}-selected-model`)
  let selectedModel = selectedModelRaw.trim()
  try {
    selectedModel = selectedModelRaw ? String(JSON.parse(selectedModelRaw)).trim() : ''
  } catch {
    // Keep the raw storage value when it was not JSON encoded.
  }

  const sessionId = details?.id || entry.id
  const active = activeCliSnapshotForSession(client, sessionId)

  return {
    id: details?.id || entry.id,
    client,
    sessionId,
    title: entry.title || projectName,
    preview,
    projectName,
    projectPath,
    model: selectedModel || model,
    status: active ? 'running' : 'synced',
    updatedAt,
    purposes: [],
    messages,
    logs: [],
  }
}

async function syncMobileBridgeSessionsSnapshot(force = false) {
  const deviceId = await getMobileBridgeDeviceId()
  const [codexHistory, claudeHistory] = await Promise.all([
    listCodexHistory(MOBILE_BRIDGE_MAX_SESSION_SNAPSHOTS).catch(() => [] as CliHistoryEntry[]),
    listClaudeHistory(MOBILE_BRIDGE_MAX_SESSION_SNAPSHOTS).catch(() => [] as CliHistoryEntry[]),
  ])
  const entries = await Promise.all([
    ...codexHistory.map((item) => buildMobileBridgeSessionSnapshot('codex', item)),
    ...claudeHistory.map((item) => buildMobileBridgeSessionSnapshot('claude', item)),
  ])
  const sessions = entries
    .filter((item): item is MobileBridgeSessionSnapshot => !!item)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const existingKeys = new Set(sessions.map((item) => `${item.client}\n${item.sessionId}`))
  for (const [requestId, state] of activeCliRequestStates.entries()) {
    const sessionId = state.sessionId.trim()
    const key = `${state.client}\n${sessionId}`
    if (sessionId && existingKeys.has(key)) {
      continue
    }
    const snapshot = buildActiveMobileBridgeSessionSnapshot(requestId, state)
    sessions.unshift(snapshot)
    existingKeys.add(`${snapshot.client}\n${snapshot.sessionId}`)
  }

  const boundedSessions = sessions
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MOBILE_BRIDGE_MAX_SESSION_SNAPSHOTS)
    .map(limitMobileBridgeSessionPayload)

  const signature = JSON.stringify(boundedSessions.map((item) => ({
    id: item.id,
    client: item.client,
    lastUploadedVersion: item.lastUploadedVersion,
    sessionUpdatedAt: item.sessionUpdatedAt,
    messageCount: item.messageCount,
    logCount: item.logCount,
  })))
  if (!shouldUploadMobileBridgeSessionsSnapshot(signature, force)) {
    return
  }

  await requestMobileBridgeJson({
    method: 'POST',
    path: '/api/mobile/desktop-sessions/snapshot',
    query: {
      device_id: deviceId,
    },
    body: boundedSessions,
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

async function applyMobileBridgeModelSelections() {
  const deviceId = await getMobileBridgeDeviceId()
  const selections = await requestMobileBridgeJson<MobileBridgeModelSelection[]>({
    method: 'GET',
    path: '/api/mobile/desktop-model-selection/pending',
    query: {
      device_id: deviceId,
    },
  })
  let changed = false
  for (const item of selections) {
    const selectionId = (item.selectionId || item.selection_id || '').trim()
    const client = (item.client || '').trim().toLowerCase() as CliClient
    const model = (item.model || '').trim()
    if ((client === 'codex' || client === 'claude') && model) {
      await applyRendererDesktopModelSelection(client, model)
      changed = true
    }
    if (selectionId) {
      await requestMobileBridgeJson({
        method: 'POST',
        path: `/api/mobile/desktop-model-selection/${encodeURIComponent(selectionId)}/ack`,
      }).catch(() => undefined)
    }
  }
  if (changed) {
    mobileBridgeLastSessionsSnapshotSignature = ''
    await syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)
  }
}

async function applyMobileBridgeModelSelectionsSafely() {
  try {
    await applyMobileBridgeModelSelections()
  } catch (error) {
    const now = Date.now()
    if (now - mobileBridgeLastModelSelectionErrorAt < MOBILE_BRIDGE_HEARTBEAT_INTERVAL_MS) {
      return
    }
    mobileBridgeLastModelSelectionErrorAt = now
    const message = error instanceof Error ? error.message : String(error)
    // Model selection sync is auxiliary; keep the bridge degraded note but never block job polling.
    await heartbeatMobileBridgeDevice('degraded', `model selection sync failed: ${message}`).catch(() => undefined)
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
  const projectPath = job.projectPath.trim() || (await readBridgeClientProjectPath(job.client)).trim() || os.homedir()
  const projectName = path.basename(projectPath) || projectPath
  const fullAccess = job.permissionMode === 'full' || job.permissionMode === 'full_access'
  const attachments = await materializeMobileBridgeAttachments({
    userDataPath: app.getPath('userData'),
    jobId: job.jobId,
    attachments: job.attachments,
  })
  const extensions = resolveMobileBridgeExtensionRefs({
    client: job.client,
    refs: job.extensionRefs,
    installed: await listCliExtensions(job.client).catch(() => [] as CliExtensionEntry[]),
  })
  const promptSnapshot = buildFinalPrompt({
    prompt: job.prompt,
    client: job.client,
    projectPath,
    fullAccess,
    attachments,
    extensions,
  })

  await postMobileBridgeJobEvent(job.jobId, {
    id: `${requestId}-project`,
    sessionId: requestedSessionId,
    type: 'project',
    phase: 'project',
    level: 0,
    title: projectName,
    body: projectPath,
    source: 'mobile',
    origin: 'mobile',
    createdAt: Date.now(),
  })

  await postMobileBridgeJobEvent(job.jobId, {
    id: `${requestId}-user`,
    sessionId: requestedSessionId,
    type: 'message',
    role: 'user',
    text: job.prompt,
    source: 'mobile',
    origin: 'mobile',
    clientRequestId: job.clientRequestId,
    createdAt: Date.now(),
  })

  await postMobileBridgeJobEvent(job.jobId, {
    id: `${requestId}-running`,
    sessionId: requestedSessionId,
    type: 'log',
    phase: 'running',
    level: 0,
    title: `${job.client === 'codex' ? 'Codex' : 'Claude'} 正在执行`,
    body: '桌面客户端已接管当前任务，正在等待执行输出。',
    source: 'mobile',
    origin: 'mobile',
    createdAt: Date.now(),
  })

  for (const event of buildExecutionCycleEvents({
    sessionId: requestedSessionId,
    requestId,
    intent: job.prompt,
    finalPrompt: promptSnapshot.finalPrompt,
    commandTitle: '任务准备',
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
      source: 'mobile',
      origin: 'mobile',
      createdAt: event.createdAt,
    })
  }

  const mapMobileBridgeEvent = createMobileBridgeEventMapper(job.jobId)
  mobileBridgeProgressMirrors.set(requestId, (payload) => {
    const events = mapMobileBridgeEvent(payload)
    for (const mapped of events) {
      void postMobileBridgeJobEvent(job.jobId, mapped).catch(() => undefined)
    }
  })

  const interactionState = { done: false }
  const interactionLoop = runMobileBridgeInteractionLoop(requestId, job.jobId, interactionState)
  setMobileBridgePowerSaveBlocker(true)
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
        sessionId: result.sessionId,
        type: 'message',
        role: 'assistant',
        text: result.output.trim(),
        source: 'mobile',
        origin: 'mobile',
        createdAt: Date.now(),
      })
    }

    if (!result.success) {
      await postMobileBridgeJobEvent(job.jobId, {
        id: `${requestId}-failed`,
        sessionId: result.sessionId,
        type: 'error',
        phase: 'error',
        level: 2,
        title: '执行失败',
        body: result.error || 'CLI 执行未返回成功结果。',
        source: 'mobile',
        origin: 'mobile',
        createdAt: Date.now(),
      })
    } else {
      await postMobileBridgeJobEvent(job.jobId, {
        id: `${requestId}-complete`,
        sessionId: result.sessionId,
        type: 'complete',
        phase: 'complete',
        level: 0,
        title: `${job.client === 'codex' ? 'Codex' : 'Claude'} 输出已结束`,
        body: '',
        source: 'mobile',
        origin: 'mobile',
        createdAt: Date.now(),
      })
    }
  } catch (error) {
    await postMobileBridgeJobEvent(job.jobId, {
      id: `${requestId}-error`,
      sessionId: requestedSessionId,
      type: 'error',
      phase: 'error',
      level: 2,
      title: '执行失败',
      body: error instanceof Error ? error.message : String(error),
      source: 'mobile',
      origin: 'mobile',
      createdAt: Date.now(),
    }).catch(() => undefined)
  } finally {
    interactionState.done = true
    mobileBridgeProgressMirrors.delete(requestId)
    setMobileBridgePowerSaveBlocker(false)
    await interactionLoop.catch(() => undefined)
    await syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)
  }
}

function readMobileBridgeJobId(value: unknown) {
  if (!value || typeof value !== 'object') {
    return ''
  }
  const record = value as Record<string, unknown>
  return (
    (typeof record.jobId === 'string' && record.jobId.trim()) ||
    (typeof record.job_id === 'string' && record.job_id.trim()) ||
    ''
  )
}

async function createLocalCliMobileBridgeMirror(request: CliRunRequest) {
  if (request.requestId.startsWith('mobile-')) {
    return null
  }

  const userId = await getDesktopUserHeaderValue()
  if (!userId) {
    return null
  }

  const deviceId = await getMobileBridgeDeviceId()
  const visiblePrompt = extractCliUserTask(request.prompt) || request.prompt
  const created = await requestMobileBridgeJson<Record<string, unknown>>({
    method: 'POST',
    path: '/api/mobile/desktop-jobs',
    body: {
      deviceId,
      client: request.client,
      sessionId: request.sessionId || `local-${request.client}-${request.requestId}`,
      projectPath: request.projectPath,
      prompt: visiblePrompt,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      permissionMode: 'local_mirror',
      origin: 'desktop',
      source: 'desktop',
    },
  })
  const jobId = readMobileBridgeJobId(created)
  if (!jobId) {
    return null
  }

  await requestMobileBridgeJson({
    method: 'POST',
    path: `/api/mobile/desktop-jobs/${encodeURIComponent(jobId)}/claim`,
    query: {
      device_id: deviceId,
    },
  })

  const projectPath = request.projectPath.trim() || os.homedir()
  const projectName = path.basename(projectPath) || projectPath
  await postMobileBridgeJobEvent(jobId, {
    id: `${request.requestId}-project`,
    sessionId: request.sessionId || `local-${request.client}-${request.requestId}`,
    type: 'project',
    phase: 'project',
    level: 0,
    title: projectName,
    body: projectPath,
    source: 'desktop',
    origin: 'desktop',
    createdAt: Date.now(),
  })

  await postMobileBridgeJobEvent(jobId, {
    id: `${request.requestId}-running`,
    sessionId: request.sessionId || `local-${request.client}-${request.requestId}`,
    type: 'log',
    phase: 'running',
    level: 0,
    title: `${request.client === 'codex' ? 'Codex' : 'Claude'} 正在执行`,
    body: '桌面客户端正在执行当前任务。',
    source: 'desktop',
    origin: 'desktop',
    createdAt: Date.now(),
  })

  for (const event of buildExecutionCycleEvents({
    sessionId: request.sessionId || `local-${request.client}-${request.requestId}`,
    requestId: request.requestId,
    intent: visiblePrompt,
    finalPrompt: request.prompt,
    commandTitle: 'PC 客户端任务准备',
  })) {
    await postMobileBridgeJobEvent(jobId, {
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
      source: 'desktop',
      origin: 'desktop',
      createdAt: event.createdAt,
    })
  }

  const mapMobileBridgeEvent = createMobileBridgeEventMapper(jobId)
  mobileBridgeProgressMirrors.set(request.requestId, (payload) => {
    const events = mapMobileBridgeEvent(payload)
    for (const mapped of events) {
      void postMobileBridgeJobEvent(jobId, mapped).catch(() => undefined)
    }
  })

  return {
    jobId,
    async finish(result: CliRunResponse) {
      mobileBridgeProgressMirrors.delete(request.requestId)
      if (result.output.trim() && result.metadata?.aborted !== true) {
        await postMobileBridgeJobEvent(jobId, {
          id: `${request.requestId}-assistant-final`,
          sessionId: result.sessionId,
          type: 'message',
          role: 'assistant',
          text: result.output.trim(),
          source: 'desktop',
          origin: 'desktop',
          createdAt: Date.now(),
        })
      }
      await postMobileBridgeJobEvent(jobId, result.success ? {
        id: `${request.requestId}-complete`,
        sessionId: result.sessionId,
        type: 'complete',
        phase: 'complete',
        level: 0,
        title: `${request.client === 'codex' ? 'Codex' : 'Claude'} 输出已结束`,
        body: '',
        source: 'desktop',
        origin: 'desktop',
        createdAt: Date.now(),
      } : {
        id: `${request.requestId}-failed`,
        sessionId: result.sessionId,
        type: 'error',
        phase: 'error',
        level: 2,
        title: '执行失败',
        body: result.error || 'CLI 执行未返回成功结果。',
        source: 'desktop',
        origin: 'desktop',
        createdAt: Date.now(),
      })
      await syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)
    },
    dispose() {
      mobileBridgeProgressMirrors.delete(request.requestId)
    },
  }
}

async function startMobileBridgeLoop() {
  if (mobileBridgeStarted) {
    return
  }
  mobileBridgeStarted = true
  while (!isQuitting) {
    if (mobileBridgeRunning) {
      await wait(MOBILE_BRIDGE_PENDING_JOB_ACTIVE_INTERVAL_MS)
      continue
    }
    let loopDelay = activeMobileBridgeJobIds.size > 0
      ? MOBILE_BRIDGE_PENDING_JOB_ACTIVE_INTERVAL_MS
      : MOBILE_BRIDGE_PENDING_JOB_IDLE_INTERVAL_MS
    mobileBridgeRunning = true
    try {
      const userId = await getDesktopUserHeaderValue()
      if (!userId) {
        setMobileBridgePowerSaveBlocker(false)
        await wait(MOBILE_BRIDGE_PENDING_JOB_IDLE_INTERVAL_MS)
        continue
      }

      await registerMobileBridgeDevice()
      await heartbeatMobileBridgeDevice()
      await syncMobileBridgeExtensionsSnapshot()
      await syncMobileBridgeAssistantsSnapshot()
      await applyMobileBridgeModelSelectionsSafely()
      await syncMobileBridgeSessionsSnapshot()

      const jobs = await requestMobileBridgeJson<MobileBridgeJob[]>({
        method: 'GET',
        path: '/api/mobile/desktop-jobs/pending',
        query: {
          device_id: await getMobileBridgeDeviceId(),
        },
      })
      const nextLoopDelay = jobs.length > 0 || activeMobileBridgeJobIds.size > 0
        ? MOBILE_BRIDGE_PENDING_JOB_ACTIVE_INTERVAL_MS
        : MOBILE_BRIDGE_PENDING_JOB_IDLE_INTERVAL_MS
      loopDelay = nextLoopDelay

      for (const job of jobs) {
        const jobId = readMobileBridgeJobId(job)
        if (!jobId || activeMobileBridgeJobIds.has(jobId)) {
          continue
        }
        activeMobileBridgeJobIds.add(jobId)
        void executeMobileBridgeJob(job)
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            void heartbeatMobileBridgeDevice('degraded', `desktop job ${jobId} failed: ${message}`).catch(() => undefined)
          })
          .finally(() => {
            activeMobileBridgeJobIds.delete(jobId)
          })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await heartbeatMobileBridgeDevice('degraded', message).catch(() => undefined)
    } finally {
      mobileBridgeRunning = false
    }
    const nextLoopDelay = loopDelay
    await wait(nextLoopDelay)
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

async function setRendererStorageValue(key: string, value: string) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return
  }
  await mainWindow.webContents.executeJavaScript(
    `window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`,
    true,
  ).catch(() => undefined)
}

async function applyRendererDesktopModelSelection(client: CliClient, model: string) {
  const clean = model.trim()
  if (!clean) {
    return
  }
  await setRendererStorageValue(`oneapi-desktop-${client}-selected-model`, JSON.stringify(clean))
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return
  }
  await mainWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('oneapi:desktop-model-selection', { detail: ${JSON.stringify({ client, model: clean })} }))`,
    true,
  ).catch(() => undefined)
}

async function getDesktopUserHeaderValue() {
  return (await getRendererStorageValue('uid')).trim()
}

async function getDesktopAccessTokenHeaderValue() {
  return (await getRendererStorageValue('oneapi_desktop_access_token')).trim()
}

async function requestMobileBridgeApi(input: DesktopApiRequest) {
  const userId = await getDesktopUserHeaderValue()
  const accessToken = await getDesktopAccessTokenHeaderValue()
  return requestApi({
    ...input,
    headers: {
      ...(input.headers || {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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

function createLineConsumer(listener?: (line: string) => boolean | void) {
  let buffer = ''

  return {
    push(chunk: Buffer | string) {
      if (!listener) {
        return false
      }

      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      let shouldResolve = false

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) {
          shouldResolve = listener(trimmed) === true || shouldResolve
        }
      }
      return shouldResolve
    },
    flush() {
      if (!listener) {
        return false
      }

      const trimmed = buffer.trim()
      let shouldResolve = false
      if (trimmed) {
        shouldResolve = listener(trimmed) === true
      }
      buffer = ''
      return shouldResolve
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
    onStdoutLine?: (line: string) => boolean | void
    onStderrLine?: (line: string) => boolean | void
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

    const finish = (exitCode: number) => {
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
        exitCode,
      })
    }
    const finishFromCompletedStreamEvent = () => {
      finish(0)
      void stopChildProcess(child)
    }

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
      if (settled) {
        return
      }
      stdout += chunk.toString()
      if (stdoutConsumer.push(chunk)) {
        finishFromCompletedStreamEvent()
      }
    })

    child.stderr?.on('data', (chunk) => {
      if (settled) {
        return
      }
      stderr += chunk.toString()
      if (stderrConsumer.push(chunk)) {
        finishFromCompletedStreamEvent()
      }
    })

    child.on('error', (error) => {
      stderr = `${stderr}\n${error.message}`.trim()
      finish(-1)
    })

    child.on('close', (code) => {
      finish(code ?? 0)
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
  const targetDirectory = getDesktopAttachmentDirectory()
  await fs.mkdir(targetDirectory, { recursive: true })
  rememberCliAuthorizedDirectory(targetDirectory)
  const targetPath = path.join(
    targetDirectory,
    `${Date.now()}-${safeBaseName}${extension || ''}`
  )

  await fs.writeFile(targetPath, Buffer.from(input.dataBase64, 'base64'))
  return {
    path: targetPath,
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
  return requestImageEditToUrl(input, {
    url: buildUrl('/v1/images/edits'),
    powerSaveRequestId: `image-edit-${randomUUID()}`,
  })
}

async function requestCustomImageEdit(input: DesktopCustomImageEditRequest) {
  return requestImageEditToUrl(input, {
    url: buildOpenAICompatibleUrl(input.baseUrl, '/images/edits'),
    pollBaseUrl: input.baseUrl,
    powerSaveRequestId: input.requestId || `custom-image-edit-${randomUUID()}`,
  })
}

async function requestImageEditToUrl(input: DesktopImageEditRequest, target: {
  url: string
  pollBaseUrl?: string
  powerSaveRequestId: string
}) {
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
  startApiPowerSaveBlocker(target.powerSaveRequestId)

  try {
    const response = await getDesktopSession().fetch(target.url, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller?.signal,
    })

    const data = await parseResponse(response)
    if (!response.ok) {
      throw new Error(getResponseErrorMessage(data, response.status, '图片编辑失败'))
    }

    return resolveAsyncImageGenerationResponse(data, {
      authorization: headers.get('Authorization') || '',
      pollBaseUrl: target.pollBaseUrl,
      signal: controller?.signal,
      timeoutMessage: formatDesktopRequestTimeoutMessage(timeoutMs),
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
    stopApiPowerSaveBlocker(target.powerSaveRequestId)
  }
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
      assistantHistoryWriteSignatures.delete(`${scope}:${item.name}`)
    })
  )

  await Promise.all(
    normalizedEntries.map(async (item) => {
      const sessionDirectory = getAssistantHistorySessionDirectory(scope, item.id)
      const signatureKey = `${scope}:${item.id}`
      const signature = `${item.title}\n${item.updatedAt}\n${item.data.length}`
      if (assistantHistoryWriteSignatures.get(signatureKey) === signature) {
        return
      }
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
      assistantHistoryWriteSignatures.set(signatureKey, signature)
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

const cliServices = createCliServices({
  app,
  cliConfig,
  serverBaseUrlRef: { get value() { return serverBaseUrl } },
  DEFAULT_CODEX_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_CLAUDE_BASE_URL,
  pathExists,
  readBundledCliCatalogFile,
  normalizeCodexBaseUrl,
  normalizeClaudeBaseUrl,
  getToolchainRoot,
  getManagedNodeRoot,
  getManagedNpmPrefix,
  getManagedPrefixBin,
  getManagedCliExecutableCandidates,
  getManagedNodeExecutableCandidates,
  getManagedNpmExecutableCandidates,
  getNpmCliScriptCandidates,
  getNpmCommand,
  firstExistingPath,
  resolveNpmCliScriptPath,
  buildNpmInvocation,
  clearDirectory,
  flattenSingleNestedDirectory,
  describeDirectoryEntries,
  shouldUseWindowsCommandShim,
  createLineConsumer,
  spawnCommandWithHandlers,
  stopChildProcess,
  writeChildStdinSafely,
  runCommand,
  locateSystemExecutable,
  locateExecutable,
  resolveCliSpawnCommand,
  resolveNodeBackedCliInvocation,
  inspectCli,
  getRendererStorageValue,
  setRendererStorageValue,
  applyRendererDesktopModelSelection,
  getDesktopUserHeaderValue,
  getDesktopAccessTokenHeaderValue,
  requestMobileBridgeApi,
  requestMobileBridgeJson,
  resolveCliAdditionalAccessDirectories,
  rememberCliAuthorizedDirectory,
  readBridgeClientProjectPath,
  postMobileBridgeJobEvent,
  createLocalCliMobileBridgeMirror,
  syncMobileBridgeSessionsSnapshot,
  startCliPowerSaveBlocker,
  stopCliPowerSaveBlocker,
  activeCliProcesses,
  activeCliRequestStates,
  stoppedCliRequests,
  mobileBridgeProgressMirrors,
  updateActiveCliSessionState,
})
const {
  readCurrentCodexConfig,
  readCurrentClaudeConfig,
  listCliExtensions,
  installCliExtension,
  deleteCliMessage,
  deleteCliSessions,
  listCodexHistory,
  getCodexSession,
  listClaudeHistory,
  getClaudeSession,
  getLatestCodexSessionFile,
  getClaudeSessionFile,
  runCodexPrompt,
  runClaudePrompt,
  readManagedNodeRuntime,
  deployCli,
  normalizeWhitespace,
  wait,
  writeCliInteractionResponse,
  createCliProgressEmitter,
  createDeployLogger,
  buildCliExecutionEnv,
} = cliServices

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
  for (const requestId of activeApiPowerSaveBlockers.keys()) {
    stopApiPowerSaveBlocker(requestId)
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
ipcMain.handle('desktop:custom-chat-stream', async (event, request: DesktopCustomChatStreamRequest) => {
  await requestCustomChatStream(event.sender, request)
})
ipcMain.handle('desktop:custom-chat-completion', async (_event, request: DesktopCustomChatCompletionRequest) => {
  return requestCustomChatCompletion(request)
})
ipcMain.handle('desktop:custom-image-generation', async (_event, request: DesktopCustomImageGenerationRequest) => {
  return requestCustomImageGeneration(request)
})
ipcMain.handle('desktop:custom-image-edit', async (_event, request: DesktopCustomImageEditRequest) => {
  return requestCustomImageEdit(request)
})
ipcMain.handle('desktop:custom-provider-models', async (_event, request: DesktopCustomModelListRequest) => {
  return requestCustomProviderModels(request)
})
ipcMain.handle('desktop:stop-api-request', async (_event, requestId: string) => {
  activeApiRequests.get(requestId)?.abort()
  activeApiRequests.delete(requestId)
  stopApiPowerSaveBlocker(requestId)
})
ipcMain.handle('desktop:open-external', async (_event, url: string) => {
  await shell.openExternal(assertAllowedExternalUrl(url))
})
ipcMain.handle('desktop:open-html', async (_event, input: DesktopOpenHtmlRequest) => {
  await openHtmlInExternalBrowser(input)
})
ipcMain.handle('desktop:open-path', async (_event, targetPath: string) => {
  const resolved = await resolveOpenTarget(targetPath)
  if (!resolved) {
    throw new Error('目标路径当前不可打开。')
  }
  await rememberCliAuthorizedOpenTarget(resolved)

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
  const mobileMirror = await createLocalCliMobileBridgeMirror(request).catch(() => null)
  try {
    const result = request.client === 'codex'
      ? await runCodexPrompt(event.sender, request)
      : await runClaudePrompt(event.sender, request)
    await mobileMirror?.finish(result).catch(() => undefined)
    return result
  } catch (error) {
    mobileMirror?.dispose()
    throw error
  }
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
