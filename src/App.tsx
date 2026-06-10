import { createContext, forwardRef, lazy, memo, startTransition, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ChangeEvent, ClipboardEvent, Dispatch, DragEvent, HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from 'react'
import {
  Activity,
  Blocks,
  Bot,
  CircleHelp,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  CheckCircle2,
  Copy,
  CreditCard,
  Crop,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Shuffle,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Languages,
  Mail,
  MessageSquareText,
  Minus,
  Moon,
  PanelRightOpen,
  PencilLine,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Send,
  Square,
  Sparkles,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'
import {
  createAssistant,
  loadAssistants,
  saveActiveAssistantId,
  saveAssistants,
} from './domains/assistants'
import {
  createImageStylePreset,
  loadImageStylePresets,
  saveImageStylePresets,
} from './domains/image-style-presets'
import {
  getAuthStatus,
  login,
  login2fa,
  logout,
  registerUser,
  sendEmailVerification,
  unwrapEnvelope,
} from './domains/auth'
import {
  copyImageToClipboard,
  getUserGroups,
  getUserModels,
  saveImageToDisk,
  sendChatCompletion,
  sendDirectImageGeneration,
  sendImageEdit,
  sendImageGeneration,
  streamChatCompletion,
  stopChatCompletion,
} from './domains/chat'
import {
  deleteCliMessage,
  deleteCliSessions,
  deployCli,
  exportTextFile,
  getCliSession,
  getCliDeployPreset,
  getCliStatus,
  installCliExtension,
  listCliExtensions,
  listCliHistory,
  openAssistantHistoryFolder,
  openCliSessionFolder,
  onCliProgress,
  onDeployProgress,
  onTranslateSelectionRequested,
  pickProjectDirectory,
  readDesktopFilePreview,
  respondCliInteraction,
  runCliPrompt,
  setDesktopWindowTitle,
  stopCliPrompt,
  syncAssistantHistory,
} from './domains/cli'
import {
  checkForUpdates,
  getUpdateState,
  installUpdate,
  onUpdateState,
} from './domains/update'
import { ensureDesktopServiceKey, fetchApiKeySecret, getApiKeys } from './domains/keys'
import {
  deleteMobileDesktopBinding,
  deleteMobileDesktopDevice,
  getLocalMobileBridgeDevice,
  getMobileDesktopDevices,
  resetLocalMobileBridgeDevice,
  syncMobileDesktopAssistantsSnapshot,
  type MobileDesktopDevice,
} from './domains/mobile-bridge'
import { generateAccessToken, getSelfProfile, requireSuccess, verifyCurrentPassword } from './domains/profile'
import {
  getPublicPlans,
  getSelfSubscriptions,
  getSubscriptionPaymentInfo,
  paySubscription,
} from './domains/subscriptions'
import { getPerfMetricsSummary, getUserUsageLogs } from './domains/usage'
import {
  getBillingHistory,
  redeemTopupCode,
} from './domains/wallet'
import {
  getServiceStatusSnapshot,
} from './domains/service-status'
import {
  applyCliHistoryTitleOverrides,
  appendCliFallbackAssistantMessage,
  buildCliAbortLogEntry,
  buildCliRecentSessions,
  buildCliTimeline,
  type CliTimelineEntry,
  filterAssistantModels,
  filterModelsByVendor,
  isImageGenerationModel as isImageGenerationModelOption,
  type ModelVendorFilter,
  prioritizeFavoriteModels,
  resolveCompatibleModel,
  resolveCliLogGroupStatus,
} from './lib/assistant-workspace'
import { resolveCliDeploySettings } from './lib/cli-deploy'
import {
  applyConversationSearchHighlights,
  clearConversationSearchHighlights,
} from './lib/conversation-search'
import {
  normalizeCliProjectKey,
  resolveCliHistorySessionForProject,
  resolvePreferredCliSessionId,
} from './lib/cli-project-state'
import {
  DEFAULT_ASSISTANT_ID,
  decorateAssistants,
} from './lib/assistants'
import {
  getCliResumeSessionId,
  isDraftCliSessionId,
} from './lib/cli-session'
import { shouldRenderCliLogEventRow, shouldRenderCliLogOutputEntry } from './lib/cli-log-rendering'
import {
  AUTH_EXPIRED_EVENT,
  clearStoredDesktopAccessToken,
  clearStoredDesktopUserId,
  saveStoredDesktopAccessToken,
  saveStoredDesktopUserId,
} from './lib/desktop-client'
import { deriveDesktopChatDisplayState, normalizeStoredDesktopChatMessage } from './lib/chat-reasoning'
import {
  applyAssistantSelectionToEmptyChatSession,
  shouldCreateAssistantSwitchChatSession,
} from './lib/chat-session'
import {
  applyCliMessageOverlays,
  buildCliExtensionDedupeKey,
  buildCliExtensionDisplayName,
  buildCliExtensionInsertText,
  canUseCliExtension,
  collectCliToolNames,
  decorateCliExtensions,
  recommendCliExtensionsForPrompt,
  resolveCliSlashTriggerState,
  translateCliExtensionDescription,
  type CliExtensionViewItem,
  type CliMessageOverlay,
} from './lib/cli-extensions'
import { listCliBuiltinCommands, matchCliBuiltinCommand, type CliBuiltinCommand } from './lib/cli-commands'
import { resolveVisibleDrawMessageContent } from './lib/draw-message'
import { shouldDismissContextMenu } from './lib/context-menu'
import {
  buildImageStyleAugmentedPrompt,
  decorateImageStylePresets,
  type ImageStylePreset,
} from './lib/image-style-presets'
import { groupDrawSessionsByAssistant } from './lib/draw-history'
import { resolveImageGenerationResult, resolveImageResponseErrorMessage } from './lib/image-generation'
import {
  describeCliWorkspaceStatus,
  isCliStatusInstalled,
  isCliStatusReadyForWorkspace,
  resolveCliSetupPeerState,
} from './lib/desktop-service'
import {
  clipText,
  formatDateTime,
  formatPlainPrice,
  formatPrice,
  formatQuota,
  formatQuotaAsMillions,
  formatQuotaAsUsd,
  formatSubscriptionDuration,
  formatSubscriptionResetPeriod,
} from './lib/format'
import {
  getDesktopUpdateDayKey,
  resolveDesktopUpdateStatusSummary,
  shouldAutoCheckDesktopUpdate,
} from './lib/app-update'
import {
  buildPendingDrawRetryRequest,
  resolvePendingDrawRequestGroup,
  type PendingDrawRetryRequest,
} from './lib/draw-request'
import { isRecoverableNetworkError } from './lib/network-retry'
import { isDirectCliCommandPrompt } from './lib/cli-runtime'
import { formatUserFacingMessage } from './lib/user-facing-message'
import { buildFinalPrompt } from './process/prompt-assembler/build-final-prompt'
import { buildImageEditRequest } from './process/image-editing/build-edit-request'
import { mapImageEditError } from './process/image-editing/map-edit-error'
import { buildExecutionCycleEvents } from './process/execution-orchestrator/run-request.ts'
import {
  commitPromptHistoryEntry,
  createPromptHistoryState,
  navigatePromptHistory,
  setPromptHistoryEditingState,
} from './lib/prompt-history'
import {
  buildChatSessionExportMarkdown,
  buildCliSessionExportMarkdown,
  buildDrawSessionExportMarkdown,
  buildSessionExportFileName,
  mergeCliMessages,
  type ExportCliLogGroup,
} from './lib/session-history'
import { readJsonStorage, writeJsonStorage } from './lib/storage'
import { resolveSubscriptionPlanBadge } from './lib/subscription-plan'
import {
  type ServiceStatusCacheStore,
  type ServiceStatusItem,
} from './lib/service-status'
import dayjs from 'dayjs'
import type {
  AssistantRecord,
  AuthStatus,
  BillingHistoryData,
  ChatContentPart,
  ChatMessage,
  ChatModelOption,
  ImageGenerationResponse,
  PlanRecord,
  SubscriptionPaymentInfo,
  SubscriptionSelfData,
  UsageData,
  UserProfile,
} from './shared/contracts'
import type {
  CliClient,
  CliInteractionAction,
  CliInteractionPrompt,
  DesktopAnnouncement,
  CliDeployPreset,
  CliExtensionEntry,
  CliFileChange,
  CliHistoryEntry,
  CliLogKind,
  CliPlanState,
  CliProgressPayload,
  CliSessionDetails,
  CliSessionMessage,
  CliStatus,
  DesktopAppMeta,
  DesktopUpdateState,
  DeployProgressPayload,
} from './shared/desktop'
import { useAuthStore } from './stores/auth-store'

const MarkdownMessageContentLazy = lazy(async () => {
  const module = await import('./components/MarkdownMessageContent')
  return { default: module.MarkdownMessageContent }
})

type AssistantMode = 'chat' | 'draw' | 'codex' | 'claude'
type SideTab = 'assistants' | 'subscriptions' | 'wallet' | 'service-status' | 'me'
type HistoryVisibilityTab = 'visible' | 'hidden'
type ThemeMode = 'light' | 'dark'
type AppPerformanceMode = 'performance' | 'efficiency'
type CliRunningState = {
  running: boolean
  requestId: string
}

const THEME_MODE_STORAGE_KEY = 'oneapi-desktop-theme-mode'
const AppPerformanceModeContext = createContext<AppPerformanceMode>('performance')

function useAppPerformanceMode() {
  return useContext(AppPerformanceModeContext)
}
type CliPaletteTab = 'command' | 'skill' | 'plugin'

const AURORA_OPACITY_STORAGE_KEY = 'oneapi-desktop-aurora-opacity'
const DEFAULT_AURORA_OPACITY = 100
const ASSISTANT_FAVORITES_STORAGE_KEY = 'oneapi-desktop-chat-assistant-favorites'
const IMAGE_STYLE_FAVORITES_STORAGE_KEY = 'oneapi-desktop-image-style-favorites'
const CHAT_PROMPT_HISTORY_STORAGE_KEY = 'oneapi-desktop-chat-prompt-history'
const DRAW_PROMPT_HISTORY_STORAGE_KEY = 'oneapi-desktop-draw-prompt-history'
const DESKTOP_UPDATE_AUTO_CHECK_DAY_KEY = 'oneapi-desktop-update-auto-check-day'
const DESKTOP_ANNOUNCEMENT_READ_IDS_KEY = 'oneapi-desktop-announcement-read-ids'

type ComposerAttachment = {
  id: string
  name: string
  filePath: string
  size: number
  kind: 'image' | 'file'
  mimeType?: string
  dataBase64: string
  previewUrl?: string
}

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

function readServiceStatusCache() {
  return readJsonStorage<ServiceStatusCacheStore>(SERVICE_STATUS_CACHE_KEY, {
    items: [],
    refreshedAt: 0,
    mode: 'status-page',
  })
}

function writeServiceStatusCache(value: ServiceStatusCacheStore) {
  writeJsonStorage(SERVICE_STATUS_CACHE_KEY, value)
}

function countPlanPurchases(records: SubscriptionSelfData['all_subscriptions'], planId: number) {
  return records.filter((item) => item.subscription.plan_id === planId).length
}

function isAssistantHistoryTriggerTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('.assistant-history-button')
}

function isSubscriptionExhausted(subscription: SubscriptionSelfData['all_subscriptions'][number]['subscription']) {
  const total = Number(subscription.amount_total || 0)
  const used = Number(subscription.amount_used || 0)
  return total > 0 && used >= total
}

function resolveSubscriptionStatusLabel(status?: string) {
  switch (String(status || '').toLowerCase()) {
    case 'active':
      return '生效中'
    case 'expired':
      return '已过期'
    case 'cancelled':
      return '已取消'
    default:
      return status || '未知状态'
  }
}

function resolveRecommendedSubscriptionPlanId(plans: PlanRecord[]) {
  const candidates = plans
    .map((item) => {
      const price = Number(item.plan.price_amount || 0)
      const totalAmount = Number(item.plan.total_amount || 0)
      if (price <= 0 || totalAmount <= 0) {
        return null
      }
      return {
        id: item.plan.id,
        valueScore: totalAmount / price,
        totalAmount,
        price,
      }
    })
    .filter((item): item is { id: number; valueScore: number; totalAmount: number; price: number } => Boolean(item))
    .sort((left, right) => {
      if (right.valueScore !== left.valueScore) {
        return right.valueScore - left.valueScore
      }
      if (right.totalAmount !== left.totalAmount) {
        return right.totalAmount - left.totalAmount
      }
      return left.price - right.price
    })

  return candidates[0]?.id ?? 0
}

function useToastState() {
  const [message, setMessageState] = useState('')

  const setMessage = useCallback((nextMessage: string) => {
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

function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize)
      binary += String.fromCharCode(...chunk)
    }

    return window.btoa(binary)
  })
}

function guessAttachmentKind(file: File, filePath: string) {
  if (file.type.startsWith('image/')) {
    return 'image' as const
  }

  return /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(filePath) ? 'image' as const : 'file' as const
}

function normalizeAttachmentMimeType(attachment: ComposerAttachment) {
  if (attachment.mimeType?.trim()) {
    return attachment.mimeType.trim()
  }
  return attachment.kind === 'image' ? 'image/png' : 'application/octet-stream'
}

function buildAttachmentDataUrl(attachment: ComposerAttachment) {
  return `data:${normalizeAttachmentMimeType(attachment)};base64,${attachment.dataBase64}`
}

function decodeAttachmentText(attachment: ComposerAttachment) {
  const mimeType = normalizeAttachmentMimeType(attachment).toLowerCase()
  const textLike =
    mimeType.startsWith('text/') ||
    /(?:json|xml|csv|yaml|yml|markdown|javascript|typescript|x-sh|x-python)/i.test(mimeType) ||
    /\.(txt|md|markdown|json|csv|tsv|xml|yml|yaml|js|jsx|ts|tsx|css|html|py|java|go|rs|c|cpp|h|hpp|cs|php|rb|sh|ps1|sql|log)$/i.test(attachment.name)
  if (!textLike || !attachment.dataBase64) {
    return ''
  }

  try {
    const binary = window.atob(attachment.dataBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 80_000)
  } catch {
    return ''
  }
}

function buildFileAttachmentText(attachment: ComposerAttachment) {
  const decodedText = decodeAttachmentText(attachment).trim()
  const header = [
    `[附件] ${attachment.name}`,
    attachment.filePath ? `路径：${attachment.filePath}` : '',
    `类型：${normalizeAttachmentMimeType(attachment)}`,
  ].filter(Boolean).join('\n')

  if (!decodedText) {
    return `${header}\n内容：当前接口不支持直接上传普通文件，客户端已改为文本引用；如需分析文件内容，请粘贴文本或使用可读取的文本文件。`
  }

  return `${header}\n内容：\n${decodedText}`
}

function buildChatAttachmentContent(
  text: string,
  attachments: ComposerAttachment[]
): string | ChatContentPart[] {
  if (!attachments.length) {
    return text
  }

  const parts: ChatContentPart[] = [
    {
      type: 'text',
      text,
    },
  ]

  for (const attachment of attachments) {
    if (!attachment.dataBase64) {
      continue
    }

    if (attachment.kind === 'image') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: buildAttachmentDataUrl(attachment),
        },
      })
      continue
    }

    parts.push({
      type: 'text',
      text: buildFileAttachmentText(attachment),
    })
  }

  return parts.length === 1 ? text : parts
}

function buildPersistedChatRequestContent(
  text: string,
  attachments: ComposerAttachment[]
): string | ChatContentPart[] | undefined {
  const fileAttachments = attachments.filter((item) => item.kind === 'file')
  if (!fileAttachments.length) {
    return undefined
  }
  const content = buildChatAttachmentContent(text, fileAttachments)
  return content === text ? undefined : content
}

function resolveChatMessageRequestContent(message: ChatMessage) {
  return message.requestContent ?? message.content
}

function toMessageAttachments(attachments: ComposerAttachment[]) {
  return attachments.map((item) => ({
    id: item.id,
    name: item.name,
    filePath: item.filePath,
    kind: item.kind,
  }))
}

function toRenderableFileUrl(filePath: string) {
  if (!filePath.trim()) {
    return ''
  }
  const normalized = filePath.replace(/\\/g, '/')
  if (/^file:\/\//i.test(normalized)) {
    return normalized
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`)
  }
  if (normalized.startsWith('/')) {
    return encodeURI(`file://${normalized}`)
  }
  return encodeURI(normalized)
}

async function openDesktopTarget(targetPath: string) {
  if (!targetPath.trim()) {
    return
  }
  const targetUrl = toRenderableFileUrl(targetPath)
  try {
    if (targetUrl) {
      await window.desktopBridge?.openExternal(targetUrl)
      return
    }
  } catch {
    /* fall through and try opening parent path */
  }
  await window.desktopBridge?.openPath(targetPath)
}

async function openDesktopFolder(targetPath: string, treatAsFile = false) {
  const normalized = targetPath.trim()
  if (!normalized) {
    return
  }

  const resolvedPath = treatAsFile
    ? normalized.replace(/[/\\][^/\\]+$/, '') || normalized
    : normalized

  await window.desktopBridge?.openPath(resolvedPath)
}

function rehydrateCliComposerAttachments(
  attachments: Array<{
    id: string
    name: string
    filePath: string
    kind: 'image' | 'file'
  }> = []
): ComposerAttachment[] {
  return attachments.map((item) => ({
    id: item.id || globalThis.crypto.randomUUID(),
    name: item.name,
    filePath: item.filePath,
    size: 0,
    kind: item.kind,
    dataBase64: '',
    previewUrl: item.kind === 'image' ? toRenderableFileUrl(item.filePath) : undefined,
  }))
}

function isInlinePreviewableFile(targetPath: string) {
  const normalized = targetPath.trim().toLowerCase()
  const fileName = normalized.split(/[\\/]/).filter(Boolean).at(-1) || normalized
  if (fileName === 'dockerfile' || fileName === '.env' || fileName.endsWith('.env')) {
    return true
  }

  return /\.(txt|md|markdown|json|ya?ml|toml|ini|conf|cfg|log|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|less|html|htm|xml|vue|py|java|kt|kts|go|rs|rb|php|swift|sh|bash|zsh|ps1|sql|c|cc|cpp|h|hpp)$/i.test(normalized)
}

function isImagePreviewableFile(targetPath: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(targetPath.trim().toLowerCase())
}

function isMarkdownPreviewableFile(targetPath: string) {
  return /\.(md|markdown)$/i.test(targetPath.trim().toLowerCase())
}

function isEmbeddedPreviewableFile(targetPath: string) {
  return /\.(pdf)$/i.test(targetPath.trim().toLowerCase())
}

function useComposerAttachments(toast: (message: string) => void) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      setAttachments((current) => {
        current.forEach((item) => {
          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl)
          }
        })
        return current
      })
    }
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
        }
      })
      return []
    })
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) =>
      current.filter((item) => {
        if (item.id === attachmentId && item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
        }
        return item.id !== attachmentId
      })
    )
  }, [])

  const replaceAttachments = useCallback((nextAttachments: ComposerAttachment[]) => {
    setAttachments((current) => {
      current.forEach((item) => {
        if (item.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl)
        }
      })
      return nextAttachments
    })
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [])

  const appendFiles = useCallback(async (incomingFiles: File[]) => {
    if (!incomingFiles.length) {
      return
    }

    try {
      const nextAttachments = await Promise.all(
        incomingFiles.map(async (file) => {
          const fileWithPath = file as File & { path?: string }
          const dataBase64 = await fileToBase64(file)
          const filePath =
            fileWithPath.path?.trim() ||
            (
              await getDesktopBridge().saveAttachment({
                name: file.name || 'clipboard-file',
                mimeType: file.type,
                dataBase64,
              })
            ).path

          return {
            id: globalThis.crypto.randomUUID(),
            name: file.name || filePath.split(/[\\/]/).filter(Boolean).at(-1) || '未命名附件',
            filePath,
            size: file.size,
            kind: guessAttachmentKind(file, filePath),
            mimeType: file.type || undefined,
            dataBase64,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
          } satisfies ComposerAttachment
        })
      )

      setAttachments((current) => {
        const seen = new Set(current.map((item) => `${item.name}:${item.filePath}:${item.size}`))
        return [
          ...current,
          ...nextAttachments.filter((item) => {
            const key = `${item.name}:${item.filePath}:${item.size}`
            if (seen.has(key)) {
              if (item.previewUrl) {
                URL.revokeObjectURL(item.previewUrl)
              }
              return false
            }
            seen.add(key)
            return true
          }),
        ]
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '附件处理失败')
    }
  }, [toast])

  const handleInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    await appendFiles(files)
    event.target.value = ''
  }, [appendFiles])

  const handlePaste = useCallback(async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files || [])
    if (!files.length) {
      return
    }

    event.preventDefault()
    await appendFiles(files)
  }, [appendFiles])

  const handleDrop = useCallback(async (event: DragEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    const files = Array.from(event.dataTransfer.files || [])
    if (!files.length) {
      return
    }

    event.preventDefault()
    await appendFiles(files)
  }, [appendFiles])

  return {
    attachments,
    inputRef,
    clearAttachments,
    removeAttachment,
    replaceAttachments,
    handleInputChange,
    handlePaste,
    handleDrop,
    openPicker: () => inputRef.current?.click(),
  }
}

function loadInitialAssistantsState() {
  const nextAssistants = loadAssistants()
  const defaultAssistant = nextAssistants.find((item) => item.id === DEFAULT_ASSISTANT_ID)
  return {
    assistants: nextAssistants,
    activeAssistantId: defaultAssistant?.id || nextAssistants[0]?.id || '',
  }
}

function toAssistantSystemMessage(assistant: AssistantRecord | null) {
  if (!assistant?.prompt.trim()) {
    return null
  }
  return {
    role: 'system' as const,
    content: assistant.prompt.trim(),
  }
}

function maskSecretText(value?: string) {
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

const AUTO_TEXTAREA_MAX_HEIGHT = 260
const AUTO_TEXTAREA_MIN_ROWS = 3
const AUTO_TEXTAREA_MAX_ROWS = 8

function syncTextareaHeight(node: HTMLTextAreaElement | null) {
  if (!node) {
    return
  }

  node.style.height = 'auto'
  const computed = window.getComputedStyle(node)
  const lineHeight = Number.parseFloat(computed.lineHeight) || 24
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0
  const minHeight = lineHeight * AUTO_TEXTAREA_MIN_ROWS + paddingTop + paddingBottom
  const maxHeight = lineHeight * AUTO_TEXTAREA_MAX_ROWS + paddingTop + paddingBottom
  const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), Math.min(maxHeight, AUTO_TEXTAREA_MAX_HEIGHT))
  node.style.height = `${nextHeight}px`
  node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function useAutosizeTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const resize = useCallback(() => {
    syncTextareaHeight(ref.current)
  }, [])

  useLayoutEffect(() => {
    resize()
  }, [resize, value])

  return { ref, resize }
}

type ChatBubbleMessage = ChatMessage & {
  modelLabel?: string
}

type CliMessage = CliSessionMessage

type CliLogEntry = {
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
  files?: CliSessionMessage['fileChanges']
  detail?: string
  command?: string
  exitCode?: number
  interaction?: CliInteractionPrompt
  done?: boolean
}

type CliExtensionPreferenceBucket = {
  favoriteIds: string[]
  notes: Record<string, string>
  autoInvokeEnabled: boolean
}

type CliExtensionPreferenceStore = Record<string, CliExtensionPreferenceBucket>
type CliExtensionTranslationCache = Record<string, string>

type CliMessageOverlayStore = Record<string, CliMessageOverlay[]>

function hashStorageText(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

function resolveCliExtensionTranslationCacheKey(client: CliClient, item: CliExtensionViewItem, description: string) {
  return [
    client,
    item.kind,
    item.installKey ||
      [item.catalogSource?.repoUrl, item.catalogSource?.subdir, item.catalogSource?.sha].filter(Boolean).join('#') ||
      item.id ||
      item.name,
    hashStorageText(description),
  ].join(':')
}

type ComposerActionItem = {
  key: string
  node: ReactNode
}

type ComposerFileAsset = {
  id: string
  name: string
  filePath: string
  previewUrl?: string
  kind: 'image' | 'file'
  onPreview?: () => void
  onRemove?: () => void
}

type ComposerTokenItem = {
  id: string
  label: string
  kindLabel: string
  onEdit?: () => void
  onRemove?: () => void
}

function renderComposer(props: {
  inputRef?: React.RefObject<HTMLInputElement | null>
  onAttachmentInputChange?: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  placeholder: string
  onChange: (value: string) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void | Promise<void>
  onDrop?: (event: DragEvent<HTMLDivElement | HTMLTextAreaElement>) => void | Promise<void>
  leftActions: ComposerActionItem[]
  sendButton: React.ReactNode
  fileAssets?: ComposerFileAsset[]
  tokenItems?: ComposerTokenItem[]
  overlayPanel?: ReactNode
}) {
  const {
    inputRef,
    onAttachmentInputChange,
    textareaRef,
    value,
    placeholder,
    onChange,
    onKeyDown,
    onPaste,
    onDrop,
    leftActions,
    sendButton,
    fileAssets = [],
    tokenItems = [],
    overlayPanel,
  } = props

  return (
    <div className='composer shell-composer'>
      {inputRef && onAttachmentInputChange && (
        <input
          ref={inputRef}
          type='file'
          multiple
          className='hidden-file-input'
          onChange={onAttachmentInputChange}
        />
      )}
      <div className='composer-input-shell'>
        {overlayPanel ? <div className='composer-overlay-panel'>{overlayPanel}</div> : null}
        <div
          className='composer-input-zone'
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDrop={onDrop}
        >
          {tokenItems.length > 0 && (
            <div className='composer-token-strip'>
              {tokenItems.map((item) => (
                <div key={item.id} className='composer-token-chip'>
                  <span className='composer-token-kind'>{item.kindLabel}</span>
                  <strong className='composer-token-label' title={item.label}>{item.label}</strong>
                  {item.onEdit ? (
                    <button
                      className='composer-token-edit'
                      type='button'
                      onClick={item.onEdit}
                      aria-label='编辑预设'
                      title='展开并编辑'
                    >
                      <PencilLine size={12} />
                    </button>
                  ) : null}
                  {item.onRemove ? (
                    <button
                      className='composer-token-remove'
                      type='button'
                      onClick={item.onRemove}
                      aria-label='移除扩展'
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {fileAssets.length > 0 && (
            <div className='composer-asset-strip'>
              {fileAssets.map((item) => (
                <div key={item.id} className='composer-asset-card'>
                  <button
                    type='button'
                    className='composer-asset-preview'
                    onClick={item.onPreview}
                    title={item.filePath}
                  >
                    <div className='composer-asset-thumb'>
                      {item.kind === 'image' && item.previewUrl ? (
                        <img src={item.previewUrl} alt={item.name} />
                      ) : (
                        <FileText size={14} />
                      )}
                    </div>
                    <span className='composer-asset-name' title={item.name}>{item.name}</span>
                  </button>
                  {item.onRemove && (
                    <button className='composer-asset-remove' type='button' onClick={item.onRemove} aria-label='移除附件'>
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            rows={AUTO_TEXTAREA_MIN_ROWS}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDragOver={(event) => {
              event.preventDefault()
            }}
            onDrop={onDrop}
            onInput={(event) => syncTextareaHeight(event.currentTarget)}
            placeholder={placeholder}
          />
        </div>
      </div>
      <div className='composer-toolbar'>
        <div className='composer-actions left'>
          {leftActions.map((item) => (
            <div key={item.key} className='composer-action-slot'>
              {item.node}
            </div>
          ))}
        </div>
        <div className='composer-actions right'>{sendButton}</div>
      </div>
    </div>
  )
}

function useComposerPromptHistory(storageKey: string) {
  const [state, setState] = useState(() =>
    createPromptHistoryState(readJsonStorage<string[]>(storageKey, []))
  )

  useEffect(() => {
    writeJsonStorage(storageKey, state.items)
  }, [state.items, storageKey])

  const syncInputValue = useCallback((value: string) => {
    setState((current) => setPromptHistoryEditingState(current, value))
  }, [])

  const commitInputValue = useCallback((value: string) => {
    setState((current) => createPromptHistoryState(commitPromptHistoryEntry(current.items, value)))
  }, [])

  const recallInputValue = useCallback((direction: 'up' | 'down', currentValue: string) => {
    const next = navigatePromptHistory(state, direction, currentValue)
    setState(next.state)
    return next.nextValue
  }, [state])

  return {
    syncInputValue,
    commitInputValue,
    recallInputValue,
  }
}

function focusTextareaToEnd(textarea: HTMLTextAreaElement | null, value: string) {
  if (!textarea) {
    return
  }

  textarea.focus()
  textarea.setSelectionRange(value.length, value.length)
}

function useDebouncedJsonStorage<T>(key: string, value: T, delayMs = 350) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeJsonStorage(key, value)
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, key, value])
}

function useAutoFollowScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
  dependencies: readonly unknown[]
) {
  const shouldFollowRef = useRef(true)

  const scrollToLatest = useCallback(() => {
    const node = containerRef.current
    if (!node) {
      return
    }
    shouldFollowRef.current = true
    window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  }, [containerRef])

  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    let followFrame = 0
    const handleScroll = () => {
      const remaining = node.scrollHeight - node.scrollTop - node.clientHeight
      shouldFollowRef.current = remaining <= 48
    }
    const scheduleFollowToLatest = () => {
      if (!shouldFollowRef.current || followFrame) {
        return
      }
      followFrame = window.requestAnimationFrame(() => {
        followFrame = 0
        if (shouldFollowRef.current) {
          node.scrollTop = node.scrollHeight
        }
      })
    }

    handleScroll()
    node.addEventListener('scroll', handleScroll, { passive: true })
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleFollowToLatest)

    resizeObserver?.observe(node)
    if (node.firstElementChild) {
      resizeObserver?.observe(node.firstElementChild)
    }

    return () => {
      node.removeEventListener('scroll', handleScroll)
      if (followFrame) {
        window.cancelAnimationFrame(followFrame)
      }
      resizeObserver?.disconnect()
    }
  }, [containerRef])

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || !shouldFollowRef.current) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [containerRef, ...dependencies])

  return scrollToLatest
}

function findClosestConversationBubble(
  container: HTMLDivElement | null,
  selector = '.message-bubble'
) {
  if (!container) {
    return null
  }

  const nodes = Array.from(container.querySelectorAll<HTMLElement>(selector))
  if (!nodes.length) {
    return null
  }

  const containerRect = container.getBoundingClientRect()
  const centerY = containerRect.top + containerRect.height / 2

  const intersected = nodes.find((node) => {
    const rect = node.getBoundingClientRect()
    return rect.top <= centerY && rect.bottom >= centerY
  })
  if (intersected) {
    return intersected
  }

  return nodes.reduce<{ node: HTMLElement | null; distance: number }>(
    (closest, node) => {
      const rect = node.getBoundingClientRect()
      const nodeCenterY = rect.top + rect.height / 2
      const distance = Math.abs(nodeCenterY - centerY)
      if (!closest.node || distance < closest.distance) {
        return { node, distance }
      }
      return closest
    },
    { node: null, distance: Number.POSITIVE_INFINITY }
  ).node
}

function scrollBubbleIntoView(
  container: HTMLDivElement | null,
  selector: string,
  position: 'current-top' | 'current-bottom' | 'session-top' | 'session-bottom'
) {
  if (!container) {
    return
  }

  if (position === 'session-top') {
    container.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }

  if (position === 'session-bottom') {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    return
  }

  const bubble = findClosestConversationBubble(container, selector)
  if (!bubble) {
    return
  }

  const nextTop =
    position === 'current-top'
      ? Math.max(bubble.offsetTop - 8, 0)
      : Math.max(bubble.offsetTop + bubble.offsetHeight - container.clientHeight + 8, 0)

  container.scrollTo({ top: nextTop, behavior: 'smooth' })
}

const CONVERSATION_SCROLL_DOCK_VIEWPORT_INSET = 8
const CONVERSATION_SCROLL_DOCK_VERTICAL_INSET = 72
const CONVERSATION_SCROLL_DOCK_UPDATE_THROTTLE_MS = 140

function ConversationScrollDock(props: {
  containerRef: React.RefObject<HTMLDivElement | null>
  active?: boolean
  itemSelector?: string
}) {
  const { containerRef, active = true, itemSelector = '.message-bubble' } = props
  const [portalRoot] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.body
  )
  const [dockStyle, setDockStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    let animationFrame = 0
    let throttleTimer = 0
    let lastUpdateAt = 0
    const updateDockPosition = () => {
      animationFrame = 0
      lastUpdateAt = performance.now()
      const node = containerRef.current
      if (!active || !node) {
        setDockStyle({ visibility: 'hidden' })
        return
      }

      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        setDockStyle({ visibility: 'hidden' })
        return
      }

      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      const top = Math.min(
        Math.max(rect.top + rect.height / 2, CONVERSATION_SCROLL_DOCK_VERTICAL_INSET),
        Math.max(CONVERSATION_SCROLL_DOCK_VERTICAL_INSET, viewportHeight - CONVERSATION_SCROLL_DOCK_VERTICAL_INSET)
      )
      const right = CONVERSATION_SCROLL_DOCK_VIEWPORT_INSET

      setDockStyle((current) => {
        if (current.visibility === 'visible' && current.top === top && current.right === right) {
          return current
        }
        return {
          visibility: 'visible',
          top,
          right,
        }
      })
    }

    const requestDockPositionUpdate = () => {
      if (animationFrame) {
        return
      }
      animationFrame = window.requestAnimationFrame(updateDockPosition)
    }
    const scheduleDockPositionUpdate = () => {
      const elapsed = performance.now() - lastUpdateAt
      const wait = CONVERSATION_SCROLL_DOCK_UPDATE_THROTTLE_MS - elapsed
      if (wait > 0) {
        if (!throttleTimer) {
          throttleTimer = window.setTimeout(() => {
            throttleTimer = 0
            requestDockPositionUpdate()
          }, wait)
        }
        return
      }
      requestDockPositionUpdate()
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleDockPositionUpdate)
    const node = containerRef.current
    if (node) {
      resizeObserver?.observe(node)
    }
    resizeObserver?.observe(document.documentElement)
    scheduleDockPositionUpdate()
    window.addEventListener('resize', scheduleDockPositionUpdate)
    document.addEventListener('scroll', scheduleDockPositionUpdate, { capture: true, passive: true })

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      if (throttleTimer) {
        window.clearTimeout(throttleTimer)
      }
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleDockPositionUpdate)
      document.removeEventListener('scroll', scheduleDockPositionUpdate, true)
    }
  }, [active, containerRef])

  const dock = (
    <div className='conversation-scroll-dock' style={dockStyle} aria-label='会话导航'>
      <button
        className='conversation-scroll-button'
        type='button'
        title='会话顶部'
        aria-label='会话顶部'
        onClick={() => scrollBubbleIntoView(containerRef.current, itemSelector, 'session-top')}
      >
        <ChevronsUp size={16} />
      </button>
      <button
        className='conversation-scroll-button'
        type='button'
        title='当前顶部'
        aria-label='当前顶部'
        onClick={() => scrollBubbleIntoView(containerRef.current, itemSelector, 'current-top')}
      >
        <ChevronUp size={16} />
      </button>
      <button
        className='conversation-scroll-button'
        type='button'
        title='当前底部'
        aria-label='当前底部'
        onClick={() => scrollBubbleIntoView(containerRef.current, itemSelector, 'current-bottom')}
      >
        <ChevronDown size={16} />
      </button>
      <button
        className='conversation-scroll-button'
        type='button'
        title='会话底部'
        aria-label='会话底部'
        onClick={() => scrollBubbleIntoView(containerRef.current, itemSelector, 'session-bottom')}
      >
        <ChevronsDown size={16} />
      </button>
    </div>
  )

  return portalRoot && active && dockStyle.visibility !== 'hidden' ? createPortal(dock, portalRoot) : null
}

type ChatSessionRecord = {
  id: string
  title: string
  assistantId: string
  model: string
  group: string
  updatedAt: number
  messages: ChatBubbleMessage[]
}

type DrawSessionRecord = {
  id: string
  title: string
  updatedAt: number
  messages: ChatBubbleMessage[]
}

type PendingDrawRetryState = {
  sessionId: string
  request: PendingDrawRetryRequest
}

const REASONING_OPTIONS = [
  { label: '关闭', value: 'off' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '极高', value: 'xhigh' },
] as const

const CLI_REASONING_OPTIONS = REASONING_OPTIONS
const CHAT_REASONING_OPTIONS = REASONING_OPTIONS
const CLAUDE_REASONING_OPTIONS = REASONING_OPTIONS

const DEFAULT_CHAT_MODEL = 'mimo-v2.5-pro'
const DEFAULT_DRAW_MODEL = 'gpt-image-2'
const DEFAULT_CODEX_MODEL = 'gpt-5.4'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'
const DEFAULT_SERVER_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_BASE_URL = 'https://ai.oneapi.center/v1'
const DEFAULT_CLAUDE_BASE_URL = 'https://ai.oneapi.center'
const CHAT_SESSIONS_STORAGE_KEY = 'oneapi-desktop-chat-sessions'
const CHAT_ACTIVE_SESSION_STORAGE_KEY = 'oneapi-desktop-chat-active-session'
const CHAT_REASONING_STORAGE_KEY = 'oneapi-desktop-chat-reasoning'
const CHAT_CONTEXT_WINDOW_STORAGE_KEY = 'oneapi-desktop-chat-context-window'
const DRAW_SESSIONS_STORAGE_KEY = 'oneapi-desktop-draw-sessions'
const DRAW_ACTIVE_SESSION_STORAGE_KEY = 'oneapi-desktop-draw-active-session'
const SERVICE_STATUS_CACHE_KEY = 'oneapi-desktop-service-status'
const SERVICE_STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const CHAT_PENDING_MESSAGE_LABEL = 'Thinking...'
const CLI_PENDING_MESSAGE_LABEL = 'Coding...'
const DRAW_PENDING_MESSAGE_LABEL = 'Thinking...'
const DRAW_PENDING_IMAGE_URL = '__oneapi_draw_pending__'
const MODEL_VENDOR_FILTER_OPTIONS: Array<{ value: ModelVendorFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xiaomimimo', label: 'XiaomiMIMO' },
]
const CHAT_CONTEXT_WINDOW_OPTIONS = [
  { label: '10 条', value: 10 },
  { label: '20 条', value: 20 },
  { label: '30 条', value: 30 },
  { label: '全部', value: 'all' as const },
] as const
const DRAW_SIZE_OPTIONS = [
  { label: '方图', value: '1024x1024' },
  { label: '竖图', value: '1024x1536' },
  { label: '横图', value: '1536x1024' },
] as const
const DRAW_QUALITY_OPTIONS = [
  { label: '标准', value: 'medium' },
  { label: '高清', value: 'high' },
] as const

type PickerMenuWidthStyle = CSSProperties & {
  '--picker-menu-width'?: string
  '--picker-menu-safe-width'?: string
  '--picker-menu-list-height'?: string
  '--picker-menu-list-max-height'?: string
}

type GlassPickerMenuProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

const GlassPickerMenu = forwardRef<HTMLDivElement, GlassPickerMenuProps>(function GlassPickerMenu(
  { className = '', children, ...props },
  ref
) {
  return (
    <div ref={ref} className={`${className} glass-picker-menu`.trim()} {...props}>
      <div className='glass-picker-menu-bg' aria-hidden='true' />
      <div className='glass-picker-menu-content'>{children}</div>
    </div>
  )
})

function estimatePickerTextUnits(value: string) {
  return Array.from(value || '').reduce((total, char) => {
    if (/\s/.test(char)) {
      return total + 0.35
    }
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)) {
      return total + 1
    }
    if (/[A-Z0-9]/.test(char)) {
      return total + 0.64
    }
    if (/[-_./:·|()[\]]/.test(char)) {
      return total + 0.42
    }
    return total + 0.58
  }, 0)
}

function createPickerMenuWidthStyle(
  labels: string[],
  options: {
    min?: number
    max?: number
    padding?: number
    itemCount?: number
    rowHeight?: number
    rowGap?: number
    minListHeight?: number
    maxListHeight?: number
  } = {}
): PickerMenuWidthStyle {
  const {
    min = 188,
    max = 420,
    padding = 72,
    itemCount = labels.length,
    rowHeight = 40,
    rowGap = 6,
    minListHeight = 0,
    maxListHeight = 240,
  } = options
  const longestUnits = labels.reduce((longest, label) => Math.max(longest, estimatePickerTextUnits(label)), 0)
  const width = Math.max(min, Math.min(max, Math.ceil(longestUnits * 13 + padding)))
  const widthValue = `${width}px`
  const safeWidthValue = `min(${widthValue}, calc(100vw - 48px))`
  const effectiveItemCount = Math.max(1, itemCount)
  const listHeight = Math.max(
    minListHeight,
    Math.min(maxListHeight, Math.ceil(effectiveItemCount * rowHeight + Math.max(0, effectiveItemCount - 1) * rowGap))
  )
  const listHeightValue = `min(${listHeight}px, calc(100vh - 240px))`
  const listMaxHeightValue = `min(${maxListHeight}px, calc(100vh - 240px))`
  return {
    '--picker-menu-width': widthValue,
    '--picker-menu-safe-width': safeWidthValue,
    '--picker-menu-list-height': listHeightValue,
    '--picker-menu-list-max-height': listMaxHeightValue,
    width: safeWidthValue,
    minWidth: safeWidthValue,
    maxWidth: safeWidthValue,
    flexBasis: safeWidthValue,
  }
}

type ChatContextWindow = (typeof CHAT_CONTEXT_WINDOW_OPTIONS)[number]['value']

function isImageGenerationModel(value: string) {
  return isImageGenerationModelOption(value)
}

function shouldAttachPromptCacheKey(model: string) {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('deepseek') || normalized.startsWith('mimo')
}

function isVisionChatModel(model: string) {
  const normalized = model.trim().toLowerCase()
  return (
    normalized.startsWith('gpt') ||
    normalized.startsWith('gemini') ||
    normalized.startsWith('claude')
  )
}

function resolveChatModelForAttachments(
  selectedModel: string,
  fallbackModel: string,
  models: ChatModelOption[],
  attachments: ComposerAttachment[]
) {
  if (!attachments.some((item) => item.kind === 'image')) {
    return selectedModel || fallbackModel
  }
  if (isVisionChatModel(selectedModel)) {
    return selectedModel
  }
  return models.find((item) => isVisionChatModel(item.value))?.value || fallbackModel || 'gpt-5.4'
}

function normalizeTimestampMs(value: number) {
  if (!value) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

function getCurrentTimestamp() {
  return Date.now()
}

function resolveUsageTimestamp(item: UsageData['items'][number]) {
  const raw = Number(item.created_at || item.created_time || 0)
  if (!raw) {
    return 0
  }
  return raw > 10_000_000_000 ? raw : raw * 1000
}

type BubbleActionConfig = {
  key: string
  label: string
  icon: typeof Copy
  onClick: () => void
  disabled?: boolean
}

type AttachmentPreviewState =
  | {
      mode: 'image'
      path: string
      name: string
      src: string
    }
  | {
      mode: 'iframe'
      path: string
      name: string
      src: string
    }
  | {
      mode: 'markdown'
      path: string
      name: string
      content: string
    }
  | {
      mode: 'text'
      path: string
      name: string
      content: string
    }

function resolvePreferredModel(
  options: ChatModelOption[],
  preferred: string,
  fallback = ''
) {
  const smartDefault = resolveSmartDefaultChatModel(options)
  if (smartDefault) {
    return smartDefault
  }

  if (options.some((item) => item.value === preferred)) {
    return preferred
  }

  if (fallback && options.some((item) => item.value === fallback)) {
    return fallback
  }

  return options[0]?.value || preferred || fallback || ''
}

function extractModelRank(value: string) {
  const normalized = value.trim().toLowerCase()
  const matched = normalized.match(/(\d+(?:\.\d+)+|\d+)/g)
  if (!matched?.length) {
    return [0]
  }
  return matched.flatMap((item) => item.split('.').map((part) => Number(part || 0)))
}

function compareModelRank(left: string, right: string) {
  const leftRank = extractModelRank(left)
  const rightRank = extractModelRank(right)
  const length = Math.max(leftRank.length, rightRank.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (rightRank[index] || 0) - (leftRank[index] || 0)
    if (delta !== 0) {
      return delta
    }
  }
  return right.localeCompare(left, 'en')
}

function resolveSmartDefaultChatModel(options: ChatModelOption[]) {
  const candidates = options
    .filter((item) => !isImageGenerationModel(item.value))
    .map((item) => item.value)
  const mimo = candidates
    .filter((item) => item.toLowerCase().includes('mimo') || item.toLowerCase().includes('xiaomi'))
    .sort(compareModelRank)
  if (mimo.length > 0) {
    return mimo[0]
  }
  const deepseek = candidates
    .filter((item) => item.toLowerCase().startsWith('deepseek'))
    .sort(compareModelRank)
  if (deepseek.length > 0) {
    return deepseek[0]
  }
  return ''
}

async function translateSelectedText(options: {
  sourceText: string
  modelHint?: string
  group?: string
  candidateModels?: ChatModelOption[]
}) {
  const normalizedText = options.sourceText.trim()
  if (!normalizedText) {
    return ''
  }

  const availableModels =
    options.candidateModels && options.candidateModels.length
      ? options.candidateModels
      : await getUserModels().catch(() => [])

  const chatModels = filterAssistantModels('chat', availableModels)
  const resolvedModel = resolvePreferredModel(
    chatModels,
    options.modelHint || DEFAULT_CHAT_MODEL,
    DEFAULT_CHAT_MODEL
  )

  if (!resolvedModel) {
    throw new Error('当前没有可用于翻译的模型。')
  }

  const response = await sendChatCompletion({
    model: resolvedModel,
    group: options.group || undefined,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: '你是专业翻译助手。请将用户给出的文本准确翻译成简体中文，保留原有格式、代码块、列表、链接和换行，不要添加解释。',
      },
      {
        role: 'user',
        content: normalizedText,
      },
    ],
  })

  return response.choices?.[0]?.message?.content?.trim() || ''
}

function storeFavoriteModels(key: string, value: string[]) {
  writeJsonStorage(key, value)
}

function loadFavoriteModels(key: string) {
  return readJsonStorage<string[]>(key, [])
}

function withFavoriteFlag(models: ChatModelOption[], favorites: string[]) {
  return models.map((item) => ({
    ...item,
    favorite: favorites.includes(item.value),
  }))
}

function isAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('请求已取消') || error.message.includes('已停止')
}

function BubbleMeta(props: {
  side: 'left' | 'right'
  createdAt: number
  actions: BubbleActionConfig[]
  extra?: ReactNode
}) {
  const { side, createdAt, actions, extra } = props

  return (
    <div className={`message-meta ${side}`}>
      <div className='message-meta-main'>
        <small>{formatDateTime(createdAt)}</small>
        {actions.length > 0 ? (
          <div className='bubble-actions'>
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.key}
                  className='bubble-action'
                  type='button'
                  onClick={action.onClick}
                  title={action.label}
                  aria-label={action.label}
                  disabled={action.disabled}
                >
                  <Icon size={14} />
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      {extra ? <div className='message-meta-extra'>{extra}</div> : null}
    </div>
  )
}

function getStoredVerificationKey(userId: number) {
  return `oneapi-desktop-verify-${userId}`
}

function isVerificationStillValid(userId: number) {
  const raw = window.localStorage.getItem(getStoredVerificationKey(userId))
  if (!raw) {
    return false
  }
  const expiresAt = Number(raw)
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function markVerificationValid(userId: number) {
  const expiresAt = Date.now() + 30 * 60 * 1000
  window.localStorage.setItem(getStoredVerificationKey(userId), String(expiresAt))
}

function clearVerificationValid(userId: number) {
  window.localStorage.removeItem(getStoredVerificationKey(userId))
}

function getPendingCliVerificationKey(client: CliClient) {
  return `oneapi-desktop-${client}-pending-verify`
}

function markPendingCliVerification(client: CliClient) {
  window.localStorage.setItem(getPendingCliVerificationKey(client), '1')
}

function hasPendingCliVerification(client: CliClient) {
  return window.localStorage.getItem(getPendingCliVerificationKey(client)) === '1'
}

function clearPendingCliVerification(client: CliClient) {
  window.localStorage.removeItem(getPendingCliVerificationKey(client))
}

function buildEmptyCliStatus(client: CliClient): CliStatus {
  return {
    client,
    installed: false,
    version: '',
    executablePath: '',
    configPath: '',
    dataPath: '',
    hasConfig: false,
    baseUrl: '',
    hasApiKey: false,
    managedByDesktop: false,
    hasDataDirectory: false,
    brokenInstallation: false,
  }
}

const CLI_STATUS_CACHE_KEY = 'oneapi-desktop-cli-status'

function readCachedCliStatus(client: CliClient) {
  const cache = readJsonStorage<Partial<Record<CliClient, CliStatus>>>(CLI_STATUS_CACHE_KEY, {})
  return cache[client] ?? buildEmptyCliStatus(client)
}

function writeCachedCliStatus(status: CliStatus) {
  const cache = readJsonStorage<Partial<Record<CliClient, CliStatus>>>(CLI_STATUS_CACHE_KEY, {})
  cache[status.client] = status
  writeJsonStorage(CLI_STATUS_CACHE_KEY, cache)
}

function sameCliStatus(left: CliStatus, right: CliStatus) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function resolvePendingReasoningState(
  content: string,
  reasoningContent: string,
  streamComplete = false
) {
  const displayState = deriveDesktopChatDisplayState(content, reasoningContent)
  const hasVisibleContent = displayState.visibleContent.trim().length > 0
  const hasReasoningContent = displayState.reasoningContent.trim().length > 0

  if (!hasReasoningContent || streamComplete) {
    return {
      ...displayState,
      reasoningPending: false,
    }
  }

  const hasDirectReasoning = reasoningContent.trim().length > 0

  return {
    ...displayState,
    reasoningPending: displayState.hasUnclosedReasoningTag || (hasDirectReasoning && !hasVisibleContent),
  }
}

function notifyCliStatusChanged(status: CliStatus) {
  window.dispatchEvent(new CustomEvent('oneapi:cli-status-changed', { detail: status }))
}

function percentageOf(value: number, total: number) {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, (value / total) * 100))
}

function formatUsageSummary(usage?: ChatMessage['usage']) {
  if (!usage) {
    return ''
  }

  const total = Number(usage.total_tokens || 0)
  const prompt = Number(usage.prompt_tokens || 0)
  const completion = Number(usage.completion_tokens || 0)
  const cacheHitTokens = Math.max(
    Number(usage.prompt_tokens_details?.cached_tokens || 0),
    Number(usage.input_tokens_details?.cached_tokens || 0),
    Number(usage.prompt_cache_hit_tokens || 0)
  )
  const cacheHitRatio = total > 0
    ? percentageOf(cacheHitTokens, total)
    : prompt > 0
      ? percentageOf(cacheHitTokens, prompt)
      : 0
  const cacheHitSummary =
    cacheHitTokens > 0
      ? `缓存命中 ${cacheHitRatio.toFixed(cacheHitRatio >= 10 ? 0 : 1)}%`
      : ''

  if (total > 0) {
    return `Tokens ${total}${prompt || completion ? ` · 输入 ${prompt} · 输出 ${completion}` : ''}${cacheHitSummary ? ` · ${cacheHitSummary}` : ''}`
  }

  if (prompt > 0 || completion > 0 || cacheHitTokens > 0) {
    return `输入 ${prompt} · 输出 ${completion}${cacheHitSummary ? ` · ${cacheHitSummary}` : ''}`
  }

  return ''
}

function usageModelSummary(items: UsageData['items']) {
  const summary = new Map<
    string,
    {
      model: string
      quota: number
      count: number
      promptTokens: number
      completionTokens: number
      lastAt: number
    }
  >()

  for (const item of items) {
    const model = item.model_name || item.token_name || '未标注模型'
    const current = summary.get(model) ?? {
      model,
      quota: 0,
      count: 0,
      promptTokens: 0,
      completionTokens: 0,
      lastAt: 0,
    }

    current.quota += Number(item.quota || 0)
    current.count += 1
    current.promptTokens += Number(item.prompt_tokens || 0)
    current.completionTokens += Number(item.completion_tokens || 0)
    current.lastAt = Math.max(current.lastAt, Number(item.created_at || item.created_time || 0))
    summary.set(model, current)
  }

  return Array.from(summary.values()).sort((left, right) => right.quota - left.quota)
}

const USAGE_CHART_COLORS = [
  '#1d6b78',
  '#c96e4b',
  '#356f9c',
  '#6f7d4e',
  '#8d5bb3',
  '#2a9fa7',
  '#cc8f2b',
  '#54708c',
]

function clampChartCoordinate(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function buildSmoothLinePath(points: Array<{ x: number; y: number }>, minY?: number, maxY?: number) {
  if (points.length === 0) {
    return ''
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  const [first, ...rest] = points
  let path = `M ${first.x} ${first.y}`

  for (let index = 0; index < rest.length; index += 1) {
    const previous = points[index]
    const current = rest[index]
    const midX = (previous.x + current.x) / 2
    const controlY1 = typeof minY === 'number' && typeof maxY === 'number'
      ? clampChartCoordinate(previous.y, minY, maxY)
      : previous.y
    const controlY2 = typeof minY === 'number' && typeof maxY === 'number'
      ? clampChartCoordinate(current.y, minY, maxY)
      : current.y
    path += ` C ${midX} ${controlY1} ${midX} ${controlY2} ${current.x} ${current.y}`
  }

  return path
}

function buildUsageSeriesFromTimeline(items: UsageData['items']) {
  const buckets = new Map<number, Map<string, number>>()
  const timestamps = items
    .map((item) => resolveUsageTimestamp(item))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)
  const rangeMs = timestamps.length >= 2 ? timestamps[timestamps.length - 1] - timestamps[0] : 0
  const hasMultiDayRange = rangeMs >= 24 * 60 * 60 * 1000
  const targetBuckets = hasMultiDayRange ? 8 : 12
  const bucketCandidatesMs = [
    30 * 1000,
    60 * 1000,
    2 * 60 * 1000,
    5 * 60 * 1000,
    10 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    2 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    12 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  ]
  const bucketSizeMs =
    bucketCandidatesMs.find((candidate) => rangeMs <= 0 || Math.ceil(rangeMs / candidate) <= targetBuckets) ||
    bucketCandidatesMs[bucketCandidatesMs.length - 1]

  for (const item of items) {
    const timestamp = resolveUsageTimestamp(item)
    const bucketKey = timestamp
      ? Math.floor(timestamp / bucketSizeMs) * bucketSizeMs
      : 0
    const model = item.model_name || item.token_name || '未标注模型'
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, new Map())
    }
    const current = buckets.get(bucketKey)!
    current.set(model, (current.get(model) || 0) + Number(item.quota || 0))
  }

  const labels = Array.from(buckets.keys()).sort((left, right) => left - right)

  const models = Array.from(new Set(items.map((item) => item.model_name || item.token_name || '未标注模型')))

  return {
    labels,
    models,
    buckets,
    formatLabel: (value: number) =>
      value
        ? dayjs(value).format(hasMultiDayRange ? 'MM-DD HH:mm' : 'HH:mm')
        : '未知时间',
  }
}

function UsageTrendChart(props: {
  items: UsageData['items']
}) {
  const { items } = props
  const chart = useMemo(() => buildUsageSeriesFromTimeline(items), [items])
  const [hoveredPoint, setHoveredPoint] = useState<{
    model: string
    label: string
    value: number
    color: string
    x: number
    y: number
  } | null>(null)

  if (!chart.labels.length || !chart.models.length) {
    return <EmptyState title='暂无模型分析数据' description='开始使用模型后，这里会自动生成时间趋势。' />
  }

  const width = 760
  const height = 280
  const left = 36
  const right = 24
  const top = 18
  const bottom = 52
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const chartBottom = top + chartHeight
  const maxValue = Math.max(
    1,
    ...chart.labels.flatMap((label) => chart.models.map((model) => chart.buckets.get(label)?.get(model) || 0))
  )
  const gridRows = 4
  const tickStep = Math.max(1, Math.ceil(chart.labels.length / 6))

  return (
    <div className='usage-trend-card'>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className='usage-trend-svg'
        role='img'
        aria-label='模型调用分析趋势图'
        onMouseLeave={() => setHoveredPoint(null)}
      >
        <defs>
          <clipPath id='usage-trend-chart-clip'>
            <rect x={left} y={top} width={chartWidth} height={chartHeight} />
          </clipPath>
        </defs>
        {Array.from({ length: gridRows + 1 }).map((_, index) => {
          const y = top + (chartHeight / gridRows) * index
          return (
            <line
              key={`grid-${index}`}
              x1={left}
              y1={y}
              x2={width - right}
              y2={y}
              className='usage-trend-grid'
            />
          )
        })}

        <g clipPath='url(#usage-trend-chart-clip)'>
          {chart.models.map((model, modelIndex) => {
            const values = chart.labels.map((label) => chart.buckets.get(label)?.get(model) || 0)
            const points = values.map((value, index) => {
              const x = left + (chartWidth * index) / Math.max(chart.labels.length - 1, 1)
              const y = clampChartCoordinate(top + chartHeight - (value / maxValue) * chartHeight, top, chartBottom)
              return { x, y }
            })
            const color = USAGE_CHART_COLORS[modelIndex % USAGE_CHART_COLORS.length]

            return (
              <g key={model}>
                <path d={buildSmoothLinePath(points, top, chartBottom)} fill='none' stroke={color} strokeWidth='2.5' strokeLinecap='round' />
                {points.map((point, index) => (
                  <circle
                    key={`${model}-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r='4'
                    fill={color}
                    onMouseEnter={() =>
                      setHoveredPoint({
                        model,
                        label: chart.formatLabel(chart.labels[index]),
                        value: values[index],
                        color,
                        x: point.x,
                        y: point.y,
                      })
                    }
                    onMouseLeave={() => {
                      setHoveredPoint((current) =>
                        current?.model === model && current?.label === chart.formatLabel(chart.labels[index])
                          ? null
                          : current
                      )
                    }}
                  />
                ))}
              </g>
            )
          })}
        </g>

        {chart.labels.map((label, index) => {
          if (index % tickStep !== 0 && index !== chart.labels.length - 1) {
            return null
          }
          const x = left + (chartWidth * index) / Math.max(chart.labels.length - 1, 1)
          return (
            <text key={label} x={x} y={height - 14} textAnchor='middle' className='usage-trend-axis'>
              {chart.formatLabel(label)}
            </text>
          )
        })}
      </svg>
      {hoveredPoint ? (
        <div
          className='usage-trend-tooltip'
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100}%`,
          }}
        >
          <span className='usage-trend-tooltip-model'>
            <span className='usage-trend-swatch' style={{ backgroundColor: hoveredPoint.color }} />
            <strong>{hoveredPoint.model}</strong>
          </span>
          <span>{hoveredPoint.label}</span>
          <strong>{formatQuota(hoveredPoint.value)}</strong>
        </div>
      ) : null}

      <div className='usage-trend-legend'>
        {chart.models.map((model, index) => (
          <div key={model} className='usage-trend-legend-item'>
            <span className='usage-trend-swatch' style={{ backgroundColor: USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length] }} />
            <strong>{model}</strong>
            <span>{formatQuota(chart.labels.reduce((sum, label) => sum + (chart.buckets.get(label)?.get(model) || 0), 0))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PendingMessageContent(props: {
  label?: string
}) {
  const { label = CLI_PENDING_MESSAGE_LABEL.replace(/\.+$/, '') } = props

  return (
    <div className='pending-message'>
      <LoaderCircle className='spin' size={14} />
      <span>{label}</span>
    </div>
  )
}

const LazyMarkdownContent = memo(function LazyMarkdownContent(props: {
  content: string
  className?: string
  onSelectionContextMenu?: (event: MouseEvent<HTMLDivElement>, selectedText: string) => void
  renderMermaid?: boolean
}) {
  const { content, className, onSelectionContextMenu, renderMermaid = true } = props

  return (
    <Suspense fallback={<div className={className || 'markdown-body'}>{content}</div>}>
      <MarkdownMessageContentLazy
        content={content}
        onOpenLocalPath={openDesktopTarget}
        onOpenExternal={(target) => window.desktopBridge?.openExternal(target)}
        onSelectionContextMenu={onSelectionContextMenu}
        renderMermaid={renderMermaid}
      />
    </Suspense>
  )
})

const ReasoningMessageContent = memo(function ReasoningMessageContent(props: {
  content: string
  pending?: boolean
  onSelectionContextMenu?: (event: MouseEvent<HTMLDivElement>, selectedText: string) => void
}) {
  const { content, pending = false, onSelectionContextMenu } = props
  if (!content.trim()) {
    return null
  }

  return (
    <details className={`reasoning-card ${pending ? 'pending' : ''}`}>
      <summary>
        <span>Thinking</span>
        {pending ? <LoaderCircle className='spin' size={12} /> : null}
      </summary>
      <div className='reasoning-card-body'>
        <LazyMarkdownContent content={content} onSelectionContextMenu={onSelectionContextMenu} />
      </div>
    </details>
  )
})

function formatDownloadSize(value?: number) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let current = size
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  const digits = current >= 100 || unitIndex === 0 ? 0 : current >= 10 ? 1 : 2
  return `${current.toFixed(digits)} ${units[unitIndex]}`
}

function PendingImageContent(props: {
  label?: string
}) {
  const { label = DRAW_PENDING_MESSAGE_LABEL } = props
  return (
    <div className='pending-image-card' aria-label='图片生成中'>
      <div className='pending-image-shimmer' />
      <div className='pending-image-meta'>
        <LoaderCircle className='spin' size={14} />
        <span>{label}</span>
      </div>
    </div>
  )
}

type SessionContextMenuState = {
  x: number
  y: number
  title: string
  scope?: 'history' | 'general'
  items: Array<{
    key: string
    label: string
    onSelect: () => void | Promise<void>
    variant?: 'default' | 'danger'
  }>
}

type MessageAttachmentItem = {
  id: string
  name: string
  filePath: string
  kind: 'image' | 'file'
}

function showAttachmentContextMenu(
  event: MouseEvent,
  attachment: MessageAttachmentItem,
  setMenu: Dispatch<SetStateAction<SessionContextMenuState | null>>,
  onPreview?: (targetPath: string) => void
) {
  event.preventDefault()
  setMenu({
    x: event.clientX,
    y: event.clientY,
    title: attachment.name,
    items: [
      {
        key: 'preview',
        label: '预览',
        onSelect: () => {
          if (onPreview) {
            onPreview(attachment.filePath)
            return
          }
          return openDesktopTarget(attachment.filePath)
        },
      },
      {
        key: 'open-folder',
        label: '打开文件夹',
        onSelect: () => openDesktopFolder(attachment.filePath, true),
      },
    ],
  })
}

function resolveChatRetryFallbackText(hasReasoningContent: boolean) {
  return hasReasoningContent ? '模型已完成思考，但本次没有返回可显示的正文内容。' : CHAT_PENDING_MESSAGE_LABEL
}

type SessionRenameDraft = {
  id: string
  value: string
} | null

function SessionTitleEditor(props: {
  editing: boolean
  value: string
  displayValue: string
  maxLength: number
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const { editing, value, displayValue, maxLength, onChange, onCommit, onCancel } = props

  if (!editing) {
    return <span className='session-row-preview'>{clipText(displayValue, maxLength)}</span>
  }

  return (
    <input
      className='session-rename-input'
      value={value}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

function SessionContextMenu(props: {
  menu: SessionContextMenuState | null
  onClose: () => void
}) {
  const { menu, onClose } = props
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menu) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (shouldDismissContextMenu(menuRef.current, event.target)) {
        onClose()
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (shouldDismissContextMenu(menuRef.current, event.target)) {
        onClose()
      }
    }

    function handleClose() {
      onClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('blur', handleClose)
    window.addEventListener('focusin', handleFocusIn)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleClose)
    window.addEventListener('scroll', handleClose, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('blur', handleClose)
      window.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('scroll', handleClose, true)
    }
  }, [menu, onClose])

  if (!menu) {
    return null
  }

  return (
    <div
      ref={menuRef}
      className='session-context-menu'
      style={{
        left: Math.max(12, menu.x),
        top: Math.max(12, menu.y),
      }}
      role='menu'
      aria-label={`${menu.title} 会话操作`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.items.map((item) => (
        <button
          key={item.key}
          className={`session-context-menu-item ${item.variant === 'danger' ? 'danger' : ''}`}
          type='button'
          role='menuitem'
          onClick={() => {
            onClose()
            void item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function AttachmentPreviewModal(props: {
  preview: AttachmentPreviewState | null
  toast: (message: string) => void
  onClose: () => void
  onImageContextMenu?: (event: MouseEvent<HTMLImageElement | HTMLDivElement>, preview: Extract<AttachmentPreviewState, { mode: 'image' }>) => void
}) {
  const { preview, toast, onClose, onImageContextMenu } = props
  if (!preview) {
    return null
  }

  async function handleCopyPreviewImage() {
    if (!preview || preview.mode !== 'image') {
      return
    }
    try {
      await copyImageToClipboard({
        filePath: preview.path,
        sourceUrl: preview.src.startsWith('file:') ? undefined : preview.src,
      })
      toast('图片已复制到剪贴板。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制图片失败')
    }
  }

  async function handleDownloadPreviewImage() {
    if (!preview || preview.mode !== 'image') {
      return
    }
    try {
      const result = await saveImageToDisk({
        suggestedName: preview.name || `oneapi-image-${Date.now()}.png`,
        sourceUrl: preview.src.startsWith('file:') ? undefined : preview.src,
      })
      toast(result.path ? `已保存到：${result.path}` : '图片已保存。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存图片失败')
    }
  }

  let previewContent: ReactNode
  if (preview.mode === 'image') {
    previewContent = (
      <img
        src={preview.src}
        alt={preview.name}
        className='image-preview-full'
        onContextMenu={(event) => onImageContextMenu?.(event, preview)}
      />
    )
  } else if (preview.mode === 'iframe') {
    previewContent = <iframe src={preview.src} title={preview.name} className='attachment-preview-frame' />
  } else if (preview.mode === 'markdown') {
    previewContent = (
      <div className='attachment-preview-text markdown-body attachment-preview-scroll'>
        <LazyMarkdownContent
          content={preview.content}
          className='attachment-preview-text markdown-body attachment-preview-scroll'
        />
      </div>
    )
  } else {
    previewContent = <pre className='attachment-preview-text attachment-preview-scroll'>{preview.content}</pre>
  }

  return (
    <div className='modal-mask image-preview-modal-mask' onClick={onClose}>
      <div
        className={`image-preview-modal attachment-preview-modal ${preview.mode === 'image' ? 'image-only' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className='image-preview-stage attachment-preview-stage'
          onContextMenu={preview.mode === 'image' ? (event) => onImageContextMenu?.(event, preview) : undefined}
        >
          <div className='image-preview-overlay-actions'>
            {preview.mode === 'image' ? (
              <>
                <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={() => void handleCopyPreviewImage()} title='复制图片' aria-label='复制图片'>
                  <Copy size={15} />
                </button>
                <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={() => void handleDownloadPreviewImage()} title='下载图片' aria-label='下载图片'>
                  <Download size={15} />
                </button>
              </>
            ) : null}
            <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={onClose} title='关闭' aria-label='关闭'>
              <X size={15} />
            </button>
          </div>
          {previewContent}
        </div>
      </div>
    </div>
  )
}

function TranslationResultModal(props: {
  open: boolean
  sourceText: string
  translatedText: string
  loading: boolean
  onClose: () => void
  onCopy: () => void
}) {
  const { open, sourceText, translatedText, loading, onClose, onCopy } = props

  if (!open) {
    return null
  }

  return (
    <div className='modal-mask' onClick={onClose}>
      <div className='modal-card translation-modal-card' onClick={(event) => event.stopPropagation()}>
        <div className='panel-header compact'>
          <div>
            <span className='eyebrow dark'>选中文本翻译</span>
            <h2>翻译结果</h2>
          </div>
        </div>
        <div className='translation-modal-sections'>
          <section className='translation-modal-section'>
            <strong>原文</strong>
            <pre>{sourceText}</pre>
          </section>
          <section className='translation-modal-section'>
            <strong>译文</strong>
            <pre>{loading ? '翻译中...' : translatedText || '暂无可用结果。'}</pre>
          </section>
        </div>
        <div className='modal-actions'>
          <button className='secondary-button' type='button' onClick={onClose}>
            关闭
          </button>
          <button className='primary-button' type='button' disabled={loading || !translatedText.trim()} onClick={onCopy}>
            <Copy size={14} />
            <span>复制译文</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function getCliExtensionKindLabel(item: CliExtensionEntry) {
  if (item.kind === 'skill') {
    return '技能'
  }
  if (item.kind === 'command') {
    return '命令'
  }
  return '插件'
}

function getCliBuiltinCommandKindLabel() {
  return '命令'
}

type CliPaletteItem =
  | {
      id: string
      section: 'command'
      source: 'builtin'
      builtin: CliBuiltinCommand
    }
  | {
      id: string
      section: 'command' | 'skill' | 'plugin'
      source: 'extension'
      extension: CliExtensionViewItem
    }

function MessageCliExtensionChips(props: {
  items?: CliExtensionEntry[]
  label?: string
}) {
  const { items = [], label = '已插入扩展' } = props
  if (!items.length) {
    return null
  }

  return (
    <div className='message-extension-strip'>
      <span className='message-extension-strip-label'>{label}</span>
      <div className='message-extension-strip-chips'>
        {items.map((item) => (
          <div key={item.id} className='message-extension-chip' title={item.path}>
            <span className='message-extension-kind'>{getCliExtensionKindLabel(item)}</span>
            <strong>{buildCliExtensionDisplayName(item.name, item.note)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function CliExtensionPalette(props: {
  loading: boolean
  menuStyle?: PickerMenuWidthStyle
  paletteItems: CliPaletteItem[]
  availableTabs: CliPaletteTab[]
  activeTab: CliPaletteTab
  onChangeTab: (tab: CliPaletteTab) => void
  highlightedIndex: number
  searchValue: string
  onSearchChange: (value: string) => void
  onSelect: (item: CliPaletteItem) => void
  onInsert: (item: CliPaletteItem) => void
  onCopyName: (item: CliPaletteItem) => void
  onHoverIndex: (index: number) => void
  onRefresh: () => void
  installingIds: string[]
  onInstall: (item: CliExtensionViewItem) => void
  searchActive: boolean
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  onToggleFavorite: (item: CliExtensionViewItem) => void
  getCachedTranslatedDetail: (item: CliExtensionViewItem) => string
  onTranslateDetail: (item: CliExtensionViewItem) => Promise<string>
  onContextMenu: (event: MouseEvent, item: CliExtensionViewItem) => void
  autoInvokeEnabled: boolean
  onAutoInvokeChange: (enabled: boolean) => void
  menuHostRef?: React.RefObject<HTMLDivElement | null>
}) {
  const {
    loading,
    menuStyle,
    paletteItems,
    availableTabs,
    activeTab,
    onChangeTab,
    highlightedIndex,
    searchValue,
    onSearchChange,
    onSelect,
    onInsert,
    onCopyName,
    onHoverIndex,
    onRefresh,
    installingIds,
    onInstall,
    searchActive,
    onKeyDown,
    onToggleFavorite,
    getCachedTranslatedDetail,
    onTranslateDetail,
    onContextMenu,
    autoInvokeEnabled,
    onAutoInvokeChange,
    menuHostRef,
  } = props
  const menuRef = useRef<HTMLDivElement | null>(null)
  const tooltipHideTimerRef = useRef<number | null>(null)
  const [hoveredTooltip, setHoveredTooltip] = useState<{
    left: number
    top: number
    item: CliExtensionViewItem
    originalDescription: string
    translatedDescription: string
    showTranslated: boolean
    translating: boolean
    translationUnavailable: boolean
  } | null>(null)

  function clearTooltipHideTimer() {
    if (tooltipHideTimerRef.current !== null) {
      window.clearTimeout(tooltipHideTimerRef.current)
      tooltipHideTimerRef.current = null
    }
  }

  function scheduleTooltipHide() {
    clearTooltipHideTimer()
    tooltipHideTimerRef.current = window.setTimeout(() => {
      setHoveredTooltip(null)
      tooltipHideTimerRef.current = null
    }, 220)
  }

  function openDetailTooltip(trigger: HTMLElement, item: CliExtensionViewItem) {
    clearTooltipHideTimer()
    const triggerRect = trigger.getBoundingClientRect()
    const originalDescription = item.description.trim()
    const cachedTranslation = getCachedTranslatedDetail(item)
    const localTranslation = translateCliExtensionDescription(item.name, originalDescription).trim()
    const translatedDescription = cachedTranslation || localTranslation
    const tooltipWidth = 280
    const tooltipGap = 6
    const viewportPadding = 12
    const fixedLeft = Math.max(
      viewportPadding,
      Math.min(triggerRect.right - tooltipWidth, window.innerWidth - tooltipWidth - viewportPadding)
    )
    const fixedTop = Math.max(viewportPadding, triggerRect.top - tooltipGap)

    setHoveredTooltip({
      left: fixedLeft,
      top: fixedTop,
      item,
      originalDescription,
      translatedDescription,
      showTranslated: Boolean(translatedDescription && translatedDescription !== originalDescription),
      translating: false,
      translationUnavailable: false,
    })
  }

  useEffect(() => () => clearTooltipHideTimer(), [])

  return (
    <GlassPickerMenu
      ref={(node) => {
        menuRef.current = node
        if (menuHostRef) {
          menuHostRef.current = node
        }
      }}
      className='picker-menu cli-extension-menu fixed-width-menu'
      style={menuStyle}
      onMouseLeave={scheduleTooltipHide}
    >
      <div className='picker-filter-row cli-extension-filter-row'>
        <div className='cli-extension-filter-tabs'>
          {availableTabs.length > 1 ? (
            <>
          {availableTabs.map((tab) => (
            <button
              key={tab}
              className={`picker-filter-chip ${activeTab === tab ? 'active' : ''}`}
              type='button'
              onClick={() => onChangeTab(tab)}
            >
              <span>{tab}</span>
            </button>
          ))}
            </>
          ) : null}
        </div>
        <div className='cli-extension-toolbar'>
          <input
            className='cli-extension-search'
            value={searchValue}
            placeholder='搜索扩展'
            autoFocus
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            className='ghost-button icon-only tiny'
            type='button'
            onClick={onRefresh}
            title={loading ? '正在刷新' : searchActive ? '搜索已生效' : '刷新扩展'}
          >
            {loading ? <LoaderCircle className='spin' size={14} /> : searchActive ? <Search size={14} /> : <RotateCcw size={14} />}
          </button>
          <label className='cli-extension-auto-toggle'>
            <span>自动调用</span>
            <input
              type='checkbox'
              checked={autoInvokeEnabled}
              onChange={(event) => onAutoInvokeChange(event.target.checked)}
            />
          </label>
        </div>
      </div>
      {hoveredTooltip ? createPortal(
        <div
          className='cli-extension-floating-tooltip'
          style={{
            left: hoveredTooltip.left,
            top: hoveredTooltip.top,
          }}
          onMouseEnter={clearTooltipHideTimer}
          onMouseLeave={scheduleTooltipHide}
        >
          <div className='cli-extension-tooltip-head'>
            <strong>{hoveredTooltip.item.displayName}</strong>
            <button
              className='ghost-button icon-only tiny cli-extension-tooltip-action'
              type='button'
              title='翻译为中文'
              aria-label='翻译为中文'
              onClick={async (event) => {
                event.stopPropagation()

                if (
                  hoveredTooltip.translatedDescription &&
                  hoveredTooltip.translatedDescription !== hoveredTooltip.originalDescription
                ) {
                  setHoveredTooltip((current) =>
                    current && current.item.id === hoveredTooltip.item.id
                      ? { ...current, showTranslated: true, translationUnavailable: false }
                      : current
                  )
                  return
                }

                setHoveredTooltip((current) =>
                  current && current.item.id === hoveredTooltip.item.id
                    ? { ...current, translating: true, translationUnavailable: false }
                    : current
                )

                const nextTranslation = await onTranslateDetail(hoveredTooltip.item)

                setHoveredTooltip((current) => {
                  if (!current || current.item.id !== hoveredTooltip.item.id) {
                    return current
                  }
                  const normalizedTranslation = nextTranslation.trim()
                  return {
                    ...current,
                    translating: false,
                    translatedDescription: normalizedTranslation || current.originalDescription,
                    showTranslated: true,
                    translationUnavailable:
                      !normalizedTranslation || normalizedTranslation === current.originalDescription,
                  }
                })
              }}
            >
              {hoveredTooltip.translating ? <LoaderCircle className='spin' size={13} /> : <Languages size={13} />}
            </button>
          </div>
          <p>
          {hoveredTooltip.showTranslated
              ? hoveredTooltip.translatedDescription || hoveredTooltip.originalDescription || '未提供描述'
              : hoveredTooltip.originalDescription || '未提供描述'}
          </p>
          {hoveredTooltip.translationUnavailable ? <p className='muted'>当前仅能显示原文。</p> : null}
        </div>,
        document.body
      ) : null}
      <div className='cli-extension-list'>
        {loading ? (
          <div className='cli-extension-empty'>正在读取本机与官方扩展...</div>
        ) : paletteItems.length === 0 ? (
          <div className='cli-extension-empty'>未找到匹配的技能、命令或插件。</div>
        ) : paletteItems.map((paletteItem, index) => {
          const item = paletteItem.source === 'extension' ? paletteItem.extension : null
          const builtin = paletteItem.source === 'builtin' ? paletteItem.builtin : null
          const translatedDescription = item
            ? translateCliExtensionDescription(item.name, item.description)
            : builtin?.description || ''
          const compactDescription = translatedDescription || item?.description || builtin?.description || '未提供描述'
          const installed = item ? canUseCliExtension(item) : true
          const installing = item ? installingIds.includes(item.id) : false
          return (
            <div key={paletteItem.id}>
              <button
                type='button'
                className={`cli-extension-card ${index === highlightedIndex ? 'selected' : ''} ${installed ? '' : 'uninstalled'}`}
                onMouseEnter={() => onHoverIndex(index)}
                onClick={() => {
                  if (installed) {
                    onSelect(paletteItem)
                  }
                }}
                onContextMenu={(event) => {
                  if (item && installed) {
                    onContextMenu(event, item)
                  }
                }}
                aria-selected={index === highlightedIndex}
              >
                <div className='cli-extension-name-row'>
                  <div className='cli-extension-name-meta'>
                    <strong>
                      {item ? item.displayName : builtin?.command}
                      {item?.official ? <span className='cli-extension-badge'>官</span> : null}
                    </strong>
                    <span className='cli-extension-meta'>
                      {item ? getCliExtensionKindLabel(item) : getCliBuiltinCommandKindLabel()}
                      {item?.source ? ` · ${item.source}` : ''}
                      {!installed ? ' · 未安装' : ''}
                    </span>
                  </div>
                  <div className='cli-extension-inline-actions'>
                    {item ? (
                      installed ? (
                        <>
                          <button
                            className='ghost-button icon-only tiny cli-extension-inline-action cli-extension-detail-trigger'
                            type='button'
                            title='查看详情'
                            aria-label='查看详情'
                            onMouseEnter={(event) => {
                              event.stopPropagation()
                              openDetailTooltip(event.currentTarget, item)
                            }}
                            onMouseLeave={scheduleTooltipHide}
                            onFocus={(event) => openDetailTooltip(event.currentTarget, item)}
                            onBlur={scheduleTooltipHide}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                          >
                            <CircleHelp size={13} />
                          </button>
                          <button
                            className={`ghost-button icon-only tiny cli-extension-inline-action model-favorite ${item.favorite ? 'active' : ''}`}
                            type='button'
                            title={item.favorite ? '取消收藏' : '收藏并置顶'}
                            aria-label={item.favorite ? '取消收藏' : '收藏并置顶'}
                            onClick={(event) => {
                              event.stopPropagation()
                              onToggleFavorite(item)
                            }}
                          >
                            <Star size={13} />
                          </button>
                          <button
                            className='ghost-button icon-only tiny cli-extension-inline-action'
                            type='button'
                            title='复制名称'
                            aria-label='复制名称'
                            onClick={(event) => {
                              event.stopPropagation()
                              onCopyName(paletteItem)
                            }}
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            className='ghost-button icon-only tiny cli-extension-inline-action'
                            type='button'
                            title='插入'
                            aria-label='插入'
                            onClick={(event) => {
                              event.stopPropagation()
                              onInsert(paletteItem)
                            }}
                          >
                            <Plus size={13} />
                          </button>
                        </>
                      ) : (
                        <button
                          className='secondary-button tiny cli-extension-install-button'
                          type='button'
                          disabled={installing}
                          onClick={(event) => {
                            event.stopPropagation()
                            onInstall(item)
                          }}
                        >
                          {installing ? <LoaderCircle className='spin' size={13} /> : <Download size={13} />}
                          <span>{installing ? '安装中' : '安装'}</span>
                        </button>
                      )
                    ) : (
                      <>
                        <button
                          className='ghost-button icon-only tiny cli-extension-inline-action'
                          type='button'
                          title='复制命令'
                          aria-label='复制命令'
                          onClick={(event) => {
                            event.stopPropagation()
                            onCopyName(paletteItem)
                          }}
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          className='ghost-button icon-only tiny cli-extension-inline-action'
                          type='button'
                          title='插入'
                          aria-label='插入'
                          onClick={(event) => {
                            event.stopPropagation()
                            onInsert(paletteItem)
                          }}
                        >
                          <Plus size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className='cli-extension-desc-line' title={compactDescription}>
                  {item ? compactDescription : `${builtin?.title || ''} · ${compactDescription}`}
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </GlassPickerMenu>
  )
}

function ImageStylePresetPalette(props: {
  mode: 'list' | 'create' | 'edit'
  searchValue: string
  menuStyle?: PickerMenuWidthStyle
  items: Array<ImageStylePreset & { favorite: boolean }>
  selectedPresetId?: string
  onSelect: (item: ImageStylePreset) => void
  onSearchChange: (value: string) => void
  onToggleFavorite: (presetId: string) => void
  onOpenCreateEditor: () => void
  onContextMenu: (event: MouseEvent, presetId: string) => void
  titleValue: string
  categoryValue: string
  descriptionValue: string
  promptValue: string
  sizeValue: (typeof DRAW_SIZE_OPTIONS)[number]['value']
  qualityValue: (typeof DRAW_QUALITY_OPTIONS)[number]['value']
  onTitleChange: (value: string) => void
  onCategoryChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onPromptChange: (value: string) => void
  onSizeChange: (value: (typeof DRAW_SIZE_OPTIONS)[number]['value']) => void
  onQualityChange: (value: (typeof DRAW_QUALITY_OPTIONS)[number]['value']) => void
  onCancelEditor: () => void
  onSaveEditor: () => void
}) {
  const {
    mode,
    searchValue,
    menuStyle,
    items,
    selectedPresetId = '',
    onSelect,
    onSearchChange,
    onToggleFavorite,
    onOpenCreateEditor,
    onContextMenu,
    titleValue,
    categoryValue,
    descriptionValue,
    promptValue,
    sizeValue,
    qualityValue,
    onTitleChange,
    onCategoryChange,
    onDescriptionChange,
    onPromptChange,
    onSizeChange,
    onQualityChange,
    onCancelEditor,
    onSaveEditor,
  } = props

  return (
    <GlassPickerMenu className='picker-menu assistant-menu image-style-menu fixed-width-menu' style={menuStyle}>
      {mode === 'list' ? (
        <>
          <div className='assistant-menu-toolbar'>
            <input
              className='assistant-search'
              value={searchValue}
              placeholder='搜索助手'
              autoFocus
              onChange={(event) => onSearchChange(event.target.value)}
            />
            <button className='secondary-button tiny' type='button' onClick={onOpenCreateEditor}>
              <Plus size={14} />
              <span>新建自定义助手</span>
            </button>
          </div>
          <div className='picker-menu-list assistant-picker-list'>
            {items.length === 0 ? (
              <div className='assistant-picker-empty'>未找到匹配助手</div>
            ) : items.map((item) => (
              <div
                key={item.id}
                className='assistant-picker-row'
                onContextMenu={(event) => onContextMenu(event, item.id)}
              >
                <button
                  type='button'
                  className={`picker-option assistant-picker-option image-style-picker-option ${selectedPresetId === item.id ? 'active' : ''}`}
                  onClick={() => onSelect(item)}
                  title={item.prompt}
                >
                  <strong>{item.title}</strong>
                  <span>{`${item.description}${item.category && item.category !== item.title ? ` · ${item.category}` : ''} · ${item.size}${item.quality ? ` · ${item.quality}` : ''}`}</span>
                </button>
                <button
                  className={`ghost-button icon-only tiny model-favorite ${item.favorite ? 'active' : ''}`}
                  type='button'
                  title={item.favorite ? '取消收藏' : '收藏并置顶'}
                  aria-label={item.favorite ? '取消收藏' : '收藏并置顶'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleFavorite(item.id)
                  }}
                >
                  <Star size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className='assistant-editor'>
          <div className='assistant-editor-head'>
            <strong>{mode === 'edit' ? '编辑助手' : '新建助手'}</strong>
          </div>
          <div className='assistant-editor-fields'>
            <input
              value={titleValue}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder='助手名称，例如商业海报'
            />
            <input
              value={categoryValue}
              onChange={(event) => onCategoryChange(event.target.value)}
              placeholder='分类，例如产品与海报'
            />
            <input
              value={descriptionValue}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder='一句话描述'
            />
            <div className='assistant-editor-inline-fields'>
              <select value={sizeValue} onChange={(event) => onSizeChange(event.target.value as (typeof DRAW_SIZE_OPTIONS)[number]['value'])}>
                {DRAW_SIZE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select value={qualityValue} onChange={(event) => onQualityChange(event.target.value as (typeof DRAW_QUALITY_OPTIONS)[number]['value'])}>
                {DRAW_QUALITY_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={promptValue}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder='输入图像风格提示词。'
            />
          </div>
          <div className='assistant-editor-actions'>
            <button className='ghost-button tiny' type='button' onClick={onCancelEditor}>
              <span>取消</span>
            </button>
            <button className='secondary-button tiny' type='button' onClick={onSaveEditor}>
              <span>{mode === 'edit' ? '保存更新' : '新建助手'}</span>
            </button>
          </div>
        </div>
      )}
    </GlassPickerMenu>
  )
}

function useAttachmentPreview(toast: (message: string) => void) {
  const [preview, setPreview] = useState<AttachmentPreviewState | null>(null)

  const openPreview = useCallback(async (targetPath: string) => {
    if (!targetPath.trim()) {
      return
    }

    try {
      if (isImagePreviewableFile(targetPath)) {
        setPreview({
          mode: 'image',
          path: targetPath,
          name: targetPath.split(/[\\/]/).filter(Boolean).at(-1) || targetPath,
          src: toRenderableFileUrl(targetPath),
        })
        return
      }

      if (isEmbeddedPreviewableFile(targetPath)) {
        setPreview({
          mode: 'iframe',
          path: targetPath,
          name: targetPath.split(/[\\/]/).filter(Boolean).at(-1) || targetPath,
          src: toRenderableFileUrl(targetPath),
        })
        return
      }

      if (isInlinePreviewableFile(targetPath)) {
        const details = await readDesktopFilePreview(targetPath)
        setPreview({
          mode: isMarkdownPreviewableFile(targetPath) ? 'markdown' : 'text',
          path: details.path,
          name: details.name,
          content: details.content,
        })
        return
      }

      await openDesktopTarget(targetPath)
    } catch (error) {
      toast(error instanceof Error ? error.message : '附件预览失败')
    }
  }, [toast])

  return {
    preview,
    setPreview,
    openPreview,
  }
}

function MessageAttachmentGallery(props: {
  attachments?: MessageAttachmentItem[]
  onPreview?: (targetPath: string) => void
  onAttachmentContextMenu?: (event: MouseEvent, item: MessageAttachmentItem) => void
}) {
  const { attachments = [], onPreview, onAttachmentContextMenu } = props
  if (!attachments.length) {
    return null
  }

  return (
    <div className='message-attachment-strip'>
      {attachments.map((item) => (
        <button
          key={item.id}
          type='button'
          className='message-attachment-card'
          onClick={() => onPreview ? void onPreview(item.filePath) : void openDesktopTarget(item.filePath)}
          onContextMenu={(event) => onAttachmentContextMenu?.(event, item)}
          title={`预览附件：${item.filePath}`}
        >
          <div className='message-attachment-thumb'>
            {item.kind === 'image' ? (
              <img src={toRenderableFileUrl(item.filePath)} alt={item.name} />
            ) : (
              <FileText size={16} />
            )}
          </div>
          <span className='message-attachment-name'>{item.name}</span>
        </button>
      ))}
    </div>
  )
}

function MessageFileChangeLinks(props: {
  ownerId: string
  files?: Array<{
    path: string
    kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  }>
  previewFile?: {
    ownerId: string
    path: string
    name: string
    content: string
  } | null
  onOpenFile: (ownerId: string, path: string) => void
}) {
  const { ownerId, files = [], previewFile, onOpenFile } = props
  const uniqueFiles = Array.from(new Map(files.map((item) => [item.path, item])).values())
  if (!uniqueFiles.length) {
    return null
  }

  return (
    <div className='message-file-links'>
      {uniqueFiles.map((item) => (
        <button
          key={item.path}
          type='button'
          className='ghost-button tiny cli-log-file'
          onClick={() => onOpenFile(ownerId, item.path)}
          title={item.path}
        >
          <FileText size={14} />
          <span>{item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path}</span>
        </button>
      ))}
      {previewFile && previewFile.ownerId === ownerId && (
        <div className='inline-file-preview'>
          <code className='inline-file-preview-path'>{previewFile.path}</code>
          <pre className='inline-file-preview-content'>{previewFile.content}</pre>
        </div>
      )}
    </div>
  )
}

function CliLogBubble(props: {
  item: Extract<CliTimelineEntry, { kind: 'log' }>
  expanded: boolean
  expandedEventIds: string[]
  onToggleEvent: (eventId: string) => void
  onOpenFile: (ownerId: string, path: string) => void
  onCopy: () => void
  onDelete: () => void
  onRespondInteraction: (requestId: string, interactionId: string, action: CliInteractionAction) => void
  respondingInteractionIds: string[]
  requestedExtensions?: CliExtensionEntry[]
  previewFile?: {
    ownerId: string
    path: string
    name: string
    content: string
  } | null
}) {
  const {
    item,
    expanded,
    expandedEventIds,
    onToggleEvent,
    onOpenFile,
    onCopy,
    onDelete,
    onRespondInteraction,
    respondingInteractionIds,
    requestedExtensions = [],
    previewFile,
  } = props
  const uniqueFiles = Array.from(new Map(item.files.map((file) => [file.path, file])).values())
  const executedToolNames = collectCliToolNames(item.events.map((eventItem) => eventItem.sourceKind))
  const logStatus = resolveCliLogGroupStatus(item.events)
  const commandCount = item.events.filter((eventItem) => eventItem.kind === 'command').length
  const visibleEvents = expanded ? item.events : item.events.slice(0, 1)
  const visualBlocks = buildCliVisualLogBlocks(visibleEvents)
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<string[]>([])
  const [collapsedTimeGroupIds, setCollapsedTimeGroupIds] = useState<string[]>([])
  const eventTotals = useMemo(() => summarizeCliEventTotals(item.events), [item.events])
  const renderedBlocks = useMemo(() => visualBlocks.map((block) => {
    const rows: Array<
      | { type: 'event'; id: string; event: typeof block.items[number] }
      | { type: 'output'; id: string; items: Array<typeof block.items[number]>; title: string; summary: string }
    > = []

    for (const sectionItem of block.items) {
      const previous = rows.at(-1)
      const outputFamily = resolveCliOutputFamily(sectionItem)
      if (
        previous?.type === 'output' &&
        outputFamily &&
        canGroupCliOutputEvents(sectionItem, previous.items.at(-1)!)
      ) {
        previous.items.push(sectionItem)
        previous.title = resolveCliOutputGroupTitle(previous.items)
        previous.summary = resolveCliOutputGroupSummary(previous.items)
        continue
      }

      if (outputFamily) {
        rows.push({
          type: 'output',
          id: `${block.id}-${sectionItem.id}`,
          items: [sectionItem],
          title: resolveCliOutputGroupTitle([sectionItem]),
          summary: resolveCliOutputGroupSummary([sectionItem]),
        })
        continue
      }

      rows.push({
        type: 'event',
        id: sectionItem.id,
        event: sectionItem,
      })
    }

    return {
      ...block,
      rows,
      summary: summarizeCliBlockRows(rows),
      timeGroups: rows.reduce<Array<{
        id: string
        timeLabel: string
        summary: string
        rows: typeof rows
      }>>((groups, row) => {
        const createdAt = row.type === 'output' ? row.items[0]?.createdAt || item.createdAt : row.event.createdAt
        const timeLabel = formatCliLogTime(createdAt)
        const summary = row.type === 'output' ? resolveCliOutputGroupHeadline(row.items) || row.summary : row.event.message
        const previous = groups.at(-1)
        if (previous && previous.timeLabel === timeLabel) {
          previous.rows.push(row)
          return groups
        }
        groups.push({
          id: `${block.id}-${timeLabel}-${groups.length}`,
          timeLabel,
          summary,
          rows: [row],
        })
        return groups
      }, []),
    }
  }), [visualBlocks, item.createdAt])

  const toggleSection = (sectionId: string) => {
    setCollapsedSectionIds((current) =>
      current.includes(sectionId) ? current.filter((itemId) => itemId !== sectionId) : [...current, sectionId],
    )
  }

  const toggleTimeGroup = (groupId: string) => {
    setCollapsedTimeGroupIds((current) =>
      current.includes(groupId) ? current.filter((itemId) => itemId !== groupId) : [...current, groupId],
    )
  }

  const normalizeComparable = (value?: string) => (value || '').trim().replace(/\s+/g, ' ')
  const isPlainStatusSourceKind = (sourceKind?: string) => isCliMetaIntentSourceKind(sourceKind)

  const renderInteraction = (interaction: CliInteractionPrompt) => {
    const interactionPending = interaction.status === 'pending'
    const interactionBusy = respondingInteractionIds.includes(interaction.id)
    return (
      <div className={`cli-interaction-card ${interaction.status}`}>
        <div className='cli-interaction-copy'>
          <strong>{interaction.message}</strong>
          {interaction.command?.trim() ? (
            <pre className='cli-log-detail-window'>{interaction.command}</pre>
          ) : null}
        </div>
        {interactionPending && item.requestId ? (
          <div className='cli-interaction-actions'>
            <button
              className='ghost-button tiny'
              type='button'
              disabled={interactionBusy}
              onClick={() => onRespondInteraction(item.requestId || '', interaction.id, 'approve')}
            >
              确认
            </button>
            <button
              className='ghost-button tiny'
              type='button'
              disabled={interactionBusy}
              onClick={() => onRespondInteraction(item.requestId || '', interaction.id, 'approve_always')}
            >
              一直确认
            </button>
            <button
              className='ghost-button tiny danger'
              type='button'
              disabled={interactionBusy}
              onClick={() => onRespondInteraction(item.requestId || '', interaction.id, 'reject')}
            >
              拒绝
            </button>
          </div>
        ) : (
          <span className='cli-interaction-status'>
            {interaction.status === 'auto_approved'
              ? '已自动确认'
              : interaction.status === 'approved_always'
                ? '已持续放行'
                : interaction.status === 'approved'
                  ? '已确认'
                  : interaction.status === 'rejected'
                    ? '已拒绝'
                    : '等待确认'}
          </span>
        )}
      </div>
    )
  }

  const renderExpandedEventDetails = (
    ownerId: string,
    command?: string,
    detail?: string,
    files?: Array<{ path: string }>,
  ) => {
    const uniqueEventFiles = Array.from(new Map((files || []).map((file) => [file.path, file])).values())
    return (
      <div className='cli-log-event-details'>
        {command?.trim() ? (
          <div className='cli-log-detail-block'>
            <span className='cli-log-detail-label'>执行命令</span>
            <pre className='cli-log-detail-window'>{command}</pre>
          </div>
        ) : null}
        {detail?.trim() ? (
          <div className='cli-log-detail-block'>
            <pre className='cli-log-detail-window'>{detail}</pre>
          </div>
        ) : null}
        {uniqueEventFiles.length > 0 ? (
          <div className='cli-log-detail-block'>
            <span className='cli-log-detail-label'>相关文件</span>
            <div className='cli-log-files inline-expanded'>
              {uniqueEventFiles.map((fileItem) => (
                <button
                  key={fileItem.path}
                  className='ghost-button tiny cli-log-file'
                  type='button'
                  onClick={() => onOpenFile(ownerId, fileItem.path)}
                  title={fileItem.path}
                >
                  <FileText size={14} />
                  <span>{fileItem.path.split(/[\\/]/).filter(Boolean).at(-1) || fileItem.path}</span>
                </button>
              ))}
            </div>
            {previewFile && previewFile.ownerId === ownerId ? (
              <div className='inline-file-preview'>
                <code className='inline-file-preview-path'>{previewFile.path}</code>
                <pre className='inline-file-preview-content'>{previewFile.content}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`message-bubble system cli-log-bubble ${logStatus.tone === 'error' ? 'error' : ''}`}>
      <div className='cli-log-card-head'>
        <span className='message-role'>{logStatus.tone === 'error' ? '运行异常' : '运行日志'}</span>
        <strong>{`已执行 ${item.events.length} 步`}</strong>
      </div>
      <MessageCliExtensionChips items={requestedExtensions} label='本轮指定扩展' />
      {executedToolNames.length > 0 ? (
        <div className='message-extension-strip compact'>
          <span className='message-extension-strip-label'>实际工具调用</span>
          <div className='message-extension-strip-chips'>
            {executedToolNames.map((itemName) => (
              <div key={itemName} className='message-extension-chip subtle'>
                <span className='message-extension-kind'>工具</span>
                <strong>{itemName}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {item.events.length >= 40 ? (
        <div className='cli-log-overview-strip'>
          <span>{`意图 ${eventTotals.intentCount}`}</span>
          <span>{`命令 ${eventTotals.commandCount}`}</span>
          <span>{`工具 ${eventTotals.toolCount}`}</span>
          <span>{`诊断 ${eventTotals.diagnosticCount}`}</span>
          <span>{`确认 ${eventTotals.interactionCount}`}</span>
        </div>
      ) : null}
      <div className='cli-log-event-list'>
        {renderedBlocks.map((block, blockIndex) => {
          const blockTitle = resolveCliVisualBlockTitle(block, blockIndex)
          const plainStatusBlock =
            (!block.items.length && !!block.intent) ||
            (block.intent ? isPlainStatusSourceKind(block.intent.sourceKind) : false) ||
            (!block.intent &&
              block.items.length > 0 &&
              block.items.every((eventItem) => isPlainStatusSourceKind(eventItem.sourceKind)))
          const autoCollapsed = item.events.length >= 80 && blockIndex < renderedBlocks.length - 3
          const collapsed = collapsedSectionIds.includes(block.id) || autoCollapsed
          const showBlockHead = !!blockTitle && !plainStatusBlock

          return (
            <div key={block.id} className={`cli-log-phase-section ${plainStatusBlock ? 'plain-status' : ''}`}>
              {showBlockHead ? (
                <button className='cli-log-phase-head' type='button' onClick={() => toggleSection(block.id)}>
                  <span className='cli-log-phase-headline'>
                    <strong>{blockTitle}</strong>
                  </span>
                  <small>{[block.summary, `${block.rows.length || block.items.length || (block.intent ? 1 : 0)} 条`].filter(Boolean).join(' · ')}</small>
                  <span className='cli-log-head-toggle-icon'>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
                </button>
              ) : null}
              {plainStatusBlock && !block.timeGroups.length && blockTitle ? (
                <div className='cli-log-time-group'>
                  <div className='cli-log-time-head plain static'>
                    <div className='cli-log-time-copy plain'>
                      <span className='cli-log-time-dot' />
                      <strong>{blockTitle}</strong>
                      {block.intent?.createdAt ? <small>{formatCliLogTime(block.intent.createdAt)}</small> : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {!collapsed ? block.timeGroups.map((timeGroup) => {
                const firstRow = timeGroup.rows[0]
                const rawHeadline = firstRow?.type === 'output' ? firstRow.summary : firstRow?.event.message || ''
                const normalizedHeadline = normalizeComparable(rawHeadline)
                const effectiveHeadline = normalizedHeadline === normalizeComparable(blockTitle) ? '' : rawHeadline
                const timeCollapsed = collapsedTimeGroupIds.includes(timeGroup.id)

                return (
                  <div key={timeGroup.id} className='cli-log-time-group'>
                    <button
                      className={`cli-log-time-head ${effectiveHeadline ? '' : 'plain'}`.trim()}
                      type='button'
                      onClick={() => toggleTimeGroup(timeGroup.id)}
                    >
                      <div className={`cli-log-time-copy ${effectiveHeadline ? '' : 'plain'}`.trim()}>
                        <span className='cli-log-time-dot' />
                        {effectiveHeadline ? <strong>{effectiveHeadline}</strong> : null}
                        <small>{timeGroup.timeLabel}</small>
                      </div>
                      <span className='cli-log-head-toggle-icon'>{timeCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
                    </button>
                    {!timeCollapsed ? (
                      <div className='cli-log-time-lines'>
                        {timeGroup.rows.map((row, rowIndex) => {
                          if (row.type === 'output') {
                            const headline =
                              resolveCliOutputGroupHeadline(row.items) || row.summary || '执行细节'
                            const outputEntries = row.items.map((eventItem) => {
                              const detailLines = resolveCliDiagnosticDetail(eventItem)
                                .split(/\r?\n/)
                                .map((line) => line.trim())
                                .filter(Boolean)
                              const entryHeadline =
                                resolveCliOutputGroupHeadline([eventItem]) ||
                                detailLines[0] ||
                                eventItem.message
                              const detailBody = detailLines.join('\n')

                              return {
                                id: eventItem.id,
                                headline: entryHeadline,
                                detail:
                                  normalizeComparable(detailBody) === normalizeComparable(entryHeadline)
                                    ? ''
                                    : detailBody,
                              }
                            })

                            return (
                              <div key={row.id} className='cli-log-output-stack'>
                                {headline && normalizeComparable(headline) !== normalizeComparable(effectiveHeadline) ? (
                                  <div className='cli-log-output-stack-title'>
                                    <span className='cli-log-child-dot' />
                                    <strong>{headline}</strong>
                                  </div>
                                ) : null}
                                {outputEntries.map((entry, outputIndex) => {
                                  const duplicatedPrimary =
                                    outputIndex === 0 &&
                                    normalizeComparable(entry.headline) === normalizeComparable(effectiveHeadline || entry.headline)
                                  if (!shouldRenderCliLogOutputEntry({
                                    outputIndex,
                                    entryHeadline: entry.headline,
                                    entryDetail: entry.detail,
                                    groupHeadline: headline,
                                  })) {
                                    return null
                                  }

                                  return (
                                    <div key={entry.id} className='cli-log-output-inline'>
                                      <span className='cli-log-child-dot' />
                                      <div className='cli-log-output-inline-copy'>
                                        {!duplicatedPrimary ? <strong>{entry.headline}</strong> : null}
                                        {entry.detail ? <pre className='cli-log-detail-window compact'>{entry.detail}</pre> : null}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          }

                          const eventItem = row.event
                          const eventExpanded = expandedEventIds.includes(eventItem.id)
                          const hasExpandableContent =
                            !!eventItem.command?.trim() ||
                            !!eventItem.detail?.trim() ||
                            eventItem.files.length > 0
                          const duplicatedPrimary =
                            rowIndex === 0 &&
                            normalizeComparable(eventItem.message) === normalizeComparable(effectiveHeadline || eventItem.message)
                          if (!shouldRenderCliLogEventRow({
                            duplicatedPrimary,
                            hasExpandableContent,
                            hasInteraction: !!eventItem.interaction,
                          })) {
                            return null
                          }

                          return (
                            <div
                              key={eventItem.id}
                              className={`cli-log-event-row ${eventItem.kind} ${eventItem.level}`}
                              style={
                                {
                                  '--cli-log-indent-level': `${Math.max(0, eventItem.indentLevel || 0)}`,
                                } as CSSProperties
                              }
                            >
                              <div className='cli-log-event-dot' />
                              <div className='cli-log-event-body'>
                                {!duplicatedPrimary ? (
                                  <div className='cli-log-event-head'>
                                    <div className='cli-log-event-copy'>
                                      {hasExpandableContent ? (
                                        <button
                                          className='cli-log-event-toggle'
                                          type='button'
                                          title={eventExpanded ? '收起详情' : '展开详情'}
                                          aria-label={eventExpanded ? '收起详情' : '展开详情'}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            onToggleEvent(eventItem.id)
                                          }}
                                        >
                                          {eventExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                          <strong>{eventItem.message}</strong>
                                        </button>
                                      ) : (
                                        <strong>{eventItem.message}</strong>
                                      )}
                                    </div>
                                  </div>
                                ) : hasExpandableContent ? (
                                  <div className='cli-log-event-head compact'>
                                    <button
                                      className='cli-log-event-toggle'
                                      type='button'
                                      title={eventExpanded ? '收起详情' : '展开详情'}
                                      aria-label={eventExpanded ? '收起详情' : '展开详情'}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        onToggleEvent(eventItem.id)
                                      }}
                                    >
                                      {eventExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                      <span>查看详情</span>
                                    </button>
                                  </div>
                                ) : null}
                                {eventItem.interaction ? renderInteraction(eventItem.interaction) : null}
                                {eventExpanded
                                  ? renderExpandedEventDetails(
                                      eventItem.id,
                                      eventItem.command,
                                      eventItem.detail,
                                      eventItem.files,
                                    )
                                  : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              }) : null}
            </div>
          )
        })}
      </div>
      <div className='cli-log-status-bar'>
        <span className={`cli-log-status-pill ${logStatus.tone}`}>
          {logStatus.tone === 'running' ? <LoaderCircle className='spin' size={13} /> : null}
          {logStatus.label}
        </span>
        <small>
          {[
            commandCount > 0 ? `命令 ${commandCount}` : '',
            `步骤 ${item.events.length}`,
            `最后更新 ${formatCliLogTime(item.createdAt)}`,
          ].filter(Boolean).join(' · ')}
        </small>
      </div>
      {uniqueFiles.length > 0 && !expanded ? (
        <div className='cli-log-files'>
          {uniqueFiles.slice(0, 4).map((fileItem) => (
            <button
              key={fileItem.path}
              className='ghost-button tiny cli-log-file'
              type='button'
              onClick={() => onOpenFile(item.id, fileItem.path)}
              title={fileItem.path}
            >
              <FileText size={14} />
              <span>{fileItem.path.split(/[\\/]/).filter(Boolean).at(-1) || fileItem.path}</span>
            </button>
          ))}
        </div>
      ) : null}
      <BubbleMeta
        side='left'
        createdAt={item.createdAt}
        actions={[
          {
            key: 'copy',
            label: '复制',
            icon: Copy,
            onClick: () => onCopy(),
          },
          {
            key: 'delete',
            label: '删除',
            icon: Trash2,
            onClick: () => onDelete(),
          },
        ]}
      />
    </div>
  )
}

function ConversationFindBar(props: {
  active: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  itemSelector?: string
}) {
  const { active, containerRef, itemSelector = '.message-bubble' } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<HTMLElement[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const clearHighlights = useCallback(() => {
    clearConversationSearchHighlights(containerRef.current)
  }, [containerRef])

  const clearActiveTarget = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    container.querySelectorAll<HTMLElement>('.conversation-search-hit-active, .conversation-search-mark-active').forEach((node) => {
      node.classList.remove('conversation-search-hit-active', 'conversation-search-mark-active')
    })
  }, [containerRef])

  useEffect(() => {
    if (!active) {
      window.setTimeout(() => {
        setOpen(false)
        setQuery('')
        setMatches([])
        setActiveIndex(0)
        clearHighlights()
      }, 0)
    }
  }, [active, clearHighlights])

  useEffect(() => {
    if (!active) {
      return
    }
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setOpen(true)
        window.setTimeout(() => inputRef.current?.focus(), 0)
      }
      if (event.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active, open])

  useEffect(() => {
    clearHighlights()
    if (!open || !query.trim()) {
      window.setTimeout(() => {
        setMatches([])
        setActiveIndex(0)
      }, 0)
      return
    }
    const container = containerRef.current
    if (!container) {
      window.setTimeout(() => {
        setMatches([])
      }, 0)
      return
    }
    const nextMatches = applyConversationSearchHighlights(container, itemSelector, query)
    window.setTimeout(() => {
      setMatches(nextMatches)
      setActiveIndex(nextMatches.length ? 0 : 0)
    }, 0)
  }, [clearHighlights, containerRef, itemSelector, open, query])

  useEffect(() => {
    clearActiveTarget()
    const activeNode = matches[activeIndex]
    if (!activeNode) {
      return
    }
    activeNode.classList.add('conversation-search-mark-active')
    activeNode.closest<HTMLElement>(itemSelector)?.classList.add('conversation-search-hit-active')
    activeNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIndex, clearActiveTarget, itemSelector, matches])

  const jump = useCallback((direction: 1 | -1) => {
    setActiveIndex((current) => {
      if (!matches.length) {
        return 0
      }
      return (current + direction + matches.length) % matches.length
    })
  }, [matches.length])

  if (!open) {
    return null
  }

  return (
    <div className='conversation-find-bar' aria-label='会话搜索'>
      <Search size={15} />
      <input
        ref={inputRef}
        value={query}
        placeholder='搜索当前会话'
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            jump(event.shiftKey ? -1 : 1)
          }
        }}
      />
      <span className='conversation-find-stats'>
        {matches.length ? `${activeIndex + 1}/${matches.length}` : '0/0'}
      </span>
      <button className='conversation-find-button' type='button' aria-label='上一条' onClick={() => jump(-1)}>
        <ChevronUp size={14} />
      </button>
      <button className='conversation-find-button' type='button' aria-label='下一条' onClick={() => jump(1)}>
        <ChevronDown size={14} />
      </button>
      <button className='conversation-find-button' type='button' aria-label='关闭搜索' onClick={() => setOpen(false)}>
        <X size={14} />
      </button>
    </div>
  )
}

function normalizeProjectKey(value?: string) {
  return normalizeCliProjectKey(value)
}

function resolveProjectNameFromPath(value?: string) {
  const normalized = (value || '').split(/[\\/]/).filter(Boolean)
  return normalized.at(-1) || ''
}

function resolveCliExtensionPreferenceProjectKey(projectPath?: string) {
  return normalizeProjectKey(projectPath) || '__global__'
}

function createEmptyCliExtensionPreferenceBucket(): CliExtensionPreferenceBucket {
  return {
    favoriteIds: [],
    notes: {},
    autoInvokeEnabled: true,
  }
}

function createDefaultChatSession(
  activeAssistantId: string,
  model: string,
  group: string
): ChatSessionRecord {
  return {
    id: `chat-session-${Date.now()}`,
    title: '新对话',
    assistantId: activeAssistantId,
    model,
    group,
    updatedAt: Date.now(),
    messages: [],
  }
}

function resolveExistingAssistantId(assistants: AssistantRecord[], requestedId?: string) {
  if (requestedId && assistants.some((item) => item.id === requestedId)) {
    return requestedId
  }
  return assistants[0]?.id || ''
}

function loadStoredChatSessions() {
  const sessions = readJsonStorage<ChatSessionRecord[]>(CHAT_SESSIONS_STORAGE_KEY, [])
  return sessions
    .map((session) => ({
      ...session,
      messages: (session.messages || [])
        .filter((message) => !message.pending)
        .map((message) => normalizeStoredDesktopChatMessage(message))
        .sort((left, right) => left.createdAt - right.createdAt),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

function createDefaultDrawSession(): DrawSessionRecord {
  return {
    id: `draw-session-${Date.now()}`,
    title: '新绘图',
    updatedAt: Date.now(),
    messages: [],
  }
}

function loadStoredDrawSessions() {
  const sessions = readJsonStorage<DrawSessionRecord[]>(DRAW_SESSIONS_STORAGE_KEY, [])
  return sessions
    .map((session) => ({
      ...session,
      messages: (session.messages || [])
        .filter((message) => !message.pending)
        .sort((left, right) => left.createdAt - right.createdAt),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

function orderGroupedEntries<T extends { updatedAt?: number }>(
  groups: Array<[string, T[]]>,
  pinnedKeys: string[]
) {
  const pinnedIndex = new Map(pinnedKeys.map((key, index) => [key, index]))
  return [...groups].sort((left, right) => {
    const leftPinned = pinnedIndex.has(left[0])
    const rightPinned = pinnedIndex.has(right[0])
    if (leftPinned && rightPinned) {
      return (pinnedIndex.get(left[0]) || 0) - (pinnedIndex.get(right[0]) || 0)
    }
    if (leftPinned) {
      return -1
    }
    if (rightPinned) {
      return 1
    }
    const leftUpdated = Math.max(...left[1].map((item) => Number(item.updatedAt || 0)), 0)
    const rightUpdated = Math.max(...right[1].map((item) => Number(item.updatedAt || 0)), 0)
    return rightUpdated - leftUpdated
  })
}

function extractDataUrlBase64(value: string) {
  const match = value.match(/^data:[^;]+;base64,(.+)$/)
  return match?.[1] || ''
}

function mergeCliLogs(left: CliLogEntry[], right: CliLogEntry[]) {
  const seen = new Set<string>()
  return [...left, ...right]
    .map((item) => ({
      ...item,
      createdAt: normalizeTimestampMs(item.createdAt),
    }))
    .sort((a, b) => a.createdAt - b.createdAt)
    .filter((item) => {
      const key = `${item.level}:${item.logKind || ''}:${item.sourceKind || ''}:${item.createdAt}:${item.content}:${item.assistantChunk || ''}:${item.indentLevel || 0}:${item.command || ''}:${item.detail || ''}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}

function formatCliLogTime(timestamp: number) {
  return dayjs(normalizeTimestampMs(timestamp)).format('HH:mm:ss')
}

function shouldReplaceStreamingCliIntentEntry(previous: CliLogEntry | undefined, next: CliLogEntry) {
  return (
    !!previous &&
    previous.requestId === next.requestId &&
    previous.logKind === 'intent' &&
    next.logKind === 'intent' &&
    previous.sourceKind === next.sourceKind &&
    previous.content === next.content &&
    previous.indentLevel === next.indentLevel &&
    next.sourceKind === 'agent_progress.prompt'
  )
}

function resolveCliLogKindLabel(kind?: CliLogKind) {
  switch (kind) {
    case 'intent':
      return ''
    case 'command':
      return '命令'
    case 'stdout':
      return '输出'
    case 'stderr':
      return '错误输出'
    case 'result':
      return '结果'
    case 'tool':
      return '工具'
    case 'error':
      return '异常'
    case 'status':
    default:
      return '状态'
  }
}

function isCliIntentEvent(item: {
  kind?: CliLogKind
  sourceKind?: string
  interaction?: CliInteractionPrompt
  assistantChunk?: string
}) {
  const sourceKind = (item.sourceKind || '').trim().toLowerCase()
  return sourceKind.startsWith('orchestrator.intent') || sourceKind.startsWith('intent.') || item.kind === 'intent'
}

function buildCliVisualLogBlocks<T extends {
  id: string
  message: string
  kind?: CliLogKind
  sourceKind?: string
  interaction?: CliInteractionPrompt
  assistantChunk?: string
  detail?: string
  createdAt: number
}>(events: T[]) {
  const blocks: Array<{
    id: string
    label: string
    intent?: T
    items: T[]
  }> = []

  let currentBlock: {
    id: string
    label: string
    intent?: T
    items: T[]
  } | null = null

  for (const eventItem of events) {
    if (isCliIntentEvent(eventItem)) {
      currentBlock = {
        id: `intent-block-${eventItem.id}`,
        label: '意图',
        intent: eventItem,
        items: [],
      }
      blocks.push(currentBlock)
      continue
    }

    if (!currentBlock) {
      currentBlock = {
        id: `execution-block-${eventItem.id}`,
        label: '执行',
        items: [],
      }
      blocks.push(currentBlock)
    }

    currentBlock.items.push(eventItem)
  }

  return blocks.filter((block) => block.intent || block.items.length > 0)
}

function isCliMetaIntentSourceKind(sourceKind?: string) {
  const normalized = (sourceKind || '').trim().toLowerCase()
  return (
    normalized === 'request.started' ||
    normalized === 'thread.started' ||
    normalized === 'turn.started' ||
    normalized === 'session.connected' ||
    normalized === 'system.init' ||
    normalized === 'request.stream.completed' ||
    normalized === 'request.aborted' ||
    normalized === 'request.failed' ||
    normalized === 'turn.completed' ||
    normalized === 'turn.completed.with_warnings' ||
    normalized === 'result' ||
    normalized === 'result.with_warnings'
  )
}

function resolveCliVisualBlockTitle<T extends {
  intent?: {
    assistantChunk?: string
    detail?: string
    message: string
    sourceKind?: string
  }
  label: string
}>(block: T, index: number) {
  const assistantChunk = block.intent?.assistantChunk?.trim()
  if (assistantChunk) {
    return assistantChunk
  }
  const detail = block.intent?.detail?.trim()
  if (detail && detail !== (block.intent?.sourceKind || '').trim()) {
    return detail
  }
  if (block.intent && !isCliMetaIntentSourceKind(block.intent.sourceKind)) {
    return block.intent.message.trim() || `${block.label} ${index + 1}`
  }
  return ''
}

function isCliDiagnosticEvent(item: {
  kind?: CliLogKind
  sourceKind?: string
}) {
  const sourceKind = (item.sourceKind || '').trim().toLowerCase()
  return item.kind === 'stderr' || sourceKind.startsWith('stderr')
}

function resolveCliDiagnosticDetail(item: {
  detail?: string
  command?: string
  message: string
}) {
  return item.detail?.trim() || item.command?.trim() || item.message.trim()
}

function resolveCliOutputFamily(item: {
  kind?: CliLogKind
  sourceKind?: string
}) {
  const sourceKind = (item.sourceKind || '').trim().toLowerCase()
  if (item.kind === 'stdout' || sourceKind.startsWith('stdout')) {
    return 'stdout' as const
  }
  if (item.kind === 'stderr' || sourceKind.startsWith('stderr')) {
    return 'stderr' as const
  }
  return null
}

function canGroupCliOutputEvents(
  left: {
    kind?: CliLogKind
    sourceKind?: string
    createdAt: number
  },
  right: {
    kind?: CliLogKind
    sourceKind?: string
    createdAt: number
  }
) {
  return (
    resolveCliOutputFamily(left) === resolveCliOutputFamily(right) &&
    (left.sourceKind || '').trim().toLowerCase() === (right.sourceKind || '').trim().toLowerCase() &&
    Math.abs(left.createdAt - right.createdAt) <= 3000
  )
}

function resolveCliOutputGroupTitle(items: Array<{
  kind?: CliLogKind
  sourceKind?: string
  detail?: string
}>) {
  const family = resolveCliOutputFamily(items[0] || {})
  if (family === 'stderr') {
    return `同类 stderr ${items.length} 条`
  }
  if (family === 'stdout') {
    return `同类 stdout ${items.length} 条`
  }
  return `同类输出 ${items.length} 条`
}

function resolveCliOutputGroupSummary(items: Array<{
  kind?: CliLogKind
  sourceKind?: string
  detail?: string
}>) {
  const family = resolveCliOutputFamily(items[0] || {})
  if (family === 'stderr') {
    return resolveCliDiagnosticSummary(items)
  }
  return '执行输出'
}

function resolveCliDiagnosticSummary(items: Array<{
  sourceKind?: string
  detail?: string
}>) {
  const sourceKinds = items.map((item) => (item.sourceKind || '').trim().toLowerCase())
  if (sourceKinds.every((item) => item.startsWith('stderr.command'))) {
    return '执行细节：命令返回了路径、参数或文件状态'
  }
  if (sourceKinds.every((item) => item.startsWith('stderr.stdin.idle'))) {
    return '执行细节：CLI 正在等待交互输入或权限确认'
  }
  if (sourceKinds.every((item) => item.startsWith('stderr.warn'))) {
    return '执行细节：CLI 返回了警告信息'
  }
  const matchedDetail = items
    .map((item) => item.detail?.trim() || '')
    .find((item) => /error|failed|not found|invalid|拒绝|blocked/i.test(item))
  if (matchedDetail) {
    return '执行细节'
  }
  return '执行细节'
}

function resolveCliOutputGroupHeadline(items: Array<{
  sourceKind?: string
  detail?: string
  command?: string
  message: string
}>) {
  const detailLines = items
    .map((item) => resolveCliDiagnosticDetail(item))
    .flatMap((item) => item.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
  const firstErrorLine = detailLines.find((line) =>
    /error|failed|eperm|enoent|invalid config|proxy|ts\d+|exit code/i.test(line),
  )
  if (firstErrorLine) {
    return firstErrorLine
  }
  return detailLines[0] || resolveCliDiagnosticSummary(items)
}

function summarizeCliBlockRows(rows: Array<
  | { type: 'event'; id: string; event: { kind?: CliLogKind; interaction?: CliInteractionPrompt } }
  | { type: 'output'; id: string; items: Array<{ kind?: CliLogKind; interaction?: CliInteractionPrompt; sourceKind?: string }> }
>) {
  let commandCount = 0
  let toolCount = 0
  let interactionCount = 0
  let stderrGroupCount = 0
  let stderrItemCount = 0
  let stdoutGroupCount = 0
  let stdoutItemCount = 0

  for (const row of rows) {
    if (row.type === 'output') {
      const family = resolveCliOutputFamily(row.items[0] || {})
      if (family === 'stderr') {
        stderrGroupCount += 1
        stderrItemCount += row.items.length
      } else if (family === 'stdout') {
        stdoutGroupCount += 1
        stdoutItemCount += row.items.length
      }
      continue
    }
    if (row.event.interaction) {
      interactionCount += 1
    }
    if (row.event.kind === 'command') {
      commandCount += 1
    } else if (row.event.kind === 'tool') {
      toolCount += 1
    }
  }

  return [
    commandCount > 0 ? `命令 ${commandCount}` : '',
    toolCount > 0 ? `工具 ${toolCount}` : '',
    stdoutGroupCount > 0 ? `stdout ${stdoutGroupCount} 组/${stdoutItemCount} 条` : '',
    stderrGroupCount > 0 ? `stderr ${stderrGroupCount} 组/${stderrItemCount} 条` : '',
    interactionCount > 0 ? `确认 ${interactionCount}` : '',
  ].filter(Boolean).join(' · ')
}

function summarizeCliEventTotals(events: Array<{ kind?: CliLogKind; interaction?: CliInteractionPrompt }>) {
  let intentCount = 0
  let commandCount = 0
  let toolCount = 0
  let diagnosticCount = 0
  let interactionCount = 0

  for (const eventItem of events) {
    if (isCliIntentEvent(eventItem)) {
      intentCount += 1
      continue
    }
    if (isCliDiagnosticEvent(eventItem)) {
      diagnosticCount += 1
      continue
    }
    if (eventItem.interaction) {
      interactionCount += 1
    }
    if (eventItem.kind === 'command') {
      commandCount += 1
    } else if (eventItem.kind === 'tool') {
      toolCount += 1
    }
  }

  return {
    intentCount,
    commandCount,
    toolCount,
    diagnosticCount,
    interactionCount,
  }
}

function serializeCliLogEvent(item: {
  kind?: CliLogKind
  sourceKind?: string
  message: string
  command?: string
  detail?: string
  exitCode?: number
  interaction?: CliInteractionPrompt
}) {
  const kindLabel = resolveCliLogKindLabel(item.kind)
  return [
    kindLabel ? `[${kindLabel}] ${item.message}` : item.message,
    item.sourceKind ? `sourceKind: ${item.sourceKind}` : '',
    item.command ? `command:\n${item.command}` : '',
    item.interaction ? `interactionStatus: ${item.interaction.status}` : '',
    item.detail ? `detail:\n${item.detail}` : '',
    item.exitCode !== undefined ? `exitCode: ${item.exitCode}` : '',
  ].filter(Boolean).join('\n\n')
}

function buildCliLogFilesSignature(files?: CliFileChange[]) {
  if (!files?.length) {
    return ''
  }
  return files.map((item) => `${item.kind}:${item.path}:${item.diff || item.content || ''}`).join('|')
}

function buildCliInteractionSignature(interaction?: CliInteractionPrompt) {
  if (!interaction) {
    return ''
  }
  return [
    interaction.id,
    interaction.kind,
    interaction.status,
    interaction.title,
    interaction.message,
    interaction.command,
  ].filter(Boolean).join('|')
}

function isSameCliLogEntry(left?: CliLogEntry, right?: CliLogEntry) {
  if (!left || !right) {
    return false
  }
  return (
    left.level === right.level &&
    left.logKind === right.logKind &&
    left.sourceKind === right.sourceKind &&
    left.content === right.content &&
    left.assistantChunk === right.assistantChunk &&
    left.indentLevel === right.indentLevel &&
    left.detail === right.detail &&
    left.command === right.command &&
    left.exitCode === right.exitCode &&
    buildCliInteractionSignature(left.interaction) === buildCliInteractionSignature(right.interaction) &&
    buildCliLogFilesSignature(left.files) === buildCliLogFilesSignature(right.files)
  )
}

function PasswordField(props: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onEnter?: () => void
}) {
  const { value, placeholder, onChange, onEnter } = props
  const [revealed, setRevealed] = useState(false)

  return (
    <div className='password-field'>
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault()
            onEnter()
          }
        }}
        placeholder={placeholder}
      />
      <button
        className='password-toggle'
        type='button'
        aria-label={revealed ? '松开隐藏密码' : '按住查看密码'}
        onPointerDown={(event) => {
          event.preventDefault()
          setRevealed(true)
        }}
        onPointerUp={() => setRevealed(false)}
        onPointerLeave={() => setRevealed(false)}
        onPointerCancel={() => setRevealed(false)}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            setRevealed(true)
          }
        }}
        onKeyUp={() => setRevealed(false)}
        onBlur={() => setRevealed(false)}
      >
        {revealed ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
    </div>
  )
}

function EmptyState(props: { title: string; description: string; icon?: typeof Bot }) {
  const { title, description, icon: Icon = MessageSquareText } = props
  return (
    <div className='empty-card'>
      <Icon size={20} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

function AssistantsChatWorkspace(props: {
  toast: (message: string) => void
  active: boolean
}) {
  const { toast, active } = props
  const performanceMode = useAppPerformanceMode()
  const [models, setModels] = useState<ChatModelOption[]>([])
  const [favoriteModels, setFavoriteModels] = useState<string[]>(() => loadFavoriteModels('oneapi-desktop-chat-favorites'))
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>(() => loadStoredChatSessions())
  const [activeSessionId, setActiveSessionId] = useState(() =>
    readJsonStorage<string>(CHAT_ACTIVE_SESSION_STORAGE_KEY, '')
  )
  const [draft, setDraft] = useState('')
  const chatPromptHistory = useComposerPromptHistory(CHAT_PROMPT_HISTORY_STORAGE_KEY)
  const [selectedModel, setSelectedModel] = useState(() =>
    readJsonStorage<string>('oneapi-desktop-chat-selected-model', '')
  )
  const [selectedGroup, setSelectedGroup] = useState('')
  const [sending, setSending] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [hiddenChatSessionIds, setHiddenChatSessionIds] = useState<string[]>(() =>
    readJsonStorage<string[]>('oneapi-desktop-chat-hidden-sessions', [])
  )
  const [pinnedChatGroups, setPinnedChatGroups] = useState<string[]>(() =>
    readJsonStorage<string[]>('oneapi-desktop-chat-pinned-groups', [])
  )
  const [historyVisibilityTab, setHistoryVisibilityTab] = useState<HistoryVisibilityTab>('visible')
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [translationState, setTranslationState] = useState<{
    sourceText: string
    translatedText: string
    loading: boolean
  } | null>(null)
  const [renamingChatSession, setRenamingChatSession] = useState<SessionRenameDraft>(null)
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelVendorFilter, setModelVendorFilter] = useState<ModelVendorFilter>('all')
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [assistantSearch, setAssistantSearch] = useState('')
  const [assistantMenuMode, setAssistantMenuMode] = useState<'list' | 'create' | 'edit'>('list')
  const [editingAssistantId, setEditingAssistantId] = useState('')
  const [assistantName, setAssistantName] = useState('')
  const [assistantDescription, setAssistantDescription] = useState('')
  const [assistantPrompt, setAssistantPrompt] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState(() =>
    readJsonStorage<string>(CHAT_REASONING_STORAGE_KEY, 'medium')
  )
  const [contextWindow, setContextWindow] = useState<ChatContextWindow>(() =>
    readJsonStorage<ChatContextWindow>(CHAT_CONTEXT_WINDOW_STORAGE_KEY, 20)
  )
  const [initialAssistantsState] = useState(loadInitialAssistantsState)
  const [assistants, setAssistants] = useState(initialAssistantsState.assistants)
  const [activeAssistantId, setActiveAssistantId] = useState(initialAssistantsState.activeAssistantId)
  const [assistantFavorites, setAssistantFavorites] = useState<string[]>(() =>
    loadFavoriteModels(ASSISTANT_FAVORITES_STORAGE_KEY)
  )
  const {
    attachments,
    inputRef: attachmentInputRef,
    clearAttachments,
    removeAttachment,
    handleInputChange: handleAttachmentInputChange,
    handlePaste: handleAttachmentPaste,
    handleDrop: handleAttachmentDrop,
  } = useComposerAttachments(toast)
  const { preview: attachmentPreview, setPreview: setAttachmentPreview, openPreview: openAttachmentPreview } = useAttachmentPreview(toast)
  const { ref: draftRef, resize: resizeDraft } = useAutosizeTextarea(draft)
  const assistantMenuRef = useRef<HTMLDivElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const reasoningMenuRef = useRef<HTMLDivElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const messageStreamRef = useRef<HTMLDivElement | null>(null)
  const hydratedSessionIdRef = useRef('')
  const pendingRequestIdRef = useRef('')
  const pendingStreamAbortRef = useRef<AbortController | null>(null)
  const stoppingRef = useRef(false)
  const persistChatSessionsTimerRef = useRef<number | null>(null)
  const persistChatHistoryTimerRef = useRef<number | null>(null)
  const closeChatHistoryPanel = useCallback(() => {
    setHistoryOpen(false)
    setSessionContextMenu(null)
  }, [])

  const activeAssistant = useMemo(
    () => assistants.find((item) => item.id === activeAssistantId) ?? assistants[0] ?? null,
    [assistants, activeAssistantId]
  )
  const assistantMenuItems = useMemo(
    () => decorateAssistants(assistants, assistantFavorites, assistantSearch),
    [assistantFavorites, assistantSearch, assistants]
  )

  useEffect(() => {
    let disposed = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const device = await getLocalMobileBridgeDevice()
          if (disposed || !device.deviceId) {
            return
          }
          await syncMobileDesktopAssistantsSnapshot(device.deviceId, 'chat', assistants.map((item) => ({
            id: item.id,
            scope: 'chat',
            name: item.name,
            description: item.description,
            prompt: item.prompt,
            model: item.model,
            temperature: item.temperature,
          })))
        } catch {
          // Assistant snapshots are best-effort; the Android app keeps built-in fallbacks.
        }
      })()
    }, 800)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [assistants])

  const resolvedActiveSessionId =
    activeSessionId && chatSessions.some((item) => item.id === activeSessionId)
      ? activeSessionId
      : chatSessions[0]?.id || ''
  const activeSession = useMemo(
    () => chatSessions.find((item) => item.id === resolvedActiveSessionId) ?? null,
    [chatSessions, resolvedActiveSessionId]
  )
  const messages = activeSession?.messages || []
  const compatibleChatModels = useMemo(
    () => prioritizeFavoriteModels(filterAssistantModels('chat', withFavoriteFlag(models, favoriteModels))),
    [favoriteModels, models]
  )
  const chatModeModels = compatibleChatModels
  const chatModelVendorFilterOptions = useMemo(
    () =>
      MODEL_VENDOR_FILTER_OPTIONS.filter((item) => {
        if (item.value === 'all') {
          return chatModeModels.length > 0
        }
        return filterModelsByVendor(chatModeModels, item.value).length > 0
      }),
    [chatModeModels]
  )
  const effectiveModelVendorFilter = useMemo(
    () => (chatModelVendorFilterOptions.some((item) => item.value === modelVendorFilter) ? modelVendorFilter : 'all'),
    [chatModelVendorFilterOptions, modelVendorFilter]
  )
  const visibleChatModeModels = useMemo(
    () => filterModelsByVendor(chatModeModels, effectiveModelVendorFilter),
    [chatModeModels, effectiveModelVendorFilter]
  )
  const selectedReasoningLabel =
    CHAT_REASONING_OPTIONS.find((item) => item.value === reasoningEffort)?.label || reasoningEffort
  const selectedContextWindowLabel =
    CHAT_CONTEXT_WINDOW_OPTIONS.find((item) => item.value === contextWindow)?.label || `${contextWindow}`

  const activeModelLabel = useMemo(
    () =>
      chatModeModels.find((item) => item.value === selectedModel)?.label ||
      selectedModel ||
      activeAssistant?.model ||
      '默认模型',
    [activeAssistant?.model, chatModeModels, selectedModel]
  )
  const assistantMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(
        assistants.flatMap((item) => [item.name, item.description]),
        { min: 320, max: 420, padding: 96, itemCount: assistants.length, rowHeight: 50, maxListHeight: 420 }
      ),
    [assistants]
  )
  const chatModelMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(
        [
          ...chatModeModels.flatMap((item) => [item.label, item.value]),
          ...chatModelVendorFilterOptions.map((item) => item.label),
          '切换当前对话所用模型',
        ],
        { min: 260, max: 460, padding: 112, itemCount: chatModeModels.length, rowHeight: 42, maxListHeight: 260 }
      ),
    [chatModeModels, chatModelVendorFilterOptions]
  )
  const chatReasoningMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(CHAT_REASONING_OPTIONS.map((item) => item.label), {
        min: 188,
        max: 260,
        itemCount: CHAT_REASONING_OPTIONS.length,
        rowHeight: 46,
        maxListHeight: 260,
      }),
    []
  )
  const chatContextMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(CHAT_CONTEXT_WINDOW_OPTIONS.map((item) => item.label), {
        min: 188,
        max: 260,
        itemCount: CHAT_CONTEXT_WINDOW_OPTIONS.length,
        rowHeight: 46,
        maxListHeight: 220,
      }),
    []
  )
  const visibleChatSessions = useMemo(
    () => chatSessions.filter((item) => !hiddenChatSessionIds.includes(item.id)),
    [chatSessions, hiddenChatSessionIds]
  )
  const hiddenChatSessions = useMemo(
    () => chatSessions.filter((item) => hiddenChatSessionIds.includes(item.id)),
    [chatSessions, hiddenChatSessionIds]
  )
  const historySessions = historyVisibilityTab === 'hidden' ? hiddenChatSessions : visibleChatSessions

  const scrollChatToLatest = useAutoFollowScroll(messageStreamRef, [messages, sending])

  const ensureChatSessionRemainder = useCallback((remaining: ChatSessionRecord[]) => {
    if (remaining.length) {
      return remaining
    }
    return [
      createDefaultChatSession(
        resolveExistingAssistantId(assistants, activeAssistantId),
        selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model),
        selectedGroup
      ),
    ]
  }, [activeAssistant?.model, activeAssistantId, assistants, models, selectedGroup, selectedModel])

  const removeChatSessions = useCallback((sessionIds: string[]) => {
    const removeSet = new Set(sessionIds)
    let nextActiveSessionId = ''
    setChatSessions((current) => {
      const remaining = ensureChatSessionRemainder(current.filter((item) => !removeSet.has(item.id)))
      nextActiveSessionId = remaining[0]?.id || ''
      return remaining
    })
    setHiddenChatSessionIds((current) => current.filter((item) => !removeSet.has(item)))
    if (removeSet.has(resolvedActiveSessionId)) {
      setActiveSessionId(nextActiveSessionId)
    }
  }, [ensureChatSessionRemainder, resolvedActiveSessionId])

  const exportChatSession = useCallback(async (session: ChatSessionRecord) => {
    try {
      const content = buildChatSessionExportMarkdown({
        title: session.title,
        updatedAt: session.updatedAt,
        messages: session.messages,
      })
      const result = await exportTextFile(
        buildSessionExportFileName('chat', session.title || '聊天会话'),
        content,
        '导出聊天会话'
      )
      toast(`已导出到：${result.path}`)
    } catch (error) {
      if (error instanceof Error && error.message === '已取消导出。') {
        return
      }
      toast(error instanceof Error ? error.message : '导出会话失败')
    }
  }, [toast])

  const requestChatSelectionTranslation = useCallback(async (sourceText: string) => {
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
      const resolvedModel = selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model)
      if (!resolvedModel) {
        throw new Error('当前没有可用于翻译的模型。')
      }

      const response = await sendChatCompletion({
        model: resolvedModel,
        group: selectedGroup || undefined,
        messages: [
          {
            role: 'system',
            content: '你是专业翻译助手。请将用户给出的文本准确翻译成简体中文，保留原有格式、代码块、列表、链接和换行，不要添加解释。',
          },
          {
            role: 'user',
            content: normalizedText,
          },
        ],
        temperature: 0.1,
      })

      const translatedText = response.choices?.[0]?.message?.content?.trim() || ''
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
  }, [activeAssistant, models, selectedGroup, selectedModel, toast])

  useEffect(() => {
    if (!active) {
      return
    }

    return onTranslateSelectionRequested((payload) => {
      void requestChatSelectionTranslation(payload.text)
    })
  }, [active, requestChatSelectionTranslation])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextModels, nextGroups] = await Promise.all([
          getUserModels(),
          getUserGroups(),
        ])

        if (disposed) {
          return
        }

        const filteredModels = filterAssistantModels('chat', nextModels)
        setModels(filteredModels)
        setSelectedModel((current) =>
          current || resolvePreferredModel(filteredModels, DEFAULT_CHAT_MODEL, activeAssistant?.model)
        )
        setSelectedGroup((current) => current || nextGroups[0]?.value || '')
        setChatSessions((current) => {
          if (current.length > 0) {
            return current
          }

          return [
            createDefaultChatSession(
              activeAssistant?.id || initialAssistantsState.assistants[0]?.id || '',
              resolvePreferredModel(nextModels, DEFAULT_CHAT_MODEL, activeAssistant?.model),
              nextGroups[0]?.value || ''
            ),
          ]
        })
      } catch (error) {
        if (!disposed) {
          toast(error instanceof Error ? error.message : '加载聊天配置失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [activeAssistant?.id, activeAssistant?.model, initialAssistantsState.assistants, toast])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (isAssistantHistoryTriggerTarget(event.target)) {
        return
      }

      if (assistantMenuOpen && assistantMenuRef.current && !assistantMenuRef.current.contains(target)) {
        setAssistantMenuOpen(false)
        setAssistantMenuMode('list')
      }

      if (modelMenuOpen && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setModelMenuOpen(false)
      }

      if (reasoningMenuOpen && reasoningMenuRef.current && !reasoningMenuRef.current.contains(target)) {
        setReasoningMenuOpen(false)
      }

      if (contextMenuOpen && contextMenuRef.current && !contextMenuRef.current.contains(target)) {
        setContextMenuOpen(false)
      }

      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        closeChatHistoryPanel()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [assistantMenuOpen, closeChatHistoryPanel, contextMenuOpen, historyOpen, modelMenuOpen, reasoningMenuOpen])

  useEffect(() => {
    function handleOpenHistory() {
      setContextMenuOpen(false)
      setHistoryOpen((current) => {
        if (current) {
          setSessionContextMenu(null)
        }
        return !current
      })
    }
    window.addEventListener('oneapi:open-assistant-history', handleOpenHistory as EventListener)
    return () => window.removeEventListener('oneapi:open-assistant-history', handleOpenHistory as EventListener)
  }, [])

  useEffect(() => {
    const hasPending = chatSessions.some((session) => session.messages.some((item) => item.pending))
    if (persistChatSessionsTimerRef.current) {
      window.clearTimeout(persistChatSessionsTimerRef.current)
    }
    const persistDelay = performanceMode === 'efficiency' ? (hasPending ? 900 : 450) : (hasPending ? 220 : 80)
    persistChatSessionsTimerRef.current = window.setTimeout(() => {
      writeJsonStorage(CHAT_SESSIONS_STORAGE_KEY, chatSessions)
      persistChatSessionsTimerRef.current = null
    }, persistDelay)

    return () => {
      if (persistChatSessionsTimerRef.current) {
        window.clearTimeout(persistChatSessionsTimerRef.current)
        persistChatSessionsTimerRef.current = null
      }
    }
  }, [chatSessions, performanceMode])

  useEffect(() => {
    writeJsonStorage(CHAT_ACTIVE_SESSION_STORAGE_KEY, resolvedActiveSessionId)
  }, [resolvedActiveSessionId])

  useEffect(() => {
    const hasPending = chatSessions.some((session) => session.messages.some((item) => item.pending))
    if (persistChatHistoryTimerRef.current) {
      window.clearTimeout(persistChatHistoryTimerRef.current)
    }
    const persistDelay = performanceMode === 'efficiency' ? (hasPending ? 1200 : 700) : (hasPending ? 360 : 120)
    persistChatHistoryTimerRef.current = window.setTimeout(() => {
      void syncAssistantHistory(
        'chat',
        chatSessions.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          data: JSON.stringify(session),
        }))
      )
      persistChatHistoryTimerRef.current = null
    }, persistDelay)

    return () => {
      if (persistChatHistoryTimerRef.current) {
        window.clearTimeout(persistChatHistoryTimerRef.current)
        persistChatHistoryTimerRef.current = null
      }
    }
  }, [chatSessions, performanceMode])

  useEffect(() => {
    writeJsonStorage(CHAT_REASONING_STORAGE_KEY, reasoningEffort)
  }, [reasoningEffort])

  useEffect(() => {
    writeJsonStorage(CHAT_CONTEXT_WINDOW_STORAGE_KEY, contextWindow)
  }, [contextWindow])

  useEffect(() => {
    writeJsonStorage('oneapi-desktop-chat-hidden-sessions', hiddenChatSessionIds)
  }, [hiddenChatSessionIds])

  useEffect(() => {
    writeJsonStorage('oneapi-desktop-chat-pinned-groups', pinnedChatGroups)
  }, [pinnedChatGroups])

  useEffect(() => {
    if (!activeSession?.id || hydratedSessionIdRef.current === activeSession.id) {
      return
    }

    hydratedSessionIdRef.current = activeSession.id
    setSelectedModel(
      activeSession.model || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model)
    )
    setSelectedGroup(activeSession.group || '')
  }, [activeAssistant?.model, activeSession?.group, activeSession?.id, activeSession?.model, models])

  function resetAssistantEditor() {
    setAssistantName('')
    setAssistantDescription('')
    setAssistantPrompt('')
    setEditingAssistantId('')
  }

  function openAssistantCreateEditor() {
    resetAssistantEditor()
    setAssistantMenuMode('create')
    window.setTimeout(() => {
      const target = assistantMenuRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '.assistant-editor input, .assistant-editor textarea'
      )
      target?.focus()
    }, 0)
  }

  function openAssistantEditEditor(assistantId: string) {
    const target = assistants.find((item) => item.id === assistantId)
    if (!target) {
      return
    }
    setEditingAssistantId(target.id)
    setAssistantName(target.name)
    setAssistantDescription(target.description)
    setAssistantPrompt(target.prompt)
    setAssistantMenuMode('edit')
    window.setTimeout(() => {
      const targetNode = assistantMenuRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '.assistant-editor input, .assistant-editor textarea'
      )
      targetNode?.focus()
    }, 0)
  }

  function closeAssistantEditor() {
    setAssistantMenuMode('list')
    resetAssistantEditor()
  }

  function handleSaveAssistant() {
    if (!assistantName.trim() || !assistantPrompt.trim()) {
      toast('请填写助手名称和提示词。')
      return
    }

    const normalizedName = assistantName.trim()
    const normalizedDescription = assistantDescription.trim() || '自定义助手'
    const normalizedPrompt = assistantPrompt.trim()
    const editingTarget =
      editingAssistantId
        ? assistants.find((item) => item.id === editingAssistantId)
        : null

    const next = editingTarget
      ? {
          ...editingTarget,
          name: normalizedName,
          description: normalizedDescription,
          prompt: normalizedPrompt,
          updatedAt: Date.now(),
        }
      : createAssistant({
          name: normalizedName,
          description: normalizedDescription,
          prompt: normalizedPrompt,
          model: selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL),
          temperature: 0.7,
        })

    const all = editingTarget
      ? assistants.map((item) => (item.id === editingTarget.id ? next : item))
      : [next, ...assistants]
    setAssistants(all)
    saveAssistants(all)
    setActiveAssistantId(next.id)
    saveActiveAssistantId(next.id)
    closeAssistantEditor()
    setAssistantSearch('')
    toast(editingTarget ? '助手已更新。' : '自定义助手已创建。')
  }

  function createChatSession() {
    const next = createDefaultChatSession(
      activeAssistantId,
      selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model),
      selectedGroup
    )
    setChatSessions((current) => [next, ...current])
    setActiveSessionId(next.id)
    setDraft('')
    chatPromptHistory.syncInputValue('')
    window.setTimeout(() => resizeDraft(), 0)
    closeChatHistoryPanel()
  }

  function handleSwitchAssistant(nextAssistantId: string) {
    const nextAssistant = assistants.find((item) => item.id === nextAssistantId)
    if (!nextAssistant) {
      return
    }

    const nextModel = selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, nextAssistant.model)

    setActiveAssistantId(nextAssistantId)
    saveActiveAssistantId(nextAssistantId)
    setSelectedModel(nextModel)

    if (shouldCreateAssistantSwitchChatSession(activeSession, nextAssistantId)) {
      const nextSession = createDefaultChatSession(nextAssistantId, nextModel, selectedGroup)
      setChatSessions((current) => [nextSession, ...current])
      setActiveSessionId(nextSession.id)
    } else if (activeSession && activeSession.assistantId !== nextAssistantId) {
      setChatSessions((current) =>
        current
          .map((item) =>
            item.id === resolvedActiveSessionId
              ? applyAssistantSelectionToEmptyChatSession(item, nextAssistantId, nextModel, selectedGroup)
              : item
          )
          .sort((left, right) => right.updatedAt - left.updatedAt)
      )
    }

    setDraft('')
    chatPromptHistory.syncInputValue('')
    window.setTimeout(() => resizeDraft(), 0)
    setAssistantMenuMode('list')
    setAssistantMenuOpen(false)
    setAssistantSearch('')
  }

  function toggleFavoriteModel(value: string) {
    setFavoriteModels((current) => {
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [value, ...current]
      storeFavoriteModels('oneapi-desktop-chat-favorites', next)
      return next
    })
  }

  function toggleFavoriteAssistant(value: string) {
    setAssistantFavorites((current) => {
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [value, ...current.filter((item) => item !== value)]
      storeFavoriteModels(ASSISTANT_FAVORITES_STORAGE_KEY, next)
      return next
    })
  }

  function handleAssistantContextMenu(event: MouseEvent, assistantId: string) {
    event.preventDefault()
    const target = assistants.find((item) => item.id === assistantId)
    if (!target) {
      return
    }
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: target.name,
      items: [
        {
          key: 'edit',
          label: '编辑',
          onSelect: () => openAssistantEditEditor(target.id),
        },
      ],
    })
  }

  function syncActiveSession(
    updater: (session: ChatSessionRecord) => ChatSessionRecord | null
  ) {
    if (!resolvedActiveSessionId) {
      return
    }

    setChatSessions((current) =>
      current
        .map((item) => {
          if (item.id !== resolvedActiveSessionId) {
            return item
          }
          return updater(item) ?? item
        })
        .sort((left, right) => right.updatedAt - left.updatedAt)
    )
  }

  async function handleSendMessage(nextDraft?: string) {
    const normalizedDraft = (nextDraft ?? draft).trim()
    if (!normalizedDraft || sending || !resolvedActiveSessionId) {
      return
    }

    const preferredModel = selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model)
    const resolvedModel = resolveChatModelForAttachments(selectedModel, preferredModel, chatModeModels, attachments)
    if (!resolvedModel) {
      toast('当前没有可用模型。')
      return
    }
    const resolvedModelLabel =
      chatModeModels.find((item) => item.value === resolvedModel)?.label ||
      models.find((item) => item.value === resolvedModel)?.label ||
      resolvedModel
    const createdAt = new Date().getTime()
    const requestId = `chat-${createdAt}`
    const pendingAssistantId = `assistant-pending-${requestId}`
    const userMessageContent = normalizedDraft
    const persistedRequestContent = buildPersistedChatRequestContent(userMessageContent, attachments)
    const userMessage: ChatMessage = {
      id: `user-${createdAt}`,
      role: 'user',
      content: userMessageContent,
      requestContent: persistedRequestContent,
      createdAt,
      attachments: toMessageAttachments(attachments),
    }
    const pendingAssistantMessage: ChatBubbleMessage = {
      id: pendingAssistantId,
      role: 'assistant',
      content: CHAT_PENDING_MESSAGE_LABEL,
      createdAt: createdAt + 1,
      modelLabel: resolvedModelLabel,
      pending: true,
    }

    const historyBase = contextWindow === 'all' ? messages : messages.slice(-contextWindow)
    const requestHistory = [...historyBase, userMessage]
    const renderedHistory = [...messages, userMessage, pendingAssistantMessage]
    syncActiveSession((session) => ({
      ...session,
      assistantId: activeAssistant?.id || session.assistantId,
      model: resolvedModel,
      group: selectedGroup,
      updatedAt: Date.now(),
      title: clipText(userMessage.content.replace(/\s+/g, ' '), 24) || session.title,
      messages: renderedHistory,
    }))
    scrollChatToLatest()
    pendingRequestIdRef.current = requestId
    stoppingRef.current = false
    chatPromptHistory.commitInputValue(userMessageContent)
    setDraft('')
    clearAttachments()
    window.setTimeout(() => resizeDraft(), 0)
    setSending(true)
    let streamedAssistantText = ''
    let streamedReasoningText = ''
    let streamedUsageData: ChatMessage['usage'] | undefined

    const syncPendingAssistantMessage = (reasoningStreamComplete = false) => {
      const displayState = resolvePendingReasoningState(
        streamedAssistantText,
        streamedReasoningText,
        reasoningStreamComplete
      )
      const visibleContent = displayState.visibleContent
      const reasoningContent = displayState.reasoningContent.trim()
      const hasVisibleContent = visibleContent.trim().length > 0

      syncActiveSession((session) => ({
        ...session,
        assistantId: activeAssistant?.id || session.assistantId,
        model: resolvedModel,
        group: selectedGroup,
        updatedAt: Date.now(),
        messages: session.messages.map((item) =>
          item.id === pendingAssistantId
            ? {
                ...item,
                content: hasVisibleContent ? visibleContent : CHAT_PENDING_MESSAGE_LABEL,
                reasoningContent: reasoningContent || undefined,
                reasoningPending: displayState.reasoningPending,
                createdAt: Date.now(),
              }
            : item
        ),
      }))
    }

    try {
      if (isImageGenerationModel(resolvedModel)) {
        const response = await sendImageGeneration(
          {
            model: resolvedModel,
            group: selectedGroup || undefined,
            prompt: normalizedDraft,
            n: 1,
            response_format: 'b64_json',
          },
          { requestId }
        )
        const resolvedImage = resolveImageGenerationResult(response, normalizedDraft)
        if (!resolvedImage) {
          throw new Error('图片生成失败')
        }

        syncActiveSession((session) => ({
          ...session,
          assistantId: activeAssistant?.id || session.assistantId,
          model: resolvedModel,
          group: selectedGroup,
          updatedAt: Date.now(),
          messages: session.messages.map((item) =>
            item.id === pendingAssistantId
              ? {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: resolvedImage.prompt,
                  createdAt: Date.now(),
                  imageUrl: resolvedImage.imageUrl,
                  modelLabel: resolvedModelLabel,
                }
              : item
          ),
        }))
      } else {
        const systemMessage = toAssistantSystemMessage(activeAssistant)
        const requestHasAttachments = attachments.some((item) => item.dataBase64)
        const chatRequestPayload = {
          model: resolvedModel,
          group: selectedGroup || undefined,
          promptCacheKey: shouldAttachPromptCacheKey(resolvedModel) && !requestHasAttachments
            ? resolvedActiveSessionId
            : undefined,
          temperature: activeAssistant?.temperature ?? 0.7,
          reasoningEffort,
          messages: [
            ...(systemMessage ? [systemMessage] : []),
            ...requestHistory.map((item) => ({
              role: item.role,
              content:
                item.id === userMessage.id
                  ? buildChatAttachmentContent(item.content, attachments)
                  : resolveChatMessageRequestContent(item),
            })),
          ],
        }
        const abortController = new AbortController()
        pendingStreamAbortRef.current = abortController

        await streamChatCompletion(
          chatRequestPayload,
          {
            requestId,
            signal: abortController.signal,
            onDelta: (text) => {
              streamedAssistantText += text
              syncPendingAssistantMessage()
            },
            onReasoningDelta: (text) => {
              streamedReasoningText += text
              syncPendingAssistantMessage()
            },
            onDone: (usage) => {
              streamedUsageData = usage
            },
          }
        )

        const finalDisplayState = resolvePendingReasoningState(
          streamedAssistantText,
          streamedReasoningText,
          true
        )
        let finalVisibleContent = finalDisplayState.visibleContent
        let finalReasoningContent = finalDisplayState.reasoningContent.trim()
        let hasFinalVisibleContent = finalVisibleContent.trim().length > 0

        if (!hasFinalVisibleContent && !stoppingRef.current) {
          try {
            const retryResponse = await sendChatCompletion(chatRequestPayload, { requestId: `${requestId}-fallback` })
            const retryDisplayState = deriveDesktopChatDisplayState(
              retryResponse.choices[0]?.message?.content || '',
              ''
            )
            if (retryDisplayState.visibleContent.trim()) {
              finalVisibleContent = retryDisplayState.visibleContent
              hasFinalVisibleContent = true
            }
            if (!finalReasoningContent && retryDisplayState.reasoningContent.trim()) {
              finalReasoningContent = retryDisplayState.reasoningContent.trim()
            }
            streamedUsageData = streamedUsageData || retryResponse.usage
          } catch {
            /* keep streamed result */
          }
        }

        syncActiveSession((session) => ({
          ...session,
          assistantId: activeAssistant?.id || session.assistantId,
          model: resolvedModel,
          group: selectedGroup,
          updatedAt: Date.now(),
          messages: session.messages.map((item) =>
            item.id === pendingAssistantId
              ? {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content:
                    hasFinalVisibleContent
                      ? finalVisibleContent
                      : resolveChatRetryFallbackText(!!finalReasoningContent),
                  createdAt: Date.now(),
                  reasoningContent: finalReasoningContent || undefined,
                  reasoningPending: false,
                  usage: streamedUsageData,
                  modelLabel: resolvedModelLabel,
                }
              : item
          ),
        }))
      }
    } catch (error) {
      const partialDisplayState = resolvePendingReasoningState(
        streamedAssistantText,
        streamedReasoningText,
        true
      )
      const resolvedPartialText = partialDisplayState.visibleContent
      const partialReasoningContent = partialDisplayState.reasoningContent.trim()
      const hasResolvedPartialText = resolvedPartialText.trim().length > 0
      syncActiveSession((session) => ({
        ...session,
        updatedAt: Date.now(),
        messages: hasResolvedPartialText || partialReasoningContent
          ? session.messages.map((item) =>
              item.id === pendingAssistantId
                ? {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: hasResolvedPartialText ? resolvedPartialText : '',
                    createdAt: Date.now(),
                    reasoningContent: partialReasoningContent || undefined,
                    reasoningPending: false,
                    usage: streamedUsageData,
                    modelLabel: resolvedModelLabel,
                  }
                : item
            )
          : session.messages.filter((item) => item.id !== pendingAssistantId),
      }))
      if (!stoppingRef.current && !isAbortError(error)) {
        toast(error instanceof Error ? error.message : '聊天请求失败')
      }
    } finally {
      pendingRequestIdRef.current = ''
      pendingStreamAbortRef.current = null
      stoppingRef.current = false
      setSending(false)
    }
  }

  async function handleStopMessage() {
    if (!pendingRequestIdRef.current) {
      return
    }

    stoppingRef.current = true
    try {
      pendingStreamAbortRef.current?.abort()
      await stopChatCompletion(pendingRequestIdRef.current)
      toast('已停止当前回复。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '停止失败')
    }
  }

  async function copyText(content: string) {
    try {
      await navigator.clipboard.writeText(content)
      toast('已复制到剪贴板。')
    } catch {
      toast('复制失败，请检查系统剪贴板权限。')
    }
  }

  const handleMessageSelectionContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, selectedText: string) => {
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
          onSelect: () => requestChatSelectionTranslation(selectedText),
        },
      ],
    })
  }, [copyText, requestChatSelectionTranslation])

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

  function deleteChatMessage(messageId: string) {
    syncActiveSession((session) => ({
      ...session,
      updatedAt: Date.now(),
      messages: session.messages.filter((item) => item.id !== messageId),
    }))
  }

  function deleteChatSession(sessionId: string) {
    removeChatSessions([sessionId])
    toast('已删除该聊天会话。')
  }

  function resolveAssistantHistoryGroup(session: ChatSessionRecord) {
    return assistants.find((item) => item.id === session.assistantId)?.name || assistants[0]?.name || '助手'
  }

  function deleteChatGroup(groupKey: string) {
    const sessionIds = chatSessions
      .filter((item) => resolveAssistantHistoryGroup(item) === groupKey)
      .map((item) => item.id)
    if (!sessionIds.length) {
      return
    }
    removeChatSessions(sessionIds)
    setPinnedChatGroups((current) => current.filter((item) => item !== groupKey))
    toast(`已删除“${groupKey}”分类下的 ${sessionIds.length} 个会话。`)
  }

  function hideChatSession(sessionId: string) {
    setHiddenChatSessionIds((current) => (current.includes(sessionId) ? current : [...current, sessionId]))
  }

  function unhideChatSession(sessionId: string) {
    setHiddenChatSessionIds((current) => current.filter((item) => item !== sessionId))
  }

  function togglePinnedChatGroup(groupKey: string) {
    setPinnedChatGroups((current) =>
      current.includes(groupKey)
        ? current.filter((item) => item !== groupKey)
        : [groupKey, ...current]
    )
  }

  function findReplayPrompt(messageId: string) {
    const targetIndex = messages.findIndex((item) => item.id === messageId)
    if (targetIndex < 0) {
      return ''
    }

    const target = messages[targetIndex]
    if (target.role === 'user') {
      return target.content
    }

    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        return messages[index]?.content || ''
      }
    }

    return ''
  }

  function handleSelectChatSession(session: ChatSessionRecord) {
    setActiveSessionId(session.id)
    const resolvedAssistantId = resolveExistingAssistantId(assistants, session.assistantId || activeAssistantId)
    setActiveAssistantId(resolvedAssistantId)
    saveActiveAssistantId(resolvedAssistantId)
    setSelectedModel(
      session.model || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model)
    )
    setSelectedGroup(session.group || selectedGroup)
    setDraft('')
    chatPromptHistory.syncInputValue('')
    window.setTimeout(() => resizeDraft(), 0)
    closeChatHistoryPanel()
  }

  function renameChatSession(sessionId: string) {
    const target = chatSessions.find((item) => item.id === sessionId)
    if (!target) {
      return
    }
    setRenamingChatSession({
      id: sessionId,
      value: target.title,
    })
  }

  function commitChatSessionRename(sessionId: string) {
    if (renamingChatSession?.id !== sessionId) {
      return
    }

    const nextTitle = renamingChatSession.value.trim()
    setRenamingChatSession(null)
    if (!nextTitle) {
      return
    }
    setChatSessions((current) =>
      current.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              title: nextTitle,
              updatedAt: Math.max(Date.now(), item.updatedAt),
            }
          : item
      )
    )
  }

  function openChatSessionFolder(sessionId: string) {
    void openAssistantHistoryFolder('chat', sessionId).catch((error: unknown) => {
      toast(error instanceof Error ? error.message : '打开会话目录失败')
    })
  }

  function handleChatGroupContextMenu(event: MouseEvent, groupKey: string) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: groupKey,
      scope: 'history',
      items: [
        {
          key: 'pin',
          label: pinnedChatGroups.includes(groupKey) ? '取消置顶分类' : '置顶分类',
          onSelect: () => togglePinnedChatGroup(groupKey),
        },
        {
          key: 'delete-group',
          label: '删除分类会话',
          variant: 'danger',
          onSelect: () => deleteChatGroup(groupKey),
        },
      ],
    })
  }

  function handleChatSessionContextMenu(event: MouseEvent, session: ChatSessionRecord) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: session.title,
      scope: 'history',
      items: [
        {
          key: 'rename',
          label: '重命名',
          onSelect: () => renameChatSession(session.id),
        },
        {
          key: 'open-folder',
          label: '打开文件夹',
          onSelect: () => openChatSessionFolder(session.id),
        },
        {
          key: 'export',
          label: '导出会话',
          onSelect: () => void exportChatSession(session),
        },
        {
          key: 'delete',
          label: '删除会话',
          variant: 'danger',
          onSelect: () => deleteChatSession(session.id),
        },
      ],
    })
  }

  return (
    <section className='workspace-page chat-page'>
      <div className={`chat-layout ${historyOpen ? 'history-open' : ''}`}>
        <article className='panel conversation-panel chat-panel-surface'>
          <div className='conversation-scroll-region'>
            <div className='workspace-corner-tools'>
              <ConversationFindBar active containerRef={messageStreamRef} itemSelector='.message-bubble' />
            </div>
            <div ref={messageStreamRef} className='message-stream'>
              {messages.length === 0 ? (
                <EmptyState
                  title='开始聊天'
                  description='输入问题、粘贴图片或拖拽文件后，即可开始新的助手会话。'
                  icon={Sparkles}
                />
              ) : messages.map((item) => (
                <div
                  key={item.id}
                  className={`message-bubble ${item.role} ${item.imageUrl ? 'image-bubble' : ''} ${item.pending ? 'streaming-bubble' : ''}`}
                >
                  <span className='message-role'>
                    {item.role === 'assistant'
                      ? item.modelLabel || activeModelLabel
                      : item.role === 'system'
                        ? '系统'
                        : ''}
                  </span>
                  <MessageAttachmentGallery
                    attachments={item.attachments}
                    onPreview={openAttachmentPreview}
                    onAttachmentContextMenu={(event, attachment) =>
                      showAttachmentContextMenu(event, attachment, setSessionContextMenu, openAttachmentPreview)
                    }
                  />
                  <ReasoningMessageContent
                    content={item.reasoningContent || ''}
                    pending={!!item.reasoningPending}
                    onSelectionContextMenu={handleMessageSelectionContextMenu}
                  />
                  {item.imageUrl ? (
                    <div className='chat-image-result'>
                      <img src={item.imageUrl} alt={item.content || '生成图片'} />
                    </div>
                  ) : (
                    item.pending &&
                    !item.reasoningContent?.trim() &&
                    (!item.content.trim() || item.content === CHAT_PENDING_MESSAGE_LABEL)
                      ? <PendingMessageContent label={CHAT_PENDING_MESSAGE_LABEL.replace(/\.+$/, '')} />
                      : <LazyMarkdownContent
                          content={item.content}
                          onSelectionContextMenu={handleMessageSelectionContextMenu}
                          renderMermaid={!item.pending}
                        />
                  )}
                  <BubbleMeta
                    side={item.role === 'user' ? 'right' : 'left'}
                    createdAt={item.createdAt}
                    extra={item.role === 'assistant' ? <span className='message-usage'>{formatUsageSummary(item.usage)}</span> : null}
                    actions={
                      item.role === 'system'
                        ? [
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
                              onClick: () => deleteChatMessage(item.id),
                            },
                          ]
                        : [
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
                              onClick: () => deleteChatMessage(item.id),
                            },
                            {
                              key: 'replay',
                              label: '重发',
                              icon: RotateCcw,
                              disabled: sending,
                              onClick: () => {
                                const replayPrompt = findReplayPrompt(item.id)
                                if (!replayPrompt) {
                                  toast('未找到可重新发送的提问。')
                                  return
                                }
                                void handleSendMessage(replayPrompt)
                              },
                            },
                          ]
                    }
                  />
                </div>
              ))}
            </div>
            <ConversationScrollDock active={active} containerRef={messageStreamRef} />
          </div>

          {renderComposer({
            inputRef: attachmentInputRef,
            onAttachmentInputChange: handleAttachmentInputChange,
            textareaRef: draftRef,
            value: draft,
            placeholder: '输入你的问题、任务或上下文。',
            onChange: (value) => {
              setDraft(value)
              chatPromptHistory.syncInputValue(value)
            },
            onKeyDown: (event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !sending) {
                event.preventDefault()
                void handleSendMessage()
                return
              }

              if (event.ctrlKey || event.metaKey || event.altKey) {
                return
              }
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                return
              }
              const nextValue = chatPromptHistory.recallInputValue(
                event.key === 'ArrowUp' ? 'up' : 'down',
                draft
              )
              if (nextValue === draft) {
                return
              }
              event.preventDefault()
              setDraft(nextValue)
              window.setTimeout(() => focusTextareaToEnd(draftRef.current, nextValue), 0)
            },
            onPaste: handleAttachmentPaste,
            onDrop: handleAttachmentDrop,
            leftActions: [
              {
                key: 'assistant',
                node: (
                  <div className='toolbar-picker' ref={assistantMenuRef}>
                    <button
                      className='ghost-button tiny picker-trigger icon-picker-trigger'
                      type='button'
                      aria-expanded={assistantMenuOpen}
                      onClick={() => {
                        setModelMenuOpen(false)
                        setReasoningMenuOpen(false)
                        setContextMenuOpen(false)
                        setAssistantMenuOpen((current) => {
                          const next = !current
                          if (next) {
                            setAssistantSearch('')
                            setAssistantMenuMode('list')
                          }
                          return next
                        })
                      }}
                      title='助手'
                    >
                      <Sparkles size={16} />
                      <strong>{activeAssistant?.name || assistants[0]?.name || '助手'}</strong>
                    </button>
                    {assistantMenuOpen && (
                      <GlassPickerMenu className='picker-menu assistant-menu fixed-width-menu' style={assistantMenuWidthStyle}>
                        {assistantMenuMode === 'list' ? (
                          <>
                            <div className='assistant-menu-toolbar'>
                              <input
                                className='assistant-search'
                                value={assistantSearch}
                                placeholder='搜索助手'
                                autoFocus
                                onChange={(event) => setAssistantSearch(event.target.value)}
                              />
                              <button className='secondary-button tiny' type='button' onClick={openAssistantCreateEditor}>
                                <Plus size={14} />
                                <span>新建自定义助手</span>
                              </button>
                            </div>
                            <div className='picker-menu-list assistant-picker-list'>
                              {assistantMenuItems.length === 0 ? (
                                <div className='assistant-picker-empty'>未找到匹配助手</div>
                              ) : assistantMenuItems.map((item) => (
                                <div
                                  key={item.id}
                                  className='assistant-picker-row'
                                  onContextMenu={(event) => handleAssistantContextMenu(event, item.id)}
                                >
                                  <button
                                    type='button'
                                    className={`picker-option assistant-picker-option ${item.id === activeAssistantId ? 'active' : ''}`}
                                    onClick={() => handleSwitchAssistant(item.id)}
                                  >
                                    <strong>{item.name}</strong>
                                    <span>{item.description}</span>
                                  </button>
                                  <button
                                    className={`ghost-button icon-only tiny model-favorite ${item.favorite ? 'active' : ''}`}
                                    type='button'
                                    title={item.favorite ? '取消收藏' : '收藏并置顶'}
                                    aria-label={item.favorite ? '取消收藏' : '收藏并置顶'}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleFavoriteAssistant(item.id)
                                    }}
                                  >
                                    <Star size={13} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className='assistant-editor'>
                            <div className='assistant-editor-head'>
                              <strong>{assistantMenuMode === 'edit' ? '编辑助手' : '新建助手'}</strong>
                            </div>
                            <div className='assistant-editor-fields'>
                              <input
                                value={assistantName}
                                onChange={(event) => setAssistantName(event.target.value)}
                                placeholder='助手名称，例如法务助手'
                              />
                              <input
                                value={assistantDescription}
                                onChange={(event) => setAssistantDescription(event.target.value)}
                                placeholder='一句话描述'
                              />
                              <textarea
                                value={assistantPrompt}
                                onChange={(event) => setAssistantPrompt(event.target.value)}
                                placeholder='输入提示词，保存后即可作为专用助手参与聊天。'
                              />
                            </div>
                            <div className='assistant-editor-actions'>
                              <button className='ghost-button tiny' type='button' onClick={closeAssistantEditor}>
                                <span>取消</span>
                              </button>
                              <button className='secondary-button tiny' type='button' onClick={handleSaveAssistant}>
                                <span>{assistantMenuMode === 'edit' ? '保存更新' : '新建助手'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </GlassPickerMenu>
                    )}
                  </div>
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
                        setAssistantMenuOpen(false)
                        setReasoningMenuOpen(false)
                        setContextMenuOpen(false)
                        setModelMenuOpen((current) => !current)
                      }}
                      title='AI 选择'
                    >
                      <Bot size={16} />
                      <strong>{activeModelLabel}</strong>
                    </button>
                    {modelMenuOpen && (
                      <GlassPickerMenu className='picker-menu model-menu fixed-width-menu' style={chatModelMenuWidthStyle}>
                        {chatModelVendorFilterOptions.length > 1 ? (
                          <div className='picker-filter-row'>
                            {chatModelVendorFilterOptions.map((item) => (
                              <button
                                key={item.value}
                                className={`picker-filter-chip ${effectiveModelVendorFilter === item.value ? 'active' : ''}`}
                                type='button'
                                onClick={() => setModelVendorFilter(item.value)}
                              >
                                <span>{item.label}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <div className='picker-menu-list'>
                          {visibleChatModeModels.length ? (
                            visibleChatModeModels.map((item) => (
                              <button
                                key={item.value}
                                type='button'
                                className={`picker-option model-option ${item.value === selectedModel ? 'active' : ''}`}
                                onClick={() => {
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
                              </button>
                            ))
                          ) : (
                            <div className='picker-empty-state'>当前筛选下没有可用模型</div>
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
                  <div className='toolbar-picker' ref={reasoningMenuRef}>
                    <button
                      className='ghost-button tiny picker-trigger icon-picker-trigger'
                      type='button'
                      aria-expanded={reasoningMenuOpen}
                      onClick={() => {
                        setAssistantMenuOpen(false)
                        setModelMenuOpen(false)
                        setContextMenuOpen(false)
                        setReasoningMenuOpen((current) => !current)
                      }}
                      title='思考长度'
                    >
                      <Sparkles size={16} />
                      <strong>{selectedReasoningLabel}</strong>
                    </button>
                    {reasoningMenuOpen && (
                      <GlassPickerMenu className='picker-menu model-menu fixed-width-menu' style={chatReasoningMenuWidthStyle}>
                        <div className='picker-menu-list'>
                          {CHAT_REASONING_OPTIONS.map((item) => (
                            <button
                              key={item.value}
                              type='button'
                              className={`picker-option ${item.value === reasoningEffort ? 'active' : ''}`}
                              onClick={() => {
                                setReasoningEffort(item.value)
                                setReasoningMenuOpen(false)
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
                key: 'context',
                node: (
                  <div className='toolbar-picker' ref={contextMenuRef}>
                    <button
                      className='ghost-button tiny picker-trigger icon-picker-trigger'
                      type='button'
                      aria-expanded={contextMenuOpen}
                      onClick={() => {
                        setAssistantMenuOpen(false)
                        setModelMenuOpen(false)
                        setReasoningMenuOpen(false)
                        setContextMenuOpen((current) => !current)
                      }}
                      title='上下文长度'
                    >
                      <MessageSquareText size={16} />
                      <strong>{selectedContextWindowLabel}</strong>
                    </button>
                    {contextMenuOpen && (
                      <GlassPickerMenu className='picker-menu model-menu fixed-width-menu' style={chatContextMenuWidthStyle}>
                        <div className='picker-menu-list'>
                          {CHAT_CONTEXT_WINDOW_OPTIONS.map((item) => (
                            <button
                              key={String(item.value)}
                              type='button'
                              className={`picker-option ${item.value === contextWindow ? 'active' : ''}`}
                              onClick={() => {
                                setContextWindow(item.value)
                                setContextMenuOpen(false)
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
            ],
            fileAssets: attachments.map((item) => ({
              id: item.id,
              name: item.name,
              filePath: item.filePath,
              previewUrl: item.previewUrl,
              kind: item.kind,
              onPreview: () => void openAttachmentPreview(item.filePath),
              onRemove: () => removeAttachment(item.id),
            })),
            sendButton: (
              <button
                className={`primary-button icon-only send-button ${sending ? 'stop-button' : ''}`}
                type='button'
                onClick={() => void (sending ? handleStopMessage() : handleSendMessage())}
                title={sending ? '停止回复' : '发送消息（Ctrl+Enter）'}
                aria-label={sending ? '停止回复' : '发送消息（Ctrl+Enter）'}
              >
                {sending ? <Square size={14} /> : <Send size={16} />}
              </button>
            ),
          })}
        </article>

        <aside
          ref={historyPanelRef}
          className={`panel chat-history-panel ${historyOpen ? 'open' : ''}`}
          tabIndex={historyOpen ? 0 : -1}
        >
        <div className='panel-header compact'>
          <div>
          </div>
          <div className='inline-actions'>
            <button className='secondary-button tiny' type='button' onClick={createChatSession}>
                <Plus size={16} />
                <span>新对话</span>
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
            {historySessions.length === 0 ? (
              <EmptyState
                title={historyVisibilityTab === 'hidden' ? '当前没有隐藏会话' : '当前没有聊天会话'}
                description={
                  historyVisibilityTab === 'hidden'
                    ? '隐藏后的聊天会话会按助手类型显示在这里。'
                    : '发送第一条消息后，会话会出现在这里。'
                }
              />
            ) : (
              <div className='history-project-groups'>
                {orderGroupedEntries(
                  Object.entries(
                    historySessions.reduce<Record<string, ChatSessionRecord[]>>((groups, item) => {
                      const key = resolveAssistantHistoryGroup(item)
                      groups[key] = [...(groups[key] || []), item]
                      return groups
                    }, {})
                  ),
                  pinnedChatGroups
                ).map(([groupKey, items]) => (
                  <div key={groupKey} className='history-group'>
                    <div className='history-group-head' onContextMenu={(event) => handleChatGroupContextMenu(event, groupKey)}>
                      <strong>{groupKey}</strong>
                      <div className='history-group-head-actions'>
                        <span>{items.length} 条</span>
                        <button
                          className={`ghost-button icon-only tiny history-group-pin ${pinnedChatGroups.includes(groupKey) ? 'active' : ''}`}
                          type='button'
                          onClick={() => togglePinnedChatGroup(groupKey)}
                          aria-label={pinnedChatGroups.includes(groupKey) ? '取消置顶分组' : '置顶分组'}
                          title={pinnedChatGroups.includes(groupKey) ? '取消置顶' : '置顶'}
                        >
                          <Pin size={13} />
                        </button>
                      </div>
                    </div>
                    <div className='subrecords compact-records'>
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className={`record-row action-row session-row ${item.id === resolvedActiveSessionId ? 'highlighted' : ''}`}
                          role='button'
                          tabIndex={0}
                          onContextMenu={(event) => handleChatSessionContextMenu(event, item)}
                          onClick={() => {
                            if (renamingChatSession?.id !== item.id) {
                              handleSelectChatSession(item)
                            }
                          }}
                          onKeyDown={(event) => {
                            if (renamingChatSession?.id === item.id) {
                              return
                            }
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              handleSelectChatSession(item)
                            }
                          }}
                        >
                          <SessionTitleEditor
                            editing={renamingChatSession?.id === item.id}
                            value={renamingChatSession?.id === item.id ? renamingChatSession.value : ''}
                            displayValue={item.title}
                            maxLength={56}
                            onChange={(value) => setRenamingChatSession({ id: item.id, value })}
                            onCommit={() => commitChatSessionRename(item.id)}
                            onCancel={() => setRenamingChatSession(null)}
                          />
                          <small>{formatDateTime(item.updatedAt)}</small>
                          <button
                            className='ghost-button icon-only tiny session-hide-button'
                            type='button'
                            onClick={(event) => {
                              event.stopPropagation()
                              if (historyVisibilityTab === 'hidden') {
                                unhideChatSession(item.id)
                              } else {
                                hideChatSession(item.id)
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

function DrawWorkspace(props: {
  toast: (message: string) => void
  active: boolean
}) {
  const { toast, active } = props
  const performanceMode = useAppPerformanceMode()
  const [drawSessions, setDrawSessions] = useState<DrawSessionRecord[]>(() => {
    const storedSessions = loadStoredDrawSessions()
    return storedSessions.length ? storedSessions : [createDefaultDrawSession()]
  })
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const storedActiveSessionId = readJsonStorage<string>(DRAW_ACTIVE_SESSION_STORAGE_KEY, '')
    if (storedActiveSessionId.trim()) {
      return storedActiveSessionId
    }
    const storedSessions = loadStoredDrawSessions()
    return storedSessions[0]?.id || ''
  })
  const [draft, setDraft] = useState('')
  const drawPromptHistory = useComposerPromptHistory(DRAW_PROMPT_HISTORY_STORAGE_KEY)
  const [sending, setSending] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('')
  const [drawSize, setDrawSize] = useState<(typeof DRAW_SIZE_OPTIONS)[number]['value']>('1024x1024')
  const [drawQuality, setDrawQuality] = useState<(typeof DRAW_QUALITY_OPTIONS)[number]['value']>('high')
  const [drawRandomSeed, setDrawRandomSeed] = useState(true)
  const [drawSizeMenuOpen, setDrawSizeMenuOpen] = useState(false)
  const [drawQualityMenuOpen, setDrawQualityMenuOpen] = useState(false)
  const [imageStyleMenuOpen, setImageStyleMenuOpen] = useState(false)
  const [imageStyleSearch, setImageStyleSearch] = useState('')
  const [imageStyleMenuMode, setImageStyleMenuMode] = useState<'list' | 'create' | 'edit'>('list')
  const [editingImageStylePresetId, setEditingImageStylePresetId] = useState('')
  const [imageStyleTitle, setImageStyleTitle] = useState('')
  const [imageStyleCategory, setImageStyleCategory] = useState('')
  const [imageStyleDescription, setImageStyleDescription] = useState('')
  const [imageStylePrompt, setImageStylePrompt] = useState('')
  const [imageStyleSizeDraft, setImageStyleSizeDraft] = useState<(typeof DRAW_SIZE_OPTIONS)[number]['value']>('1024x1024')
  const [imageStyleQualityDraft, setImageStyleQualityDraft] = useState<(typeof DRAW_QUALITY_OPTIONS)[number]['value']>('high')
  const [imageStylePresets, setImageStylePresets] = useState<ImageStylePreset[]>(() => loadImageStylePresets())
  const [imageStyleFavorites, setImageStyleFavorites] = useState<string[]>(() =>
    loadFavoriteModels(IMAGE_STYLE_FAVORITES_STORAGE_KEY)
  )
  const [selectedImageStylePreset, setSelectedImageStylePreset] = useState<ImageStylePreset | null>(null)
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [translationState, setTranslationState] = useState<{
    sourceText: string
    translatedText: string
    loading: boolean
  } | null>(null)
  const [renamingDrawSession, setRenamingDrawSession] = useState<SessionRenameDraft>(null)
  const [previewImage, setPreviewImage] = useState<{
    src: string
    name: string
  } | null>(null)
  const [pendingRetry, setPendingRetry] = useState<PendingDrawRetryState | null>(null)
  const {
    attachments,
    inputRef: attachmentInputRef,
    clearAttachments,
    removeAttachment,
    replaceAttachments,
    handleInputChange: handleAttachmentInputChange,
    handlePaste: handleAttachmentPaste,
    handleDrop: handleAttachmentDrop,
  } = useComposerAttachments(toast)
  const { preview: attachmentPreview, setPreview: setAttachmentPreview, openPreview: openAttachmentPreview } = useAttachmentPreview(toast)
  const { ref: draftRef, resize: resizeDraft } = useAutosizeTextarea(draft)
  const retryingPendingDrawRef = useRef(false)
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const messageStreamRef = useRef<HTMLDivElement | null>(null)
  const drawSizeMenuRef = useRef<HTMLDivElement | null>(null)
  const drawQualityMenuRef = useRef<HTMLDivElement | null>(null)
  const imageStyleMenuRef = useRef<HTMLDivElement | null>(null)

  const resolvedActiveSessionId = useMemo(() => {
    if (activeSessionId && drawSessions.some((item) => item.id === activeSessionId)) {
      return activeSessionId
    }
    return drawSessions[0]?.id || ''
  }, [activeSessionId, drawSessions])
  const activeSession = drawSessions.find((item) => item.id === resolvedActiveSessionId) || null
  const messages = activeSession?.messages || []
  const drawSizeLabel =
    DRAW_SIZE_OPTIONS.find((item) => item.value === drawSize)?.label || drawSize
  const drawQualityLabel =
    DRAW_QUALITY_OPTIONS.find((item) => item.value === drawQuality)?.label || drawQuality
  const drawRandomSeedLabel = drawRandomSeed ? '随机' : '固定'
  const imageStyleMenuItems = useMemo(
    () => decorateImageStylePresets(imageStylePresets, imageStyleFavorites, imageStyleSearch),
    [imageStyleFavorites, imageStylePresets, imageStyleSearch]
  )
  const imageStyleMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(
        imageStylePresets.flatMap((item) => [
          item.title,
          item.description,
          item.category,
          `${item.title} ${item.description} ${item.category} ${item.size} ${item.quality}`,
        ]),
        {
          min: 320,
          max: 420,
          padding: 100,
          itemCount: imageStylePresets.length,
          rowHeight: 54,
          maxListHeight: 420,
        }
      ),
    [imageStylePresets]
  )
  const drawSizeMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(
        DRAW_SIZE_OPTIONS.map((item) => `${item.label} · ${item.value}`),
        { min: 190, max: 300, itemCount: DRAW_SIZE_OPTIONS.length, rowHeight: 46, maxListHeight: 220 }
      ),
    []
  )
  const drawQualityMenuWidthStyle = useMemo(
    () =>
      createPickerMenuWidthStyle(
        DRAW_QUALITY_OPTIONS.map((item) => `${item.label} · ${item.value}`),
        { min: 180, max: 260, itemCount: DRAW_QUALITY_OPTIONS.length, rowHeight: 46, maxListHeight: 180 }
      ),
    []
  )
  const imageStyleTitleById = useMemo(
    () => Object.fromEntries(imageStylePresets.map((item) => [item.id, item.title])),
    [imageStylePresets]
  )

  useEffect(() => {
    let disposed = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const device = await getLocalMobileBridgeDevice()
          if (disposed || !device.deviceId) {
            return
          }
          await syncMobileDesktopAssistantsSnapshot(device.deviceId, 'image', imageStylePresets.map((item) => ({
            id: item.id,
            scope: 'image',
            name: item.title,
            description: item.description,
            prompt: item.prompt,
            model: '',
            temperature: 0,
          })))
        } catch {
          // Image assistant snapshots are best-effort; Android falls back to built-ins.
        }
      })()
    }, 800)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [imageStylePresets])

  const drawSessionsByAssistant = useMemo(
    () => groupDrawSessionsByAssistant(drawSessions, imageStyleTitleById),
    [drawSessions, imageStyleTitleById]
  )

  useAutoFollowScroll(messageStreamRef, [messages, sending])

  useDebouncedJsonStorage(DRAW_SESSIONS_STORAGE_KEY, drawSessions, performanceMode === 'efficiency' ? 900 : 220)

  useEffect(() => {
    writeJsonStorage(DRAW_ACTIVE_SESSION_STORAGE_KEY, resolvedActiveSessionId)
  }, [resolvedActiveSessionId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void syncAssistantHistory(
        'draw',
        drawSessions.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          data: JSON.stringify(session),
        }))
      )
    }, performanceMode === 'efficiency' ? 1200 : 260)
    return () => window.clearTimeout(timer)
  }, [drawSessions, performanceMode])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const nextGroups = await getUserGroups()
        if (!disposed) {
          setSelectedGroup((current) => current || nextGroups[0]?.value || '')
        }
      } catch {
        /* empty */
      }
    })()
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (isAssistantHistoryTriggerTarget(event.target)) {
        return
      }
      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        closeDrawHistoryPanel()
      }
      if (drawSizeMenuOpen && drawSizeMenuRef.current && !drawSizeMenuRef.current.contains(target)) {
        setDrawSizeMenuOpen(false)
      }
      if (drawQualityMenuOpen && drawQualityMenuRef.current && !drawQualityMenuRef.current.contains(target)) {
        setDrawQualityMenuOpen(false)
      }
      if (imageStyleMenuOpen && imageStyleMenuRef.current && !imageStyleMenuRef.current.contains(target)) {
        setImageStyleMenuOpen(false)
        setImageStyleSearch('')
        setImageStyleMenuMode('list')
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [drawQualityMenuOpen, drawSizeMenuOpen, historyOpen, imageStyleMenuOpen])

  useEffect(() => {
    function handleOpenHistory() {
      setHistoryOpen((current) => {
        if (current) {
          setSessionContextMenu(null)
        }
        return !current
      })
    }
    window.addEventListener('oneapi:open-draw-history', handleOpenHistory as EventListener)
    return () => window.removeEventListener('oneapi:open-draw-history', handleOpenHistory as EventListener)
  }, [])

  function updateDrawSession(sessionId: string, updater: (session: DrawSessionRecord) => DrawSessionRecord) {
    setDrawSessions((current) =>
      current.map((item) => (item.id === sessionId ? updater(item) : item)).sort((a, b) => b.updatedAt - a.updatedAt)
    )
  }

  function closeDrawHistoryPanel() {
    setHistoryOpen(false)
    setSessionContextMenu(null)
  }

  function createDrawSession() {
    const next = createDefaultDrawSession()
    setDrawSessions((current) => [next, ...current])
    setActiveSessionId(next.id)
    setDraft('')
    drawPromptHistory.syncInputValue('')
    setSelectedImageStylePreset(null)
    setImageStyleMenuOpen(false)
    clearAttachments()
    window.setTimeout(() => resizeDraft(), 0)
  }

  function ensureDrawSession() {
    if (resolvedActiveSessionId) {
      return resolvedActiveSessionId
    }
    const next = createDefaultDrawSession()
    setDrawSessions((current) => [next, ...current])
    setActiveSessionId(next.id)
    return next.id
  }

  function replacePendingDrawMessage(sessionId: string, nextMessage: ChatBubbleMessage) {
    updateDrawSession(sessionId, (session) => {
      const nextMessages = [...session.messages]
      const pendingIndex = nextMessages.findIndex((item) => item.pending && item.imageUrl === DRAW_PENDING_IMAGE_URL)
      if (pendingIndex >= 0) {
        nextMessages[pendingIndex] = nextMessage
      } else {
        nextMessages.push(nextMessage)
      }
      return {
        ...session,
        title: clipText(nextMessages.find((item) => item.role === 'user')?.content || '新绘图', 32),
        updatedAt: nextMessage.createdAt,
        messages: nextMessages,
      }
    })
  }

  function handleSelectDrawSession(session: DrawSessionRecord) {
    setActiveSessionId(session.id)
    closeDrawHistoryPanel()
    setDraft('')
    drawPromptHistory.syncInputValue('')
    clearAttachments()
    window.setTimeout(() => resizeDraft(), 0)
  }

  function renameDrawSession(sessionId: string) {
    const target = drawSessions.find((item) => item.id === sessionId)
    if (!target) {
      return
    }
    setRenamingDrawSession({
      id: sessionId,
      value: target.title || '新绘图',
    })
  }

  function commitDrawSessionRename(sessionId: string) {
    if (renamingDrawSession?.id !== sessionId) {
      return
    }

    const nextTitle = renamingDrawSession.value.trim()
    setRenamingDrawSession(null)
    if (!nextTitle) {
      return
    }
    setDrawSessions((current) =>
      current.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              title: nextTitle,
              updatedAt: Math.max(Date.now(), item.updatedAt),
            }
          : item
      )
    )
  }

  function openDrawSessionFolder(sessionId: string) {
    void openAssistantHistoryFolder('draw', sessionId).catch((error: unknown) => {
      toast(error instanceof Error ? error.message : '打开会话目录失败')
    })
  }

  function deleteDrawSession(sessionId: string) {
    setDrawSessions((current) => {
      const remaining = current.filter((item) => item.id !== sessionId)
      if (remaining.length) {
        return remaining
      }
      return [createDefaultDrawSession()]
    })
    if (resolvedActiveSessionId === sessionId) {
      setActiveSessionId('')
    }
    toast('已删除该绘图会话。')
  }

  async function exportDrawSession(session: DrawSessionRecord) {
    try {
      const content = buildDrawSessionExportMarkdown({
        title: session.title,
        updatedAt: session.updatedAt,
        messages: session.messages,
      })
      const result = await exportTextFile(
        buildSessionExportFileName('image', session.title || '绘图会话'),
        content,
        '导出绘图会话'
      )
      toast(`已导出到：${result.path}`)
    } catch (error) {
      if (error instanceof Error && error.message === '已取消导出。') {
        return
      }
      toast(error instanceof Error ? error.message : '导出会话失败')
    }
  }

  function handleDrawSessionContextMenu(event: MouseEvent, session: DrawSessionRecord) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: session.title || '新绘图',
      scope: 'history',
      items: [
        {
          key: 'rename',
          label: '重命名',
          onSelect: () => renameDrawSession(session.id),
        },
        {
          key: 'open-folder',
          label: '打开文件夹',
          onSelect: () => openDrawSessionFolder(session.id),
        },
        {
          key: 'export',
          label: '导出会话',
          onSelect: () => void exportDrawSession(session),
        },
        {
          key: 'delete',
          label: '删除会话',
          variant: 'danger',
          onSelect: () => deleteDrawSession(session.id),
        },
      ],
    })
  }

  function resetImageStyleEditor() {
    setEditingImageStylePresetId('')
    setImageStyleTitle('')
    setImageStyleCategory('')
    setImageStyleDescription('')
    setImageStylePrompt('')
    setImageStyleSizeDraft('1024x1024')
    setImageStyleQualityDraft('high')
  }

  function openImageStyleCreateEditor() {
    resetImageStyleEditor()
    setImageStyleMenuMode('create')
    window.setTimeout(() => {
      const target = imageStyleMenuRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '.assistant-editor input, .assistant-editor textarea'
      )
      target?.focus()
    }, 0)
  }

  function openImageStyleEditEditor(presetId: string) {
    const target = imageStylePresets.find((item) => item.id === presetId)
    if (!target) {
      return
    }
    setEditingImageStylePresetId(target.id)
    setImageStyleTitle(target.title)
    setImageStyleCategory(target.category)
    setImageStyleDescription(target.description)
    setImageStylePrompt(target.prompt)
    setImageStyleSizeDraft(target.size)
    setImageStyleQualityDraft(target.quality || 'high')
    setImageStyleMenuMode('edit')
    window.setTimeout(() => {
      const targetNode = imageStyleMenuRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '.assistant-editor input, .assistant-editor textarea'
      )
      targetNode?.focus()
    }, 0)
  }

  function closeImageStyleEditor() {
    setImageStyleMenuMode('list')
    resetImageStyleEditor()
  }

  function toggleFavoriteImageStylePreset(presetId: string) {
    setImageStyleFavorites((current) => {
      const next = current.includes(presetId)
        ? current.filter((item) => item !== presetId)
        : [presetId, ...current.filter((item) => item !== presetId)]
      storeFavoriteModels(IMAGE_STYLE_FAVORITES_STORAGE_KEY, next)
      return next
    })
  }

  function handleImageStylePresetContextMenu(event: MouseEvent, presetId: string) {
    event.preventDefault()
    const target = imageStylePresets.find((item) => item.id === presetId)
    if (!target) {
      return
    }
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: target.title,
      items: [
        {
          key: 'edit',
          label: '编辑',
          onSelect: () => openImageStyleEditEditor(target.id),
        },
      ],
    })
  }

  function handleSaveImageStylePreset() {
    if (!imageStyleTitle.trim() || !imageStylePrompt.trim()) {
      toast('请填写风格名称和提示词。')
      return
    }

    const normalizedTitle = imageStyleTitle.trim()
    const normalizedCategory = imageStyleCategory.trim() || '自定义'
    const normalizedDescription = imageStyleDescription.trim() || '自定义图像风格助手'
    const normalizedPrompt = imageStylePrompt.trim()
    const editingTarget = editingImageStylePresetId
      ? imageStylePresets.find((item) => item.id === editingImageStylePresetId)
      : null

    const nextPreset = editingTarget
      ? {
          ...editingTarget,
          title: normalizedTitle,
          category: normalizedCategory,
          description: normalizedDescription,
          prompt: normalizedPrompt,
          size: imageStyleSizeDraft,
          quality: imageStyleQualityDraft,
        }
      : createImageStylePreset({
          title: normalizedTitle,
          category: normalizedCategory,
          description: normalizedDescription,
          prompt: normalizedPrompt,
          size: imageStyleSizeDraft,
          quality: imageStyleQualityDraft,
        })

    const nextPresets = editingTarget
      ? imageStylePresets.map((item) => (item.id === editingTarget.id ? nextPreset : item))
      : [nextPreset, ...imageStylePresets]

    setImageStylePresets(nextPresets)
    saveImageStylePresets(nextPresets)
    setSelectedImageStylePreset((current) => current?.id === nextPreset.id ? nextPreset : current)
    closeImageStyleEditor()
    toast(editingTarget ? '图像助手已更新。' : '图像助手已创建。')
  }

  async function copyText(content: string) {
    try {
      await navigator.clipboard.writeText(content)
      toast('已复制到剪贴板。')
    } catch {
      toast('复制失败，请检查系统剪贴板权限。')
    }
  }

  const requestDrawSelectionTranslation = useCallback(async (sourceText: string) => {
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
        group: selectedGroup || undefined,
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
  }, [selectedGroup, toast])

  const handleDrawMessageSelectionContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, selectedText: string) => {
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
          onSelect: () => requestDrawSelectionTranslation(selectedText),
        },
      ],
    })
  }, [requestDrawSelectionTranslation])

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

  async function handleDownloadImage(source: string, name: string) {
    try {
      const dataBase64 = source.startsWith('data:') ? extractDataUrlBase64(source) : undefined
      const result = await saveImageToDisk({
        suggestedName: name || `oneapi-image-${Date.now()}.png`,
        sourceUrl: source.startsWith('data:') ? undefined : source,
        dataBase64,
      })
      if (result.path) {
        toast(`已保存到：${result.path}`)
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存图片失败')
    }
  }

  async function referenceGeneratedImageForEdit(message: ChatBubbleMessage) {
    if (!message.imageUrl || message.imageUrl === DRAW_PENDING_IMAGE_URL) {
      return
    }
    try {
      const name = `${clipText(message.imagePrompt || 'oneapi-image', 24).replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'oneapi-image'}.png`
      const response = await fetch(message.imageUrl)
      if (!response.ok) {
        throw new Error('图片读取失败')
      }
      const blob = await response.blob()
      const file = new File([blob], name, { type: blob.type || 'image/png' })
      const dataBase64 = await fileToBase64(file)
      const saved = await getDesktopBridge().saveAttachment({
        name,
        mimeType: file.type || 'image/png',
        dataBase64,
      })
      replaceAttachments([{
        id: globalThis.crypto.randomUUID(),
        name,
        filePath: saved.path,
        size: file.size,
        kind: 'image',
        mimeType: file.type || 'image/png',
        dataBase64,
        previewUrl: URL.createObjectURL(file),
      }])
      if (!draft.trim() && message.imagePrompt?.trim()) {
        setDraft(message.imagePrompt)
        drawPromptHistory.syncInputValue(message.imagePrompt)
        window.setTimeout(() => resizeDraft(), 0)
      }
      window.setTimeout(() => draftRef.current?.focus(), 0)
    } catch (error) {
      toast(error instanceof Error ? error.message : '引用图片失败')
    }
  }

  async function handleCopyImage(source: string) {
    try {
      await copyImageToClipboard({
        sourceUrl: source.startsWith('data:') ? undefined : source,
        dataBase64: source.startsWith('data:') ? extractDataUrlBase64(source) : undefined,
      })
      toast('图片已复制到剪贴板。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制图片失败')
    }
  }

  function handlePreviewImageContextMenu(event: MouseEvent<HTMLDivElement | HTMLImageElement>) {
    if (!previewImage?.src) {
      return
    }
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: previewImage.name,
      items: [
        {
          key: 'copy-image',
          label: '复制图片',
          onSelect: () => void handleCopyImage(previewImage.src),
        },
        {
          key: 'download-image',
          label: '下载图片',
          onSelect: () => void handleDownloadImage(previewImage.src, previewImage.name),
        },
      ],
    })
  }

  function handleGeneratedImageContextMenu(
    event: MouseEvent<HTMLButtonElement | HTMLImageElement>,
    message: ChatBubbleMessage
  ) {
    if (!message.imageUrl || message.imageUrl === DRAW_PENDING_IMAGE_URL) {
      return
    }
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: message.imagePrompt || '生成图片',
      items: [
        {
          key: 'copy-image',
          label: '复制图片',
          onSelect: () => void handleCopyImage(message.imageUrl || ''),
        },
        {
          key: 'download-image',
          label: '下载图片',
          onSelect: () => void handleDownloadImage(message.imageUrl || '', 'oneapi-image.png'),
        },
      ],
    })
  }

  function deleteDrawMessage(messageId: string) {
    updateDrawSession(resolvedActiveSessionId, (session) => ({
      ...session,
      updatedAt: Date.now(),
      messages: session.messages.filter((item) => item.id !== messageId),
    }))
  }

  function applyImageStylePreset(preset: ImageStylePreset) {
    setSelectedImageStylePreset(preset)
    setDrawSize(preset.size)
    if (preset.quality) {
      setDrawQuality(preset.quality)
    }
    setImageStyleMenuOpen(false)
    setImageStyleSearch('')
    window.setTimeout(() => draftRef.current?.focus(), 0)
  }

  function expandImageStylePresetToDraft() {
    if (!selectedImageStylePreset) {
      return
    }
    const expandedPrompt = buildImageStyleAugmentedPrompt(draft, selectedImageStylePreset)
    setDraft(expandedPrompt)
    drawPromptHistory.syncInputValue(expandedPrompt)
    setSelectedImageStylePreset(null)
    setImageStyleSearch('')
    window.setTimeout(() => resizeDraft(), 0)
    window.setTimeout(() => draftRef.current?.focus(), 0)
  }

  async function executeDrawRequest(request: PendingDrawRetryRequest) {
    if (request.kind === 'edit') {
      const serviceKey = await ensureDesktopServiceKey({
        name: 'OneAPI Desktop Internal Key',
        group: resolvePendingDrawRequestGroup(request, selectedGroup || ''),
        preferredNames: ['桌面端专用 Key', 'CODEX 桌面安装 Key', 'CLAUDE 桌面安装 Key'],
      })

      try {
        return await sendImageEdit(
          buildImageEditRequest({
            apiKey: serviceKey.key,
            model: request.model,
            fallbackModel: DEFAULT_DRAW_MODEL,
            prompt: request.prompt,
            imageName: request.imageName,
            mimeType: request.mimeType,
            dataBase64: request.dataBase64,
            size: request.size,
            quality: request.quality,
          })
        )
      } catch (error) {
        throw new Error(mapImageEditError(error), { cause: error })
      }
    }

    const serviceKey = await ensureDesktopServiceKey({
      name: 'OneAPI Desktop Internal Key',
      group: request.group || '',
      preferredNames: ['桌面端专用 Key', 'CODEX 桌面安装 Key', 'CLAUDE 桌面安装 Key'],
    })

    return sendDirectImageGeneration({
      apiKey: serviceKey.key,
      model: request.model,
      prompt: request.prompt,
      size: request.size,
      quality: request.quality,
      seed: request.seed,
      response_format: request.response_format,
    })
  }

  function buildResolvedDrawAssistantMessage(response: ImageGenerationResponse, fallbackPrompt: string) {
    const responseErrorMessage = resolveImageResponseErrorMessage(response)
    if (responseErrorMessage) {
      throw new Error(responseErrorMessage)
    }

    const resolvedImage = resolveImageGenerationResult(response, fallbackPrompt)
    if (!resolvedImage) {
      throw new Error('模型没有返回可展示的图片。')
    }

    const resolvedAt = getCurrentTimestamp()
    return {
      id: `draw-assistant-${resolvedAt}`,
      role: 'assistant' as const,
      content: resolvedImage.prompt,
      createdAt: resolvedAt,
      imageUrl: resolvedImage.imageUrl,
      imagePrompt: resolvedImage.prompt,
      modelLabel: DEFAULT_DRAW_MODEL,
      usage: response.usage,
    }
  }

  async function continuePendingDrawRequest(snapshot: PendingDrawRetryState) {
    if (retryingPendingDrawRef.current) {
      return
    }

    retryingPendingDrawRef.current = true
    try {
      const response = await executeDrawRequest(snapshot.request)
      replacePendingDrawMessage(
        snapshot.sessionId,
        buildResolvedDrawAssistantMessage(response, snapshot.request.prompt)
      )
      setPendingRetry(null)
      setSending(false)
    } catch (error) {
      if (isRecoverableNetworkError(error)) {
        replacePendingDrawMessage(snapshot.sessionId, {
          id: `draw-pending-retry-${getCurrentTimestamp()}`,
          role: 'assistant',
          content: '网络已断开，恢复后将自动继续生成...',
          createdAt: getCurrentTimestamp(),
          pending: true,
          imageUrl: DRAW_PENDING_IMAGE_URL,
          modelLabel: DEFAULT_DRAW_MODEL,
        })
        return
      }

      const failedAt = getCurrentTimestamp()
      replacePendingDrawMessage(snapshot.sessionId, {
        id: `draw-assistant-error-${failedAt}`,
        role: 'assistant',
        content: formatUserFacingMessage(
          error instanceof Error ? error.message : '图片生成失败',
          '图片生成失败'
        ),
        createdAt: failedAt,
        modelLabel: DEFAULT_DRAW_MODEL,
      })
      setPendingRetry(null)
      setSending(false)
      toast(error instanceof Error ? error.message : '图片生成失败')
    } finally {
      retryingPendingDrawRef.current = false
    }
  }

  useEffect(() => {
    if (!pendingRetry) {
      return
    }

    const handleOnline = () => {
      toast('网络已恢复，正在继续获取图片结果。')
      void continuePendingDrawRequest(pendingRetry)
    }

    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [pendingRetry, toast])

  async function handleSendDrawMessage() {
    if ((!draft.trim() && !selectedImageStylePreset) || sending) {
      toast('请输入绘图提示词。')
      return
    }

    const nextSessionId = ensureDrawSession()
    const imageAttachment = attachments.find((item) => item.kind === 'image')
    const now = getCurrentTimestamp()
    const nextPrompt = buildImageStyleAugmentedPrompt(draft, selectedImageStylePreset || { prompt: '' })
    const userMessage: ChatBubbleMessage = {
      id: `draw-user-${now}`,
      role: 'user',
      content: nextPrompt,
      createdAt: now,
      imageStylePresetId: selectedImageStylePreset?.id,
      imageStylePresetTitle: selectedImageStylePreset?.title,
      attachments: toMessageAttachments(attachments),
    }
    const pendingMessage: ChatBubbleMessage = {
      id: `draw-pending-${now}`,
      role: 'assistant',
      content: DRAW_PENDING_MESSAGE_LABEL,
      createdAt: now + 1,
      pending: true,
      imageUrl: DRAW_PENDING_IMAGE_URL,
      modelLabel: DEFAULT_DRAW_MODEL,
    }

    updateDrawSession(nextSessionId, (session) => ({
      ...session,
      title: clipText(nextPrompt, 32),
      updatedAt: now + 1,
      messages: [...session.messages, userMessage, pendingMessage],
    }))

    drawPromptHistory.commitInputValue(nextPrompt)
    setDraft('')
    setSelectedImageStylePreset(null)
    setImageStyleMenuOpen(false)
    setImageStyleSearch('')
    clearAttachments()
    window.setTimeout(() => resizeDraft(), 0)
    setSending(true)
    let keepSending = false

    try {
      const request = buildPendingDrawRetryRequest({
        model: DEFAULT_DRAW_MODEL,
        prompt: nextPrompt,
        group: selectedGroup || '',
        size: drawSize,
        quality: drawQuality,
        seed: drawRandomSeed ? undefined : 1,
        imageAttachment,
      })
      const response = await executeDrawRequest(request)
      replacePendingDrawMessage(nextSessionId, buildResolvedDrawAssistantMessage(response, nextPrompt))
      setPendingRetry(null)
    } catch (error) {
      if (isRecoverableNetworkError(error)) {
        keepSending = true
        replacePendingDrawMessage(nextSessionId, {
          ...pendingMessage,
          content: '网络已断开，恢复后将自动继续生成...',
        })
        setPendingRetry({
          sessionId: nextSessionId,
          request: buildPendingDrawRetryRequest({
            model: DEFAULT_DRAW_MODEL,
            prompt: nextPrompt,
            group: selectedGroup || '',
            size: drawSize,
            quality: drawQuality,
            seed: drawRandomSeed ? undefined : 1,
            imageAttachment,
          }),
        })
        toast('网络异常，连接恢复后会自动继续当前图片生成。')
        return
      }

      const failedAt = getCurrentTimestamp()
      replacePendingDrawMessage(nextSessionId, {
        id: `draw-assistant-error-${failedAt}`,
        role: 'assistant',
        content: formatUserFacingMessage(
          error instanceof Error ? error.message : '图片生成失败',
          '图片生成失败'
        ),
        createdAt: failedAt,
        modelLabel: DEFAULT_DRAW_MODEL,
      })
      setPendingRetry(null)
      toast(error instanceof Error ? error.message : '图片生成失败')
    } finally {
      if (!keepSending) {
        setSending(false)
      }
    }
  }

  return (
    <section className='workspace-page chat-page'>
      <div className={`chat-layout ${historyOpen ? 'history-open' : ''}`}>
        <article className='panel chat-main-panel chat-panel-surface'>
          <div className='conversation-scroll-region'>
            <div className='workspace-corner-tools'>
              <ConversationFindBar active containerRef={messageStreamRef} itemSelector='.message-bubble' />
            </div>
            <div ref={messageStreamRef} className='message-stream'>
              {messages.length === 0 ? (
                <EmptyState title='开始绘图' description='输入提示词后，使用 gpt-image-2 直接生图；拖拽或粘贴图片后，会自动走修图接口。' icon={Sparkles} />
              ) : (
                messages.map((message) => {
                  const isUser = message.role === 'user'
                  const isPendingImage = message.pending && message.imageUrl === DRAW_PENDING_IMAGE_URL
                  const visibleMessageContent = resolveVisibleDrawMessageContent({
                    role: message.role,
                    content: message.content,
                    imageUrl: message.imageUrl,
                    pending: message.pending,
                  })
                  return (
                    <div
                      key={message.id}
                      className={`message-bubble ${isUser ? 'user' : 'assistant'} ${message.pending ? 'streaming-bubble' : ''}`}
                    >
                      {!isUser ? <span className='message-role'>{message.modelLabel || DEFAULT_DRAW_MODEL}</span> : null}
                      <MessageAttachmentGallery
                        attachments={message.attachments}
                        onPreview={openAttachmentPreview}
                        onAttachmentContextMenu={(event, attachment) =>
                          showAttachmentContextMenu(event, attachment, setSessionContextMenu, openAttachmentPreview)
                        }
                      />
                      {isPendingImage ? (
                        <PendingImageContent label={message.content || DRAW_PENDING_MESSAGE_LABEL} />
                      ) : message.imageUrl ? (
                        <div className='generated-image-block'>
                          <button
                            type='button'
                            className='generated-image-button'
                            onContextMenu={(event) => handleGeneratedImageContextMenu(event, message)}
                            onClick={() =>
                              setPreviewImage({
                                src: message.imageUrl || '',
                                name: `${clipText(message.imagePrompt || 'oneapi-image', 24).replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'oneapi-image'}.png`,
                              })
                            }
                          >
                            <img
                              src={message.imageUrl}
                              alt={message.imagePrompt || '生成图片'}
                              className='generated-image'
                              onContextMenu={(event) => handleGeneratedImageContextMenu(event, message)}
                            />
                          </button>
                          {visibleMessageContent.trim() ? (
                            <LazyMarkdownContent
                              content={visibleMessageContent}
                              onSelectionContextMenu={handleDrawMessageSelectionContextMenu}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <LazyMarkdownContent
                          content={visibleMessageContent}
                          onSelectionContextMenu={handleDrawMessageSelectionContextMenu}
                        />
                      )}
                      <BubbleMeta
                        side={isUser ? 'right' : 'left'}
                        createdAt={message.createdAt}
                        extra={!isUser ? <span className='message-usage'>{formatUsageSummary(message.usage)}</span> : null}
                        actions={[
                          ...(visibleMessageContent.trim()
                            ? [
                                {
                                  key: 'copy',
                                  label: '复制',
                                  icon: Copy,
                                  onClick: () => void copyText(visibleMessageContent),
                                },
                              ]
                            : []),
                          ...(message.imageUrl && message.imageUrl !== DRAW_PENDING_IMAGE_URL
                            ? [
                                {
                                  key: 'edit-image',
                                  label: '编辑',
                                  icon: PencilLine,
                                  onClick: () => void referenceGeneratedImageForEdit(message),
                                },
                              ]
                            : []),
                          {
                            key: 'delete',
                            label: '删除',
                            icon: Trash2,
                            onClick: () => deleteDrawMessage(message.id),
                          },
                          ...(message.imageUrl && message.imageUrl !== DRAW_PENDING_IMAGE_URL
                            ? [
                                {
                                  key: 'download',
                                  label: '下载图片',
                                  icon: Download,
                                  onClick: () => void handleDownloadImage(message.imageUrl || '', 'oneapi-image.png'),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                  )
                })
              )}
            </div>
            <ConversationScrollDock active={active} containerRef={messageStreamRef} />
          </div>

          {renderComposer({
            inputRef: attachmentInputRef,
            onAttachmentInputChange: handleAttachmentInputChange,
            textareaRef: draftRef,
            value: draft,
            placeholder: '输入绘图提示词；粘贴、拖拽图片后会自动进入修图模式',
            onChange: (value) => {
              setDraft(value)
              drawPromptHistory.syncInputValue(value)
            },
            onKeyDown: (event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !sending) {
                event.preventDefault()
                void handleSendDrawMessage()
                return
              }

              if (event.ctrlKey || event.metaKey || event.altKey) {
                return
              }
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                return
              }

              const nextValue = drawPromptHistory.recallInputValue(
                event.key === 'ArrowUp' ? 'up' : 'down',
                draft
              )
              if (nextValue === draft) {
                return
              }
              event.preventDefault()
              setDraft(nextValue)
              window.setTimeout(() => focusTextareaToEnd(draftRef.current, nextValue), 0)
            },
            onPaste: handleAttachmentPaste,
            onDrop: handleAttachmentDrop,
            tokenItems: selectedImageStylePreset
              ? [
                  {
                    id: selectedImageStylePreset.id,
                    label: `${selectedImageStylePreset.title} · ${selectedImageStylePreset.description}`,
                    kindLabel: '风格',
                    onEdit: expandImageStylePresetToDraft,
                    onRemove: () => setSelectedImageStylePreset(null),
                  },
                ]
              : [],
            leftActions: [
              {
                key: 'group',
                node: (
                  <div className='toolbar-picker'>
                    <button className='ghost-button tiny picker-trigger icon-picker-trigger' type='button' title='当前模型'>
                      <Sparkles size={16} />
                      <strong>{DEFAULT_DRAW_MODEL}</strong>
                    </button>
                  </div>
                ),
              },
              {
                key: 'draw-style',
                node: (
                  <div className='toolbar-picker' ref={imageStyleMenuRef}>
                    <button
                      className={`ghost-button tiny picker-trigger icon-picker-trigger ${imageStyleMenuOpen ? 'selected-toggle' : ''}`}
                      type='button'
                      aria-expanded={imageStyleMenuOpen}
                      title={selectedImageStylePreset ? `提示词助手：${selectedImageStylePreset.title}` : '提示词助手'}
                      onClick={() => {
                        setDrawSizeMenuOpen(false)
                        setDrawQualityMenuOpen(false)
                        setImageStyleMenuOpen((current) => {
                          const next = !current
                          if (next) {
                            setImageStyleMenuMode('list')
                            setImageStyleSearch('')
                          }
                          return next
                        })
                      }}
                    >
                      <Sparkles size={16} />
                      <strong>{selectedImageStylePreset?.title || '提示词助手'}</strong>
                    </button>
                    {imageStyleMenuOpen && (
                      <ImageStylePresetPalette
                        mode={imageStyleMenuMode}
                        searchValue={imageStyleSearch}
                        items={imageStyleMenuItems}
                        selectedPresetId={selectedImageStylePreset?.id}
                        onSelect={applyImageStylePreset}
                        onSearchChange={setImageStyleSearch}
                        onToggleFavorite={toggleFavoriteImageStylePreset}
                        onOpenCreateEditor={openImageStyleCreateEditor}
                        onContextMenu={handleImageStylePresetContextMenu}
                        titleValue={imageStyleTitle}
                        categoryValue={imageStyleCategory}
                        descriptionValue={imageStyleDescription}
                        promptValue={imageStylePrompt}
                        sizeValue={imageStyleSizeDraft}
                        qualityValue={imageStyleQualityDraft}
                        onTitleChange={setImageStyleTitle}
                        onCategoryChange={setImageStyleCategory}
                        onDescriptionChange={setImageStyleDescription}
                        onPromptChange={setImageStylePrompt}
                        onSizeChange={setImageStyleSizeDraft}
                        onQualityChange={setImageStyleQualityDraft}
                        onCancelEditor={closeImageStyleEditor}
                        onSaveEditor={handleSaveImageStylePreset}
                        menuStyle={imageStyleMenuWidthStyle}
                      />
                    )}
                  </div>
                ),
              },
              {
                key: 'draw-size',
                node: (
                  <div className='toolbar-picker' ref={drawSizeMenuRef}>
                    <button
                      className={`ghost-button tiny toolbar-icon-button ${drawSizeMenuOpen ? 'selected-toggle' : ''}`}
                      type='button'
                      title={`图片尺寸：${drawSizeLabel}`}
                      aria-label={`图片尺寸：${drawSizeLabel}`}
                      aria-expanded={drawSizeMenuOpen}
                      onClick={() => {
                        setImageStyleMenuOpen(false)
                        setDrawQualityMenuOpen(false)
                        setDrawSizeMenuOpen((current) => !current)
                      }}
                    >
                      <Crop size={16} />
                      <span className='toolbar-icon-label'>{drawSizeLabel}</span>
                    </button>
                    {drawSizeMenuOpen && (
                      <GlassPickerMenu className='picker-menu image-config-menu fixed-width-menu' style={drawSizeMenuWidthStyle}>
                        <div className='picker-menu-list'>
                          {DRAW_SIZE_OPTIONS.map((item) => (
                            <button
                              key={item.value}
                              type='button'
                              className={`picker-option ${item.value === drawSize ? 'active' : ''}`}
                              onClick={() => {
                                setDrawSize(item.value)
                                setDrawSizeMenuOpen(false)
                              }}
                            >
                              <strong>{`${item.label} · ${item.value}`}</strong>
                            </button>
                          ))}
                        </div>
                      </GlassPickerMenu>
                    )}
                  </div>
                ),
              },
              {
                key: 'draw-quality',
                node: (
                  <div className='toolbar-picker' ref={drawQualityMenuRef}>
                    <button
                      className={`ghost-button tiny toolbar-icon-button ${drawQualityMenuOpen ? 'selected-toggle' : ''}`}
                      type='button'
                      title={`图片质量：${drawQualityLabel}`}
                      aria-label={`图片质量：${drawQualityLabel}`}
                      aria-expanded={drawQualityMenuOpen}
                      onClick={() => {
                        setImageStyleMenuOpen(false)
                        setDrawSizeMenuOpen(false)
                        setDrawQualityMenuOpen((current) => !current)
                      }}
                    >
                      <SlidersHorizontal size={16} />
                      <span className='toolbar-icon-label'>{drawQualityLabel}</span>
                    </button>
                    {drawQualityMenuOpen && (
                      <GlassPickerMenu className='picker-menu image-config-menu fixed-width-menu' style={drawQualityMenuWidthStyle}>
                        <div className='picker-menu-list'>
                          {DRAW_QUALITY_OPTIONS.map((item) => (
                            <button
                              key={item.value}
                              type='button'
                              className={`picker-option ${item.value === drawQuality ? 'active' : ''}`}
                              onClick={() => {
                                setDrawQuality(item.value)
                                setDrawQualityMenuOpen(false)
                              }}
                            >
                              <strong>{`${item.label} · ${item.value}`}</strong>
                            </button>
                          ))}
                        </div>
                      </GlassPickerMenu>
                    )}
                  </div>
                ),
              },
              {
                key: 'draw-random',
                node: (
                  <button
                    className={`ghost-button tiny toolbar-icon-button ${drawRandomSeed ? 'active' : ''}`}
                    type='button'
                    title={`随机种子：${drawRandomSeedLabel}`}
                    aria-label={`随机种子：${drawRandomSeedLabel}`}
                    onClick={() => setDrawRandomSeed((current) => !current)}
                  >
                    <Shuffle size={16} />
                    <span className='toolbar-icon-label'>{drawRandomSeedLabel}</span>
                  </button>
                ),
              },
            ],
            fileAssets: attachments
              .filter((item) => item.kind === 'image')
              .slice(0, 1)
              .map((item) => ({
                id: item.id,
                name: item.name,
                filePath: item.filePath,
                previewUrl: item.previewUrl,
                kind: item.kind,
                onPreview: () => void openAttachmentPreview(item.filePath),
                onRemove: () => removeAttachment(item.id),
              })),
            sendButton: (
              <button
                className='primary-button icon-only send-button'
                type='button'
                onClick={() => void handleSendDrawMessage()}
                title='发送绘图请求（Ctrl+Enter）'
                aria-label='发送绘图请求（Ctrl+Enter）'
                disabled={sending}
              >
                {sending ? <LoaderCircle className='spin' size={16} /> : <Send size={16} />}
              </button>
            ),
          })}
        </article>

        <aside
          ref={historyPanelRef}
          className={`panel chat-history-panel ${historyOpen ? 'open' : ''}`}
          tabIndex={historyOpen ? 0 : -1}
        >
          <div className='panel-header compact'>
            <div />
            <div className='inline-actions'>
              <button className='secondary-button tiny' type='button' onClick={createDrawSession}>
                <Plus size={16} />
                <span>新绘图</span>
              </button>
            </div>
          </div>
          <div className='side-pane-scroll'>
            {drawSessions.length === 0 ? (
              <EmptyState title='当前没有绘图会话' description='生成第一张图片后，会话会显示在这里。' />
            ) : (
              <div className='history-project-groups'>
                {drawSessionsByAssistant.map(([assistantGroup, items]) => (
                  <div key={assistantGroup} className='history-group'>
                    <div className='history-group-head'>
                      <strong>{assistantGroup}</strong>
                      <span>{items.length} 条</span>
                    </div>
                    <div className='subrecords compact-records'>
                      {items.map((session) => (
                        <div
                          key={session.id}
                          className={`record-row action-row session-row ${session.id === resolvedActiveSessionId ? 'highlighted' : ''}`}
                          role='button'
                          tabIndex={0}
                          onContextMenu={(event) => handleDrawSessionContextMenu(event, session)}
                          onClick={() => {
                            if (renamingDrawSession?.id !== session.id) {
                              handleSelectDrawSession(session)
                            }
                          }}
                          onKeyDown={(event) => {
                            if (renamingDrawSession?.id === session.id) {
                              return
                            }
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              handleSelectDrawSession(session)
                            }
                          }}
                        >
                          <SessionTitleEditor
                            editing={renamingDrawSession?.id === session.id}
                            value={renamingDrawSession?.id === session.id ? renamingDrawSession.value : ''}
                            displayValue={session.title || '新绘图'}
                            maxLength={56}
                            onChange={(value) => setRenamingDrawSession({ id: session.id, value })}
                            onCommit={() => commitDrawSessionRename(session.id)}
                            onCancel={() => setRenamingDrawSession(null)}
                          />
                          <small>{formatDateTime(session.updatedAt)}</small>
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

      {previewImage && (
        <div className='modal-mask image-preview-modal-mask' onClick={() => setPreviewImage(null)}>
          <div
            className='image-preview-modal'
            onClick={(event) => event.stopPropagation()}
            onContextMenu={handlePreviewImageContextMenu}
          >
            <div className='image-preview-stage' onContextMenu={handlePreviewImageContextMenu}>
              <div className='image-preview-overlay-actions'>
                <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={() => void handleCopyImage(previewImage.src)} title='复制图片' aria-label='复制图片'>
                  <Copy size={15} />
                </button>
                <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={() => void handleDownloadImage(previewImage.src, previewImage.name)} title='下载图片' aria-label='下载图片'>
                  <Download size={15} />
                </button>
                <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={() => setPreviewImage(null)} title='关闭' aria-label='关闭'>
                  <X size={15} />
                </button>
              </div>
              <img
                src={previewImage.src}
                alt={previewImage.name}
                className='image-preview-full'
                onContextMenu={handlePreviewImageContextMenu}
              />
            </div>
          </div>
        </div>
      )}
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

function SubscriptionsWorkspace(props: {
  toast: (message: string) => void
}) {
  const { toast } = props
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [subscriptionSelf, setSubscriptionSelf] = useState<SubscriptionSelfData | null>(null)
  const [paymentInfo, setPaymentInfo] = useState<SubscriptionPaymentInfo | null>(null)
  const [quotaPerUnit, setQuotaPerUnit] = useState(500_000)
  const [buyingPlanId, setBuyingPlanId] = useState(0)
  const activeSubscriptions = (subscriptionSelf?.subscriptions || []).filter(
    (item) => !isSubscriptionExhausted(item.subscription)
  )
  const allSubscriptions = subscriptionSelf?.all_subscriptions || []
  const recommendedPlanId = useMemo(() => resolveRecommendedSubscriptionPlanId(plans), [plans])
  const planById = useMemo(
    () => new Map(plans.map((item) => [item.plan.id, item.plan])),
    [plans]
  )
  const planTitleMap = useMemo(
    () => new Map(plans.map((item) => [item.plan.id, item.plan.title])),
    [plans]
  )
  const paymentOptions = useMemo(() => {
    const next: Array<{ key: string; label: string; variant: 'primary' | 'secondary' }> = []
    if (paymentInfo?.enable_wallet_payment) {
      next.push({ key: 'wallet', label: '钱包购买', variant: 'primary' })
    }
    return next
  }, [paymentInfo])
  const paymentStatusLabel = paymentOptions.length > 0 ? '可购买' : '待配置'

  function resolveSubscriptionUsagePrefix(planId: number) {
    const resetPeriod = planById.get(planId)?.quota_reset_period
    switch (resetPeriod) {
      case 'daily':
        return '当日已用'
      case 'weekly':
        return '当周已用'
      case 'monthly':
        return '当月已用'
      case 'custom':
        return '本周期已用'
      default:
        return '已用'
    }
  }

  const refreshSubscriptions = useCallback(async () => {
    const [nextPlans, nextSelf, nextPaymentInfo, nextStatus] = await Promise.all([
      getPublicPlans(),
      getSelfSubscriptions(),
      getSubscriptionPaymentInfo(),
      unwrapEnvelope(getAuthStatus()).catch(() => null),
    ])
    setPlans(nextPlans.filter((item) => item.plan.enabled))
    setSubscriptionSelf(nextSelf)
    setPaymentInfo(nextPaymentInfo ?? null)
    const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
    if (resolvedQuotaPerUnit > 0) {
      setQuotaPerUnit(resolvedQuotaPerUnit)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextPlans, nextSelf, nextPaymentInfo, nextStatus] = await Promise.all([
          getPublicPlans(),
          getSelfSubscriptions(),
          getSubscriptionPaymentInfo(),
          unwrapEnvelope(getAuthStatus()).catch(() => null),
        ])

        if (disposed) {
          return
        }

        setPlans(nextPlans.filter((item) => item.plan.enabled))
        setSubscriptionSelf(nextSelf)
        setPaymentInfo(nextPaymentInfo ?? null)
        const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
        if (resolvedQuotaPerUnit > 0) {
          setQuotaPerUnit(resolvedQuotaPerUnit)
        }
      } catch (error) {
        if (!disposed) {
          toast(error instanceof Error ? error.message : '加载订阅信息失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [toast])

  async function handleBuyPlan(planId: number, paymentMethod: string) {
    setBuyingPlanId(planId)
    try {
      const result = await paySubscription(planId, paymentMethod)
      const externalUrl = result?.checkout_url || result?.pay_link
      if (externalUrl) {
        await getDesktopBridge().openExternal(externalUrl)
      }
      toast(result?.notice || '订阅请求已发起。')
      await refreshSubscriptions()
    } catch (error) {
      toast(error instanceof Error ? error.message : '购买套餐失败')
    } finally {
      setBuyingPlanId(0)
    }
  }

  return (
    <section className='workspace-page full-bleed-page'>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <h2>套餐订阅</h2>
          </div>
        </div>

        <div className='panel-scroll'>
          <div className='stats-inline page-stats-grid'>
            <div className='mini-stat'>
              <strong>{plans.length}</strong>
              <span>可选套餐</span>
            </div>
            <div className='mini-stat'>
              <strong>{activeSubscriptions.length}</strong>
              <span>当前生效订阅</span>
            </div>
            <div className='mini-stat'>
              <strong>{allSubscriptions.length}</strong>
              <span>全部订阅记录</span>
            </div>
            <div className='mini-stat'>
              <strong>{paymentStatusLabel}</strong>
              <span>支付状态</span>
            </div>
          </div>

          <div className='content-grid subscription-layout'>
            <div className='subscription-grid wide-grid'>
              {plans.length === 0 ? (
                <EmptyState title='当前没有可购买套餐' description='请稍后刷新或检查服务端套餐配置。' />
              ) : (
                plans.map((item) => {
                  const purchaseLimit = Number(item.plan.max_purchase_per_user || 0)
                  const purchaseCount = countPlanPurchases(allSubscriptions, item.plan.id)
                  const limitReached = purchaseLimit > 0 && purchaseCount >= purchaseLimit
                  const buying = buyingPlanId === item.plan.id
                  const isRecommended = item.plan.id === recommendedPlanId
                  const quotaUsd = Number(item.plan.total_amount || 0) > 0 ? formatQuotaAsUsd(item.plan.total_amount, quotaPerUnit) : '不限额度'
                  const quotaMillion = Number(item.plan.total_amount || 0) > 0 ? formatQuotaAsMillions(item.plan.total_amount) : 'unlimited'
                  const resetRule = formatSubscriptionResetPeriod(item.plan)
                  const validity = formatSubscriptionDuration(item.plan)
                  const planBadge = resolveSubscriptionPlanBadge(item.plan)

                  return (
                    <article
                      key={item.plan.id}
                      className={`pricing-card subscription-plan-card ${isRecommended ? 'recommended' : ''} ${limitReached ? 'limit-reached' : ''}`}
                    >
                      <div className='subscription-plan-badge-row'>
                        <div className='subscription-plan-badge-group'>
                          <span className={`subscription-plan-badge ${planBadge.tone === 'annual' ? 'annual' : 'subtle'}`}>
                            {planBadge.label}
                          </span>
                          {isRecommended ? (
                            <span className='subscription-plan-badge recommended'>
                              <Sparkles size={14} />
                              <span>推荐</span>
                            </span>
                          ) : null}
                        </div>
                        {purchaseLimit > 0 ? (
                          <span className={`subscription-plan-badge ${limitReached ? 'muted' : 'subtle'}`}>
                            限购 {purchaseCount}/{purchaseLimit}
                          </span>
                        ) : null}
                      </div>

                      <div className='subscription-plan-head'>
                        <strong>{item.plan.title}</strong>
                        <span className='subscription-plan-subtitle'>
                          {item.plan.subtitle || '适合稳定桌面端高频使用。'}
                        </span>
                      </div>

                      <div className='subscription-plan-price-group'>
                        <div className='subscription-plan-price-row'>
                          <b>{formatPlainPrice(item.plan.price_amount)}</b>
                          <span className='subscription-plan-price-unit'>人民币</span>
                        </div>
                      </div>

                      <div className='subscription-plan-quota'>
                        <span className='subscription-plan-quota-label'>总额度</span>
                        <div className='subscription-plan-quota-values'>
                          <strong>{quotaUsd}</strong>
                          <strong className='subscription-plan-quota-divider'>|</strong>
                          <strong className='subscription-plan-token-value'>{`${quotaMillion} Token`}</strong>
                        </div>
                      </div>

                      <div className='subscription-plan-meta'>
                        <span>{`有效期 ${validity}`}</span>
                        <span>{`重置规则 ${resetRule}`}</span>
                      </div>

                      <div className='pricing-actions subscription-plan-actions'>
                        {paymentOptions.length > 0 ? (
                          paymentOptions.map((option) => (
                            <button
                              key={`${item.plan.id}-${option.key}`}
                              className={`${option.variant === 'primary' ? 'primary-button' : 'secondary-button'} tiny`}
                              type='button'
                              disabled={buying || limitReached}
                              onClick={() => void handleBuyPlan(item.plan.id, option.key)}
                            >
                              {limitReached ? '已达上限' : option.label}
                            </button>
                          ))
                        ) : (
                          <button className='ghost-button tiny' type='button' disabled>
                            暂无可用支付方式
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>

            <div className='subscription-side-column'>
              <div className='panel-block'>
                <div className='list-block-header'>
                  <strong>已有订阅</strong>
                  <span>查看当前订阅状态与额度使用情况</span>
                </div>
                <div className='subrecords'>
                  {allSubscriptions.length === 0 ? (
                    <EmptyState title='还没有订阅记录' description='购买套餐后会在这里看到订阅状态和用量。' />
                  ) : (
                    allSubscriptions.map((item) => (
                      <div key={item.subscription.id} className='record-row subscription-record-row'>
                        <div className='subscription-record-main'>
                          <strong>{planTitleMap.get(item.subscription.plan_id) || `订阅 #${item.subscription.id}`}</strong>
                          <span>
                            {resolveSubscriptionUsagePrefix(item.subscription.plan_id)} {formatQuotaAsUsd(item.subscription.amount_used, quotaPerUnit)} /{' '}
                            {Number(item.subscription.amount_total || 0) > 0
                              ? formatQuotaAsUsd(item.subscription.amount_total, quotaPerUnit)
                              : '不限额度'}
                          </span>
                          <small>
                            有效至 {formatDateTime(item.subscription.end_time)}
                            {item.subscription.next_reset_time ? ` · 下次重置 ${formatDateTime(item.subscription.next_reset_time)}` : ''}
                          </small>
                        </div>
                        <div className='subscription-record-side'>
                          <div className='subscription-progress-inline'>
                            <div className='usage-bar-track'>
                              <div
                                className='usage-bar-fill'
                                style={{ width: `${percentageOf(item.subscription.amount_used, item.subscription.amount_total)}%` }}
                              />
                            </div>
                          </div>
                          <small className='subscription-record-status'>{resolveSubscriptionStatusLabel(item.subscription.status)}</small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  )
}

function WalletWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
}) {
  const { user, toast } = props
  const [quotaPerUnit, setQuotaPerUnit] = useState(500_000)
  const [billing, setBilling] = useState<BillingHistoryData | null>(null)
  const [walletPlans, setWalletPlans] = useState<PlanRecord[]>([])
  const [walletSubscriptionSelf, setWalletSubscriptionSelf] = useState<SubscriptionSelfData | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [perfMetrics, setPerfMetrics] = useState<{ requestCount24h: number; avgLatencyMs: number } | null>(null)
  const [usageDistributionPage, setUsageDistributionPage] = useState(0)

  const recentBills = useMemo(
    () =>
      [...(billing?.items || [])]
        .sort((left, right) => Number(right.create_time || 0) - Number(left.create_time || 0))
        .slice(0, 3),
    [billing?.items]
  )
  const completedBillCount = recentBills.filter((item) => item.status === 'success').length
  const walletBalance = Number(user.quota || 0)
  const tokenBalance = Number(user.quota || 0)
  const tokenExpense = Number(user.used_quota || 0)
  const requestCount24h = perfMetrics?.requestCount24h ?? 0
  const modelSummary = useMemo(
    () => usageModelSummary(usageData?.items || []),
    [usageData?.items]
  )
  const totalQuota = modelSummary.reduce((sum, item) => sum + item.quota, 0)
  const usageDistributionPageSize = 5
  const usageDistributionPageCount = Math.max(1, Math.ceil(modelSummary.length / usageDistributionPageSize))
  const visibleUsageModels = modelSummary.slice(
    usageDistributionPage * usageDistributionPageSize,
    usageDistributionPage * usageDistributionPageSize + usageDistributionPageSize
  )
  const avgTpm = useMemo(() => {
    const logs = usageData?.items || []
    const timestamps = logs
      .map((item) => Number(item.created_at || item.created_time || 0))
      .filter((value) => value > 0)
      .sort((left, right) => left - right)
    if (timestamps.length < 2) {
      return 0
    }
    const timeDiff = (timestamps.at(-1)! - timestamps[0]) / 60000
    return timeDiff > 0 ? totalQuota / timeDiff : 0
  }, [totalQuota, usageData?.items])
  const avgLatency = perfMetrics?.avgLatencyMs ?? 0
  const subscriptionUsageByTitle = useMemo(() => {
    const planTitleMap = new Map(walletPlans.map((item) => [item.plan.id, item.plan.title]))
    const records = walletSubscriptionSelf?.all_subscriptions || []
    const next = new Map<
      string,
      {
        updatedAt: number
        percentage: number
      }
    >()

    for (const item of records) {
      const title = planTitleMap.get(item.subscription.plan_id)?.trim()
      if (!title) {
        continue
      }

      const updatedAt = Number(item.subscription.end_time || item.subscription.start_time || item.subscription.id || 0)
      const current = next.get(title)
      if (current && current.updatedAt > updatedAt) {
        continue
      }

      next.set(title, {
        updatedAt,
        percentage: percentageOf(item.subscription.amount_used, item.subscription.amount_total),
      })
    }

    return next
  }, [walletPlans, walletSubscriptionSelf])

  function formatBillingLabel(item: BillingHistoryData['items'][number]) {
    if (item.plan_title?.trim()) {
      return item.plan_title.trim()
    }
    const trade = String(item.trade_no || '').replace(/SUBWALLETUSR1NO[a-zA-Z0-9_-]*/g, '').trim()
    const payment = String(item.payment_method || '').replace(/^wallet$/i, '').trim()
    return trade || payment || '购买记录'
  }

  function resolveBillingUsagePercentage(item: BillingHistoryData['items'][number]) {
    const title = item.plan_title?.trim()
    if (!title) {
      return 0
    }
    return subscriptionUsageByTitle.get(title)?.percentage || 0
  }

  const refreshWallet = useCallback(async () => {
    const [nextBilling, nextPlans, nextSelf, nextStatus] = await Promise.all([
      getBillingHistory(1, 3),
      getPublicPlans().catch(() => []),
      getSelfSubscriptions().catch(() => null),
      unwrapEnvelope(getAuthStatus()).catch(() => null),
    ])
    setBilling(nextBilling ?? null)
    setWalletPlans((nextPlans || []).filter((item) => item.plan.enabled))
    setWalletSubscriptionSelf(nextSelf)
    const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
    if (resolvedQuotaPerUnit > 0) {
      setQuotaPerUnit(resolvedQuotaPerUnit)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextBilling, nextUsageData, nextPerfMetrics, nextPlans, nextSelf, nextStatus] = await Promise.all([
          getBillingHistory(1, 3),
          getUserUsageLogs(1, 200),
          getPerfMetricsSummary(24).catch(() => null),
          getPublicPlans().catch(() => []),
          getSelfSubscriptions().catch(() => null),
          unwrapEnvelope(getAuthStatus()).catch(() => null),
        ])

        if (disposed) {
          return
        }

        setBilling(nextBilling ?? null)
        setUsageData(nextUsageData ?? null)
        setWalletPlans((nextPlans || []).filter((item) => item.plan.enabled))
        setWalletSubscriptionSelf(nextSelf)
        const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
        if (resolvedQuotaPerUnit > 0) {
          setQuotaPerUnit(resolvedQuotaPerUnit)
        }
        if (nextPerfMetrics?.models?.length) {
          const requestCount = nextPerfMetrics.models.reduce((sum, item) => sum + Number(item.request_count || 0), 0)
          const latencyTotal = nextPerfMetrics.models.reduce((sum, item) => {
            const requestCount = Number(item.request_count || 0)
            const latency = Number(item.avg_latency_ms || 0)
            return sum + latency * requestCount
          }, 0)
          setPerfMetrics({
            requestCount24h: requestCount,
            avgLatencyMs: requestCount > 0 ? Math.round(latencyTotal / requestCount) : 0,
          })
        }
      } catch (error) {
        if (!disposed) {
          toast(error instanceof Error ? error.message : '加载钱包信息失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [toast])

  useEffect(() => {
    setUsageDistributionPage((current) => Math.min(current, usageDistributionPageCount - 1))
  }, [usageDistributionPageCount])

  async function handleRedeem() {
    if (!redeemCode.trim()) {
      toast('请输入兑换码。')
      return
    }
    try {
      await redeemTopupCode(redeemCode.trim())
      setRedeemCode('')
      toast('兑换成功，钱包余额已刷新。')
      await refreshWallet()
    } catch (error) {
      toast(error instanceof Error ? error.message : '兑换失败')
    }
  }

  return (
    <section className='workspace-page full-bleed-page'>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <h2>用量账单</h2>
          </div>
        </div>

        <div className='panel-scroll'>
          <div className='panel-block hero-panel-block wallet-overview-card wallet-overview-top'>
            <div className='wallet-overview-head'>
              <div>
                <span className='eyebrow dark'>账户统计</span>
                <h3>钱包总览</h3>
              </div>
              <span className='metric-pill success'>已完成账单 {completedBillCount}</span>
            </div>
            <div className='wallet-overview-grid'>
              <div className='wallet-overview-metric'>
                <strong>{formatQuotaAsUsd(walletBalance, quotaPerUnit)}</strong>
                <span>当前余额</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(tokenBalance)}</strong>
                <span>Token 余额</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(tokenExpense)}</strong>
                <span>Token 消耗</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(requestCount24h)}</strong>
                <span>请求数（24 小时）</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(avgTpm)}</strong>
                <span>平均 TPM</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(avgLatency)}</strong>
                <span>平均延迟</span>
              </div>
            </div>
          </div>

          <div className='content-grid wallet-grid'>
            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>充值与兑换</strong>
                <span>仅保留兑换充值码入口</span>
              </div>
              <div className='subform'>
                <input
                  value={redeemCode}
                  onChange={(event) => setRedeemCode(event.target.value)}
                  placeholder='输入兑换码'
                />
                <button className='secondary-button full' type='button' onClick={() => void handleRedeem()}>
                  兑换充值码
                </button>
              </div>
            </div>

            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>最近账单</strong>
                <span>最近的充值、兑换与支付记录</span>
              </div>
              <div className='subrecords'>
                {(billing?.items || []).length === 0 ? (
                  <EmptyState title='当前没有账单记录' description='充值、兑换或订阅支付后会显示在这里。' />
                ) : (
                  <div className='billing-grid'>
                    {recentBills.map((item, index) => (
                      <div key={String(item.trade_no || index)} className='billing-card'>
                        <div
                          className='billing-card-fill'
                          style={{
                            width: `${resolveBillingUsagePercentage(item)}%`,
                          }}
                        />
                        <div className='billing-card-inner'>
                          <strong>{formatBillingLabel(item)}</strong>
                          <span>{formatPrice(item.money || item.amount || 0, 'CNY')}</span>
                          <small>{item.status === 'success' ? '已完成' : item.status === 'pending' ? '处理中' : '已过期'}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>消耗分布</strong>
                <span>按模型统计当前账户的额度消耗</span>
              </div>
              {modelSummary.length === 0 ? (
                <EmptyState title='当前没有用量记录' description='模型调用后会在这里显示消耗分布。' />
              ) : (
                <>
                  <div className='usage-bars'>
                    {visibleUsageModels.map((item) => (
                      <div key={item.model} className='usage-bar-row'>
                        <div className='usage-bar-head'>
                          <strong>{item.model}</strong>
                          <span>
                            {formatQuota(item.quota)}
                            <b>|</b>
                            占比 {percentageOf(item.quota, totalQuota).toFixed(1)}%
                          </span>
                        </div>
                        <div className='usage-bar-track'>
                          <div className='usage-bar-fill' style={{ width: `${percentageOf(item.quota, totalQuota)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {usageDistributionPageCount > 1 ? (
                    <div className='usage-distribution-pager'>
                      <button
                        className='ghost-button tiny'
                        type='button'
                        disabled={usageDistributionPage <= 0}
                        onClick={() => setUsageDistributionPage((current) => Math.max(0, current - 1))}
                      >
                        上一页
                      </button>
                      <span>{usageDistributionPage + 1} / {usageDistributionPageCount}</span>
                      <button
                        className='ghost-button tiny'
                        type='button'
                        disabled={usageDistributionPage >= usageDistributionPageCount - 1}
                        onClick={() => setUsageDistributionPage((current) => Math.min(usageDistributionPageCount - 1, current + 1))}
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>模型调用分析</strong>
                <span>按时间轴绘制各模型的额度消耗曲线</span>
              </div>
              <UsageTrendChart items={usageData?.items || []} />
            </div>
          </div>
        </div>
      </article>
    </section>
  )
}

function ServiceStatusWorkspace(props: {
  toast: (message: string) => void
}) {
  const { toast } = props
  const initialServiceStatusCache = useMemo(() => readServiceStatusCache(), [])
  const [serviceStatusItems, setServiceStatusItems] = useState<ServiceStatusItem[]>(initialServiceStatusCache.items)
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false)
  const [serviceStatusError, setServiceStatusError] = useState('')
  const [serviceStatusRefreshedAt, setServiceStatusRefreshedAt] = useState(initialServiceStatusCache.refreshedAt)
  const [serviceStatusTooltip, setServiceStatusTooltip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const [, setServiceStatusMode] = useState<'status-page' | 'channel-test'>(initialServiceStatusCache.mode)
  const serviceStatusRequestedRef = useRef(false)
  const serviceStatusRefreshingRef = useRef(false)

  const resolveServiceStatusLabel = useCallback((item: ServiceStatusItem) => {
    switch (item.tone) {
      case 'up':
        return { text: '运行正常', className: 'success' }
      case 'down':
        return { text: '服务异常', className: 'danger' }
      case 'maintenance':
        return { text: '维护中', className: 'warn' }
      default:
        return { text: '状态未知', className: 'muted' }
    }
  }, [])

  const resolveServiceStatusHistoryTitle = useCallback(
    (item: ServiceStatusItem, checkedAt: number, index: number) => {
      const history = item.history || []
      const target = history[index]
      const statusText = target
        ? resolveServiceStatusLabel({ ...item, tone: target.tone }).text
        : resolveServiceStatusLabel(item).text
      const latencyText = target?.latencyMs ? ` · 延迟 ${target.latencyMs} ms` : ''
      const detailText = target?.detail?.trim() ? ` · ${target.detail.trim()}` : ''
      return `${formatDateTime(checkedAt)} · ${statusText}${latencyText}${detailText}`
    },
    [resolveServiceStatusLabel]
  )

  const refreshServiceStatus = useCallback(async () => {
    if (serviceStatusRefreshingRef.current) {
      return
    }
    serviceStatusRefreshingRef.current = true
    setServiceStatusLoading(true)
    setServiceStatusError('')
    try {
      const snapshot = await getServiceStatusSnapshot()
      const nextItems = snapshot.items.map((item) => ({
        ...item,
        history: item.history || [],
      }))
      const refreshedAt = Number(snapshot.refreshedAt || 0) > 0 ? Number(snapshot.refreshedAt) : Date.now()

      setServiceStatusItems(nextItems)
      setServiceStatusMode(snapshot.mode)
      setServiceStatusRefreshedAt(refreshedAt)
      writeServiceStatusCache({
        items: nextItems,
        refreshedAt,
        mode: snapshot.mode,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载服务状态失败'
      setServiceStatusError(message)
      if (serviceStatusItems.length === 0) {
        toast(message)
      }
    } finally {
      serviceStatusRefreshingRef.current = false
      setServiceStatusLoading(false)
    }
  }, [serviceStatusItems.length, toast])

  useEffect(() => {
    if (!serviceStatusRequestedRef.current) {
      serviceStatusRequestedRef.current = true
      void refreshServiceStatus()
    }
    const intervalId = window.setInterval(() => {
      void refreshServiceStatus()
    }, SERVICE_STATUS_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [refreshServiceStatus])

  useEffect(() => {
    function handlePointerDown(event: globalThis.PointerEvent) {
      if (event.target instanceof Element && event.target.closest('.service-status-history-dot')) {
        return
      }
      setServiceStatusTooltip(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  return (
    <section className='workspace-page full-bleed-page'>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <h2>服务状态</h2>
          </div>
          <div className='inline-actions'>
            <button
              className='ghost-button icon-only tiny'
              type='button'
              onClick={() => void refreshServiceStatus()}
              title='刷新服务状态'
              aria-label='刷新服务状态'
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className='panel-scroll'>
          <div className='panel-block'>
            <div className='list-block-header'>
              <strong>渠道运行状态</strong>
              <span>最近状态变化</span>
            </div>
            {serviceStatusRefreshedAt ? <small className='muted'>{`最后更新：${formatDateTime(serviceStatusRefreshedAt)}`}</small> : null}
            {serviceStatusLoading && serviceStatusItems.length === 0 ? (
              <EmptyState title='正在读取服务状态' description='正在同步服务器已配置渠道状态。' />
            ) : serviceStatusError && serviceStatusItems.length === 0 ? (
              <EmptyState title='服务状态读取失败' description={serviceStatusError} />
            ) : serviceStatusItems.length === 0 ? (
              <EmptyState title='当前没有可展示的服务状态' description='服务器尚未配置 Claude、Codex、Gemini、DeepSeek 或 XiaomiMIMO 渠道。' />
            ) : (
              <>
                {serviceStatusError ? <small className='muted'>{`刷新失败，当前展示缓存结果：${serviceStatusError}`}</small> : null}
                <div className='service-status-grid'>
                  {serviceStatusItems.map((item) => {
                    const statusMeta = resolveServiceStatusLabel(item)
                    return (
                      <div key={item.id} className='service-status-card'>
                        <div className='service-status-card-head'>
                          <div>
                            <strong>{item.title}</strong>
                            {item.subtitle ? <span>{item.subtitle}</span> : null}
                          </div>
                          <span className={`service-status-pill ${statusMeta.className}`}>{statusMeta.text}</span>
                        </div>
                        {item.history?.length ? (
                          <div className='service-status-history' aria-label={`${item.title} 最近状态历史`}>
                            {item.history.map((entry, index) => {
                              const historyMeta = resolveServiceStatusLabel({ ...item, tone: entry.tone })
                              return (
                                <span
                                  key={`${item.id}-history-${entry.checkedAt}-${index}`}
                                  className={`service-status-history-dot ${historyMeta.className}`}
                                  role='button'
                                  tabIndex={0}
                                  aria-label={resolveServiceStatusHistoryTitle(item, entry.checkedAt, index)}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setServiceStatusTooltip({
                                      x: event.clientX,
                                      y: event.clientY,
                                      text: resolveServiceStatusHistoryTitle(item, entry.checkedAt, index),
                                    })
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') {
                                      return
                                    }
                                    event.preventDefault()
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    setServiceStatusTooltip({
                                      x: rect.left + rect.width / 2,
                                      y: rect.top + rect.height / 2,
                                      text: resolveServiceStatusHistoryTitle(item, entry.checkedAt, index),
                                    })
                                  }}
                                />
                              )
                            })}
                          </div>
                        ) : null}
                        <div className='service-status-card-meta'>
                          {item.latencyMs ? <small>{`延迟 ${item.latencyMs} ms`}</small> : null}
                          {item.checkedAt ? <small>{`检测时间 ${formatDateTime(item.checkedAt)}`}</small> : null}
                        </div>
                        {item.detail ? <p>{item.detail}</p> : null}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {serviceStatusTooltip ? createPortal(
              <div
                className='service-status-point-tooltip'
                style={{
                  left: serviceStatusTooltip.x,
                  top: serviceStatusTooltip.y,
                }}
              >
                {serviceStatusTooltip.text}
              </div>,
              document.body
            ) : null}
          </div>
        </div>
      </article>
    </section>
  )
}

function resolveNextClientKeyName(keys: Array<{ name?: string }>) {
  const used = new Set(
    keys
      .map((item) => item.name?.trim())
      .filter((name): name is string => Boolean(name))
  )
  let index = 1
  while (used.has(`ClientKey_${index}`)) {
    index += 1
  }
  return `ClientKey_${index}`
}

function MeWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
  themeMode: ThemeMode
  onToggleTheme: () => void
  visible: boolean
}) {
  const { user, toast, themeMode, onToggleTheme, visible } = props
  const [apiKeys, setApiKeys] = useState<
    Array<{
      id: number
      name: string
      status: number
      group?: string
      remain_quota: number
      created_time: number
    }>
  >([])
  const [passwordGateOpen, setPasswordGateOpen] = useState(false)
  const [passwordGatePurpose, setPasswordGatePurpose] = useState<'view-key' | 'create-key' | 'view-token'>('view-key')
  const [passwordInput, setPasswordInput] = useState('')
  const [pendingKeyId, setPendingKeyId] = useState<number | null>(null)
  const [revealedKey, setRevealedKey] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [accessTokenVisible, setAccessTokenVisible] = useState(false)
  const [activeDeployClient, setActiveDeployClient] = useState<CliClient | null>(null)
  const [mobileBridgeDevice, setMobileBridgeDevice] = useState<MobileDesktopDevice | null>(null)
  const [mobileBridgeLoading, setMobileBridgeLoading] = useState(false)

  const refreshMe = useCallback(async () => {
    const nextKeys = await getApiKeys()
    setApiKeys(nextKeys?.items ?? [])
  }, [])

  const refreshMobileBridge = useCallback(async () => {
    setMobileBridgeLoading(true)
    try {
      const [localDevice, devices] = await Promise.all([
        getLocalMobileBridgeDevice(),
        getMobileDesktopDevices(),
      ])
      const registered = devices.find((item) => item.deviceId === localDevice.deviceId)
      setMobileBridgeDevice({
        deviceId: localDevice.deviceId,
        name: registered?.name || localDevice.name,
        platform: registered?.platform || localDevice.platform,
        clientVersion: registered?.clientVersion || localDevice.clientVersion,
        status: registered?.status || 'online',
        lastSeenAt: registered?.lastSeenAt || Date.now(),
        lastError: registered?.lastError,
        bound: registered?.bound,
        boundAppId: registered?.boundAppId,
        boundAppName: registered?.boundAppName,
        boundAt: registered?.boundAt,
      })
    } finally {
      setMobileBridgeLoading(false)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const nextKeys = await getApiKeys()

        if (disposed) {
          return
        }

        setApiKeys(nextKeys?.items ?? [])
      } catch (error) {
        if (!disposed) {
          toast(error instanceof Error ? error.message : '加载账户信息失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [toast])

  useEffect(() => {
    if (!visible) {
      return
    }
    const timer = window.setTimeout(() => {
      void refreshMobileBridge().catch((error) => {
        toast(error instanceof Error ? error.message : '加载设备绑定状态失败')
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshMobileBridge, toast, visible])

  function openPasswordGate(purpose: 'view-key' | 'create-key', keyId?: number) {
    if (isVerificationStillValid(user.id)) {
      void continueAfterVerification(purpose, keyId)
      return
    }
    setPasswordGatePurpose(purpose)
    setPendingKeyId(keyId ?? null)
    setPasswordInput('')
    setPasswordGateOpen(true)
  }

  async function continueAfterVerification(
    purpose: 'view-key' | 'create-key' | 'view-token',
    keyId?: number
  ) {
    if (purpose === 'view-key' && keyId) {
      try {
        const secret = await fetchApiKeySecret(keyId)
        setRevealedKey(secret)
      } catch (error) {
        toast(error instanceof Error ? error.message : '读取 Key 失败')
      }
      return
    }

    if (purpose === 'create-key') {
      try {
        const result = await ensureDesktopServiceKey({
          name: resolveNextClientKeyName(apiKeys),
          group: user.group || '',
          preferredNames: apiKeys.map((item) => item.name),
        })
        setRevealedKey(result.key)
        toast(result.reused ? '已复用服务器现有有效 Key。' : '新的 API Key 已创建。')
        await refreshMe()
      } catch (error) {
        toast(error instanceof Error ? error.message : '创建 Key 失败')
      }
    }

    if (purpose === 'view-token') {
      const nextAccessToken = await requireSuccess(generateAccessToken())
      setAccessToken(nextAccessToken ?? '')
      setAccessTokenVisible(true)
      toast('已生成新的系统访问令牌。')
    }
  }

  async function handleRevealAccessToken() {
    if (isVerificationStillValid(user.id)) {
      setAccessTokenVisible(true)
      return
    }

    setPasswordGatePurpose('view-token')
    setPendingKeyId(null)
    setPasswordInput('')
    setPasswordGateOpen(true)
  }

  async function handlePasswordVerify() {
    try {
      await verifyCurrentPassword(user, passwordInput)
      markVerificationValid(user.id)
      setPasswordGateOpen(false)
      await continueAfterVerification(passwordGatePurpose, pendingKeyId ?? undefined)
    } catch (error) {
      toast(error instanceof Error ? error.message : '密码验证失败')
    }
  }

  async function handleUnbindMobileDevice() {
    if (!mobileBridgeDevice) {
      return
    }
    try {
      setMobileBridgeLoading(true)
      await deleteMobileDesktopBinding(mobileBridgeDevice.deviceId, mobileBridgeDevice.boundAppId)
      toast('设备绑定已解除。')
      await refreshMobileBridge()
    } catch (error) {
      toast(error instanceof Error ? error.message : '解除绑定失败')
    } finally {
      setMobileBridgeLoading(false)
    }
  }

  async function handleSwitchMobileDeviceBinding() {
    if (!mobileBridgeDevice) {
      return
    }
    try {
      setMobileBridgeLoading(true)
      if (mobileBridgeDevice.bound) {
        await deleteMobileDesktopBinding(mobileBridgeDevice.deviceId, mobileBridgeDevice.boundAppId)
      }
      await deleteMobileDesktopDevice(mobileBridgeDevice.deviceId).catch(() => undefined)
      const nextDevice = await resetLocalMobileBridgeDevice()
      setMobileBridgeDevice({
        deviceId: nextDevice.deviceId,
        name: nextDevice.name,
        platform: nextDevice.platform,
        clientVersion: nextDevice.clientVersion,
        status: 'online',
        lastSeenAt: Date.now(),
      })
      toast('本机绑定标识已更换，请在 Android 端重新绑定。')
      await refreshMobileBridge()
    } catch (error) {
      toast(error instanceof Error ? error.message : '更换绑定失败')
    } finally {
      setMobileBridgeLoading(false)
    }
  }

  return (
    <>
      <section className={`workspace-page full-bleed-page ${visible ? '' : 'workspace-hidden'}`}>
        <article className='panel scroll-panel page-surface'>
          <div className='panel-header compact'>
            <div>
              <h2>账户与部署</h2>
            </div>
            <div className='inline-actions'>
              <button
                className='ghost-button tiny theme-toggle-button'
                type='button'
                onClick={onToggleTheme}
                title={themeMode === 'dark' ? '切换到明亮模式' : '切换到暗黑模式'}
                aria-label={themeMode === 'dark' ? '切换到明亮模式' : '切换到暗黑模式'}
              >
                {themeMode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                <span>{themeMode === 'dark' ? '明亮' : '暗黑'}</span>
              </button>
            </div>
          </div>

          <div className='panel-scroll'>
            <div className='content-grid me-layout page-blocks'>
              <div className='me-column me-column-left'>
                <div className='panel-block me-user-card'>
                  <div className='subrecords'>
                    <div className='record-row highlighted'>
                      <div>
                        <strong>{user.display_name || user.username}</strong>
                        <span>{user.username} · {user.email || '未绑定邮箱'}</span>
                      </div>
                      <small>组 {user.group}</small>
                    </div>
                    <div className='record-row'>
                      <div>
                        <strong>系统访问令牌</strong>
                        <span>
                          {accessTokenVisible
                            ? accessToken || '当前没有可显示的系统访问令牌。'
                            : '默认隐藏。验证密码后会生成新的系统访问令牌，并使旧令牌失效。'}
                        </span>
                      </div>
                      <div className='record-actions'>
                        <small>高敏感</small>
                        <button className='ghost-button' type='button' onClick={() => void handleRevealAccessToken()}>
                          {accessTokenVisible ? '已显示' : '查看'}
                        </button>
                        {accessTokenVisible && (
                          <button
                            className='ghost-button'
                            type='button'
                            onClick={() => {
                              void navigator.clipboard.writeText(accessToken)
                              toast('系统访问令牌已复制。')
                            }}
                          >
                            复制
                          </button>
                        )}
                      </div>
                    </div>
                    <div className='record-row'>
                      <div>
                        <strong>账户额度</strong>
                        <span>剩余额度 {formatQuota(user.quota)} · 已用 {formatQuota(user.used_quota)}</span>
                      </div>
                      <small>请求数 {user.request_count}</small>
                    </div>
                  </div>
                </div>

                <div className='panel-block me-device-binding-card'>
                  <div className='list-block-header'>
                    <strong>设备绑定</strong>
                    <div className='inline-actions'>
                      <button
                        className='ghost-button tiny'
                        type='button'
                        onClick={() => void refreshMobileBridge().catch((error) => {
                          toast(error instanceof Error ? error.message : '刷新设备绑定失败')
                        })}
                        disabled={mobileBridgeLoading}
                      >
                        <RotateCcw size={14} />
                        <span>刷新</span>
                      </button>
                    </div>
                  </div>
                  <div className='subrecords'>
                    <div className='mobile-bridge-info-row'>
                      <div className='record-row highlighted'>
                        <div>
                          <strong>{mobileBridgeDevice?.name || '本机客户端'}</strong>
                          <span>
                            {mobileBridgeDevice?.platform || 'desktop'} · {mobileBridgeDevice?.clientVersion || '当前版本'}
                          </span>
                        </div>
                        <small>{mobileBridgeDevice?.status === 'degraded' ? '异常' : '在线'}</small>
                      </div>
                      <div className='record-row'>
                        <div>
                          <strong>本机标识</strong>
                          <span>{mobileBridgeDevice?.deviceId || '正在读取本机设备标识'}</span>
                        </div>
                        <small>{mobileBridgeLoading ? '同步中' : '已启用'}</small>
                      </div>
                    </div>
                    <div className='mobile-bridge-action-row'>
                        <button
                          className='ghost-button'
                          type='button'
                          onClick={() => void handleUnbindMobileDevice()}
                          disabled={!mobileBridgeDevice?.bound || mobileBridgeLoading}
                        >
                          解除绑定
                        </button>
                        <button
                          className='secondary-button'
                          type='button'
                          onClick={() => void handleSwitchMobileDeviceBinding()}
                          disabled={!mobileBridgeDevice || mobileBridgeLoading}
                        >
                          更换绑定
                        </button>
                    </div>
                  </div>
                </div>

                <div className='panel-block me-key-list-card'>
                  <div className='list-block-header'>
                    <strong>已有 Key</strong>
                    <button
                      className='secondary-button tiny'
                      type='button'
                      onClick={() => openPasswordGate('create-key')}
                    >
                      <Plus size={14} />
                      <span>新建 Key</span>
                    </button>
                  </div>
                  <div className='subrecords'>
                    {apiKeys.length === 0 ? (
                      <EmptyState title='当前还没有 API Key' description='验证密码后即可直接新建桌面端专用 Key。' />
                    ) : (
                      <div className='me-key-grid'>
                        {apiKeys.map((item) => (
                          <div key={item.id} className='record-row me-key-record'>
                            <div>
                              <strong>{item.name}</strong>
                              <span>{item.group || 'default'} · 创建于 {formatDateTime(item.created_time)}</span>
                            </div>
                            <div className='record-actions'>
                              <small>{item.status === 1 ? '启用中' : '已停用'}</small>
                              <button
                                className='ghost-button icon-only'
                                type='button'
                                title='查看 Key'
                                aria-label='查看 Key'
                                onClick={() => openPasswordGate('view-key', item.id)}
                              >
                                <Eye size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {revealedKey && (
                      <div className='key-reveal'>
                        <strong>最近查看 / 创建的 Key</strong>
                        <code>{revealedKey}</code>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className='me-column me-column-right'>
                <CliSetupCard
                  client='claude'
                  user={user}
                  toast={toast}
                  className='me-claude-card'
                  activeDeployClient={activeDeployClient}
                  setActiveDeployClient={setActiveDeployClient}
                />
                <CliSetupCard
                  client='codex'
                  user={user}
                  toast={toast}
                  className='me-codex-card'
                  activeDeployClient={activeDeployClient}
                  setActiveDeployClient={setActiveDeployClient}
                />
              </div>
            </div>
          </div>
        </article>
      </section>

      {passwordGateOpen && (
        <div className='modal-mask'>
          <div className='modal-card'>
            <div className='panel-header compact'>
              <div>
                <span className='eyebrow dark'>安全验证</span>
                <h2>请输入账户密码</h2>
              </div>
            </div>
            <p className='modal-copy'>
              本次验证通过后，30 分钟内查看 Key 或新建 Key 不再重复要求输入密码。
            </p>
            <PasswordField
              value={passwordInput}
              onChange={setPasswordInput}
              placeholder='输入当前账号密码'
            />
            <div className='modal-actions'>
              <button className='secondary-button' type='button' onClick={() => setPasswordGateOpen(false)}>
                取消
              </button>
              <button className='primary-button' type='button' onClick={() => void handlePasswordVerify()}>
                验证并继续
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
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
  runningState: CliRunningState
  onRunningStateChange: (client: CliClient, state: CliRunningState) => void
}) {
  const { client, toast, openSettings, active, serverBaseUrl, runningState, onRunningStateChange } = props
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
  } = useComposerAttachments(toast)
  const { preview: attachmentPreview, setPreview: setAttachmentPreview, openPreview: openAttachmentPreview } = useAttachmentPreview(toast)
  const { ref: promptRef, resize: resizePrompt } = useAutosizeTextarea(prompt)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const effortMenuRef = useRef<HTMLDivElement | null>(null)
  const extensionsMenuRef = useRef<HTMLDivElement | null>(null)
  const extensionsButtonRef = useRef<HTMLButtonElement | null>(null)
  const extensionsPaletteRef = useRef<HTMLDivElement | null>(null)
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
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
  const autoInvokeExtensions = activeExtensionPreferenceBucket.autoInvokeEnabled !== false
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
  const requestExtensionMap = useMemo(
    () =>
      activeMessages.reduce<Record<string, CliExtensionEntry[]>>((map, item) => {
        if (item.requestId && item.selectedExtensions?.length) {
          map[item.requestId] = item.selectedExtensions
        }
        return map
      }, {}),
    [activeMessages]
  )
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

  const setCliExtensionAutoInvokeEnabled = useCallback((enabled: boolean) => {
    updateCliExtensionPreferenceBucket(currentExtensionPreferenceKey, (bucket) => ({
      ...bucket,
      autoInvokeEnabled: enabled,
    }))
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
        const models = await getUserModels()
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
  }, [client, preferredCliModel])

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
        setProjectSessionMap((current) => ({
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
    setProjectSessionMap((current) =>
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
    setProjectSessionMap((current) => ({
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
    const currentSessionKey = activeSessionId || `draft-${client}-${Date.now()}`
    const matchedBuiltinCommand = matchCliBuiltinCommand(client, cleanedPrompt)
    const planMode = matchedBuiltinCommand?.id === 'plan'
    const visiblePrompt = planMode ? stripCliPlanCommandPrompt(cleanedPrompt) : cleanedPrompt
    const directCommand = options.directCommand || (isDirectCliCommandPrompt(cleanedPrompt) && !planMode)
    const manualExtensions = selectedExtensions.map((item) => ({ ...item }))
    const autoRecommendedExtensions = autoInvokeExtensions
      ? directCommand
        ? []
        : recommendCliExtensionsForPrompt(cleanedPrompt, cliExtensions)
      : []
    const requestExtensions = [...manualExtensions]
    const requestExtensionKeys = new Set(requestExtensions.map((item) => buildCliExtensionDedupeKey(item)))
    for (const item of autoRecommendedExtensions) {
      const dedupeKey = buildCliExtensionDedupeKey(item)
      if (requestExtensionKeys.has(dedupeKey)) {
        continue
      }
      requestExtensions.push({ ...item })
      requestExtensionKeys.add(dedupeKey)
      if (requestExtensions.length >= 3) {
        break
      }
    }
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
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: visiblePrompt,
      createdAt: Date.now(),
      requestId,
      attachments: toMessageAttachments(targetAttachments),
      selectedExtensions: directCommand ? [] : requestExtensions,
    }

    setProjectSessionMap((current) => ({
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
        extensions: selectedExtensions.map((item) => ({
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
        sessionId: getCliResumeSessionId(activeSessionId),
        model: resolvedCliModel,
        reasoningEffort,
        fullAccess,
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
      activeRequestIdRef.current = ''
      stoppingRunRef.current = false
      setRunning(false)
      onRunningStateChange(client, { running: false, requestId: '' })
    }
  }, [
    activeSessionId,
    attachments,
    autoInvokeExtensions,
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
      autoInvokeEnabled={autoInvokeExtensions}
      onAutoInvokeChange={setCliExtensionAutoInvokeEnabled}
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
                itemSelector='.message-bubble, .cli-log-bubble'
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
                  return (
                    <CliLogBubble
                      key={item.id}
                      item={item}
                      expanded={true}
                      expandedEventIds={expandedLogEventMap[item.id] || []}
                      onToggleEvent={(eventId) => toggleLogEvent(item.id, eventId)}
                      onOpenFile={(ownerId, path) => void handlePreviewFile(ownerId, path)}
                      onCopy={() => void copyText(item.events.map((eventItem) => serializeCliLogEvent(eventItem)).join('\n\n'))}
                      onDelete={() => handleDeleteCliLogGroup(item)}
                      onRespondInteraction={handleRespondCliInteraction}
                      respondingInteractionIds={respondingInteractionIds}
                      requestedExtensions={item.requestId ? requestExtensionMap[item.requestId] : undefined}
                      previewFile={previewFile}
                    />
                  )
                }

                return (
                  <div
                    key={item.id}
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
              })}
            </div>
            <ConversationScrollDock
              active={active}
              containerRef={threadRef}
              itemSelector='.message-bubble, .cli-log-bubble'
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
                          {visibleCliModels.length ? (
                            visibleCliModels.map((item: ChatModelOption) => (
                              <button
                                key={item.value}
                                type='button'
                                className={`picker-option ${item.value === selectedModel ? 'active' : ''}`}
                                onClick={() => {
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
                              </button>
                            ))
                          ) : (
                            <div className='picker-empty-state'>当前筛选下没有可用模型</div>
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

function CliSetupCard(props: {
  client: CliClient
  user: UserProfile
  toast: (message: string) => void
  className?: string
  activeDeployClient: CliClient | null
  setActiveDeployClient: Dispatch<SetStateAction<CliClient | null>>
}) {
  const { client, user, toast, className, activeDeployClient, setActiveDeployClient } = props
  const [status, setStatus] = useState<CliStatus>(buildEmptyCliStatus(client))
  const [deploying, setDeploying] = useState(false)
  const [deployLog, setDeployLog] = useState<DeployProgressPayload[]>([])
  const [preset, setPreset] = useState<CliDeployPreset | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const peerState = resolveCliSetupPeerState(client, activeDeployClient)
  const workspaceStatusSummary = describeCliWorkspaceStatus(status, DEFAULT_SERVER_BASE_URL)

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const cliStatusAll = await getCliStatus()
        const nextStatus = client === 'codex' ? cliStatusAll.codex : cliStatusAll.claude
        writeCachedCliStatus(nextStatus)
        if (!disposed) {
          setStatus(nextStatus)
        }
        notifyCliStatusChanged(nextStatus)
      } catch {
        if (!disposed) {
          setStatus(buildEmptyCliStatus(client))
        }
      }
    })()
    return () => {
      disposed = true
    }
  }, [client])

  useEffect(() => {
    const unsubscribe = onDeployProgress((payload) => {
      if (payload.client !== client) {
        return
      }
      setDeployLog((current) => [...current, payload])
      if (payload.step === 'complete' || payload.status === 'error') {
        setDeploying(false)
        setActiveDeployClient((current) => (current === client ? null : current))
        void (async () => {
          const cliStatusAll = await getCliStatus()
          const nextStatus = client === 'codex' ? cliStatusAll.codex : cliStatusAll.claude
          if (nextStatus.installed && nextStatus.hasConfig) {
            markPendingCliVerification(client)
          }
          writeCachedCliStatus(nextStatus)
          setStatus((current) => (sameCliStatus(current, nextStatus) ? current : nextStatus))
          notifyCliStatusChanged(nextStatus)
        })()
      }
    })

    return unsubscribe
  }, [client])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const nextPreset = await getCliDeployPreset(client)
        if (!disposed) {
          setPreset(nextPreset)
        }
      } catch {
        if (!disposed) {
          setPreset(null)
        }
      }
    })()
    return () => {
      disposed = true
    }
  }, [client])

  useEffect(() => {
    const element = timelineRef.current
    if (!element || !deployLog.length) {
      return
    }
    element.scrollTop = element.scrollHeight
  }, [deployLog])

  async function openFolder(targetPath?: string, filePath = false) {
    if (!targetPath) {
      toast('路径不存在。')
      return
    }

    const resolvedPath = filePath ? targetPath.replace(/[/\\][^/\\]+$/, '') : targetPath
    await window.desktopBridge?.openPath(resolvedPath)
  }

  async function handleDeploy() {
    try {
      setDeploying(true)
      setActiveDeployClient(client)
      setDeployLog([])
      const generated = await ensureDesktopServiceKey({
        name: 'OneAPI Desktop Internal Key',
        group: user.group || '',
        preferredNames: [
          `OneAPI Desktop ${client.toUpperCase()} Key`,
          'OneAPI Desktop CODEX Key',
          'OneAPI Desktop CLAUDE Key',
          'OneAPI Desktop Internal Key',
          '桌面端专用 Key',
          'CODEX 桌面安装 Key',
          'CLAUDE 桌面安装 Key',
        ],
      })
      const resolvedDeploySettings = resolveCliDeploySettings({
        preset,
        generatedApiKey: generated.key,
        defaultBaseUrl: client === 'codex' ? DEFAULT_CODEX_BASE_URL : DEFAULT_CLAUDE_BASE_URL,
        defaultModel: client === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL,
      })
      await deployCli({
        client,
        apiKey: resolvedDeploySettings.apiKey,
        baseUrl: resolvedDeploySettings.baseUrl,
        model: resolvedDeploySettings.model,
      })
      toast(`${client} 安装任务已开始。`)
    } catch (error) {
      setDeploying(false)
      setActiveDeployClient((current) => (current === client ? null : current))
      toast(error instanceof Error ? error.message : '安装初始化失败')
    }
  }

  async function copyLogDetail(content: string) {
    try {
      await navigator.clipboard.writeText(content)
      toast('已复制到剪贴板。')
    } catch {
      toast('复制失败，请检查系统剪贴板权限。')
    }
  }

  return (
    <article
      className={[
        'panel settings-card inline-settings-card',
        className || '',
        peerState.isActiveDeploy ? 'deploy-active' : '',
        peerState.isPeerDeploying ? 'peer-muted' : '',
      ].join(' ').trim()}
    >
      <div className='panel-header compact'>
        <div>
          <span className='eyebrow dark'>{client.toUpperCase()}</span>
          <h2>{client === 'codex' ? 'Codex 环境配置' : 'Claude 环境配置'}</h2>
        </div>
        <div className='inline-actions'>
          <button
            className='primary-button tiny'
            type='button'
            disabled={deploying || peerState.disableDeployButton}
            onClick={() => void handleDeploy()}
          >
            <span>{deploying ? '部署中' : '一键部署'}</span>
          </button>
        </div>
      </div>

      <div className='status-grid status-grid-slim'>
        <button className='ghost-button tiny status-button' type='button' onClick={() => void openFolder(status.executablePath, true)}>
          <strong>可执行文件</strong>
        </button>
        <button className='ghost-button tiny status-button' type='button' onClick={() => void openFolder(status.configPath, true)}>
          <strong>配置文件</strong>
        </button>
        <button className='ghost-button tiny status-button' type='button' onClick={() => void openFolder(status.dataPath)}>
          <strong>数据目录</strong>
        </button>
      </div>

      <div className={`inline-notice ${workspaceStatusSummary.level === 'ready' ? 'success' : 'warn'}`}>
        <span>{workspaceStatusSummary.detail}</span>
      </div>

      {!peerState.isPeerDeploying && (
        <div className='timeline-list deploy-timeline-list' ref={timelineRef}>
          {deployLog.length === 0 ? (
          <EmptyState title='部署进度会显示在这里' description='包含检测、安装、配置、MCP 互联、测试结果。' />
        ) : (
          deployLog.map((item, index) => (
            <div key={`${item.jobId}-${item.step}-${index}`} className={`timeline-row ${item.status}`}>
              <div className='timeline-dot' />
              <div className='timeline-content'>
                <strong>{item.message}</strong>
                <span>{formatDateTime(item.createdAt)}</span>
                {item.command ? <pre className='timeline-code'>{item.command}</pre> : null}
                {item.detail ? (
                  <div className='timeline-detail-wrap'>
                    <button
                      type='button'
                      className='markdown-code-copy timeline-copy-button'
                      aria-label='复制日志详情'
                      title='复制日志详情'
                      onClick={() => void copyLogDetail(maskSecretText(item.detail))}
                    >
                      <Copy size={13} />
                    </button>
                    <pre className='timeline-detail'>{maskSecretText(item.detail)}</pre>
                  </div>
                ) : null}
                {typeof item.exitCode === 'number' ? <small>exit code: {item.exitCode}</small> : null}
              </div>
            </div>
          ))
          )}
        </div>
      )}
    </article>
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
}) {
  const { mode, setMode, toast, openSettings, visible, enabledModes, serverBaseUrl } = props
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
          <AssistantsChatWorkspace toast={toast} active={visible && mode === 'chat'} />
        </div>
        <div className={mode === 'draw' ? 'workspace-shell active' : 'workspace-shell'}>
          <DrawWorkspace toast={toast} active={visible && mode === 'draw'} />
        </div>
        <div className={mode === 'codex' ? 'workspace-shell active' : 'workspace-shell'}>
          <CliWorkspace
            client='codex'
            toast={toast}
            openSettings={openSettings}
            active={visible && mode === 'codex'}
            serverBaseUrl={serverBaseUrl}
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
            runningState={cliRunningState.claude}
            onRunningStateChange={updateCliRunningState}
          />
        </div>
      </div>
    </section>
  )
}

function LoginScreen(props: {
  platformLabel: string
  productName: string
  onLoginSuccess: (user: UserProfile) => void
  toast: (message: string) => void
}) {
  const { platformLabel, productName, onLoginSuccess, toast } = props
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [require2fa, setRequire2fa] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [registerUsernameValue, setRegisterUsernameValue] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPasswordValue, setRegisterPasswordValue] = useState('')
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const registerEnabled =
    authStatus?.register_enabled !== false && authStatus?.password_register_enabled !== false
  const emailVerificationRequired = authStatus?.email_verification === true

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const status = await unwrapEnvelope(getAuthStatus())
        if (!disposed) {
          setAuthStatus(status ?? null)
        }
      } catch {
        if (!disposed) {
          setAuthStatus(null)
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    if (countdown <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) => Math.max(current - 1, 0))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [countdown])

  async function handlePasswordLogin() {
    if (!username.trim() || !password.trim()) {
      toast('请输入账号和密码。')
      return
    }
    setSubmitting(true)
    try {
      const result = await unwrapEnvelope(login({ username: username.trim(), password }))
      if (result?.require_2fa) {
        setRequire2fa(true)
        toast('该账号已启用 2FA，请继续输入验证码。')
        return
      }
      if (result?.id) {
        saveStoredDesktopUserId(result.id)
      }
      const accessToken = result?.access_token || result?.accessToken || result?.token || ''
      if (accessToken) {
        saveStoredDesktopAccessToken(accessToken)
      }
      const profile = await requireSuccess(getSelfProfile())
      const nextUser = profile as UserProfile
      saveStoredDesktopUserId(nextUser.id)
      onLoginSuccess(nextUser)
      toast('登录成功。')
    } catch (error) {
      try {
        const currentServerBaseUrl = await window.desktopBridge?.getServerBaseUrl()
        const normalizedCurrent = currentServerBaseUrl?.trim().replace(/\/+$/, '') || ''
        if (normalizedCurrent && normalizedCurrent !== DEFAULT_SERVER_BASE_URL) {
          await window.desktopBridge?.resetServerBaseUrl()
          toast('检测到异常的自定义服务地址，已自动恢复官方地址，请重新登录。')
          window.setTimeout(() => window.location.reload(), 200)
          return
        }
      } catch {
        /* ignore auto-reset failure and keep original login error */
      }
      toast(error instanceof Error ? error.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendVerificationCode() {
    if (!registerEmail.trim()) {
      toast('请输入邮箱地址。')
      return
    }

    setSendingCode(true)
    try {
      const result = await sendEmailVerification(registerEmail.trim())
      if (!result.success) {
        throw new Error(result.message || '验证码发送失败')
      }
      setCountdown(60)
      toast('验证码已发送，请检查邮箱。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '验证码发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  async function handleRegister() {
    if (!registerEnabled) {
      toast('当前服务端未开放注册。')
      return
    }

    if (!registerUsernameValue.trim() || !registerPasswordValue.trim()) {
      toast('请先填写注册账号和密码。')
      return
    }

    if (registerPasswordValue !== registerConfirmPassword) {
      toast('两次输入的密码不一致。')
      return
    }

    if (emailVerificationRequired) {
      if (!registerEmail.trim()) {
        toast('当前注册需要填写邮箱。')
        return
      }

      if (!verificationCode.trim()) {
        toast('请输入邮箱验证码。')
        return
      }
    }

    setSubmitting(true)
    try {
      const result = await registerUser({
        username: registerUsernameValue.trim(),
        password: registerPasswordValue,
        email: registerEmail.trim() || undefined,
        verification_code: verificationCode.trim() || undefined,
      })

      if (!result.success) {
        throw new Error(result.message || '注册失败')
      }

      setUsername(registerUsernameValue.trim())
      setPassword(registerPasswordValue)
      setMode('login')
      setRegisterUsernameValue('')
      setRegisterEmail('')
      setRegisterPasswordValue('')
      setRegisterConfirmPassword('')
      setVerificationCode('')
      toast('注册成功，请使用新账号登录。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTwoFactorLogin() {
    if (!twoFactorCode.trim()) {
      toast('请输入 2FA 验证码。')
      return
    }
    setSubmitting(true)
    try {
      const result = await unwrapEnvelope(login2fa(twoFactorCode.trim()))
      if (result?.id) {
        saveStoredDesktopUserId(result.id)
      }
      const accessToken = result?.access_token || result?.accessToken || result?.token || ''
      if (accessToken) {
        saveStoredDesktopAccessToken(accessToken)
      }
      const profile = await requireSuccess(getSelfProfile())
      const nextUser = profile as UserProfile
      saveStoredDesktopUserId(nextUser.id)
      onLoginSuccess(nextUser)
      toast('双重验证通过。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '2FA 验证失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='login-shell'>
      <section className='login-hero'>
        <div className='login-copy'>
          <span className='eyebrow'>OneAPI Desktop</span>
          <h1>
            OneAPI
            <span>客户端工作台</span>
          </h1>
          <p>
            一个账号即可使用聊天、助手、订阅、钱包、用量、我的，以及 Codex / Claude
            轻量客户端能力。
          </p>
          <div className='login-badges'>
            <span className='metric-pill'>{platformLabel}</span>
            <span className='metric-pill'>{productName}</span>
            <span className='metric-pill'>中文界面</span>
          </div>
        </div>

        <div className='login-card'>
          <div className='panel-header compact login-card-head'>
            <div className='login-card-title'>
              <span className='eyebrow dark'>
                {require2fa ? '二次验证' : mode === 'register' ? '创建账号' : '账号登录'}
              </span>
              <h2>
                {require2fa
                  ? '输入 2FA 验证码'
                  : mode === 'register'
                    ? '注册新的 OneAPI 账号'
                    : '登录你的 OneAPI 账号'}
              </h2>
            </div>
            {!require2fa && (
              <div className='inline-actions'>
                <button
                  className={`ghost-button tiny ${mode === 'login' ? 'selected-toggle' : ''}`}
                  type='button'
                  onClick={() => setMode('login')}
                >
                  登录
                </button>
                {registerEnabled && (
                  <button
                    className={`ghost-button tiny ${mode === 'register' ? 'selected-toggle' : ''}`}
                    type='button'
                    onClick={() => setMode('register')}
                  >
                    注册
                  </button>
                )}
              </div>
            )}
          </div>

          {require2fa ? (
            <div className='subform'>
              <input
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !submitting) {
                    event.preventDefault()
                    void handleTwoFactorLogin()
                  }
                }}
                placeholder='6 位验证码或备用码'
              />
              <button className='primary-button full' type='button' disabled={submitting} onClick={() => void handleTwoFactorLogin()}>
                {submitting ? <LoaderCircle className='spin' size={16} /> : <CheckCircle2 size={16} />}
                <span>{submitting ? '验证中' : '完成验证'}</span>
              </button>
              <button
                className='ghost-button'
                type='button'
                onClick={() => {
                  setRequire2fa(false)
                  setMode('login')
                }}
              >
                返回账号密码登录
              </button>
            </div>
          ) : mode === 'register' ? (
            <div className='subform'>
              <input
                value={registerUsernameValue}
                onChange={(event) => setRegisterUsernameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !submitting) {
                    event.preventDefault()
                    void handleRegister()
                  }
                }}
                placeholder='用户名'
              />
              <input
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !submitting) {
                    event.preventDefault()
                    void handleRegister()
                  }
                }}
                placeholder={emailVerificationRequired ? '邮箱（必填）' : '邮箱（选填）'}
              />
              <PasswordField
                value={registerPasswordValue}
                onChange={setRegisterPasswordValue}
                placeholder='密码'
                onEnter={() => {
                  if (!submitting) {
                    void handleRegister()
                  }
                }}
              />
              <PasswordField
                value={registerConfirmPassword}
                onChange={setRegisterConfirmPassword}
                placeholder='确认密码'
                onEnter={() => {
                  if (!submitting) {
                    void handleRegister()
                  }
                }}
              />
              {emailVerificationRequired && (
                <div className='inline-fields verification-inline-fields'>
                  <input
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !submitting) {
                        event.preventDefault()
                        void handleRegister()
                      }
                    }}
                    placeholder='邮箱验证码'
                  />
                  <button
                    className='secondary-button'
                    type='button'
                    disabled={sendingCode || countdown > 0 || !registerEmail.trim()}
                    onClick={() => void handleSendVerificationCode()}
                  >
                    <Mail size={16} />
                    <span>{countdown > 0 ? `${countdown}s` : sendingCode ? '发送中' : '发送验证码'}</span>
                  </button>
                </div>
              )}
              <p className='helper-copy'>
                注册频控以服务端识别到的公网出口 IP 为准；若该 IP 已被限制注册，会提示“此IP已拥有账号”。
              </p>
              <button className='primary-button full' type='button' disabled={submitting} onClick={() => void handleRegister()}>
                {submitting ? <LoaderCircle className='spin' size={16} /> : <UserPlus size={16} />}
                <span>{submitting ? '注册中' : '注册账号'}</span>
              </button>
            </div>
          ) : (
            <div className='subform'>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !submitting) {
                    event.preventDefault()
                    void handlePasswordLogin()
                  }
                }}
                placeholder='账号或邮箱'
              />
              <PasswordField
                value={password}
                onChange={setPassword}
                placeholder='密码'
                onEnter={() => {
                  if (!submitting) {
                    void handlePasswordLogin()
                  }
                }}
              />
              <button className='primary-button full' type='button' disabled={submitting} onClick={() => void handlePasswordLogin()}>
                {submitting ? <LoaderCircle className='spin' size={16} /> : <LockKeyhole size={16} />}
                <span>{submitting ? '登录中' : '登录'}</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function DesktopWindowFrame({
  children,
  iconPath,
  productName,
}: {
  children: ReactNode
  iconPath: string
  productName: string
}) {
  const handleMinimize = useCallback(() => {
    void window.desktopBridge?.minimizeWindow?.()
  }, [])

  const handleToggleMaximize = useCallback(() => {
    void window.desktopBridge?.toggleMaximizeWindow?.()
  }, [])

  const handleClose = useCallback(() => {
    void window.desktopBridge?.closeWindow?.()
  }, [])

  const dragStateRef = useRef<{
    active: boolean
    pointerId: number | null
  }>({
    active: false,
    pointerId: null,
  })

  const stopWindowDrag = useCallback(() => {
    const state = dragStateRef.current
    state.active = false
    state.pointerId = null
    void window.desktopBridge?.endWindowDrag?.()
  }, [])

  useEffect(() => () => stopWindowDrag(), [stopWindowDrag])

  useEffect(() => {
    const handleBlur = () => {
      stopWindowDrag()
    }
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('blur', handleBlur)
    }
  }, [stopWindowDrag])

  const handleWindowPointerDown = useCallback(async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    dragStateRef.current.active = true
    dragStateRef.current.pointerId = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    await window.desktopBridge?.startWindowDrag?.(event.screenX, event.screenY)
  }, [])

  const handleWindowPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state.active || state.pointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
  }, [])

  const handleWindowPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    stopWindowDrag()
  }, [stopWindowDrag])

  return (
    <div className='desktop-window-shell'>
      <div className='workspace-aurora app-aurora-shell' aria-hidden='true'>
        <span className='workspace-aurora-veil' />
        <span className='workspace-aurora-blob blob-a' />
        <span className='workspace-aurora-blob blob-b' />
        <span className='workspace-aurora-blob blob-c' />
        <span className='workspace-aurora-blob blob-d' />
      </div>
      <header className='window-chrome'>
        <div
          className='window-drag-region'
          onPointerDown={handleWindowPointerDown}
          onPointerMove={handleWindowPointerMove}
          onPointerUp={handleWindowPointerUp}
          onPointerCancel={handleWindowPointerUp}
          onDoubleClick={(event) => {
            event.preventDefault()
            stopWindowDrag()
            handleToggleMaximize()
          }}
          title='双击最大化或还原'
        >
          <div className='window-chrome-brand'>
            {iconPath ? (
              <img className='window-chrome-icon' src={iconPath} alt='' />
            ) : (
              <span className='window-chrome-icon window-chrome-icon-fallback' aria-hidden='true' />
            )}
            <span className='window-chrome-title'>{productName || 'OneAPI Center'}</span>
          </div>
        </div>
        <div className='window-chrome-controls'>
          <button
            className='window-chrome-button'
            type='button'
            onClick={handleMinimize}
            aria-label='最小化'
            title='最小化'
          >
            <Minus size={16} />
          </button>
          <button
            className='window-chrome-button'
            type='button'
            onClick={handleToggleMaximize}
            aria-label='最大化或还原'
            title='最大化或还原'
          >
            <Square size={14} />
          </button>
          <button
            className='window-chrome-button close'
            type='button'
            onClick={handleClose}
            aria-label='关闭'
            title='关闭'
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className='desktop-window-content'>{children}</div>
    </div>
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
      return
    }

    let disposed = false
    void unwrapEnvelope(getAuthStatus())
      .then((status) => {
        if (disposed) {
          return
        }
        const resolved = Number(status?.quota_per_unit || 0)
        setSidebarQuotaPerUnit(resolved > 0 ? resolved : 500_000)
      })
      .catch(() => {
        if (!disposed) {
          setSidebarQuotaPerUnit(500_000)
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
      setMessage(detail?.message || '登录态已失效，请重新登录。')
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
  }, [])

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

  if (!auth.user) {
    return (
      <>
        <DesktopWindowFrame iconPath={iconPath} productName={productName}>
          <LoginScreen
            platformLabel={platformLabel}
            productName={productName}
            onLoginSuccess={(user) => {
              auth.setUser(user)
            }}
            toast={setMessage}
          />
        </DesktopWindowFrame>
        {message && <div className='toast-bar'>{message}</div>}
      </>
    )
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
                  <div className='brand-text'>
                    <div className='brand-name'>OneAPI Center</div>
                    <div className='brand-sub'>Windows 客户端</div>
                  </div>
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
                    onClick={() => setSideTab(item.key)}
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
                    <div className='sidebar-user-row' onClick={handleSidebarUserRowClick}>
                      <span className={`user-pill ${showUpdateDot ? 'has-update-dot' : ''}`}>
                        {auth.user.username}
                        {showAnnouncementCount ? (
                          <span className='user-pill-count-badge'>
                            {unreadAnnouncementCount > 99 ? '99+' : unreadAnnouncementCount}
                          </span>
                        ) : null}
                      </span>
                      <span className='user-pill secondary'>{sidebarWalletBalance}</span>
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
                    </div>
                    {updatePopoverOpen && (
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
                    onClick={() => void handleLogout()}
                    title='退出'
                    aria-label='退出'
                  >
                    <LogOut size={16} />
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
              />
              {sideTab === 'subscriptions' && <SubscriptionsWorkspace toast={setMessage} />}
              {sideTab === 'wallet' && <WalletWorkspace user={auth.user} toast={setMessage} />}
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
              />
              {/* settings removed */}
            </div>
          </main>
        </div>
      </DesktopWindowFrame>

      {message && <div className='toast-bar'>{message}</div>}

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
