import { Fragment, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react'
import {
  Activity,
  Blocks,
  Bot,
  CircleHelp,
  ChevronLeft,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  PanelRightOpen,
  PencilLine,
  Pin,
  Plus,
  RotateCcw,
  Send,
  Square,
  Sparkles,
  Star,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import {
  getAuthStatus,
  logout,
  unwrapEnvelope,
} from './domains/auth'
import {
  copyImageToClipboard,
  getUserModels,
  sendChatCompletion,
} from './domains/chat'
import {
  deleteCliMessage,
  deleteCliSessions,
  exportTextFile,
  getCliSession,
  getCliStatus,
  installCliExtension,
  listCliExtensions,
  listCliHistory,
  openCliSessionFolder,
  onCliProgress,
  pickProjectDirectory,
  readDesktopFilePreview,
  respondCliInteraction,
  runCliPrompt,
  setDesktopWindowTitle,
  stopCliPrompt,
} from './domains/cli'
import {
  checkForUpdates,
  getUpdateState,
  installUpdate,
  onUpdateState,
} from './domains/update'
import { fetchApiKeySecret, getApiKeys } from './domains/keys'
import { getSelfProfile, requireSuccess } from './domains/profile'
import {
  applyCliHistoryTitleOverrides,
  appendCliFallbackAssistantMessage,
  buildCliAbortLogEntry,
  buildCliRecentSessions,
  buildCliTimeline,
  type CliTimelineEntry,
  filterAssistantModels,
  filterModelsByVendor,
  type ModelVendorFilter,
  prioritizeFavoriteModels,
  resolveCompatibleModel,
} from './lib/assistant-workspace'
import {
  loadOneApiModelsForActiveKey,
  resolveActiveDesktopApiKeySummary,
  sameActiveDesktopApiKeySummary,
  type ActiveDesktopApiKeySummary,
} from './features/desktop-api-key-models'
import { getSelectedDesktopApiKeyStorageKey } from './lib/desktop-api-keys'
import {
  resolveCliHistorySessionForProject,
  resolvePreferredCliSessionId,
} from './lib/cli-project-state'
import {
  getCliResumeSessionId,
  isDraftCliSessionId,
} from './lib/cli-session'
import { SubscriptionsWorkspace, WalletWorkspace, ServiceStatusWorkspace } from './features/account/AccountWorkspaces'
import { MeWorkspace } from './features/settings/SettingsWorkspaces'
import { DesktopWindowFrame } from './components/DesktopWindowFrame'
import { LoginScreen } from './features/auth/LoginScreen'
import { AssistantsChatWorkspace, DrawWorkspace } from './features/assistants/AssistantChatDrawWorkspaces'
import {
  AttachmentPreviewModal,
  AppPerformanceModeContext,
  BubbleMeta,
  CLAUDE_REASONING_OPTIONS,
  CLI_PENDING_MESSAGE_LABEL,
  CLI_REASONING_OPTIONS,
  ConversationFindBar,
  ConversationScrollDock,
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_CODEX_MODEL,
  DEFAULT_SERVER_BASE_URL,
  EmptyState,
  GlassPickerMenu,
  LazyMarkdownContent,
  MessageAttachmentGallery,
  MessageCliExtensionChips,
  MessageFileChangeLinks,
  MODEL_VENDOR_FILTER_OPTIONS,
  PendingMessageContent,
  SessionContextMenu,
  SessionTitleEditor,
  TranslationResultModal,
  CliExtensionPalette,
  CliLogBubble,
  CliLogCompletionFooter,
  createEmptyCliExtensionPreferenceBucket,
  createPickerMenuWidthStyle,
  focusTextareaToEnd,
  formatDownloadSize,
  formatUsageSummary,
  buildEmptyCliStatus,
  clearPendingCliVerification,
  clearVerificationValid,
  getCliExtensionKindLabel,
  hasPendingCliVerification,
  isAbortError,
  isAssistantHistoryTriggerTarget,
  isSameCliLogEntry,
  loadFavoriteModels,
  mergeCliLogs,
  normalizeProjectKey,
  normalizeTimestampMs,
  openDesktopFolder,
  openDesktopTarget,
  orderGroupedEntries,
  renderComposer,
  resolveCliExtensionPreferenceProjectKey,
  resolveCliExtensionTranslationCacheKey,
  resolveProjectNameFromPath,
  readCachedCliStatus,
  sameCliStatus,
  serializeCliLogEvent,
  shouldReplaceStreamingCliIntentEntry,
  showAttachmentContextMenu,
  storeFavoriteModels,
  translateSelectedText,
  useAttachmentPreview,
  useAppPerformanceMode,
  useComposerPromptHistory,
  writeCachedCliStatus,
  withFavoriteFlag,
  type AppPerformanceMode,
  type AttachmentPreviewState,
  type CliExtensionPreferenceBucket,
  type CliExtensionPreferenceStore,
  type CliExtensionTranslationCache,
  type CliLogEntry,
  type CliMessage,
  type CliMessageOverlayStore,
  type CliPaletteItem,
  type SessionContextMenuState,
  type SessionRenameDraft,
} from './features/assistants/AssistantWorkspaceSupport'
import {
  AUTH_EXPIRED_EVENT,
  clearStoredDesktopAccessToken,
  clearStoredDesktopUserId,
  saveStoredDesktopUserId,
} from './lib/desktop-client'
import {
  applyCliMessageOverlays,
  buildCliExtensionDisplayName,
  buildCliExtensionInsertText,
  canUseCliExtension,
  decorateCliExtensions,
  resolveCliSlashTriggerState,
  translateCliExtensionDescription,
  type CliExtensionViewItem,
  type CliMessageOverlay,
} from './lib/cli-extensions'
import { listCliBuiltinCommands, matchCliBuiltinCommand } from './lib/cli-commands'
import {
  describeCliWorkspaceStatus,
  isCliStatusInstalled,
  isCliStatusReadyForWorkspace,
} from './lib/desktop-service'
import {
  formatDateTime,
  formatQuotaAsUsd,
} from './lib/format'
import {
  getDesktopUpdateDayKey,
  resolveDesktopUpdateStatusSummary,
  shouldAutoCheckDesktopUpdate,
} from './lib/app-update'
import { isDirectCliCommandPrompt } from './lib/cli-runtime'
import { formatUserFacingMessage } from './lib/user-facing-message'
import { buildFinalPrompt } from './process/prompt-assembler/build-final-prompt'
import { buildExecutionCycleEvents } from './process/execution-orchestrator/run-request.ts'
import { useAutoFollowScroll } from './hooks/use-auto-follow-scroll'
import {
  syncTextareaHeight,
  useAutosizeTextarea,
} from './hooks/use-autosize-textarea'
import {
  isInlinePreviewableFile,
  rehydrateCliComposerAttachments,
  toMessageAttachments,
  useComposerAttachments,
  type ComposerAttachment,
} from './hooks/use-composer-attachments'
import { useDebouncedJsonStorage } from './hooks/use-debounced-json-storage'
import {
  buildCliSessionExportMarkdown,
  buildSessionExportFileName,
  canDeleteCliMessageFromSessionFile,
  mergeCliMessages,
  type ExportCliLogGroup,
} from './lib/session-history'
import { readJsonStorage, writeJsonStorage } from './lib/storage'
import {
  AI_CHAT_PROVIDER_STORAGE_KEY,
  DEFAULT_AI_CHAT_PROVIDER_CONFIG,
  normalizeAiChatProviderConfig,
  normalizeOpenAICompatibleBaseUrl,
  resolveAiChatProviderState,
  shouldDisableCliModelForProvider,
  type AiChatProviderConfig,
  type AiChatProviderState,
} from './lib/aichat-provider'
import type {
  ChatModelOption,
  UserProfile,
} from './shared/contracts'
import type {
  CliClient,
  CliInteractionAction,
  CliInteractionPrompt,
  DesktopAnnouncement,
  CliExtensionEntry,
  CliHistoryEntry,
  CliPlanState,
  CliProgressPayload,
  CliSessionDetails,
  CliSessionMessage,
  CliStatus,
  DesktopAppMeta,
  DesktopAttachmentSaveRequest,
  DesktopAttachmentSaveResult,
  DesktopUpdateState,
} from './shared/desktop'
import { useAuthStore } from './stores/auth-store'

type AssistantMode = 'chat' | 'draw' | 'codex' | 'claude'
type SideTab = 'assistants' | 'subscriptions' | 'wallet' | 'service-status' | 'me'
type HistoryVisibilityTab = 'visible' | 'hidden'
type ThemeMode = 'light' | 'dark'
type CliRunningState = {
  running: boolean
  requestId: string
}

const THEME_MODE_STORAGE_KEY = 'oneapi-desktop-theme-mode'
type CliPaletteTab = 'command' | 'skill' | 'plugin'

const AURORA_OPACITY_STORAGE_KEY = 'oneapi-desktop-aurora-opacity'
const DEFAULT_AURORA_OPACITY = 100
const DESKTOP_UPDATE_AUTO_CHECK_DAY_KEY = 'oneapi-desktop-update-auto-check-day'
const DESKTOP_ANNOUNCEMENT_READ_IDS_KEY = 'oneapi-desktop-announcement-read-ids'

function getCliPromptHistoryStorageKey(client: CliClient) {
  return `oneapi-desktop-${client}-prompt-history`
}

function resolveSystemThemeMode(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredThemeMode() {
  try {
    const raw = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    return parsed === 'dark' || parsed === 'light' ? parsed : null
  } catch {
    return null
  }
}

const assistantModes: Array<{ key: AssistantMode; label: string }> = [
  { key: 'chat', label: 'Chat' },
  { key: 'draw', label: 'Image' },
  { key: 'codex', label: 'Codex' },
  { key: 'claude', label: 'Claude' },
]

const primarySideTabs: Array<{
  key: SideTab
  label: string
  icon: typeof Sparkles
  desc: string
}> = [
  { key: 'assistants', label: 'AIChat', icon: Sparkles, desc: '提示词助手与聊天形态' },
  { key: 'subscriptions', label: '套餐订阅', icon: CreditCard, desc: '套餐购买、订阅状态和额度' },
  { key: 'wallet', label: '用量账单', icon: Wallet, desc: '余额、充值记录与消耗趋势' },
  { key: 'service-status', label: '服务状态', icon: Activity, desc: '渠道运行状态与历史心跳' },
  { key: 'me', label: '环境部署', icon: KeyRound, desc: '个人信息、Key 与安全操作' },
]

function getDesktopBridge() {
  if (!window.desktopBridge) {
    throw new Error('桌面桥接未初始化')
  }
  return window.desktopBridge
}

function saveDesktopAttachment(input: DesktopAttachmentSaveRequest): Promise<DesktopAttachmentSaveResult> {
  return getDesktopBridge().saveAttachment(input)
}

function isAuthRequiredErrorMessage(message: string) {
  const normalized = message.toLowerCase()
  return (
    message.includes('未登录且未提供 access token') ||
    message.includes('access token 无效') ||
    normalized.includes('not logged in and no access token provided') ||
    normalized.includes('access token invalid')
  )
}

function useToastState() {
  const [message, setMessageState] = useState('')

  const setMessage = useCallback((nextMessage: string) => {
    if (isAuthRequiredErrorMessage(nextMessage)) {
      return
    }
    setMessageState(formatUserFacingMessage(nextMessage))
  }, [])

  useEffect(() => {
    if (!message) {
      return
    }
    const timer = window.setTimeout(() => setMessageState(''), 2800)
    return () => window.clearTimeout(timer)
  }, [message])

  return { message, setMessage }
}


function stripCliPlanCommandPrompt(prompt: string) {
  const stripped = prompt.replace(/^\s*\/plan(?:\s+|$)/i, '').trim()
  return stripped || '请先基于当前会话与项目状态制定执行计划。'
}

function CliPlanFloatingPanel(props: {
  plan: CliPlanState | null
  client: CliClient
}) {
  const { plan, client } = props
  if (!plan?.items.length) {
    return null
  }

  const completedCount = plan.items.filter((item) => item.status === 'completed').length
  const statusLabel: Record<CliPlanState['items'][number]['status'], string> = {
    pending: '待处理',
    in_progress: '进行中',
    completed: '已完成',
  }

  return (
    <aside className='cli-plan-floating-panel' aria-label={`${client === 'codex' ? 'Codex' : 'Claude'} 计划`}>
      <div className='cli-plan-floating-head'>
        <strong>方案</strong>
        <span>{completedCount}/{plan.items.length}</span>
      </div>
      {plan.explanation ? <p className='cli-plan-floating-summary'>{plan.explanation}</p> : null}
      <div className='cli-plan-floating-list'>
        {plan.items.map((item) => {
          const Icon =
            item.status === 'completed'
              ? CheckCircle2
              : item.status === 'in_progress'
                ? LoaderCircle
                : CircleHelp
          return (
            <div key={`${item.id}-${item.status}`} className='cli-plan-floating-item'>
              <span className={`cli-plan-status-icon ${item.status}`} title={statusLabel[item.status]}>
                <Icon size={14} />
              </span>
              <span className='cli-plan-status-text'>{item.step}</span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function CliWorkspace(props: {
  client: CliClient
  toast: (message: string) => void
  openSettings: () => void
  active: boolean
  serverBaseUrl: string
  providerState: AiChatProviderState
  activeApiKey: ActiveDesktopApiKeySummary
  runningState: CliRunningState
  onRunningStateChange: (client: CliClient, state: CliRunningState) => void
}) {
  const { client, toast, openSettings, active, serverBaseUrl, providerState, activeApiKey, runningState, onRunningStateChange } = props
  const aiChatProviderMode = providerState.mode
  const performanceMode = useAppPerformanceMode()
  const lastProjectPathStorageKey = `oneapi-desktop-${client}-last-project-path`
  const projectSessionMapStorageKey = `oneapi-desktop-${client}-project-session-map`
  const lastOpenedSessionIdStorageKey = `oneapi-desktop-${client}-last-opened-session-id`
  const lastOpenedProjectPathStorageKey = `oneapi-desktop-${client}-last-opened-session-project-path`
  const [status, setStatus] = useState<CliStatus>(() => readCachedCliStatus(client))
  const [history, setHistory] = useState<CliHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [favoriteModels, setFavoriteModels] = useState<string[]>(() => loadFavoriteModels(`oneapi-desktop-${client}-favorites`))
  const [projectPath, setProjectPath] = useState(() => readJsonStorage<string>(lastProjectPathStorageKey, ''))
  const [projectName, setProjectName] = useState(() =>
    resolveProjectNameFromPath(readJsonStorage<string>(lastProjectPathStorageKey, ''))
  )
  const [prompt, setPrompt] = useState('')
  const cliPromptHistory = useComposerPromptHistory(getCliPromptHistoryStorageKey(client))
  const [running, setRunning] = useState(false)
  const [fullAccess, setFullAccess] = useState(true)
  const [projectSessionMap, setProjectSessionMap] = useState<Record<string, string>>(() =>
    readJsonStorage<Record<string, string>>(projectSessionMapStorageKey, {})
  )
  const [lastOpenedSessionId, setLastOpenedSessionId] = useState(() =>
    readJsonStorage<string>(lastOpenedSessionIdStorageKey, '')
  )
  const [lastOpenedProjectPath, setLastOpenedProjectPath] = useState(() =>
    readJsonStorage<string>(lastOpenedProjectPathStorageKey, '')
  )
  const [sessionProjectPathMap, setSessionProjectPathMap] = useState<Record<string, string>>(() =>
    readJsonStorage<Record<string, string>>(`oneapi-desktop-${client}-session-project-paths`, {})
  )
  const [sessionMessagesMap, setSessionMessagesMap] = useState<Record<string, CliMessage[]>>({})
  const [sessionLogsMap, setSessionLogsMap] = useState<Record<string, CliLogEntry[]>>(() =>
    readJsonStorage<Record<string, CliLogEntry[]>>(`oneapi-desktop-${client}-session-logs`, {})
  )
  const [sessionPlansMap, setSessionPlansMap] = useState<Record<string, CliPlanState | null>>(() =>
    readJsonStorage<Record<string, CliPlanState | null>>(`oneapi-desktop-${client}-session-plans`, {})
  )
  const [sessionPartialMap, setSessionPartialMap] = useState<Record<string, string>>({})
  const [respondingInteractionIds, setRespondingInteractionIds] = useState<string[]>([])
  const [expandedLogEventMap, setExpandedLogEventMap] = useState<Record<string, string[]>>({})
  const [previewFile, setPreviewFile] = useState<{
    ownerId: string
    path: string
    name: string
    content: string
  } | null>(null)
  const [hiddenSessionIds, setHiddenSessionIds] = useState<string[]>(() =>
    readJsonStorage<string[]>(`oneapi-desktop-${client}-hidden-sessions`, [])
  )
  const [historyTitleOverrides, setHistoryTitleOverrides] = useState<Record<string, string>>(() =>
    readJsonStorage<Record<string, string>>(`oneapi-desktop-${client}-history-title-overrides`, {})
  )
  const [pinnedHistoryGroups, setPinnedHistoryGroups] = useState<string[]>(() =>
    readJsonStorage<string[]>(`oneapi-desktop-${client}-pinned-groups`, [])
  )
  const [historyVisibilityTab, setHistoryVisibilityTab] = useState<HistoryVisibilityTab>('visible')
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [translationState, setTranslationState] = useState<{
    sourceText: string
    translatedText: string
    loading: boolean
  } | null>(null)
  const [renamingHistorySession, setRenamingHistorySession] = useState<SessionRenameDraft>(null)
  const [requestSessionMap, setRequestSessionMap] = useState<
    Record<string, { sessionId: string; projectPath: string }>
  >({})
  const [cliModels, setCliModels] = useState<ChatModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState(() => readJsonStorage<string>(`oneapi-desktop-${client}-selected-model`, ''))
  const [reasoningEffort, setReasoningEffort] = useState(client === 'claude' ? 'high' : 'medium')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [cliModelVendorFilter, setCliModelVendorFilter] = useState<ModelVendorFilter>('all')
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const [extensionsMenuOpen, setExtensionsMenuOpen] = useState(false)
  const [extensionsMenuAnchor, setExtensionsMenuAnchor] = useState<'composer' | 'button'>('button')
  const [extensionsOverlayStyle, setExtensionsOverlayStyle] = useState<CSSProperties>({})
  const [extensionsLoading, setExtensionsLoading] = useState(false)
  const [extensionsLoadedOnce, setExtensionsLoadedOnce] = useState(false)
  const [installingExtensionIds, setInstallingExtensionIds] = useState<string[]>([])
  const [extensionSearch, setExtensionSearch] = useState('')
  const [cliExtensions, setCliExtensions] = useState<CliExtensionEntry[]>([])
  const [selectedExtensions, setSelectedExtensions] = useState<CliExtensionEntry[]>([])
  const [extensionPaletteTab, setExtensionPaletteTab] = useState<CliPaletteTab>('skill')
  const [highlightedExtensionIndex, setHighlightedExtensionIndex] = useState(0)
  const [cliExtensionPreferences, setCliExtensionPreferences] = useState<CliExtensionPreferenceStore>(() =>
    readJsonStorage<CliExtensionPreferenceStore>(`oneapi-desktop-${client}-extension-preferences`, {})
  )
  const [cliMessageOverlays, setCliMessageOverlays] = useState<CliMessageOverlayStore>(() =>
    readJsonStorage<CliMessageOverlayStore>(`oneapi-desktop-${client}-message-overlays`, {})
  )
  const {
    attachments,
    inputRef: attachmentInputRef,
    clearAttachments,
    removeAttachment,
    replaceAttachments,
    handleInputChange: handleAttachmentInputChange,
    handlePaste: handleAttachmentPaste,
    handleDrop: handleAttachmentDrop,
  } = useComposerAttachments(toast, saveDesktopAttachment)
  const { preview: attachmentPreview, setPreview: setAttachmentPreview, openPreview: openAttachmentPreview } = useAttachmentPreview(toast)
  const { ref: promptRef, resize: resizePrompt } = useAutosizeTextarea(prompt)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const effortMenuRef = useRef<HTMLDivElement | null>(null)
  const extensionsMenuRef = useRef<HTMLDivElement | null>(null)
  const extensionsButtonRef = useRef<HTMLButtonElement | null>(null)
  const extensionsPaletteRef = useRef<HTMLDivElement | null>(null)
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const projectSessionMapRef = useRef(projectSessionMap)
  const requestSessionMapRef = useRef(requestSessionMap)
  const activeRequestIdRef = useRef('')
  const stoppingRunRef = useRef(false)
  const autoHydratingSessionIdsRef = useRef<Set<string>>(new Set())
  const pendingCliLogEntriesRef = useRef<Record<string, CliLogEntry[]>>({})
  const pendingCliLogFlushTimerRef = useRef<number | null>(null)
  const cliLogEntrySequenceRef = useRef(0)

  const currentExtensionPreferenceKey = useMemo(
    () => resolveCliExtensionPreferenceProjectKey(projectPath),
    [projectPath]
  )
  const activeSessionId = useMemo(
    () =>
      resolvePreferredCliSessionId({
        projectPath,
        projectSessionMap,
        lastOpenedSessionId,
        lastOpenedProjectPath,
      }),
    [lastOpenedProjectPath, lastOpenedSessionId, projectPath, projectSessionMap]
  )
  const cliStatusReady = useMemo(
    () => isCliStatusReadyForWorkspace(status, serverBaseUrl || DEFAULT_SERVER_BASE_URL),
    [serverBaseUrl, status]
  )
  const activeMessages = useMemo(
    () => (activeSessionId ? sessionMessagesMap[activeSessionId] || [] : []),
    [activeSessionId, sessionMessagesMap]
  )
  const activeLogs = useMemo(
    () => (activeSessionId ? sessionLogsMap[activeSessionId] || [] : []),
    [activeSessionId, sessionLogsMap]
  )
  const activePartial = activeSessionId ? sessionPartialMap[activeSessionId] || '' : ''
  const activePlan = activeSessionId ? sessionPlansMap[activeSessionId] || null : null
  const effectiveRunning = running || runningState.running
  const effectiveRequestId = activeRequestIdRef.current || runningState.requestId
  const activeExtensionPreferenceBucket =
    cliExtensionPreferences[currentExtensionPreferenceKey] || createEmptyCliExtensionPreferenceBucket()
  const reasoningOptions = client === 'claude' ? CLAUDE_REASONING_OPTIONS : CLI_REASONING_OPTIONS
  const preferredCliModel = client === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL
  const compatibleCliModels = useMemo(
    () =>
      prioritizeFavoriteModels(
        filterAssistantModels(client, withFavoriteFlag(cliModels, favoriteModels))
      ),
    [client, cliModels, favoriteModels]
  )
  const cliModelVendorFilterOptions = useMemo(
    () =>
      MODEL_VENDOR_FILTER_OPTIONS.filter((item) => {
        if (item.value === 'all') {
          return compatibleCliModels.length > 0
        }
        return filterModelsByVendor(compatibleCliModels, item.value).length > 0
      }),
    [compatibleCliModels]
  )
  const effectiveCliModelVendorFilter = useMemo(
    () => (cliModelVendorFilterOptions.some((item) => item.value === cliModelVendorFilter) ? cliModelVendorFilter : 'all'),
    [cliModelVendorFilter, cliModelVendorFilterOptions]
  )
  const visibleCliModels = useMemo(
    () => filterModelsByVendor(compatibleCliModels, effectiveCliModelVendorFilter),
    [compatibleCliModels, effectiveCliModelVendorFilter]
  )
  const showCliBridgeServiceNotice =
    aiChatProviderMode === 'custom' &&
    effectiveCliModelVendorFilter !== 'all' &&
    !(
      (client === 'codex' && effectiveCliModelVendorFilter === 'openai') ||
      (client === 'claude' && effectiveCliModelVendorFilter === 'anthropic')
    )
  const selectableCliModels = useMemo(
    () => compatibleCliModels.filter((item) => !shouldDisableCliModelForProvider(item.value, aiChatProviderMode)),
    [aiChatProviderMode, compatibleCliModels]
  )
  const selectedModelLabel =
    compatibleCliModels.find((item) => item.value === selectedModel)?.label || selectedModel || preferredCliModel
  const selectedEffortLabel =
    reasoningOptions.find((item) => item.value === reasoningEffort)?.label || reasoningEffort
  const cliModelMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(
        [
          ...compatibleCliModels.flatMap((item) => [item.label, item.value]),
          ...cliModelVendorFilterOptions.map((item) => item.label),
          '切换当前 CLI 会话模型',
        ],
        { min: 260, max: 460, padding: 112, itemCount: compatibleCliModels.length, rowHeight: 42, maxListHeight: 260 }
      ),
    [cliModelVendorFilterOptions, compatibleCliModels]
  )
  const cliReasoningMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(reasoningOptions.map((item) => item.label), {
        min: 188,
        max: 260,
        itemCount: reasoningOptions.length,
        rowHeight: 46,
        maxListHeight: 260,
      }),
    [reasoningOptions]
  )
  const unfilteredCliExtensions = useMemo(() => {
    const selectedIds = new Set(selectedExtensions.map((item) => item.id))
    return decorateCliExtensions(
      cliExtensions,
      activeExtensionPreferenceBucket.favoriteIds,
      activeExtensionPreferenceBucket.notes
    ).filter((item) => !selectedIds.has(item.id))
  }, [
    activeExtensionPreferenceBucket.favoriteIds,
    activeExtensionPreferenceBucket.notes,
    cliExtensions,
    selectedExtensions,
  ])
  const filteredCliExtensions = useMemo(() => {
    const decoratedEntries = unfilteredCliExtensions
    const normalizedSearch = extensionSearch.trim().toLowerCase()
    if (!normalizedSearch) {
      return decoratedEntries
    }

    return decoratedEntries.filter((item) =>
      [
        item.name,
        item.note || '',
        item.displayName,
        item.description,
        translateCliExtensionDescription(item.name, item.description),
        item.source || '',
        item.path,
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
    )
  }, [
    extensionSearch,
    unfilteredCliExtensions,
  ])
  const allBuiltinCliCommands = useMemo(
    () => listCliBuiltinCommands(client),
    [client]
  )
  const builtinCliCommands = useMemo(
    () =>
      allBuiltinCliCommands.filter((item) => {
        const normalizedSearch = extensionSearch.trim().toLowerCase()
        if (!normalizedSearch) {
          return true
        }
        return [item.command, item.title, item.description].some((value) =>
          value.toLowerCase().includes(normalizedSearch)
        )
      }),
    [allBuiltinCliCommands, extensionSearch]
  )
  const displayedCliExtensions = useMemo(
    () =>
      filteredCliExtensions.filter((item) =>
        extensionsMenuAnchor === 'button' ? item.kind !== 'command' : true
      ),
    [extensionsMenuAnchor, filteredCliExtensions]
  )
  const allPaletteItems = useMemo<CliPaletteItem[]>(() => {
    const items: CliPaletteItem[] = []
    if (extensionsMenuAnchor === 'composer') {
      items.push(
        ...builtinCliCommands.map((builtin) => ({
          id: `builtin:${builtin.id}`,
          section: 'command' as const,
          source: 'builtin' as const,
          builtin,
        }))
      )
    }
    const groupedExtensions = [
      ...displayedCliExtensions.filter((extension) => extension.kind === 'command'),
      ...displayedCliExtensions.filter((extension) => extension.kind === 'skill'),
      ...displayedCliExtensions.filter((extension) => extension.kind === 'plugin'),
    ]
    items.push(
      ...groupedExtensions.map((extension) => ({
        id: extension.id,
        section: extension.kind,
        source: 'extension' as const,
        extension,
      }))
    )
    return items
  }, [builtinCliCommands, displayedCliExtensions, extensionsMenuAnchor])
  const allPaletteWidthItems = useMemo<CliPaletteItem[]>(() => {
    const items: CliPaletteItem[] = []
    if (extensionsMenuAnchor === 'composer') {
      items.push(
        ...allBuiltinCliCommands.map((builtin) => ({
          id: `builtin:${builtin.id}`,
          section: 'command' as const,
          source: 'builtin' as const,
          builtin,
        }))
      )
    }
    const sourceExtensions = extensionsMenuAnchor === 'button'
      ? unfilteredCliExtensions.filter((extension) => extension.kind !== 'command')
      : unfilteredCliExtensions
    const groupedExtensions = [
      ...sourceExtensions.filter((extension) => extension.kind === 'command'),
      ...sourceExtensions.filter((extension) => extension.kind === 'skill'),
      ...sourceExtensions.filter((extension) => extension.kind === 'plugin'),
    ]
    items.push(
      ...groupedExtensions.map((extension) => ({
        id: extension.id,
        section: extension.kind,
        source: 'extension' as const,
        extension,
      }))
    )
    return items
  }, [allBuiltinCliCommands, extensionsMenuAnchor, unfilteredCliExtensions])
  const cliExtensionPaletteWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(
        allPaletteWidthItems.flatMap((item) =>
          item.source === 'builtin'
            ? [item.builtin.command, item.builtin.title, item.builtin.description]
            : [
                buildCliExtensionDisplayName(item.extension.name, item.extension.note),
                item.extension.displayName,
                item.extension.description,
              ]
        ),
        {
          min: 340,
          max: 460,
          padding: 112,
          itemCount: allPaletteWidthItems.length,
          rowHeight: 64,
          rowGap: 8,
          maxListHeight: 420,
        }
      ),
    [allPaletteWidthItems]
  )
  const availablePaletteTabs = useMemo<CliPaletteTab[]>(
    () => Array.from(new Set(allPaletteItems.map((item) => item.section))) as CliPaletteTab[],
    [allPaletteItems]
  )
  const activePaletteTab = availablePaletteTabs.includes(extensionPaletteTab)
    ? extensionPaletteTab
    : availablePaletteTabs[0] || 'skill'
  const paletteItems = useMemo(
    () => allPaletteItems.filter((item) => item.section === activePaletteTab),
    [activePaletteTab, allPaletteItems]
  )
  const composerTokenItems = useMemo(
    () =>
      selectedExtensions.map((item) => ({
        id: item.id,
        label: buildCliExtensionDisplayName(item.name, item.note),
        kindLabel: getCliExtensionKindLabel(item),
        onRemove: () => {
          setSelectedExtensions((current) => current.filter((entry) => entry.id !== item.id))
          window.setTimeout(() => promptRef.current?.focus(), 0)
        },
      })),
    [promptRef, selectedExtensions]
  )
  const effectiveHighlightedExtensionIndex = paletteItems.length
    ? Math.min(highlightedExtensionIndex, paletteItems.length - 1)
    : 0
  const recentSessions = useMemo(
    () => {
      const mergedHistory = buildCliRecentSessions({
        history,
        sessionMessagesMap,
        sessionLogsMap,
        sessionProjectPathMap,
      })
      return applyCliHistoryTitleOverrides(mergedHistory, historyTitleOverrides)
    },
    [history, historyTitleOverrides, sessionLogsMap, sessionMessagesMap, sessionProjectPathMap]
  )
  const visibleRecentSessions = useMemo(
    () => recentSessions.filter((item) => !hiddenSessionIds.includes(item.id)),
    [hiddenSessionIds, recentSessions]
  )
  const hiddenRecentSessions = useMemo(
    () => recentSessions.filter((item) => hiddenSessionIds.includes(item.id)),
    [hiddenSessionIds, recentSessions]
  )
  const historySource = historyVisibilityTab === 'hidden' ? hiddenRecentSessions : visibleRecentSessions
  const sessionsByProject = useMemo(() => {
    return historySource.reduce<Record<string, CliHistoryEntry[]>>((groups, item) => {
      const key = item.projectName || item.projectPath || '未命名项目'
      groups[key] = [...(groups[key] || []), item]
      return groups
    }, {})
  }, [historySource])
  const activeTimeline = useMemo(
    () =>
      buildCliTimeline({
        messages: activeMessages,
        logs: activeLogs,
        partial: activePartial,
        partialCreatedAt: activeMessages.at(-1)?.createdAt
          ? Math.max(Date.now(), (activeMessages.at(-1)?.createdAt || 0) + 1)
          : Date.now(),
        partialModelLabel: selectedModelLabel,
      }),
    [activeLogs, activeMessages, activePartial, selectedModelLabel]
  )
  const cliLogCompletionPlacement = useMemo(() => {
    const lastAssistantMessageIds = new Map<string, string>()
    const logByRequestId = new Map<string, Extract<CliTimelineEntry, { kind: 'log' }>>()
    const logByAssistantMessageId = new Map<string, Extract<CliTimelineEntry, { kind: 'log' }>>()
    const messageIdByLogId = new Map<string, string>()
    let pendingLog: Extract<CliTimelineEntry, { kind: 'log' }> | null = null

    for (const item of activeTimeline) {
      if (item.kind === 'log') {
        if (!item.requestId) {
          continue
        }
        logByRequestId.set(item.requestId, item)
        pendingLog = item
        continue
      }
      if (item.kind === 'message' && item.role === 'assistant' && item.requestId) {
        lastAssistantMessageIds.set(item.requestId, item.id)
      }
      if (item.kind === 'message' && item.role === 'user') {
        pendingLog = null
        continue
      }
      if (item.kind === 'message' && item.role === 'assistant' && pendingLog) {
        logByAssistantMessageId.set(item.id, pendingLog)
        messageIdByLogId.set(pendingLog.id, item.id)
        pendingLog = null
      }
    }

    for (const [requestId, logItem] of logByRequestId) {
      const messageId = lastAssistantMessageIds.get(requestId)
      if (!messageId || messageIdByLogId.has(logItem.id)) {
        continue
      }
      messageIdByLogId.set(logItem.id, messageId)
      logByAssistantMessageId.set(messageId, logItem)
    }

    return {
      lastAssistantMessageIds,
      logByRequestId,
      logByAssistantMessageId,
      messageIdByLogId,
    }
  }, [activeTimeline])
  useEffect(() => {
    if (!selectedModel || !shouldDisableCliModelForProvider(selectedModel, aiChatProviderMode)) {
      return
    }
    const nextModel = selectableCliModels[0]?.value || ''
    setSelectedModel(nextModel)
    toast('该模型需要 OneAPI 专用桥接服务，已切换到当前通道可用模型。')
  }, [aiChatProviderMode, client, selectableCliModels, selectedModel, toast])
  useAutoFollowScroll(threadRef, [activeTimeline, running, activePartial])
  const buildCliExportLogGroups = useCallback((logs: CliLogEntry[]) => {
    const grouped = new Map<string, ExportCliLogGroup>()
    for (const item of logs) {
      const groupKey = item.requestId || `${item.createdAt}:${item.content}`
      const current = grouped.get(groupKey) || {
        title: item.content,
        createdAt: item.createdAt,
        events: [],
      }
      current.createdAt = Math.min(current.createdAt, item.createdAt)
      current.events.push({
        kind: item.logKind,
        sourceKind: item.sourceKind,
        message: item.content,
        command: item.command,
        detail: item.detail,
        exitCode: item.exitCode,
      })
      grouped.set(groupKey, current)
    }
    return [...grouped.values()].sort((left, right) => left.createdAt - right.createdAt)
  }, [])
  function toggleFavoriteModel(value: string) {
    setFavoriteModels((current) => {
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [value, ...current]
      storeFavoriteModels(`oneapi-desktop-${client}-favorites`, next)
      return next
    })
  }

  const refreshCliState = useCallback(async (silent = false) => {
    try {
      const [cliStatusAll, cliHistory] = await Promise.all([
        getCliStatus(),
        listCliHistory(client),
      ])
      const nextStatus = client === 'codex' ? cliStatusAll.codex : cliStatusAll.claude
      writeCachedCliStatus(nextStatus)
      setStatus((current) => (sameCliStatus(current, nextStatus) ? current : nextStatus))
      setHistory(cliHistory)
    } catch (error) {
      if (!silent) {
        toast(error instanceof Error ? error.message : `${client} 环境检测失败`)
      }
    }
  }, [client, toast])

  const refreshCliExtensions = useCallback(async (silent = false) => {
    try {
      setExtensionsLoading(true)
      const next = await listCliExtensions(client)
      setCliExtensions(next)
      setExtensionsLoadedOnce(true)
    } catch (error) {
      if (!silent) {
        toast(error instanceof Error ? error.message : '读取技能与插件失败')
      }
    } finally {
      setExtensionsLoading(false)
    }
  }, [client, toast])

  const updateCliExtensionPreferenceBucket = useCallback((
    projectKey: string,
    updater: (bucket: CliExtensionPreferenceBucket) => CliExtensionPreferenceBucket
  ) => {
    setCliExtensionPreferences((current) => {
      const previousBucket = current[projectKey] || createEmptyCliExtensionPreferenceBucket()
      const nextBucket = updater(previousBucket)
      return {
        ...current,
        [projectKey]: nextBucket,
      }
    })
  }, [])

  const toggleFavoriteCliExtension = useCallback((item: CliExtensionEntry) => {
    updateCliExtensionPreferenceBucket(currentExtensionPreferenceKey, (bucket) => {
      const exists = bucket.favoriteIds.includes(item.id)
      return {
        ...bucket,
        favoriteIds: exists
          ? bucket.favoriteIds.filter((entryId) => entryId !== item.id)
          : [item.id, ...bucket.favoriteIds.filter((entryId) => entryId !== item.id)],
      }
    })
  }, [currentExtensionPreferenceKey, updateCliExtensionPreferenceBucket])

  const updateCliExtensionNote = useCallback((item: CliExtensionEntry, note: string) => {
    updateCliExtensionPreferenceBucket(currentExtensionPreferenceKey, (bucket) => {
      const normalizedNote = note.trim()
      const nextNotes = { ...bucket.notes }
      if (normalizedNote) {
        nextNotes[item.id] = normalizedNote
      } else {
        delete nextNotes[item.id]
      }
      return {
        ...bucket,
        notes: nextNotes,
      }
    })
    setSelectedExtensions((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              note: note.trim(),
            }
          : entry
      )
    )
  }, [currentExtensionPreferenceKey, updateCliExtensionPreferenceBucket])

  const moveCliSessionOverlay = useCallback((fromSessionId: string, toSessionId: string) => {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
      return
    }
    setCliMessageOverlays((current) => {
      const fromEntries = current[fromSessionId] || []
      if (!fromEntries.length) {
        return current
      }
      const next = {
        ...current,
        [toSessionId]: [...(current[toSessionId] || []), ...fromEntries],
      }
      delete next[fromSessionId]
      return next
    })
    setSessionPlansMap((current) => {
      if (!current[fromSessionId]) {
        return current
      }
      const next = {
        ...current,
        [toSessionId]: current[toSessionId] || current[fromSessionId],
      }
      delete next[fromSessionId]
      return next
    })
  }, [])

  const persistCliMessageOverlay = useCallback((sessionId: string, message: CliMessage) => {
    if (!sessionId || message.role !== 'user') {
      return
    }
    const nextOverlay: CliMessageOverlay = {
      role: message.role,
      content: message.content,
      requestId: message.requestId,
      attachments: message.attachments,
      selectedExtensions: message.selectedExtensions,
    }
    setCliMessageOverlays((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] || []), nextOverlay],
    }))
  }, [])

  const flushPendingCliLogEntries = useCallback(() => {
    const pending = pendingCliLogEntriesRef.current
    pendingCliLogEntriesRef.current = {}
    pendingCliLogFlushTimerRef.current = null
    const sessionIds = Object.keys(pending)
    if (!sessionIds.length) {
      return
    }

    startTransition(() => {
      setSessionLogsMap((current) => {
        let changed = false
        const next: Record<string, CliLogEntry[]> = { ...current }

        for (const sessionId of sessionIds) {
          const entries = pending[sessionId]
          if (!entries?.length) {
            continue
          }
          let sessionLogs = next[sessionId] || []
          for (const entry of entries) {
            const lastEntry = sessionLogs.at(-1)
            if (isSameCliLogEntry(lastEntry, entry)) {
              continue
            }
            if (shouldReplaceStreamingCliIntentEntry(lastEntry, entry)) {
              const replaceId = lastEntry?.id
              if (replaceId) {
                sessionLogs = sessionLogs.map((item) => (item.id === replaceId ? entry : item))
                changed = true
              }
              continue
            }
            sessionLogs = [...sessionLogs, entry]
            changed = true
          }
          next[sessionId] = sessionLogs
        }

        return changed ? next : current
      })
    })
  }, [])

  const enqueueCliLogEntry = useCallback((sessionId: string, entry: CliLogEntry, urgent = false) => {
    const entries = pendingCliLogEntriesRef.current[sessionId]
    if (entries) {
      entries.push(entry)
    } else {
      pendingCliLogEntriesRef.current[sessionId] = [entry]
    }
    if (pendingCliLogFlushTimerRef.current !== null) {
      if (!urgent) {
        return
      }
      window.clearTimeout(pendingCliLogFlushTimerRef.current)
    }
    const delay = urgent ? 0 : performanceMode === 'efficiency' ? 80 : 24
    pendingCliLogFlushTimerRef.current = window.setTimeout(flushPendingCliLogEntries, delay)
  }, [flushPendingCliLogEntries, performanceMode])

  useEffect(() => {
    return () => {
      if (pendingCliLogFlushTimerRef.current !== null) {
        window.clearTimeout(pendingCliLogFlushTimerRef.current)
      }
    }
  }, [])

  const closeCliExtensionsMenu = useCallback((focusPrompt = false) => {
    setExtensionsMenuOpen(false)
    setExtensionsMenuAnchor('button')
    setExtensionsOverlayStyle({})
    setExtensionSearch('')
    setHighlightedExtensionIndex(0)
    if (focusPrompt) {
      window.setTimeout(() => promptRef.current?.focus(), 0)
    }
  }, [promptRef])

  const openCliExtensionsMenu = useCallback((anchor: 'composer' | 'button') => {
    setModelMenuOpen(false)
    setEffortMenuOpen(false)
    setExtensionsMenuAnchor(anchor)
    setExtensionPaletteTab(anchor === 'composer' ? 'command' : 'skill')
    if (anchor === 'composer') {
      const composerShell = extensionsMenuRef.current?.querySelector<HTMLElement>('.composer-input-shell')
      const shellRect = composerShell?.getBoundingClientRect()
      if (shellRect) {
        const paletteWidth = Math.min(360, Math.max(320, Math.min(shellRect.width - 16, 360)))
        setExtensionsOverlayStyle({
          left: 0,
          width: paletteWidth,
        })
      } else {
        setExtensionsOverlayStyle({})
      }
    } else {
      setExtensionsOverlayStyle({})
    }
    if (!extensionsLoadedOnce && cliExtensions.length === 0) {
      setExtensionsLoading(true)
    }
    setExtensionsMenuOpen(true)
    setExtensionSearch('')
    setHighlightedExtensionIndex(0)
    void refreshCliExtensions(true)
  }, [cliExtensions.length, extensionsLoadedOnce, refreshCliExtensions])

  const insertCliCommandText = useCallback((commandText: string) => {
    const textarea = promptRef.current
    const currentValue = prompt
    if (!textarea) {
      setPrompt((current) => `${current}${current && !current.endsWith('\n') ? '\n' : ''}${commandText} `)
      closeCliExtensionsMenu(true)
      return
    }
    const start = textarea.selectionStart ?? currentValue.length
    const end = textarea.selectionEnd ?? currentValue.length
    const nextValue = `${currentValue.slice(0, start)}${commandText} ${currentValue.slice(end)}`
    setPrompt(nextValue)
    cliPromptHistory.syncInputValue(nextValue)
    closeCliExtensionsMenu(true)
    window.setTimeout(() => {
      syncTextareaHeight(promptRef.current)
      promptRef.current?.focus()
      const cursor = start + commandText.length + 1
      promptRef.current?.setSelectionRange(cursor, cursor)
    }, 0)
  }, [cliPromptHistory, closeCliExtensionsMenu, prompt, promptRef])

  const insertCliPaletteItem = useCallback((paletteItem: CliPaletteItem) => {
    if (paletteItem.source === 'builtin') {
      insertCliCommandText(paletteItem.builtin.command)
      return
    }
    const item = paletteItem.extension
    if (item.kind === 'command') {
      const insertText = buildCliExtensionInsertText({
        client,
        kind: item.kind,
        name: item.name,
      })
      if (insertText) {
        insertCliCommandText(insertText.trim())
      }
      return
    }
    if (!canUseCliExtension(item)) {
      return
    }
    setSelectedExtensions((current) => {
      if (current.some((entry) => entry.id === item.id)) {
        return current
      }
      return [...current, item]
    })
    closeCliExtensionsMenu(true)
    window.setTimeout(() => {
      resizePrompt()
    }, 0)
  }, [client, closeCliExtensionsMenu, insertCliCommandText, resizePrompt])

  const selectHighlightedCliExtension = useCallback(() => {
    const target = paletteItems[effectiveHighlightedExtensionIndex]
    if (target) {
      insertCliPaletteItem(target)
    }
  }, [effectiveHighlightedExtensionIndex, insertCliPaletteItem, paletteItems])

  const handleInstallCliExtension = useCallback(async (item: CliExtensionViewItem) => {
    if (!item.installable || !item.installKey) {
      return
    }
    setInstallingExtensionIds((current) => current.includes(item.id) ? current : [...current, item.id])
    try {
      const result = await installCliExtension({
        client,
        extensionId: item.id,
      })
      if (!result.success) {
        toast(result.message || '安装失败')
        return
      }
      toast(result.message || '安装完成')
      await refreshCliExtensions(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : '安装失败')
    } finally {
      setInstallingExtensionIds((current) => current.filter((entryId) => entryId !== item.id))
    }
  }, [client, refreshCliExtensions, toast])

  const handleCliExtensionPaletteKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!extensionsMenuOpen) {
      return false
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeCliExtensionsMenu(true)
      return true
    }

    if (!paletteItems.length) {
      return false
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedExtensionIndex((current) => (current + 1) % paletteItems.length)
      return true
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedExtensionIndex((current) =>
        current <= 0 ? paletteItems.length - 1 : current - 1
      )
      return true
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      selectHighlightedCliExtension()
      return true
    }

    return false
  }, [closeCliExtensionsMenu, extensionsMenuOpen, paletteItems, selectHighlightedCliExtension])

  const extensionTranslationStorageKey = `oneapi-desktop-${client}-extension-detail-translations`

  const getCachedCliExtensionTranslation = useCallback((item: CliExtensionViewItem) => {
    const originalDescription = item.description.trim()
    if (!originalDescription) {
      return ''
    }
    const cache = readJsonStorage<CliExtensionTranslationCache>(extensionTranslationStorageKey, {})
    const cacheKey = resolveCliExtensionTranslationCacheKey(client, item, originalDescription)
    return cache[cacheKey]?.trim() || ''
  }, [client, extensionTranslationStorageKey])

  const translateCliExtensionDetail = useCallback(async (item: CliExtensionViewItem) => {
    const originalDescription = item.description.trim()
    if (!originalDescription) {
      return ''
    }

    const cachedTranslation = getCachedCliExtensionTranslation(item)
    if (cachedTranslation) {
      return cachedTranslation
    }

    const localTranslation = translateCliExtensionDescription(item.name, originalDescription).trim()
    if (localTranslation && localTranslation !== originalDescription) {
      const cache = readJsonStorage<CliExtensionTranslationCache>(extensionTranslationStorageKey, {})
      writeJsonStorage(extensionTranslationStorageKey, {
        ...cache,
        [resolveCliExtensionTranslationCacheKey(client, item, originalDescription)]: localTranslation,
      })
      return localTranslation
    }

    const translationModel =
      selectedModel ||
      compatibleCliModels.find((entry) => entry.value.trim())?.value ||
      preferredCliModel

    try {
      const response = await sendChatCompletion({
        model: translationModel,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: '你是专业的软件技能说明翻译助手。请将用户给出的英文说明准确翻译成简体中文，只输出译文，不要补充解释。技术名词、路径、命令、标识符保持原样。',
          },
          {
            role: 'user',
            content: originalDescription,
          },
        ],
      })
      const translated = response.choices[0]?.message?.content?.trim() || localTranslation || originalDescription
      if (translated && translated !== originalDescription) {
        const cache = readJsonStorage<CliExtensionTranslationCache>(extensionTranslationStorageKey, {})
        writeJsonStorage(extensionTranslationStorageKey, {
          ...cache,
          [resolveCliExtensionTranslationCacheKey(client, item, originalDescription)]: translated,
        })
      }
      return translated
    } catch {
      return localTranslation || originalDescription
    }
  }, [
    client,
    compatibleCliModels,
    extensionTranslationStorageKey,
    getCachedCliExtensionTranslation,
    preferredCliModel,
    selectedModel,
  ])

  useEffect(() => {
    requestSessionMapRef.current = requestSessionMap
  }, [requestSessionMap])

  useEffect(() => {
    writeJsonStorage(`oneapi-desktop-${client}-pinned-groups`, pinnedHistoryGroups)
  }, [client, pinnedHistoryGroups])

  useEffect(() => {
    writeJsonStorage(projectSessionMapStorageKey, projectSessionMap)
  }, [projectSessionMap, projectSessionMapStorageKey])

  useEffect(() => {
    writeJsonStorage(lastProjectPathStorageKey, projectPath)
  }, [lastProjectPathStorageKey, projectPath])

  useEffect(() => {
    writeJsonStorage(`oneapi-desktop-${client}-history-title-overrides`, historyTitleOverrides)
  }, [client, historyTitleOverrides])

  useEffect(() => {
    writeJsonStorage(`oneapi-desktop-${client}-extension-preferences`, cliExtensionPreferences)
  }, [cliExtensionPreferences, client])

  useDebouncedJsonStorage(
    `oneapi-desktop-${client}-message-overlays`,
    cliMessageOverlays,
    performanceMode === 'efficiency' ? 900 : 260
  )

  useDebouncedJsonStorage(
    `oneapi-desktop-${client}-session-logs`,
    sessionLogsMap,
    performanceMode === 'efficiency' ? 1200 : 360
  )

  useDebouncedJsonStorage(
    `oneapi-desktop-${client}-session-plans`,
    sessionPlansMap,
    performanceMode === 'efficiency' ? 900 : 260
  )

  useEffect(() => {
    writeJsonStorage(`oneapi-desktop-${client}-session-project-paths`, sessionProjectPathMap)
  }, [client, sessionProjectPathMap])

  useEffect(() => {
    writeJsonStorage(`oneapi-desktop-${client}-selected-model`, selectedModel)
  }, [client, selectedModel])

  useEffect(() => {
    const handleDesktopModelSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ client?: string; model?: string }>).detail
      const nextClient = detail?.client
      const nextModel = detail?.model?.trim()
      if (nextClient === client && nextModel) {
        setSelectedModel(nextModel)
      }
    }
    window.addEventListener('oneapi:desktop-model-selection', handleDesktopModelSelection)
    return () => window.removeEventListener('oneapi:desktop-model-selection', handleDesktopModelSelection)
  }, [client])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const models = aiChatProviderMode === 'custom'
          ? await getUserModels()
          : await loadOneApiModelsForActiveKey(activeApiKey)
        if (!disposed) {
          setCliModels(models)
          setSelectedModel((current) =>
            resolveCompatibleModel(client, models, current, preferredCliModel)
          )
        }
      } catch {
        if (!disposed) {
          setSelectedModel('')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [
    activeApiKey?.group,
    activeApiKey?.id,
    activeApiKey?.model_limits,
    activeApiKey?.model_limits_enabled,
    aiChatProviderMode,
    client,
    preferredCliModel,
  ])

  useEffect(() => {
    const shouldPollActively = active || effectiveRunning
    if (shouldPollActively) {
      window.setTimeout(() => {
        void refreshCliState(true)
      }, 0)
    }
    const intervalMs = shouldPollActively ? 30000 : 180000
    const timer = window.setInterval(() => {
      void refreshCliState(true)
    }, intervalMs)

    return () => {
      window.clearInterval(timer)
    }
  }, [active, effectiveRunning, refreshCliState])

  useEffect(() => {
    window.setTimeout(() => {
      void refreshCliExtensions(true)
    }, 0)
  }, [refreshCliExtensions])

  useEffect(() => {
    const unsubscribe = onCliProgress((payload: CliProgressPayload) => {
      if (payload.client !== client) {
        return
      }

      let tracked = requestSessionMapRef.current[payload.requestId]
      if (!tracked && payload.requestId.startsWith('mobile-')) {
        const remoteSessionId = payload.sessionId || `remote-${payload.requestId}`
        const remoteProjectPath = payload.projectPath || projectPath
        tracked = {
          sessionId: remoteSessionId,
          projectPath: remoteProjectPath,
        }
        requestSessionMapRef.current = {
          ...requestSessionMapRef.current,
          [payload.requestId]: tracked,
        }
        setRequestSessionMap((current) => ({
          ...current,
          [payload.requestId]: tracked as { sessionId: string; projectPath: string },
        }))
        if (remoteProjectPath) {
          bindProjectSession(remoteProjectPath, remoteSessionId)
          applyProjectPath(remoteProjectPath)
        }
        if (payload.prompt?.trim()) {
          const userMessage = {
            id: `user-${payload.requestId}`,
            role: 'user' as const,
            content: payload.prompt.trim(),
            createdAt: payload.createdAt,
            requestId: payload.requestId,
          }
          setSessionMessagesMap((current) => {
            const previous = current[remoteSessionId] || []
            if (previous.some((item) => item.requestId === payload.requestId && item.role === 'user')) {
              return current
            }
            return {
              ...current,
              [remoteSessionId]: [...previous, userMessage],
            }
          })
          persistCliMessageOverlay(remoteSessionId, userMessage)
        }
        activeRequestIdRef.current = payload.requestId
        stoppingRunRef.current = false
        setRunning(true)
        onRunningStateChange(client, { running: true, requestId: payload.requestId })
      }
      const currentSession = payload.sessionId || tracked?.sessionId
      if (!currentSession) {
        return
      }

      if (payload.sessionId && tracked?.sessionId && payload.sessionId !== tracked.sessionId) {
        const nextSessionId = payload.sessionId
        updateProjectSessionMap((current) => ({
          ...current,
          [normalizeProjectKey(tracked.projectPath)]: nextSessionId,
        }))
        setSessionMessagesMap((current) => {
          const previous = current[tracked.sessionId] || []
          const incoming = current[nextSessionId] || []
          const next = {
            ...current,
            [nextSessionId]: mergeCliMessages(previous, incoming),
          }
          delete next[tracked.sessionId]
          return next
        })
        setSessionLogsMap((current) => {
          const previous = current[tracked.sessionId] || []
          const incoming = current[nextSessionId] || []
          const next = {
            ...current,
            [nextSessionId]: mergeCliLogs(previous, incoming),
          }
          delete next[tracked.sessionId]
          return next
        })
        setSessionPartialMap((current) => {
          const fallbackPartial = current[tracked.sessionId] || ''
          const incomingPartial = current[nextSessionId] || ''
          const next = {
            ...current,
            [nextSessionId]: incomingPartial || fallbackPartial,
          }
          delete next[tracked.sessionId]
          return next
        })
        setRequestSessionMap((current) => ({
          ...current,
          [payload.requestId]: {
            ...current[payload.requestId],
            sessionId: nextSessionId,
          },
        }))
        moveCliSessionOverlay(tracked.sessionId, nextSessionId)
      }

      const targetSessionId = payload.sessionId || tracked?.sessionId || currentSession

      if (payload.plan !== undefined) {
        setSessionPlansMap((current) => ({
          ...current,
          [targetSessionId]: payload.plan || null,
        }))
      }

      if (payload.done && activeRequestIdRef.current === payload.requestId) {
        activeRequestIdRef.current = ''
        stoppingRunRef.current = false
        setRunning(false)
        onRunningStateChange(client, { running: false, requestId: '' })
      }

      if (payload.kind === 'partial') {
        setSessionPartialMap((current) => {
          return {
            ...current,
            [targetSessionId]: payload.message,
          }
        })
        if (payload.done) {
          window.setTimeout(() => {
            setSessionPartialMap((current) => ({
              ...current,
              [targetSessionId]: '',
            }))
          }, 0)
        }
        return
      }

      const entryIndex = cliLogEntrySequenceRef.current
      cliLogEntrySequenceRef.current += 1
      const nextEntry = {
        id: `${payload.requestId}-${payload.kind}-${payload.createdAt}-${targetSessionId}-${entryIndex}-${payload.sourceKind || 'status'}`,
        requestId: payload.requestId,
        sessionId: targetSessionId,
        level: payload.kind === 'error' ? 'error' : 'status',
        logKind: payload.logKind || (payload.kind === 'error' ? 'error' : 'status'),
        sourceKind: payload.sourceKind,
        content: payload.message,
        assistantChunk: payload.assistantChunk,
        indentLevel: payload.indentLevel,
        createdAt: payload.createdAt,
        files: payload.files,
        detail: payload.detail,
        command: payload.command,
        exitCode: payload.exitCode,
        interaction: payload.interaction,
        done: payload.done,
      } satisfies CliLogEntry
      enqueueCliLogEntry(targetSessionId, nextEntry, !!payload.done)

      if (payload.done) {
        setSessionPartialMap((current) => ({
          ...current,
          [targetSessionId]: '',
        }))
      }
    })

    return unsubscribe
  }, [client, enqueueCliLogEntry, moveCliSessionOverlay, onRunningStateChange, persistCliMessageOverlay, projectPath])

  useEffect(() => {
    const resetTimer = window.setTimeout(() => {
      setExpandedLogEventMap({})
      setPreviewFile(null)
      setExtensionsMenuOpen(false)
      setExtensionSearch('')
      setSelectedExtensions([])
    }, 0)
    return () => window.clearTimeout(resetTimer)
  }, [activeSessionId])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (isAssistantHistoryTriggerTarget(event.target)) {
        return
      }
      if (event.target instanceof Element && event.target.closest('.cli-extension-floating-tooltip')) {
        return
      }

      if (modelMenuOpen && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setModelMenuOpen(false)
      }

      if (effortMenuOpen && effortMenuRef.current && !effortMenuRef.current.contains(target)) {
        setEffortMenuOpen(false)
      }

      if (extensionsMenuOpen && extensionsPaletteRef.current && !extensionsPaletteRef.current.contains(target)) {
        if (!extensionsButtonRef.current || !extensionsButtonRef.current.contains(target)) {
          closeCliExtensionsMenu(false)
        }
      }

      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        closeCliHistoryPanel()
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target as Node | null
      if (
        extensionsMenuOpen &&
        target &&
        extensionsPaletteRef.current &&
        !extensionsPaletteRef.current.contains(target) &&
        !(event.target instanceof Element && event.target.closest('.cli-extension-floating-tooltip')) &&
        (!extensionsButtonRef.current || !extensionsButtonRef.current.contains(target))
      ) {
        closeCliExtensionsMenu(false)
      }
    }

    function handleWindowBlur() {
      if (extensionsMenuOpen) {
        closeCliExtensionsMenu(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('focusin', handleFocusIn)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [closeCliExtensionsMenu, effortMenuOpen, extensionsMenuOpen, historyOpen, modelMenuOpen])

  useEffect(() => {
    function handleOpenHistory() {
      setHistoryOpen((current) => {
        if (current) {
          setSessionContextMenu(null)
        }
        return !current
      })
    }
    window.addEventListener(`oneapi:open-${client}-history`, handleOpenHistory as EventListener)
    return () => window.removeEventListener(`oneapi:open-${client}-history`, handleOpenHistory as EventListener)
  }, [client, moveCliSessionOverlay])

  useEffect(() => {
    if (active) {
      void setDesktopWindowTitle(projectName)
    }
  }, [active, projectName])

  useEffect(() => {
    if (!active || !projectPath.trim()) {
      return
    }

    const preferredSessionId = resolvePreferredCliSessionId({
      projectPath,
      projectSessionMap,
      lastOpenedSessionId,
      lastOpenedProjectPath,
    })
    if (isDraftCliSessionId(preferredSessionId)) {
      return
    }
    const targetHistory = resolveCliHistorySessionForProject({
      history,
      projectPath,
      preferredSessionId,
    })

    if (!targetHistory || !targetHistory.id || sessionMessagesMap[targetHistory.id]?.length) {
      return
    }

    if (autoHydratingSessionIdsRef.current.has(targetHistory.id)) {
      return
    }

    autoHydratingSessionIdsRef.current.add(targetHistory.id)
    void handleOpenHistory(targetHistory).finally(() => {
      autoHydratingSessionIdsRef.current.delete(targetHistory.id)
    })
  }, [active, history, lastOpenedProjectPath, lastOpenedSessionId, projectPath, projectSessionMap, sessionMessagesMap])

  function applyProjectPath(nextPath: string) {
    setProjectPath(nextPath)
    setProjectName(resolveProjectNameFromPath(nextPath))
  }

  function closeCliHistoryPanel() {
    setHistoryOpen(false)
    setSessionContextMenu(null)
  }

  function updateProjectSessionMap(
    updater: (current: Record<string, string>) => Record<string, string>
  ) {
    projectSessionMapRef.current = updater(projectSessionMapRef.current)
    setProjectSessionMap(projectSessionMapRef.current)
  }

  function persistHiddenSessions(next: string[]) {
    setHiddenSessionIds(next)
    writeJsonStorage(`oneapi-desktop-${client}-hidden-sessions`, next)
  }

  function unhideSession(sessionId: string) {
    persistHiddenSessions(hiddenSessionIds.filter((item) => item !== sessionId))
  }

  function hideSession(sessionId: string) {
    if (!hiddenSessionIds.includes(sessionId)) {
      persistHiddenSessions([...hiddenSessionIds, sessionId])
    }
  }

  function togglePinnedHistoryGroup(groupKey: string) {
    setPinnedHistoryGroups((current) =>
      current.includes(groupKey)
        ? current.filter((item) => item !== groupKey)
        : [groupKey, ...current]
    )
  }

  function removeCliSessionsFromState(sessionIds: string[]) {
    const removeSet = new Set(sessionIds)
    setHistory((current) => current.filter((item) => !removeSet.has(item.id)))
    persistHiddenSessions(hiddenSessionIds.filter((item) => !removeSet.has(item)))
    setSessionMessagesMap((current) => {
      const next = { ...current }
      for (const id of removeSet) {
        delete next[id]
      }
      return next
    })
    setSessionLogsMap((current) => {
      const next = { ...current }
      for (const id of removeSet) {
        delete next[id]
      }
      return next
    })
    setSessionPartialMap((current) => {
      const next = { ...current }
      for (const id of removeSet) {
        delete next[id]
      }
      return next
    })
    setSessionPlansMap((current) => {
      const next = { ...current }
      for (const id of removeSet) {
        delete next[id]
      }
      return next
    })
    setSessionProjectPathMap((current) => {
      const next = { ...current }
      for (const id of removeSet) {
        delete next[id]
      }
      return next
    })
    setHistoryTitleOverrides((current) => {
      const next = { ...current }
      for (const id of removeSet) {
        delete next[id]
      }
      return next
    })
    updateProjectSessionMap((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, sessionId]) => !removeSet.has(sessionId))
      )
    )
    setRequestSessionMap((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, item]) => !removeSet.has(item.sessionId))
      )
    )
    if (activeSessionId && removeSet.has(activeSessionId)) {
      setPreviewFile(null)
      setExpandedLogEventMap({})
    }
  }

  async function removeCliSessions(sessionIds: string[], successMessage: string) {
    const normalizedIds = [...new Set(sessionIds.map((item) => item.trim()).filter(Boolean))]
    if (!normalizedIds.length) {
      return
    }
    await deleteCliSessions(client, normalizedIds)
    removeCliSessionsFromState(normalizedIds)
    await refreshCliState(true)
    toast(successMessage)
  }

  async function exportCliSession(item: CliHistoryEntry) {
    try {
      const details = await getCliSession(client, item.id)
      if (!details) {
        throw new Error('未能读取完整会话内容。')
      }
      const content = buildCliSessionExportMarkdown({
        client,
        title: item.preview || item.title,
        details,
        logs: buildCliExportLogGroups(sessionLogsMap[item.id] || []),
      })
      const result = await exportTextFile(
        buildSessionExportFileName(client, item.title || item.preview || '会话'),
        content,
        `导出${client === 'codex' ? ' Codex ' : ' Claude '}会话`
      )
      toast(`已导出到：${result.path}`)
    } catch (error) {
      if (error instanceof Error && error.message === '已取消导出。') {
        return
      }
      throw error
    }
  }

  function bindProjectSession(nextProjectPath: string, sessionId: string) {
    const nextProjectKey = normalizeProjectKey(nextProjectPath)
    if (!nextProjectKey || !sessionId) {
      return
    }
    setLastOpenedSessionId((current) => (current === sessionId ? current : sessionId))
    setLastOpenedProjectPath((current) => (current === nextProjectPath ? current : nextProjectPath))
    writeJsonStorage(lastOpenedSessionIdStorageKey, sessionId)
    writeJsonStorage(lastOpenedProjectPathStorageKey, nextProjectPath)
    setSessionProjectPathMap((current) => ({
      ...current,
      [sessionId]: nextProjectPath,
    }))
    updateProjectSessionMap((current) => ({
      ...current,
      [nextProjectKey]: sessionId,
    }))
  }

  function toggleLogEvent(groupId: string, eventId: string) {
    setExpandedLogEventMap((current) => {
      const currentGroup = current[groupId] || []
      return {
        ...current,
        [groupId]: currentGroup.includes(eventId)
          ? currentGroup.filter((item) => item !== eventId)
          : [...currentGroup, eventId],
      }
    })
  }

  function updateCliInteractionStatus(
    sessionId: string,
    interactionId: string,
    status: CliInteractionPrompt['status']
  ) {
    if (!sessionId || !interactionId) {
      return
    }
    setSessionLogsMap((current) => {
      const previous = current[sessionId] || []
      const nextLogs = previous.map((entry) =>
        entry.interaction?.id === interactionId
          ? {
              ...entry,
              interaction: {
                ...entry.interaction,
                status,
              },
            }
          : entry
      )
      return {
        ...current,
        [sessionId]: nextLogs,
      }
    })
  }

  function hydrateCliSession(
    details: CliSessionDetails,
    options: {
      activateProject?: boolean
    } = {}
  ) {
    const normalizedUpdatedAt = normalizeTimestampMs(details.updatedAt)
    const normalizedMessages = applyCliMessageOverlays(
      details.messages.map((message) => ({
        ...message,
        createdAt: normalizeTimestampMs(message.createdAt),
      })),
      cliMessageOverlays[details.id] || []
    )

    if (details.projectPath) {
      bindProjectSession(details.projectPath, details.id)
      if (options.activateProject !== false) {
        applyProjectPath(details.projectPath)
      }
    } else if (options.activateProject !== false) {
      setProjectName(details.projectName || '')
    }

    setSessionMessagesMap((current) => ({
      ...current,
      [details.id]: mergeCliMessages(current[details.id] || [], normalizedMessages),
    }))
    setSessionLogsMap((current) => ({
      ...current,
      [details.id]:
        current[details.id]?.length
          ? current[details.id]
          : details.fileChanges?.length
            ? [
                {
                  id: `${details.id}-summary-log`,
                  sessionId: details.id,
                  level: 'status',
                  content: `本次开发共修改 ${details.fileChanges.length} 个文件`,
                  createdAt: normalizedUpdatedAt || Date.now(),
                  files: details.fileChanges,
                },
              ]
            : current[details.id] || [],
    }))
    setSessionPartialMap((current) => ({
      ...current,
      [details.id]: '',
    }))
    setSessionPlansMap((current) => ({
      ...current,
      [details.id]: details.plan || null,
    }))
  }

  async function ensureProjectSession(nextPath: string) {
    const nextProjectKey = normalizeProjectKey(nextPath)
    const existingSessionId = projectSessionMap[nextProjectKey]
    if (existingSessionId) {
      return
    }

    const matched = history
      .filter((item) => normalizeProjectKey(item.projectPath) === nextProjectKey)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]

    if (matched) {
      await handleOpenHistory(matched, false)
      return
    }

    bindProjectSession(nextPath, `draft-${client}-${Date.now()}`)
  }

  async function handlePickProject() {
    const selected = await pickProjectDirectory()
    if (selected) {
      applyProjectPath(selected)
      await ensureProjectSession(selected)
      toast(`已切换到项目：${resolveProjectNameFromPath(selected) || selected}`)
    }
  }

  function createCliSession() {
    const nextProjectPath = projectPath.trim()
    if (running) {
      toast(`请先停止当前 ${client === 'codex' ? 'Codex' : 'Claude'} 回复。`)
      return
    }
    if (!nextProjectPath) {
      toast('请选择项目目录后再新建会话。')
      return
    }

    const nextSessionId = `draft-${client}-${Date.now()}`
    bindProjectSession(nextProjectPath, nextSessionId)
    setSessionMessagesMap((current) => ({
      ...current,
      [nextSessionId]: [],
    }))
    setSessionLogsMap((current) => ({
      ...current,
      [nextSessionId]: [],
    }))
    setSessionPartialMap((current) => ({
      ...current,
      [nextSessionId]: '',
    }))
    setSessionPlansMap((current) => ({
      ...current,
      [nextSessionId]: null,
    }))
    setExpandedLogEventMap({})
    setPrompt('')
    cliPromptHistory.syncInputValue('')
    setSelectedExtensions([])
    clearAttachments()
    setPreviewFile(null)
    window.setTimeout(() => {
      resizePrompt()
      promptRef.current?.focus()
    }, 0)
    closeCliHistoryPanel()
  }

  async function handleOpenHistory(item: CliHistoryEntry, activateProject = true) {
    if (item.projectPath) {
      bindProjectSession(item.projectPath, item.id)
      if (activateProject) {
        applyProjectPath(item.projectPath)
      }
    } else if (activateProject) {
      setProjectName(item.projectName || item.title)
    }
    setPrompt('')
    cliPromptHistory.syncInputValue('')
    window.setTimeout(() => resizePrompt(), 0)

    if (sessionMessagesMap[item.id]?.length) {
      closeCliHistoryPanel()
      return
    }

    try {
      const details = await getCliSession(client, item.id)
      if (!details) {
        toast('未能读取完整会话记录。')
        return
      }
      hydrateCliSession(details, { activateProject })
      closeCliHistoryPanel()
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取会话失败')
    }
  }

  function renameHistorySession(sessionId: string) {
    const currentTitle =
      historyTitleOverrides[sessionId] ||
      recentSessions.find((item) => item.id === sessionId)?.title ||
      recentSessions.find((item) => item.id === sessionId)?.preview ||
      '新会话'
    setRenamingHistorySession({
      id: sessionId,
      value: currentTitle,
    })
  }

  function commitHistorySessionRename(sessionId: string) {
    if (renamingHistorySession?.id !== sessionId) {
      return
    }

    const nextTitle = renamingHistorySession.value.trim()
    setRenamingHistorySession(null)
    if (!nextTitle) {
      return
    }
    setHistoryTitleOverrides((current) => ({
      ...current,
      [sessionId]: nextTitle,
    }))
  }

  function handleHistorySessionContextMenu(event: MouseEvent, item: CliHistoryEntry) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: item.title || item.preview || '会话',
      scope: 'history',
      items: [
        {
          key: 'rename',
          label: '重命名',
          onSelect: () => renameHistorySession(item.id),
        },
        {
          key: 'open-folder',
          label: '打开文件夹',
          onSelect: () =>
            openCliSessionFolder(client, item.id).catch((error: unknown) => {
              toast(error instanceof Error ? error.message : '打开会话目录失败')
            }),
        },
        {
          key: 'export',
          label: '导出会话',
          onSelect: () =>
            exportCliSession(item).catch((error: unknown) => {
              toast(error instanceof Error ? error.message : '导出会话失败')
            }),
        },
        {
          key: 'delete',
          label: '删除会话',
          variant: 'danger',
          onSelect: () =>
            removeCliSessions([item.id], '已删除该条本地会话记录。').catch((error) => {
              toast(error instanceof Error ? error.message : '删除会话失败')
            }),
        },
      ],
    })
  }

  function handleHistoryProjectContextMenu(event: MouseEvent, projectName: string, items: CliHistoryEntry[]) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: projectName,
      scope: 'history',
      items: [
        {
          key: 'pin',
          label: pinnedHistoryGroups.includes(projectName) ? '取消置顶项目' : '置顶项目',
          onSelect: () => togglePinnedHistoryGroup(projectName),
        },
        {
          key: 'delete-project',
          label: '删除项目会话',
          variant: 'danger',
          onSelect: () =>
            removeCliSessions(
              items.map((entry) => entry.id),
              `已删除“${projectName}”项目下的 ${items.length} 条本地会话记录。`
            ).catch((error) => {
              toast(error instanceof Error ? error.message : '删除项目会话失败')
            }),
        },
      ],
    })
  }

  async function copyText(content: string) {
    try {
      await navigator.clipboard.writeText(content)
      toast('已复制到剪贴板。')
    } catch {
      toast('复制失败，请检查系统剪贴板权限。')
    }
  }

  const requestCliSelectionTranslation = useCallback(async (sourceText: string) => {
    const normalizedText = sourceText.trim()
    if (!normalizedText) {
      return
    }

    setTranslationState({
      sourceText: normalizedText,
      translatedText: '',
      loading: true,
    })

    try {
      const translatedText = await translateSelectedText({
        sourceText: normalizedText,
        modelHint: selectedModel || preferredCliModel,
        candidateModels: compatibleCliModels,
      })
      setTranslationState({
        sourceText: normalizedText,
        translatedText,
        loading: false,
      })
    } catch (error) {
      setTranslationState({
        sourceText: normalizedText,
        translatedText: '',
        loading: false,
      })
      toast(error instanceof Error ? error.message : '翻译失败')
    }
  }, [compatibleCliModels, preferredCliModel, selectedModel, toast])

  const handleCliMessageSelectionContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, selectedText: string) => {
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: '选中文本',
      items: [
        {
          key: 'copy-selection',
          label: '复制',
          onSelect: () => copyText(selectedText),
        },
        {
          key: 'translate-selection',
          label: '翻译选中文本',
          onSelect: () => requestCliSelectionTranslation(selectedText),
        },
      ],
    })
  }, [requestCliSelectionTranslation])

  function handleAttachmentPreviewContextMenu(
    event: MouseEvent<HTMLImageElement | HTMLDivElement>,
    preview: Extract<AttachmentPreviewState, { mode: 'image' }>
  ) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: preview.name,
      items: [
        {
          key: 'copy-image',
          label: '复制图片',
          onSelect: async () => {
            await copyImageToClipboard({
              filePath: preview.path,
              sourceUrl: preview.src.startsWith('file:') ? undefined : preview.src,
            })
            toast('图片已复制到剪贴板。')
          },
        },
        {
          key: 'open-folder',
          label: '打开文件夹',
          onSelect: () => openDesktopFolder(preview.path, true),
        },
      ],
    })
  }

  async function handleDeleteCliMessage(message: CliMessage) {
    const sessionId = activeSessionId
    const resumeSessionId = getCliResumeSessionId(sessionId)

    if (!sessionId || !resumeSessionId) {
      setSessionMessagesMap((current) => ({
        ...current,
        [sessionId || '']: (current[sessionId || ''] || []).filter((item) => item.id !== message.id),
      }))
      toast('当前消息仅从本地草稿中移除，尚未写入真实会话文件。')
      return
    }

    if (!canDeleteCliMessageFromSessionFile(message)) {
      setSessionMessagesMap((current) => ({
        ...current,
        [sessionId]: (current[sessionId] || []).filter((item) => item.id !== message.id),
      }))
      setCliMessageOverlays((current) => ({
        ...current,
        [sessionId]: (current[sessionId] || []).filter((item) => {
          const sameRequest = !!message.requestId && item.requestId === message.requestId
          const sameContent = item.role === message.role && item.content === message.content
          return !(sameRequest || sameContent)
        }),
      }))
      toast('已从当前会话视图中移除该条本地消息。')
      return
    }

    try {
      const details = await deleteCliMessage(client, resumeSessionId, {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        sourceFilePath: message.sourceFilePath,
        sourceLineNumber: message.sourceLineNumber,
        sourceTimestamp: message.sourceTimestamp,
      })

      if (details) {
        hydrateCliSession(details, { activateProject: false })
      } else {
        setSessionMessagesMap((current) => ({
          ...current,
          [sessionId]: (current[sessionId] || []).filter((item) => item.id !== message.id),
        }))
      }

      await refreshCliState(true)
      toast('已删除该条会话消息。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除消息失败')
    }
  }

  function handleDeleteCliLogGroup(item: Extract<CliTimelineEntry, { kind: 'log' }>) {
    if (!activeSessionId) {
      return
    }

    const eventIds = new Set(item.events.map((event) => event.id))
    setSessionLogsMap((current) => ({
      ...current,
      [activeSessionId]: (current[activeSessionId] || []).filter((entry) =>
        item.requestId
          ? entry.requestId !== item.requestId
          : !eventIds.has(entry.id)
      ),
    }))
    toast('已删除该组运行日志。')
  }

  async function handleRespondCliInteraction(
    requestId: string,
    interactionId: string,
    action: CliInteractionAction
  ) {
    if (!activeSessionId || !requestId || !interactionId) {
      return
    }

    const optimisticStatus: CliInteractionPrompt['status'] =
      action === 'reject'
        ? 'rejected'
        : action === 'approve_always'
          ? 'approved_always'
          : 'approved'

    setRespondingInteractionIds((current) =>
      current.includes(interactionId) ? current : [...current, interactionId]
    )
    updateCliInteractionStatus(activeSessionId, interactionId, optimisticStatus)

    try {
      await respondCliInteraction({
        requestId,
        interactionId,
        action,
      })
    } catch (error) {
      updateCliInteractionStatus(activeSessionId, interactionId, 'pending')
      toast(error instanceof Error ? error.message : 'CLI 确认请求处理失败。')
    } finally {
      setRespondingInteractionIds((current) => current.filter((item) => item !== interactionId))
    }
  }

  async function handlePreviewFile(ownerId: string, targetPath: string) {
    if (!isInlinePreviewableFile(targetPath)) {
      await openDesktopTarget(targetPath)
      return
    }

    if (previewFile?.ownerId === ownerId && previewFile.path === targetPath) {
      setPreviewFile(null)
      return
    }

    try {
      const details = await readDesktopFilePreview(targetPath)
      setPreviewFile({
        ownerId,
        ...details,
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '文件预览失败')
    }
  }

  function loadPromptForEdit(
    content: string,
    messageAttachments?: Array<{
      id: string
      name: string
      filePath: string
      kind: 'image' | 'file'
    }>,
    messageExtensions?: CliExtensionEntry[]
  ) {
    setPrompt(content)
    cliPromptHistory.syncInputValue(content)
    replaceAttachments(rehydrateCliComposerAttachments(messageAttachments))
    setSelectedExtensions(messageExtensions || [])
    window.setTimeout(() => {
      syncTextareaHeight(promptRef.current)
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(content.length, content.length)
    }, 0)
  }

  const submitCliPrompt = useCallback(async (
    promptValue: string,
    options: {
      targetProjectPath?: string
      nextAttachments?: ComposerAttachment[]
      silentValidation?: boolean
      directCommand?: boolean
    } = {}
  ) => {
    const targetProjectPath = options.targetProjectPath?.trim() || projectPath.trim()
    const targetAttachments = options.nextAttachments ?? attachments
    const cleanedPrompt = promptValue.trim()

    if (!targetProjectPath || !cleanedPrompt || effectiveRunning) {
      if (!options.silentValidation) {
        toast('请选择项目目录并输入消息。')
      }
      return
    }

    const requestId = `${client}-${Date.now()}`
    const requestProjectPath = targetProjectPath
    const requestProjectKey = normalizeProjectKey(requestProjectPath)
    const currentSessionKey =
      projectSessionMapRef.current[requestProjectKey]?.trim() ||
      activeSessionId ||
      `draft-${client}-${Date.now()}`
    const matchedBuiltinCommand = matchCliBuiltinCommand(client, cleanedPrompt)
    const planMode = matchedBuiltinCommand?.id === 'plan'
    const visiblePrompt = planMode ? stripCliPlanCommandPrompt(cleanedPrompt) : cleanedPrompt
    const directCommand = options.directCommand || (isDirectCliCommandPrompt(cleanedPrompt) && !planMode)
    const requestExtensions = directCommand ? [] : selectedExtensions.map((item) => ({ ...item }))
    const promptWithAttachments = buildFinalPrompt({
      prompt: planMode ? visiblePrompt : cleanedPrompt,
      client,
      projectPath: requestProjectPath,
      fullAccess,
      directCommand,
      planMode,
      attachments: targetAttachments.map((item) => ({
        id: item.id,
        name: item.name,
        filePath: item.filePath,
        kind: item.kind,
      })),
      extensions: directCommand
        ? []
        : requestExtensions.map((item) => ({
            client: item.client,
            kind: item.kind,
            name: item.name,
          })),
    }).finalPrompt
    const resolvedCliModel = resolveCompatibleModel(
      client,
      compatibleCliModels,
      selectedModel,
      preferredCliModel,
    )
    if (!resolvedCliModel) {
      toast(
        client === 'claude'
          ? '当前服务器没有可用的 Claude 模型，请先修复服务器 Claude 渠道。'
          : '当前服务器没有可用的 Codex 模型，请先修复服务器 Codex 渠道。'
      )
      return
    }
    if (shouldDisableCliModelForProvider(resolvedCliModel, aiChatProviderMode)) {
      toast('当前服务通道暂不支持该模型。')
      return
    }
    let runtimeApiKey = ''
    let runtimeBaseUrl = ''
    if (aiChatProviderMode === 'custom') {
      runtimeApiKey = providerState.apiKey.trim()
      runtimeBaseUrl = client === 'codex'
        ? normalizeOpenAICompatibleBaseUrl(providerState.baseUrl)
        : providerState.baseUrl.replace(/\/v1$/i, '')
      if (!runtimeApiKey || !runtimeBaseUrl) {
        toast('请先在 AIChat 服务通道中配置 Base URL 和 API Key。')
        return
      }
    } else {
      if (!activeApiKey?.id) {
        toast('请先在已有 Key 中启用一个 Key。')
        return
      }
      try {
        runtimeApiKey = await fetchApiKeySecret(activeApiKey.id)
      } catch (error) {
        toast(error instanceof Error ? error.message : '读取当前 Key 失败')
        return
      }
      runtimeBaseUrl = client === 'codex' ? DEFAULT_CODEX_BASE_URL : DEFAULT_CLAUDE_BASE_URL
    }
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: visiblePrompt,
      createdAt: Date.now(),
      requestId,
      attachments: toMessageAttachments(targetAttachments),
      selectedExtensions: requestExtensions,
    }

    updateProjectSessionMap((current) => ({
      ...current,
      [requestProjectKey]: currentSessionKey,
    }))
    setRequestSessionMap((current) => ({
      ...current,
      [requestId]: {
        sessionId: currentSessionKey,
        projectPath: requestProjectPath,
      },
    }))
    activeRequestIdRef.current = requestId
    stoppingRunRef.current = false
    onRunningStateChange(client, { running: true, requestId })
    setSessionMessagesMap((current) => ({
      ...current,
      [currentSessionKey]: [...(current[currentSessionKey] || []), userMessage],
    }))
    persistCliMessageOverlay(currentSessionKey, userMessage)
    setSessionPartialMap((current) => ({
      ...current,
      [currentSessionKey]: CLI_PENDING_MESSAGE_LABEL,
    }))
    setSessionLogsMap((current) => {
      const previous = current[currentSessionKey] || []
      const orchestrationLogs = buildExecutionCycleEvents({
        sessionId: currentSessionKey,
        requestId,
        intent: visiblePrompt,
        finalPrompt: promptWithAttachments,
        commandTitle: directCommand ? '直接命令准备' : '任务准备',
        command: directCommand ? cleanedPrompt : '',
        extensions: requestExtensions.map((item) => ({
          kind: item.kind,
          name: item.name,
        })),
      }).map((event) => ({
        id: event.id,
        requestId,
        sessionId: currentSessionKey,
        level: event.severity === 'error' ? 'error' : 'status',
        logKind: 'status',
        sourceKind: `orchestrator.${event.phase}`,
        content: event.title,
        indentLevel: event.indentLevel,
        createdAt: event.createdAt,
        detail: event.detail,
        command: event.command,
        interaction: event.interaction,
      }) satisfies CliLogEntry)
      return orchestrationLogs.length
        ? {
            ...current,
            [currentSessionKey]: [...previous, ...orchestrationLogs],
          }
        : current
    })
    cliPromptHistory.commitInputValue(cleanedPrompt)
    setPrompt('')
    setSelectedExtensions([])
    clearAttachments()
    window.setTimeout(() => resizePrompt(), 0)
    setRunning(true)
    let finalSessionKey = currentSessionKey
    let finalRequestSourceKind = 'result'
    let finalRequestMessage = `${client === 'codex' ? 'Codex' : 'Claude'} 已完成本次回复。`

    try {
      const response = await runCliPrompt({
        client,
        requestId,
        projectPath: requestProjectPath,
        prompt: promptWithAttachments,
        sessionId: getCliResumeSessionId(currentSessionKey),
        model: resolvedCliModel,
        reasoningEffort,
        fullAccess,
        apiKey: runtimeApiKey,
        baseUrl: runtimeBaseUrl,
      })

      const nextSessionId = response.sessionId || currentSessionKey
      finalSessionKey = nextSessionId
      bindProjectSession(requestProjectPath, nextSessionId)

      if (nextSessionId !== currentSessionKey) {
        moveCliSessionOverlay(currentSessionKey, nextSessionId)
        setSessionMessagesMap((current) => {
          const previous = current[currentSessionKey] || []
          const incoming = current[nextSessionId] || []
          const next: Record<string, CliSessionMessage[]> = {
            ...current,
            [nextSessionId]: mergeCliMessages(previous, incoming),
          }
          delete next[currentSessionKey]
          return next
        })
        setSessionLogsMap((current) => {
          const previous = current[currentSessionKey] || []
          const incoming = current[nextSessionId] || []
          const next: Record<string, CliLogEntry[]> = {
            ...current,
            [nextSessionId]: mergeCliLogs(previous, incoming),
          }
          delete next[currentSessionKey]
          return next
        })
      }

      try {
        if (response.sessionId) {
          const details = await getCliSession(client, response.sessionId)
          if (details) {
            hydrateCliSession(details, { activateProject: false })
          }
        }
      } catch {
        /* ignore session hydration errors and keep fallback transcript */
      }

      if (response.output.trim() && response.metadata?.aborted !== true) {
        const responseFileChanges = Array.isArray(response.metadata?.fileChanges)
          ? response.metadata.fileChanges as CliSessionMessage['fileChanges']
          : undefined
        setSessionMessagesMap((current) => {
          const previous = current[nextSessionId] || []
          const nextMessages = appendCliFallbackAssistantMessage(previous, {
            id: `assistant-${requestId}`,
            content: response.output,
            createdAt: Date.now(),
            requestId,
            modelLabel: selectedModelLabel,
            fileChanges: responseFileChanges,
            usage:
              response.metadata && typeof response.metadata === 'object' && 'usage' in response.metadata
                ? response.metadata.usage as CliSessionMessage['usage']
                : undefined,
          })
          if (nextMessages === previous) {
            return current
          }
          return {
            ...current,
            [nextSessionId]: nextMessages,
          }
        })
      }

      if (!response.success && response.metadata?.aborted !== true) {
        finalRequestSourceKind = 'request.failed'
        finalRequestMessage = `${client === 'codex' ? 'Codex' : 'Claude'} 执行失败。`
        toast(response.error || `${client} 执行失败`)
      } else if (response.metadata?.aborted === true) {
        finalRequestSourceKind = 'request.aborted'
        finalRequestMessage = `${client === 'codex' ? 'Codex' : 'Claude'} 已停止本次回复。`
      }
      void refreshCliState(true)
    } catch (error) {
      finalRequestSourceKind = stoppingRunRef.current ? 'request.aborted' : 'request.failed'
      finalRequestMessage = stoppingRunRef.current
        ? `${client === 'codex' ? 'Codex' : 'Claude'} 已停止本次回复。`
        : `${client === 'codex' ? 'Codex' : 'Claude'} 执行失败。`
      if (!stoppingRunRef.current && !isAbortError(error)) {
        toast(error instanceof Error ? error.message : '执行失败')
      }
    } finally {
      const completedAt = Date.now()
      setSessionLogsMap((current) => ({
        ...current,
        [finalSessionKey]: [
          ...(current[finalSessionKey] || []),
          {
            id: `${requestId}-local-terminal-${completedAt}`,
            requestId,
            sessionId: finalSessionKey,
            level: finalRequestSourceKind === 'request.failed' ? 'error' : 'status',
            logKind: finalRequestSourceKind === 'request.failed' ? 'error' : 'status',
            sourceKind: finalRequestSourceKind,
            content: finalRequestMessage,
            createdAt: completedAt,
            done: true,
          },
        ],
      }))
      setRequestSessionMap((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      setSessionPartialMap((current) => ({
        ...current,
        [finalSessionKey]: '',
      }))
      activeRequestIdRef.current = ''
      stoppingRunRef.current = false
      setRunning(false)
      onRunningStateChange(client, { running: false, requestId: '' })
    }
  }, [
    activeSessionId,
    attachments,
    clearAttachments,
    client,
    compatibleCliModels,
    preferredCliModel,
    projectPath,
    moveCliSessionOverlay,
    persistCliMessageOverlay,
    reasoningEffort,
    refreshCliState,
    resizePrompt,
    effectiveRunning,
    selectedModel,
    selectedModelLabel,
    selectedExtensions,
    toast,
    fullAccess,
    hydrateCliSession,
    onRunningStateChange,
  ])

  async function handleRun() {
    await submitCliPrompt(prompt)
  }

  useEffect(() => {
    if (!active || effectiveRunning || prompt.trim() || !cliStatusReady) {
      return
    }
    if (!hasPendingCliVerification(client)) {
      return
    }

    const verificationProjectPath = projectPath.trim() || status.dataPath.trim()
    if (!verificationProjectPath) {
      return
    }

    clearPendingCliVerification(client)
    const applyTimer = !projectPath.trim()
      ? window.setTimeout(() => {
          applyProjectPath(verificationProjectPath)
        }, 0)
      : 0
    const submitTimer = window.setTimeout(() => {
      void submitCliPrompt('hello', {
        targetProjectPath: verificationProjectPath,
        nextAttachments: [],
        silentValidation: true,
      })
    }, 0)
    return () => {
      if (applyTimer) {
        window.clearTimeout(applyTimer)
      }
      window.clearTimeout(submitTimer)
    }
  }, [active, cliStatusReady, client, effectiveRunning, projectPath, prompt, status.dataPath, submitCliPrompt])

  async function handleStopRun() {
    const requestId = effectiveRequestId
    if (!requestId) {
      return
    }

    stoppingRunRef.current = true
    activeRequestIdRef.current = ''
    setRunning(false)
    onRunningStateChange(client, { running: false, requestId: '' })
    if (activeSessionId) {
      const abortLog = buildCliAbortLogEntry({
        client,
        requestId,
        sessionId: activeSessionId,
      })
      setSessionLogsMap((current) => ({
        ...current,
        [activeSessionId]: mergeCliLogs(current[activeSessionId] || [], [abortLog]),
      }))
      setSessionPartialMap((current) => ({
        ...current,
        [activeSessionId]: '',
      }))
      setSessionPlansMap((current) => ({
        ...current,
        [activeSessionId]: null,
      }))
    }
    try {
      await stopCliPrompt(requestId)
      toast(`已停止 ${client === 'codex' ? 'Codex' : 'Claude'} 当前回复。`)
    } catch (error) {
      toast(error instanceof Error ? error.message : '停止失败')
    }
  }

  const extensionsPalette = extensionsMenuOpen ? (
    <CliExtensionPalette
      loading={extensionsLoading}
      menuStyle={cliExtensionPaletteWidthStyle}
      paletteItems={paletteItems}
      availableTabs={availablePaletteTabs}
      activeTab={activePaletteTab}
      onChangeTab={(tab) => {
        setExtensionPaletteTab(tab)
        setHighlightedExtensionIndex(0)
      }}
      highlightedIndex={effectiveHighlightedExtensionIndex}
      searchValue={extensionSearch}
      onSearchChange={(value) => {
        setExtensionSearch(value)
        setHighlightedExtensionIndex(0)
      }}
      onSelect={insertCliPaletteItem}
      onInsert={insertCliPaletteItem}
      onCopyName={(item) =>
        void copyText(item.source === 'builtin' ? item.builtin.command : item.extension.name)
      }
      onHoverIndex={setHighlightedExtensionIndex}
      onRefresh={() => void refreshCliExtensions()}
      installingIds={installingExtensionIds}
      onInstall={handleInstallCliExtension}
      searchActive={extensionSearch.trim().length > 0}
      onKeyDown={handleCliExtensionPaletteKeyDown}
      onToggleFavorite={toggleFavoriteCliExtension}
      getCachedTranslatedDetail={getCachedCliExtensionTranslation}
      onTranslateDetail={translateCliExtensionDetail}
      menuHostRef={extensionsPaletteRef}
      onContextMenu={(event, item) => {
        event.preventDefault()
        setSessionContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: item.displayName,
          items: [
            {
              key: 'favorite',
              label: item.favorite ? '取消收藏' : '收藏并置顶',
              onSelect: () => toggleFavoriteCliExtension(item),
            },
            {
              key: 'remark',
              label: item.note ? '编辑备注' : '添加备注',
              onSelect: () => {
                const nextNote = window.prompt('请输入备注名称', item.note || '')
                if (nextNote === null) {
                  return
                }
                updateCliExtensionNote(item, nextNote)
              },
            },
            ...(item.note
              ? [
                  {
                    key: 'clear-remark',
                    label: '清除备注',
                    onSelect: () => updateCliExtensionNote(item, ''),
                  },
                ]
              : []),
            {
              key: 'copy',
              label: '复制名称',
              onSelect: () => copyText(item.name),
            },
            {
              key: 'insert',
              label: '插入到输入框',
              onSelect: () => insertCliPaletteItem({
                id: item.id,
                section: item.kind,
                source: 'extension',
                extension: item,
              }),
            },
          ],
        })
      }}
    />
  ) : null
  const extensionsOverlayPanel = extensionsPalette && extensionsMenuAnchor === 'composer' ? (
    <div
      className='cli-extension-overlay-anchor anchored-to-composer'
      style={extensionsOverlayStyle}
    >
      {extensionsPalette}
    </div>
  ) : null

  function renderCliTimelineMessage(
    item: Exclude<CliTimelineEntry, { kind: 'log' }>
  ) {
    return (
      <div
        className={`message-bubble ${item.role} ${item.kind === 'partial' ? 'streaming-bubble' : ''}`}
      >
        <span className='message-role'>
          {item.role === 'assistant'
            ? item.modelLabel || selectedModelLabel
            : ''}
        </span>
        <MessageAttachmentGallery
          attachments={'attachments' in item ? item.attachments : undefined}
          onPreview={openAttachmentPreview}
          onAttachmentContextMenu={(event, attachment) =>
            showAttachmentContextMenu(event, attachment, setSessionContextMenu, openAttachmentPreview)
          }
        />
        {'selectedExtensions' in item ? (
          <MessageCliExtensionChips items={item.selectedExtensions} />
        ) : null}
        {item.kind === 'partial' && item.content === CLI_PENDING_MESSAGE_LABEL ? (
          <PendingMessageContent />
        ) : (
          <LazyMarkdownContent
            content={item.content}
            onSelectionContextMenu={handleCliMessageSelectionContextMenu}
          />
        )}
        {'fileChanges' in item && item.role === 'assistant' ? (
          <MessageFileChangeLinks
            ownerId={item.id}
            files={item.fileChanges}
            previewFile={previewFile}
            onOpenFile={(ownerId, path) => void handlePreviewFile(ownerId, path)}
          />
        ) : null}
        <BubbleMeta
          side={item.role === 'user' ? 'right' : 'left'}
          createdAt={item.createdAt}
          extra={item.kind === 'message' && item.role === 'assistant' ? <span className='message-usage'>{formatUsageSummary(item.usage)}</span> : null}
          actions={[
            {
              key: 'copy',
              label: '复制',
              icon: Copy,
              onClick: () => void copyText(item.content),
            },
            {
              key: 'delete',
              label: '删除',
              icon: Trash2,
              onClick: () => void handleDeleteCliMessage(item),
              disabled: effectiveRunning || item.kind === 'partial',
            },
            {
              key: 'edit',
              label: '编辑',
              icon: PencilLine,
              onClick: () =>
                loadPromptForEdit(
                  item.content,
                  'attachments' in item ? item.attachments : undefined,
                  'selectedExtensions' in item ? item.selectedExtensions : undefined
                ),
            },
          ]}
        />
      </div>
    )
  }

  return (
    <section className='workspace-page cli-page'>
      <div className={`cli-layout ${historyOpen ? 'history-open' : ''}`}>
        <article className='panel cli-main-panel cli-panel-surface'>
          {!cliStatusReady && (
            <div className='inline-notice warn'>
              <span>{describeCliWorkspaceStatus(status, serverBaseUrl || DEFAULT_SERVER_BASE_URL).detail}</span>
              <button className='secondary-button tiny' type='button' onClick={openSettings}>
                前往设置
              </button>
            </div>
          )}

          <div className='conversation-scroll-region'>
            <div className='workspace-corner-tools'>
              <ConversationFindBar
                active={active}
                containerRef={threadRef}
                itemSelector='.message-bubble, .cli-log-entry'
              />
            </div>
            <CliPlanFloatingPanel plan={activePlan} client={client} />
            <div ref={threadRef} className='cli-thread'>
              {activeTimeline.length === 0 ? (
                <EmptyState
                  title={`开始 ${client === 'codex' ? 'Codex' : 'Claude'} 会话`}
                  description='选择项目后输入任务，执行日志会显示在回复上方，完成后可从最近会话再次进入。'
                  icon={Bot}
                />
              ) : activeTimeline.map((item) => {
                if (item.kind === 'log') {
                  const hasAssistantReply =
                    (!!item.requestId && cliLogCompletionPlacement.lastAssistantMessageIds.has(item.requestId)) ||
                    cliLogCompletionPlacement.messageIdByLogId.has(item.id)
                  const groupedAssistantMessageId = cliLogCompletionPlacement.messageIdByLogId.get(item.id)
                  const groupedAssistantMessage = groupedAssistantMessageId
                    ? activeTimeline.find((timelineItem): timelineItem is Exclude<CliTimelineEntry, { kind: 'log' }> =>
                        timelineItem.kind !== 'log' && timelineItem.id === groupedAssistantMessageId
                      ) || null
                    : null
                  if (groupedAssistantMessage) {
                    return (
                      <div key={item.id} className='cli-turn-group'>
                        <CliLogBubble
                          item={item}
                          expanded={true}
                          expandedEventIds={expandedLogEventMap[item.id] || []}
                          onToggleEvent={(eventId) => toggleLogEvent(item.id, eventId)}
                          onOpenFile={(ownerId, path) => void handlePreviewFile(ownerId, path)}
                          onCopy={() => void copyText(item.events.map((eventItem) => serializeCliLogEvent(eventItem)).join('\n\n'))}
                          onDelete={() => handleDeleteCliLogGroup(item)}
                          onRespondInteraction={handleRespondCliInteraction}
                          respondingInteractionIds={respondingInteractionIds}
                          previewFile={previewFile}
                        />
                        {renderCliTimelineMessage(groupedAssistantMessage)}
                        <CliLogCompletionFooter item={item} />
                      </div>
                    )
                  }
                  return (
                    <Fragment key={item.id}>
                    <CliLogBubble
                      item={item}
                      expanded={true}
                      expandedEventIds={expandedLogEventMap[item.id] || []}
                      onToggleEvent={(eventId) => toggleLogEvent(item.id, eventId)}
                      onOpenFile={(ownerId, path) => void handlePreviewFile(ownerId, path)}
                      onCopy={() => void copyText(item.events.map((eventItem) => serializeCliLogEvent(eventItem)).join('\n\n'))}
                      onDelete={() => handleDeleteCliLogGroup(item)}
                      onRespondInteraction={handleRespondCliInteraction}
                      respondingInteractionIds={respondingInteractionIds}
                      previewFile={previewFile}
                    />
                    {!hasAssistantReply ? <CliLogCompletionFooter item={item} /> : null}
                    </Fragment>
                  )
                }

                if (cliLogCompletionPlacement.logByAssistantMessageId.has(item.id)) {
                  return null
                }

                const precedingLog =
                  item.kind === 'message' && item.role === 'assistant' && item.requestId
                    ? cliLogCompletionPlacement.lastAssistantMessageIds.get(item.requestId) === item.id
                      ? cliLogCompletionPlacement.logByRequestId.get(item.requestId) || null
                      : null
                    : item.kind === 'message' && item.role === 'assistant'
                      ? cliLogCompletionPlacement.logByAssistantMessageId.get(item.id) || null
                      : null

                return (
                  <Fragment key={item.id}>
                  {renderCliTimelineMessage(item)}
                  {precedingLog ? <CliLogCompletionFooter item={precedingLog} /> : null}
                  </Fragment>
                )
              })}
            </div>
            <ConversationScrollDock
              active={active}
              containerRef={threadRef}
              itemSelector='.message-bubble, .cli-log-entry'
            />
          </div>

          <div ref={extensionsMenuRef}>
            {renderComposer({
              inputRef: attachmentInputRef,
              onAttachmentInputChange: handleAttachmentInputChange,
              textareaRef: promptRef,
              value: prompt,
              placeholder: `输入要发给 ${client} 的消息。空白行输入 / 可呼出命令 / 技能 / 插件。`,
              onChange: (value) => {
                setPrompt(value)
                cliPromptHistory.syncInputValue(value)
              },
              onKeyDown: (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !effectiveRunning) {
                  event.preventDefault()
                  void handleRun()
                  return
                }

                if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                  const nextValue = cliPromptHistory.recallInputValue(
                    event.key === 'ArrowUp' ? 'up' : 'down',
                    prompt
                  )
                  if (nextValue !== prompt) {
                    event.preventDefault()
                    setPrompt(nextValue)
                    window.setTimeout(() => focusTextareaToEnd(promptRef.current, nextValue), 0)
                    return
                  }
                }

                if (handleCliExtensionPaletteKeyDown(event)) {
                  return
                }

                if (event.ctrlKey || event.metaKey || event.altKey || event.key !== '/') {
                  return
                }

                const nextValue =
                  `${prompt.slice(0, event.currentTarget.selectionStart)}/` +
                  prompt.slice(event.currentTarget.selectionEnd)
                const nextState = resolveCliSlashTriggerState(nextValue, event.currentTarget.selectionStart + 1)
                if (nextState.active) {
                  event.preventDefault()
                  openCliExtensionsMenu('composer')
                }
              },
              onPaste: handleAttachmentPaste,
              onDrop: handleAttachmentDrop,
              fileAssets: attachments.map((item) => ({
                id: item.id,
                name: item.name,
                filePath: item.filePath,
                previewUrl: item.previewUrl,
                kind: item.kind,
                onPreview: () => void openAttachmentPreview(item.filePath),
                onRemove: () => removeAttachment(item.id),
              })),
              tokenItems: composerTokenItems,
              overlayPanel: extensionsMenuOpen ? extensionsOverlayPanel : null,
              leftActions: [
              {
                key: 'project',
                node: (
                  <button
                    className='ghost-button tiny icon-pill-trigger'
                    type='button'
                    onClick={() => void handlePickProject()}
                    title={projectPath || '选择目录'}
                  >
                    <FolderOpen size={16} />
                    <strong>{projectName || '选择目录'}</strong>
                  </button>
                ),
              },
              {
                key: 'permission',
                node: (
                  <button
                    className={`ghost-button tiny icon-pill-trigger selected-toggle${fullAccess ? '' : ' active'}`}
                    type='button'
                    onClick={() => setFullAccess((v) => !v)}
                    title={fullAccess ? '全权限（点击切换受限）' : '受限模式（点击切换全权限）'}
                  >
                    <LockKeyhole size={16} />
                    <strong>{fullAccess ? '全权限' : '受限'}</strong>
                  </button>
                ),
              },
              {
                key: 'model',
                node: (
                  <div className='toolbar-picker' ref={modelMenuRef}>
                    <button
                      className='ghost-button tiny picker-trigger icon-picker-trigger'
                      type='button'
                      aria-expanded={modelMenuOpen}
                      onClick={() => {
                        setEffortMenuOpen(false)
                        setModelMenuOpen((value) => !value)
                      }}
                      title='AI 版本'
                    >
                      <Bot size={16} />
                      <strong>{selectedModelLabel}</strong>
                    </button>
                    {modelMenuOpen && (
                      <GlassPickerMenu className='picker-menu model-menu fixed-width-menu' style={cliModelMenuWidthStyle}>
                        {cliModelVendorFilterOptions.length > 1 ? (
                          <div className='picker-filter-row'>
                            {cliModelVendorFilterOptions.map((item) => (
                              <button
                                key={item.value}
                                className={`picker-filter-chip ${effectiveCliModelVendorFilter === item.value ? 'active' : ''}`}
                                type='button'
                                onClick={() => setCliModelVendorFilter(item.value)}
                              >
                                <span>{item.label}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <div className='picker-menu-list'>
                          {showCliBridgeServiceNotice ? (
                            <div className='picker-service-notice'>OneAPI专用桥接服务</div>
                          ) : null}
                          {visibleCliModels.length ? (
                            visibleCliModels.map((item: ChatModelOption) => {
                              const disabled = shouldDisableCliModelForProvider(item.value, aiChatProviderMode)
                              return (
                              <button
                                key={item.value}
                                type='button'
                                className={`picker-option ${item.value === selectedModel ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                                disabled={disabled}
                                onClick={() => {
                                if (disabled) {
                                  toast('当前服务通道暂不支持该模型。')
                                  return
                                }
                                  setSelectedModel(item.value)
                                  setModelMenuOpen(false)
                                }}
                              >
                                <div className='model-option-head'>
                                  <strong>{item.label}</strong>
                                  <button
                                    className={`ghost-button icon-only tiny model-favorite ${item.favorite ? 'active' : ''}`}
                                    type='button'
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleFavoriteModel(item.value)
                                    }}
                                    aria-label={item.favorite ? '取消收藏' : '收藏'}
                                  >
                                    <Star size={13} />
                                  </button>
                                </div>
                                {disabled ? <small>需要登录并使用 OneAPI 专用桥接服务</small> : null}
                              </button>
                              )
                            })
                          ) : (
                            <div className='picker-empty-state'>当前key无可用模型</div>
                          )}
                        </div>
                      </GlassPickerMenu>
                    )}
                  </div>
                ),
              },
              {
                key: 'reasoning',
                node: (
                  <div className='toolbar-picker' ref={effortMenuRef}>
                    <button
                      className='ghost-button tiny picker-trigger icon-picker-trigger'
                      type='button'
                      aria-expanded={effortMenuOpen}
                      onClick={() => {
                        setModelMenuOpen(false)
                        setEffortMenuOpen((value) => !value)
                      }}
                      title='思考长度'
                    >
                      <Sparkles size={16} />
                      <strong>{selectedEffortLabel}</strong>
                    </button>
                    {effortMenuOpen && (
                      <GlassPickerMenu className='picker-menu model-menu fixed-width-menu' style={cliReasoningMenuWidthStyle}>
                        <div className='picker-menu-list'>
                          {reasoningOptions.map((item) => (
                            <button
                              key={item.value}
                              type='button'
                              className={`picker-option ${item.value === reasoningEffort ? 'active' : ''}`}
                              onClick={() => {
                                setReasoningEffort(item.value)
                                setEffortMenuOpen(false)
                              }}
                            >
                              <strong>{item.label}</strong>
                            </button>
                          ))}
                        </div>
                      </GlassPickerMenu>
                    )}
                  </div>
                ),
              },
              {
                key: 'extensions',
                node: (
                  <div className='toolbar-picker'>
                    <button
                      ref={extensionsButtonRef}
                      className='ghost-button tiny picker-trigger icon-picker-trigger'
                      type='button'
                      aria-expanded={extensionsMenuOpen}
                      onClick={() => {
                        if (extensionsMenuOpen) {
                          closeCliExtensionsMenu(true)
                        } else {
                          openCliExtensionsMenu('button')
                        }
                      }}
                      title='技能与插件'
                    >
                      <Blocks size={16} />
                      <strong>技能/插件</strong>
                    </button>
                    {extensionsMenuOpen && extensionsMenuAnchor === 'button' ? extensionsPalette : null}
                  </div>
                ),
              },
            ],
              sendButton: (
                <button
                  className={`primary-button icon-only send-button ${effectiveRunning ? 'stop-button' : ''}`}
                  type='button'
                  onClick={() => void (effectiveRunning ? handleStopRun() : handleRun())}
                  title={effectiveRunning ? '停止回复' : '发送消息（Ctrl+Enter）'}
                  aria-label={effectiveRunning ? '停止回复' : '发送消息（Ctrl+Enter）'}
                >
                  {effectiveRunning ? <Square size={14} /> : <Send size={16} />}
                </button>
              ),
            })}
          </div>
        </article>

        <aside
          ref={historyPanelRef}
          className={`panel cli-history-panel ${historyOpen ? 'open' : ''}`}
          tabIndex={historyOpen ? 0 : -1}
        >
          <div className='panel-header compact'>
            <div>
            </div>
              <div className='inline-actions'>
                <button
                  className='secondary-button tiny'
                  type='button'
                  onClick={createCliSession}
                  disabled={effectiveRunning}
                  title='新建独立会话'
                >
                  <Plus size={16} />
                  <span>新会话</span>
                </button>
                <button className='ghost-button icon-only tiny' type='button' onClick={() => void refreshCliState()} title='刷新最近会话' aria-label='刷新最近会话'>
                  <RotateCcw size={14} />
                </button>
              </div>
          </div>

          <div className='side-pane-scroll'>
            <div className='history-panel-tabs'>
              <button
                className={`ghost-button tiny ${historyVisibilityTab === 'visible' ? 'selected-toggle' : ''}`}
                type='button'
                onClick={() => setHistoryVisibilityTab('visible')}
              >
                最近会话
              </button>
              <button
                className={`ghost-button tiny ${historyVisibilityTab === 'hidden' ? 'selected-toggle' : ''}`}
                type='button'
                onClick={() => setHistoryVisibilityTab('hidden')}
              >
                隐藏会话
              </button>
            </div>
            {Object.keys(sessionsByProject).length === 0 ? (
              <EmptyState
                title={historyVisibilityTab === 'hidden' ? '当前没有隐藏会话' : '当前没有可读取的历史'}
                description={
                  historyVisibilityTab === 'hidden'
                    ? '隐藏后的会话会按项目分组显示在这里。'
                    : projectPath
                      ? '当前项目还没有本地 CLI 会话记录。'
                      : '使用过本地 CLI 后，会话会显示在这里。'
                }
              />
            ) : (
              <div className='history-project-groups'>
                {orderGroupedEntries(Object.entries(sessionsByProject), pinnedHistoryGroups).map(([projectName, items]) => (
                  <div key={projectName} className='history-group'>
                    <div className='history-group-head' onContextMenu={(event) => handleHistoryProjectContextMenu(event, projectName, items)}>
                      <strong>{projectName}</strong>
                      <div className='history-group-head-actions'>
                        <span>{items.length} 条</span>
                        <button
                          className={`ghost-button icon-only tiny history-group-pin ${pinnedHistoryGroups.includes(projectName) ? 'active' : ''}`}
                          type='button'
                          onClick={() => togglePinnedHistoryGroup(projectName)}
                          aria-label={pinnedHistoryGroups.includes(projectName) ? '取消置顶分组' : '置顶分组'}
                          title={pinnedHistoryGroups.includes(projectName) ? '取消置顶' : '置顶'}
                        >
                          <Pin size={13} />
                        </button>
                      </div>
                    </div>
                    <div className='subrecords compact-records'>
                      {items.map((item: CliHistoryEntry) => (
                        <div
                          key={item.id}
                          className={`record-row action-row session-row ${item.id === activeSessionId ? 'highlighted' : ''}`}
                          role='button'
                          tabIndex={0}
                          onContextMenu={(event) => handleHistorySessionContextMenu(event, item)}
                          onClick={() => {
                            if (renamingHistorySession?.id !== item.id) {
                              void handleOpenHistory(item)
                            }
                          }}
                          onKeyDown={(event) => {
                            if (renamingHistorySession?.id === item.id) {
                              return
                            }
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void handleOpenHistory(item)
                            }
                          }}
                        >
                          <SessionTitleEditor
                            editing={renamingHistorySession?.id === item.id}
                            value={renamingHistorySession?.id === item.id ? renamingHistorySession.value : ''}
                            displayValue={item.title || item.preview}
                            maxLength={74}
                            onChange={(value) => setRenamingHistorySession({ id: item.id, value })}
                            onCommit={() => commitHistorySessionRename(item.id)}
                            onCancel={() => setRenamingHistorySession(null)}
                          />
                          <small>{formatDateTime(item.updatedAt)}</small>
                          <button
                            className='ghost-button icon-only tiny session-hide-button'
                            type='button'
                            onClick={(event) => {
                              event.stopPropagation()
                              if (historyVisibilityTab === 'hidden') {
                                unhideSession(item.id)
                              } else {
                                hideSession(item.id)
                              }
                            }}
                            aria-label={historyVisibilityTab === 'hidden' ? '显示会话' : '隐藏会话'}
                          >
                            {historyVisibilityTab === 'hidden' ? <Eye size={14} /> : <EyeOff size={14} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
      <AttachmentPreviewModal
        preview={attachmentPreview}
        toast={toast}
        onClose={() => setAttachmentPreview(null)}
        onImageContextMenu={handleAttachmentPreviewContextMenu}
      />
      <TranslationResultModal
        open={!!translationState}
        sourceText={translationState?.sourceText || ''}
        translatedText={translationState?.translatedText || ''}
        loading={!!translationState?.loading}
        onClose={() => setTranslationState(null)}
        onCopy={() => {
          if (!translationState?.translatedText) {
            return
          }
          void copyText(translationState.translatedText)
        }}
      />
      <SessionContextMenu menu={sessionContextMenu} onClose={() => setSessionContextMenu(null)} />
    </section>
  )
}

function AssistantWorkspace(props: {
  mode: AssistantMode
  setMode: (mode: AssistantMode) => void
  toast: (message: string) => void
  openSettings: () => void
  visible: boolean
  enabledModes: AssistantMode[]
  serverBaseUrl: string
  providerState: AiChatProviderState
  activeApiKey: ActiveDesktopApiKeySummary
}) {
  const { mode, setMode, toast, openSettings, visible, enabledModes, serverBaseUrl, providerState, activeApiKey } = props
  const [cliRunningState, setCliRunningState] = useState<Record<CliClient, CliRunningState>>({
    codex: { running: false, requestId: '' },
    claude: { running: false, requestId: '' },
  })
  const updateCliRunningState = useCallback((client: CliClient, state: CliRunningState) => {
    setCliRunningState((current) => {
      const previous = current[client]
      if (previous.running === state.running && previous.requestId === state.requestId) {
        return current
      }
      return {
        ...current,
        [client]: state,
      }
    })
  }, [])

  return (
    <section className={`workspace-page assistant-page ${visible ? '' : 'workspace-hidden'}`}>
      <div className='assistant-topbar'>
        <div className='assistant-topbar-tabs' role='tablist' aria-label='聊天形态切换'>
          {assistantModes.filter((item) => enabledModes.includes(item.key)).map((item) => (
            <button
              key={item.key}
              type='button'
              className={`assistant-mode-button ${mode === item.key ? 'active' : ''}`}
              onClick={() => setMode(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className='assistant-topbar-actions'>
          <button
            className='ghost-button icon-only assistant-history-button'
            type='button'
            onClick={() => {
              window.dispatchEvent(new CustomEvent(mode === 'chat' ? 'oneapi:open-assistant-history' : `oneapi:open-${mode}-history`))
            }}
            title='最近会话'
            aria-label='最近会话'
          >
            <PanelRightOpen size={16} />
          </button>
        </div>
      </div>

      <div className='workspace-host assistant-host'>
        <div className={mode === 'chat' ? 'workspace-shell active' : 'workspace-shell'}>
          <AssistantsChatWorkspace
            toast={toast}
            active={visible && mode === 'chat'}
            providerState={providerState}
            activeApiKey={activeApiKey}
          />
        </div>
        <div className={mode === 'draw' ? 'workspace-shell active' : 'workspace-shell'}>
          <DrawWorkspace
            toast={toast}
            active={visible && mode === 'draw'}
            providerState={providerState}
            activeApiKey={activeApiKey}
          />
        </div>
        <div className={mode === 'codex' ? 'workspace-shell active' : 'workspace-shell'}>
          <CliWorkspace
            client='codex'
            toast={toast}
            openSettings={openSettings}
            active={visible && mode === 'codex'}
            serverBaseUrl={serverBaseUrl}
            providerState={providerState}
            activeApiKey={activeApiKey}
            runningState={cliRunningState.codex}
            onRunningStateChange={updateCliRunningState}
          />
        </div>
        <div className={mode === 'claude' ? 'workspace-shell active' : 'workspace-shell'}>
          <CliWorkspace
            client='claude'
            toast={toast}
            openSettings={openSettings}
            active={visible && mode === 'claude'}
            serverBaseUrl={serverBaseUrl}
            providerState={providerState}
            activeApiKey={activeApiKey}
            runningState={cliRunningState.claude}
            onRunningStateChange={updateCliRunningState}
          />
        </div>
      </div>
    </section>
  )
}

export function App() {
  const auth = useAuthStore()
  const setBootstrapping = useAuthStore((state) => state.setBootstrapping)
  const setUser = useAuthStore((state) => state.setUser)
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('chat')
  const [sideTab, setSideTab] = useState<SideTab>('assistants')
  const [collapsed, setCollapsed] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode() ?? resolveSystemThemeMode())
  const [manualThemeMode, setManualThemeMode] = useState(() => readStoredThemeMode() !== null)
  const performanceMode: AppPerformanceMode = 'performance'
  const [auroraOpacity] = useState<number>(() => {
    const value = readJsonStorage<number>(AURORA_OPACITY_STORAGE_KEY, DEFAULT_AURORA_OPACITY)
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : DEFAULT_AURORA_OPACITY))
  })
  const [platformLabel, setPlatformLabel] = useState('Windows')
  const [productName, setProductName] = useState('OneAPI Desktop')
  const [appVersion, setAppVersion] = useState('0.1.0')
  const [iconPath, setIconPath] = useState('')
  const [serverBaseUrl, setServerBaseUrl] = useState('')
  const [serverBaseUrlDraft, setServerBaseUrlDraft] = useState('')
  const [serverBaseUrlDialogOpen, setServerBaseUrlDialogOpen] = useState(false)
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [aiChatProviderConfig, setAiChatProviderConfig] = useState<AiChatProviderConfig>(() =>
    normalizeAiChatProviderConfig(readJsonStorage<AiChatProviderConfig>(AI_CHAT_PROVIDER_STORAGE_KEY, DEFAULT_AI_CHAT_PROVIDER_CONFIG))
  )
  const [updatePopoverOpen, setUpdatePopoverOpen] = useState(false)
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    status: 'idle',
    currentVersion: '0.1.0',
    announcements: [],
  })
  const [activeAnnouncement, setActiveAnnouncement] = useState<DesktopAnnouncement | null>(null)
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<string[]>(() =>
    readJsonStorage<string[]>(DESKTOP_ANNOUNCEMENT_READ_IDS_KEY, [])
  )
  const [rightCtrlHeld, setRightCtrlHeld] = useState(false)
  const [, setSidebarSecretClicks] = useState(0)
  const [sidebarQuotaPerUnit, setSidebarQuotaPerUnit] = useState(500_000)
  const updatePopoverRef = useRef<HTMLDivElement | null>(null)
  const { message, setMessage } = useToastState()
  const [cliStatus, setCliStatus] = useState<{ codex: CliStatus; claude: CliStatus } | null>(null)
  const [activeDesktopApiKey, setActiveDesktopApiKey] = useState<ActiveDesktopApiKeySummary>(null)
  const enabledAssistantModes = useMemo(() => {
    const next: AssistantMode[] = ['chat', 'draw']
    if (cliStatus?.codex && isCliStatusInstalled(cliStatus.codex)) {
      next.push('codex')
    }
    if (cliStatus?.claude && isCliStatusInstalled(cliStatus.claude)) {
      next.push('claude')
    }
    return next
  }, [cliStatus, serverBaseUrl])
  const sidebarWalletBalance = useMemo(
    () => formatQuotaAsUsd(Number(auth.user?.quota || 0), sidebarQuotaPerUnit),
    [auth.user?.quota, sidebarQuotaPerUnit]
  )
  const aiChatProviderState = useMemo(
    () => resolveAiChatProviderState(aiChatProviderConfig, auth.user),
    [aiChatProviderConfig, auth.user]
  )
  const handleActiveDesktopApiKeyChange = useCallback((apiKey: ActiveDesktopApiKeySummary) => {
    setActiveDesktopApiKey((current) => sameActiveDesktopApiKeySummary(current, apiKey) ? current : apiKey)
  }, [])

  const updateAiChatProviderConfig = useCallback((
    updater: (current: AiChatProviderConfig) => AiChatProviderConfig
  ) => {
    setAiChatProviderConfig((current) => {
      const next = normalizeAiChatProviderConfig(updater(current))
      writeJsonStorage(AI_CHAT_PROVIDER_STORAGE_KEY, next)
      return next
    })
  }, [])

  useEffect(() => {
    setBootstrapping(true)
    const persistedUser = useAuthStore.getState().user
    if (persistedUser?.id) {
      saveStoredDesktopUserId(persistedUser.id)
    } else {
      clearStoredDesktopUserId()
      setUser(null)
    }

    getDesktopBridge()
      .getAppMeta()
      .then((meta: DesktopAppMeta) => {
        setPlatformLabel(meta.platform === 'darwin' ? 'macOS' : 'Windows')
        setProductName(meta.productName)
        setAppVersion(meta.version)
        setIconPath(meta.iconPath)
        setServerBaseUrl(meta.serverBaseUrl)
        setServerBaseUrlDraft(meta.serverBaseUrl)
      })
      .catch(() => undefined)

    getUpdateState()
      .then((state: DesktopUpdateState) => {
        setUpdateState(state)
      })
      .catch(() => undefined)

    window.setTimeout(() => {
      getDesktopBridge()
        .getCliStatus()
        .then((status: { codex: CliStatus; claude: CliStatus }) => {
          setCliStatus(status)
        })
        .catch(() => undefined)
    }, 0)

    if (!persistedUser?.id) {
      setBootstrapping(false)
      return
    }

    void requireSuccess(getSelfProfile())
      .then((profile) => {
        const nextUser = profile as UserProfile
        saveStoredDesktopUserId(nextUser.id)
        setUser(nextUser)
      })
      .catch(() => {
        clearStoredDesktopUserId()
        setUser(null)
      })
      .finally(() => {
        setBootstrapping(false)
      })
  }, [setBootstrapping, setUser])

  useEffect(() => {
    if (sideTab !== 'assistants') {
      void setDesktopWindowTitle('')
    }
  }, [sideTab])

  useEffect(() => {
    if (!auth.user?.id) {
      setActiveDesktopApiKey(null)
      return
    }
    const authenticatedUserId = auth.user.id

    let disposed = false
    void Promise.all([
      unwrapEnvelope(getAuthStatus()).catch(() => null),
      getApiKeys(1, 100).catch(() => null),
    ])
      .then(([status, keyPage]) => {
        if (disposed) {
          return
        }
        const resolved = Number(status?.quota_per_unit || 0)
        const selectedApiKeyStorageKey = getSelectedDesktopApiKeyStorageKey(authenticatedUserId)
        const persistedSelectedApiKeyId = readJsonStorage<number | null>(selectedApiKeyStorageKey, null)
        setSidebarQuotaPerUnit(resolved > 0 ? resolved : 500_000)
        setActiveDesktopApiKey(resolveActiveDesktopApiKeySummary(keyPage?.items ?? [], persistedSelectedApiKeyId))
      })
      .catch(() => {
        if (!disposed) {
          setSidebarQuotaPerUnit(500_000)
          setActiveDesktopApiKey(null)
        }
      })

    return () => {
      disposed = true
    }
  }, [auth.user?.id])

  useEffect(() => {
    function handleAuthExpired(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      clearStoredDesktopUserId()
      clearStoredDesktopAccessToken()
      useAuthStore.getState().reset()
      setUser(null)
      setBootstrapping(false)
      if (!isAuthRequiredErrorMessage(detail?.message || '')) {
        setMessage(detail?.message || '登录态已失效，请重新登录。')
      }
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired as EventListener)
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired as EventListener)
    }
  }, [setBootstrapping, setUser])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    if (manualThemeMode) {
      writeJsonStorage(THEME_MODE_STORAGE_KEY, themeMode)
    }
    void getDesktopBridge().setThemeMode(themeMode).catch(() => undefined)
  }, [manualThemeMode, themeMode])

  useEffect(() => {
    if (manualThemeMode) {
      return
    }

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) {
      return
    }

    const handleSystemThemeChange = () => {
      setThemeMode(resolveSystemThemeMode())
    }

    handleSystemThemeChange()
    media.addEventListener?.('change', handleSystemThemeChange)
    return () => {
      media.removeEventListener?.('change', handleSystemThemeChange)
    }
  }, [manualThemeMode])

  useEffect(() => {
    document.documentElement.dataset.performanceMode = performanceMode
  }, [])

  useEffect(() => {
    const syncWindowActivity = () => {
      const active = !document.hidden && document.hasFocus()
      document.documentElement.dataset.windowActive = active ? 'active' : 'inactive'
    }

    syncWindowActivity()
    window.addEventListener('focus', syncWindowActivity)
    window.addEventListener('blur', syncWindowActivity)
    document.addEventListener('visibilitychange', syncWindowActivity)
    return () => {
      window.removeEventListener('focus', syncWindowActivity)
      window.removeEventListener('blur', syncWindowActivity)
      document.removeEventListener('visibilitychange', syncWindowActivity)
    }
  }, [])

  useEffect(() => {
    const normalized = Math.max(0, Math.min(100, auroraOpacity))
    document.documentElement.style.setProperty('--aurora-opacity', '1')
    document.documentElement.style.setProperty('--ui-opacity', '1')
    document.documentElement.style.setProperty('--ui-solidness', `${normalized / 100}`)
    writeJsonStorage(AURORA_OPACITY_STORAGE_KEY, normalized)
  }, [auroraOpacity])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === 'ControlRight') {
        setRightCtrlHeld(true)
      }
      if (event.key === 'Escape' && loginDialogOpen) {
        setLoginDialogOpen(false)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === 'ControlRight') {
        setRightCtrlHeld(false)
        setSidebarSecretClicks(0)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [loginDialogOpen])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!updatePopoverOpen) {
        return
      }
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (updatePopoverRef.current && !updatePopoverRef.current.contains(target)) {
        setUpdatePopoverOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [updatePopoverOpen])

  async function handleSaveServerBaseUrl() {
    try {
      const result = await window.desktopBridge?.setServerBaseUrl(serverBaseUrlDraft.trim())
      const nextBaseUrl = result?.serverBaseUrl || serverBaseUrlDraft.trim()
      setServerBaseUrl(nextBaseUrl)
      setServerBaseUrlDraft(nextBaseUrl)
      setServerBaseUrlDialogOpen(false)
      setSidebarSecretClicks(0)
      clearStoredDesktopUserId()
      clearStoredDesktopAccessToken()
      auth.reset()
      auth.setUser(null)
      setMessage(`服务地址已切换为 ${nextBaseUrl}，请重新登录。`)
      window.setTimeout(() => window.location.reload(), 200)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存服务地址失败')
    }
  }

  function handleSidebarSecretClick() {
    if (!rightCtrlHeld) {
      setSidebarSecretClicks(0)
      return
    }

    setSidebarSecretClicks((current) => {
      const next = current + 1
      if (next >= 10) {
        setServerBaseUrlDialogOpen(true)
        setServerBaseUrlDraft(serverBaseUrl)
        return 0
      }
      return next
    })
  }

  function handleSidebarUserRowClick() {
    if (!auth.user) {
      setLoginDialogOpen(true)
      return
    }
    handleSidebarSecretClick()
    if (!rightCtrlHeld) {
      setUpdatePopoverOpen((current) => !current)
    }
  }

  async function handleUpdatePrimaryAction() {
    try {
      if (updateState.status === 'downloaded') {
        await installUpdate()
        return
      }
      if (updateState.status === 'downloading' || updateState.status === 'checking') {
        return
      }
      await checkForUpdates({ userInitiated: true })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新操作失败')
    }
  }

  const updatePrimaryActionLabel =
    updateState.status === 'available'
      ? '准备下载'
      : updateState.status === 'downloaded'
        ? '现在安装'
        : updateState.status === 'downloading'
          ? '下载中...'
          : updateState.status === 'checking'
            ? '检查中...'
            : '检查更新'

  const updateStatusSummary = resolveDesktopUpdateStatusSummary({
    status: updateState.status,
    message: updateState.message,
  })

  const hasAvailableDesktopUpdate = Boolean(
    updateState.latestVersion &&
      updateState.latestVersion !== appVersion &&
      ['available', 'downloading', 'downloaded'].includes(updateState.status)
  )
  const announcements = updateState.announcements || []
  const unreadAnnouncements = useMemo(
    () => announcements.filter((item) => !readAnnouncementIds.includes(item.id)),
    [announcements, readAnnouncementIds]
  )
  const unreadAnnouncementCount = unreadAnnouncements.length
  const showAnnouncementCount = unreadAnnouncementCount > 0
  const showUpdateDot = !showAnnouncementCount && hasAvailableDesktopUpdate
  const updateProgressLabel = updateState.totalBytes
    ? `${formatDownloadSize(updateState.downloadedBytes)} / ${formatDownloadSize(updateState.totalBytes)}`
    : updateState.progress
      ? `${Math.max(0, Math.min(100, updateState.progress)).toFixed(0)}%`
      : ''

  useEffect(() => {
    if (!enabledAssistantModes.includes(assistantMode)) {
      const timer = window.setTimeout(() => {
        setAssistantMode(enabledAssistantModes[0] || 'chat')
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [assistantMode, enabledAssistantModes])

  useEffect(() => {
    function handleCliStatusChanged(event: Event) {
      const customEvent = event as CustomEvent<CliStatus>
      const detail = customEvent.detail
      if (!detail) {
        return
      }

      setCliStatus((current) => ({
        codex:
          detail.client === 'codex'
            ? detail
            : current?.codex || buildEmptyCliStatus('codex'),
        claude:
          detail.client === 'claude'
            ? detail
            : current?.claude || buildEmptyCliStatus('claude'),
      }))
    }

    window.addEventListener('oneapi:cli-status-changed', handleCliStatusChanged as EventListener)
    return () => {
      window.removeEventListener('oneapi:cli-status-changed', handleCliStatusChanged as EventListener)
    }
  }, [])

  useEffect(() => onUpdateState((payload: DesktopUpdateState) => {
    setUpdateState(payload)
  }), [])

  useEffect(() => {
    const nextIds = readAnnouncementIds.filter((id) => announcements.some((item) => item.id === id))
    if (nextIds.length === readAnnouncementIds.length) {
      return
    }
    const timer = window.setTimeout(() => {
      setReadAnnouncementIds(nextIds)
      writeJsonStorage(DESKTOP_ANNOUNCEMENT_READ_IDS_KEY, nextIds)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [announcements, readAnnouncementIds])

  useEffect(() => {
    const runAutoCheck = () => {
      const minimumCheckHour = updateState.minimumCheckHour ?? 12
      const lastCheckedDayKey = readJsonStorage<string>(DESKTOP_UPDATE_AUTO_CHECK_DAY_KEY, '')
      const now = new Date()
      if (!shouldAutoCheckDesktopUpdate(now, minimumCheckHour, lastCheckedDayKey)) {
        return
      }
      const todayKey = getDesktopUpdateDayKey(now)
      writeJsonStorage(DESKTOP_UPDATE_AUTO_CHECK_DAY_KEY, todayKey)
      void checkForUpdates({ userInitiated: false }).catch(() => undefined)
    }

    const timerId = window.setInterval(runAutoCheck, 60 * 60 * 1000)
    runAutoCheck()
    return () => window.clearInterval(timerId)
  }, [updateState.minimumCheckHour])

  async function handleLogout() {
    const currentUserId = auth.user?.id
    try {
      await logout()
    } catch {
      /* ignore logout request error */
    }
    if (currentUserId) {
      clearVerificationValid(currentUserId)
    }
    clearStoredDesktopUserId()
    clearStoredDesktopAccessToken()
    auth.reset()
    auth.setUser(null)
    setMessage('已退出登录。')
  }

  if (auth.bootstrapping) {
    return (
      <AppPerformanceModeContext.Provider value={performanceMode}>
        <DesktopWindowFrame iconPath={iconPath} productName={productName}>
          <div className='boot-screen'>
            <LoaderCircle className='spin' size={22} />
            <span>正在初始化桌面工作台...</span>
          </div>
        </DesktopWindowFrame>
      </AppPerformanceModeContext.Provider>
    )
  }

  function markAnnouncementAsRead(announcementId: string) {
    setReadAnnouncementIds((current) => {
      if (current.includes(announcementId)) {
        return current
      }
      const next = [...current, announcementId]
      writeJsonStorage(DESKTOP_ANNOUNCEMENT_READ_IDS_KEY, next)
      return next
    })
  }

  function handleAnnouncementOpen(item: DesktopAnnouncement) {
    markAnnouncementAsRead(item.id)
    setActiveAnnouncement(item)
    setUpdatePopoverOpen(false)
  }

  return (
    <>
      <AppPerformanceModeContext.Provider value={performanceMode}>
      <DesktopWindowFrame iconPath={iconPath} productName={productName}>
        <div className='shell'>
          <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
            <div className='sidebar-head'>
              <div className='brand'>
                {collapsed && iconPath ? (
                  <button
                    className='brand-mark brand-mark-button'
                    type='button'
                    onClick={() => setCollapsed(false)}
                    aria-label='展开边栏'
                  >
                    <img src={iconPath} alt='' />
                  </button>
                ) : null}
                {!collapsed && (
                  <button
                    className='brand-text brand-home-link'
                    type='button'
                    onClick={() => void getDesktopBridge().openExternal(DEFAULT_SERVER_BASE_URL)}
                    title='打开 OneAPI 官网'
                  >
                    <div className='brand-name'>OneAPI Center</div>
                    <div className='brand-sub'>Windows 客户端</div>
                  </button>
                )}
              </div>

              {!collapsed && (
                <button
                  className='collapse-button collapse-text-button'
                  type='button'
                  onClick={() => setCollapsed(true)}
                  aria-label='收起边栏'
                  title='收起边栏'
                >
                  <ChevronLeft size={18} />
                </button>
              )}
            </div>

            <nav className='side-nav'>
              {primarySideTabs.map((item) => {
                const Icon = item.icon
                const active = item.key === sideTab
                return (
                  <button
                    key={item.key}
                    type='button'
                    className={`side-nav-item ${active ? 'active' : ''}`}
                    onClick={() => {
                      if (!auth.user && item.key === 'wallet') {
                        setLoginDialogOpen(true)
                        setMessage('请先登录 OneAPI 后使用用量账单。')
                        return
                      }
                      setSideTab(item.key)
                    }}
                    title={item.label}
                  >
                    <Icon size={18} />
                    {!collapsed && (
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.desc}</small>
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>

            <div className='sidebar-footer'>
              <div className='sidebar-account'>
                {!collapsed && (
                  <div className='sidebar-user-stack' ref={updatePopoverRef}>
                    <div className={`sidebar-user-row ${auth.user ? '' : 'anonymous'}`} onClick={auth.user ? handleSidebarUserRowClick : undefined}>
                      <span className={`user-pill ${showUpdateDot ? 'has-update-dot' : ''}`}>
                        {auth.user?.username || '登录'}
                        {auth.user && showAnnouncementCount ? (
                          <span className='user-pill-count-badge'>
                            {unreadAnnouncementCount > 99 ? '99+' : unreadAnnouncementCount}
                          </span>
                        ) : null}
                      </span>
                      {auth.user ? <span className='user-pill secondary'>{sidebarWalletBalance}</span> : null}
                      {auth.user ? (
                        <button
                          className='ghost-button icon-only tiny'
                          type='button'
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleLogout()
                          }}
                          title='退出'
                          aria-label='退出'
                        >
                          <LogOut size={16} />
                        </button>
                      ) : (
                        <button
                          className='secondary-button tiny'
                          type='button'
                          onClick={(event) => {
                            event.stopPropagation()
                            setLoginDialogOpen(true)
                          }}
                        >
                          登录OneAPI
                        </button>
                      )}
                    </div>
                    {auth.user && updatePopoverOpen && (
                      <div className='desktop-update-popover'>
                        <div className='desktop-notice-section'>
                          <div className='desktop-notice-section-head'>
                            <strong>公告</strong>
                            <small>{announcements.length ? `共 ${announcements.length} 条` : '暂无公告'}</small>
                          </div>
                          {announcements.length ? (
                            <div className='desktop-announcement-list'>
                              {announcements.map((item) => {
                                const unread = !readAnnouncementIds.includes(item.id)
                                return (
                                  <button
                                    key={item.id}
                                    type='button'
                                    className={`desktop-announcement-item ${unread ? 'unread' : ''}`}
                                    onClick={() => handleAnnouncementOpen(item)}
                                  >
                                    <span className='desktop-announcement-copy'>
                                      <strong>{item.title}</strong>
                                      <small>{item.published_at || '点击查看详情'}</small>
                                    </span>
                                    {unread ? <span className='desktop-update-pill'>新</span> : null}
                                  </button>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>

                        <div className='desktop-notice-section desktop-notice-section-update'>
                        <div className='desktop-update-inline-row'>
                          <div className='desktop-update-inline-copy'>
                            <strong>版本更新</strong>
                            <small>
                              当前 {appVersion}
                              {updateState.latestVersion && updateState.latestVersion !== appVersion ? ` / 最新 ${updateState.latestVersion}` : ''}
                              {updateState.release?.released_at && updateState.latestVersion && updateState.latestVersion !== appVersion
                                ? ` · ${updateState.release.released_at}`
                                : ''}
                            </small>
                          </div>
                          <button
                            className='secondary-button tiny desktop-update-action'
                            type='button'
                              onClick={() => void handleUpdatePrimaryAction()}
                              disabled={updateState.status === 'downloading' || updateState.status === 'checking'}
                            >
                              {updateState.status === 'checking' || updateState.status === 'downloading' ? (
                                <LoaderCircle className='spin' size={14} />
                              ) : updateState.status === 'downloaded' ? (
                                <Download size={14} />
                              ) : null}
                              {updatePrimaryActionLabel}
                            </button>
                          </div>
                          <p className='desktop-update-message'>{updateStatusSummary}</p>
                          {updateState.status === 'downloading' ? (
                            <div className='desktop-update-progress'>
                              <div className='desktop-update-progress-bar'>
                                <span
                                  style={{
                                    width: `${Math.max(0, Math.min(100, updateState.progress || 0))}%`,
                                  }}
                                />
                              </div>
                              <small>{updateProgressLabel}</small>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {collapsed && (
                  <button
                    className='ghost-button icon-only tiny collapsed-logout-button'
                    type='button'
                    onClick={() => auth.user ? void handleLogout() : setLoginDialogOpen(true)}
                    title={auth.user ? '退出' : '登录'}
                    aria-label={auth.user ? '退出' : '登录'}
                  >
                    {auth.user ? <LogOut size={16} /> : <LockKeyhole size={16} />}
                  </button>
                )}
              </div>
            </div>
          </aside>

          <main className='main-panel'>
            <div className='workspace-host workspace-content-layer'>
              <AssistantWorkspace
                mode={assistantMode}
                setMode={setAssistantMode}
                toast={setMessage}
                openSettings={() => setSideTab('me')}
                visible={sideTab === 'assistants'}
                enabledModes={enabledAssistantModes}
                serverBaseUrl={serverBaseUrl}
                providerState={aiChatProviderState}
                activeApiKey={activeDesktopApiKey}
              />
              {sideTab === 'subscriptions' ? (
                <SubscriptionsWorkspace
                  toast={setMessage}
                  user={auth.user}
                  onRequestLogin={() => setLoginDialogOpen(true)}
                />
              ) : null}
              {sideTab === 'wallet' && auth.user ? <WalletWorkspace user={auth.user} toast={setMessage} /> : null}
              {sideTab === 'service-status' && <ServiceStatusWorkspace toast={setMessage} />}
              <MeWorkspace
                user={auth.user}
                toast={setMessage}
                themeMode={themeMode}
                onToggleTheme={() => {
                  setManualThemeMode(true)
                  setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'))
                }}
                visible={sideTab === 'me'}
                providerConfig={aiChatProviderConfig}
                providerState={aiChatProviderState}
                onProviderConfigChange={updateAiChatProviderConfig}
                onRequestLogin={() => setLoginDialogOpen(true)}
                onActiveApiKeyChange={handleActiveDesktopApiKeyChange}
              />
              {/* settings removed */}
            </div>
          </main>
        </div>
      </DesktopWindowFrame>

      {message && <div className='toast-bar'>{message}</div>}

      {loginDialogOpen && (
        <div className='modal-mask' onClick={() => setLoginDialogOpen(false)}>
          <div className='login-modal-card' onClick={(event) => event.stopPropagation()}>
            <button
              className='ghost-button icon-only tiny login-modal-close'
              type='button'
              onClick={() => setLoginDialogOpen(false)}
              aria-label='关闭登录'
              title='关闭登录'
            >
              <X size={16} />
            </button>
            <LoginScreen
              platformLabel={platformLabel}
              productName={productName}
              onLoginSuccess={(user) => {
                auth.setUser(user)
                setLoginDialogOpen(false)
              }}
              toast={setMessage}
            />
          </div>
        </div>
      )}

      {serverBaseUrlDialogOpen && (
        <div className='modal-mask'>
          <div className='modal-card'>
            <div className='panel-header compact'>
              <div>
                <span className='eyebrow dark'>高级入口</span>
                <h2>修改服务地址</h2>
              </div>
            </div>
            <p className='modal-copy'>修改后会立即切换客户端请求基址，并退出当前登录状态。</p>
            <input
              value={serverBaseUrlDraft}
              onChange={(event) => setServerBaseUrlDraft(event.target.value)}
              placeholder='https://your-server.example.com'
            />
            <div className='modal-actions'>
              <button className='secondary-button' type='button' onClick={() => setServerBaseUrlDialogOpen(false)}>
                取消
              </button>
              <button className='primary-button' type='button' onClick={() => void handleSaveServerBaseUrl()}>
                保存并重载
              </button>
            </div>
          </div>
        </div>
      )}

      {activeAnnouncement && (
        <div className='modal-mask' onClick={() => setActiveAnnouncement(null)}>
          <div className='modal-card announcement-modal-card' onClick={(event) => event.stopPropagation()}>
            <div className='announcement-modal-head'>
              <div>
                <span className='eyebrow dark'>公告</span>
                <h2>{activeAnnouncement.title}</h2>
                {activeAnnouncement.published_at ? (
                  <p className='desktop-update-meta'>{activeAnnouncement.published_at}</p>
                ) : null}
              </div>
              <button
                className='ghost-button icon-only tiny'
                type='button'
                onClick={() => setActiveAnnouncement(null)}
                aria-label='关闭公告'
                title='关闭公告'
              >
                <X size={16} />
              </button>
            </div>
            <div className='announcement-modal-body'>
              <LazyMarkdownContent content={activeAnnouncement.content} className='announcement-markdown' />
            </div>
          </div>
        </div>
      )}
      </AppPerformanceModeContext.Provider>
    </>
  )
}
