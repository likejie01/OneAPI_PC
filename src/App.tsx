import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, ReactNode } from 'react'
import {
  Bot,
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareText,
  PanelRightOpen,
  PencilLine,
  Plus,
  RotateCcw,
  Send,
  Square,
  Sparkles,
  Star,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'
import {
  createAssistant,
  loadActiveAssistantId,
  loadAssistants,
  saveActiveAssistantId,
  saveAssistants,
} from './domains/assistants'
import {
  getAuthStatus,
  login,
  login2fa,
  logout,
  registerUser,
  sendEmailVerification,
  unwrapEnvelope,
} from './domains/auth'
import { getUserGroups, getUserModels, sendChatCompletion, sendImageGeneration, stopChatCompletion } from './domains/chat'
import {
  deployCli,
  getCliSession,
  getCliDeployPreset,
  getCliStatus,
  listCliHistory,
  onCliProgress,
  onDeployProgress,
  pickProjectDirectory,
  readDesktopFilePreview,
  runCliPrompt,
  setDesktopWindowTitle,
  stopCliPrompt,
} from './domains/cli'
import { createDesktopCliKey, fetchApiKeySecret, getApiKeys } from './domains/keys'
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
  buildCliRecentSessions,
  buildCliTimeline,
  type CliTimelineEntry,
  filterAssistantModels,
  prioritizeFavoriteModels,
  resolveCompatibleModel,
} from './lib/assistant-workspace'
import {
  getCliResumeSessionId,
} from './lib/cli-session'
import { clearStoredDesktopUserId, saveStoredDesktopUserId } from './lib/desktop-client'
import { clipText, formatDateTime, formatPrice, formatQuota } from './lib/format'
import { readJsonStorage, writeJsonStorage } from './lib/storage'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AssistantRecord,
  AuthStatus,
  BillingHistoryData,
  ChatContentPart,
  ChatMessage,
  ChatModelOption,
  PlanRecord,
  SubscriptionPaymentInfo,
  SubscriptionSelfData,
  UsageData,
  UserProfile,
} from './shared/contracts'
import type {
  CliClient,
  CliHistoryEntry,
  CliProgressPayload,
  CliSessionDetails,
  CliSessionMessage,
  CliStatus,
  DeployProgressPayload,
} from './shared/desktop'
import { useAuthStore } from './stores/auth-store'

type AssistantMode = 'chat' | 'codex' | 'claude'
type SideTab = 'assistants' | 'subscriptions' | 'wallet' | 'me'
type HistoryVisibilityTab = 'visible' | 'hidden'

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

const assistantModes: Array<{ key: AssistantMode; label: string }> = [
  { key: 'chat', label: '聊天' },
  { key: 'codex', label: 'Codex' },
  { key: 'claude', label: 'Claude' },
]

const primarySideTabs: Array<{
  key: SideTab
  label: string
  icon: typeof Sparkles
  desc: string
}> = [
  { key: 'assistants', label: '助手', icon: Sparkles, desc: '提示词助手与聊天形态' },
  { key: 'subscriptions', label: '订阅', icon: CreditCard, desc: '套餐购买、订阅状态和额度' },
  { key: 'wallet', label: '钱包', icon: Wallet, desc: '余额、支付入口与账单记录' },
  { key: 'me', label: '我的', icon: KeyRound, desc: '个人信息、Key 与安全操作' },
]

function getDesktopBridge() {
  if (!window.desktopBridge) {
    throw new Error('桌面桥接未初始化')
  }
  return window.desktopBridge
}

function useToastState() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!message) {
      return
    }
    const timer = window.setTimeout(() => setMessage(''), 2800)
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
      type: 'file',
      file: {
        filename: attachment.name,
        file_data: buildAttachmentDataUrl(attachment),
      },
    })
  }

  return parts.length === 1 ? text : parts
}

function buildCliAttachmentReferenceText(attachments: ComposerAttachment[]) {
  if (!attachments.length) {
    return ''
  }

  const lines = attachments.map((item, index) => `${index + 1}. ${item.name} -> ${item.filePath}`)
  return `\n\n附件引用：\n${lines.join('\n')}\n请结合这些附件路径处理本次任务。`
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

  return {
    attachments,
    inputRef,
    clearAttachments,
    removeAttachment,
    handleInputChange,
    handlePaste,
    openPicker: () => inputRef.current?.click(),
  }
}

function loadInitialAssistantsState() {
  const nextAssistants = loadAssistants()
  return {
    assistants: nextAssistants,
    activeAssistantId: loadActiveAssistantId() || nextAssistants[0]?.id || '',
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

function toMessageText(content: unknown) {
  if (typeof content === 'string' && content.trim()) {
    return content
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (typeof item === 'object' && item && 'text' in item && typeof item.text === 'string') {
          return item.text
        }

        return ''
      })
      .filter(Boolean)
      .join('\n')

    if (joined.trim()) {
      return joined
    }
  }

  return '模型未返回内容。'
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
  content: string
  createdAt: number
  files?: CliSessionMessage['fileChanges']
}

type ComposerActionItem = {
  key: string
  node: ReactNode
}

type ComposerFileAsset = {
  id: string
  name: string
  previewUrl?: string
  kind: 'image' | 'file'
  onRemove?: () => void
}

function renderComposer(props: {
  inputRef?: React.RefObject<HTMLInputElement | null>
  onAttachmentInputChange?: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  placeholder: string
  onChange: (value: string) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void | Promise<void>
  leftActions: ComposerActionItem[]
  sendButton: React.ReactNode
  fileAssets?: ComposerFileAsset[]
}) {
  const {
    inputRef,
    onAttachmentInputChange,
    textareaRef,
    value,
    placeholder,
    onChange,
    onPaste,
    leftActions,
    sendButton,
    fileAssets = [],
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
      <div className='composer-input-zone'>
        <textarea
          ref={textareaRef}
          value={value}
          rows={AUTO_TEXTAREA_MIN_ROWS}
          onChange={(event) => onChange(event.target.value)}
          onPaste={onPaste}
          onInput={(event) => syncTextareaHeight(event.currentTarget)}
          placeholder={placeholder}
        />
        {fileAssets.length > 0 && (
          <div className='composer-asset-strip'>
            {fileAssets.map((item) => (
              <div key={item.id} className='composer-asset-card'>
                <div className='composer-asset-thumb'>
                  {item.kind === 'image' && item.previewUrl ? (
                    <img src={item.previewUrl} alt={item.name} />
                  ) : (
                    <FileText size={14} />
                  )}
                </div>
                <span className='composer-asset-name' title={item.name}>{item.name}</span>
                {item.onRemove && (
                  <button className='composer-asset-remove' type='button' onClick={item.onRemove} aria-label='移除附件'>
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
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

type ChatSessionRecord = {
  id: string
  title: string
  assistantId: string
  model: string
  group: string
  updatedAt: number
  messages: ChatBubbleMessage[]
}

const CLI_REASONING_OPTIONS = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
] as const

const CLAUDE_REASONING_OPTIONS = [
  ...CLI_REASONING_OPTIONS,
  { label: '极限', value: 'max' },
] as const

const DEFAULT_CHAT_MODEL = 'gpt-5.4'
const DEFAULT_CODEX_MODEL = 'gpt-5.5'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'

function isImageGenerationModel(value: string) {
  return value.trim().toLowerCase() === 'gpt-image-2'
}

function normalizeTimestampMs(value: number) {
  if (!value) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

function resolveUsageTimestamp(item: UsageData['items'][number]) {
  const raw = Number(item.created_at || item.created_time || 0)
  if (!raw) {
    return 0
  }
  return raw > 10_000_000_000 ? raw : raw * 1000
}

function resolveImageMessageSource(item?: { url?: string; b64_json?: string }) {
  if (!item) {
    return ''
  }

  if (item.url?.trim()) {
    return item.url.trim()
  }

  if (item.b64_json?.trim()) {
    return `data:image/png;base64,${item.b64_json.trim()}`
  }

  return ''
}

type BubbleActionConfig = {
  key: string
  label: string
  icon: typeof Copy
  onClick: () => void
  disabled?: boolean
}

function resolvePreferredModel(
  options: ChatModelOption[],
  preferred: string,
  fallback = ''
) {
  if (options.some((item) => item.value === preferred)) {
    return preferred
  }

  if (fallback && options.some((item) => item.value === fallback)) {
    return fallback
  }

  return options[0]?.value || preferred || fallback || ''
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
}) {
  const { side, createdAt, actions } = props

  return (
    <div className={`message-meta ${side}`}>
      {side === 'right' && (
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
      )}
      <small>{formatDateTime(createdAt)}</small>
      {side === 'left' && (
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
      )}
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

function buildEmptyCliStatus(client: CliClient): CliStatus {
  return {
    client,
    installed: false,
    version: '',
    executablePath: '',
    configPath: '',
    dataPath: '',
    hasConfig: false,
    hasDataDirectory: false,
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

function percentageOf(value: number, total: number) {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, (value / total) * 100))
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

function buildSmoothLinePath(points: Array<{ x: number; y: number }>) {
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
    path += ` Q ${midX} ${previous.y} ${current.x} ${current.y}`
  }

  return path
}

function buildUsageSeriesFromTimeline(items: UsageData['items']) {
  const buckets = new Map<number, Map<string, number>>()
  const timestamps = items
    .map((item) => resolveUsageTimestamp(item))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)
  const hasMultiDayRange =
    timestamps.length >= 2 && timestamps[timestamps.length - 1] - timestamps[0] >= 24 * 60 * 60 * 1000
  const rangeMinutes =
    timestamps.length >= 2 ? Math.ceil((timestamps[timestamps.length - 1] - timestamps[0]) / 60000) : 0
  const baseBucketMinutes = hasMultiDayRange ? 60 : 5
  const targetBuckets = hasMultiDayRange ? 8 : 10
  const minuteBucketSize = Math.max(
    baseBucketMinutes,
    rangeMinutes > 0
      ? Math.ceil(rangeMinutes / targetBuckets / baseBucketMinutes) * baseBucketMinutes
      : baseBucketMinutes
  )

  for (const item of items) {
    const timestamp = resolveUsageTimestamp(item)
    const bucketKey = timestamp
      ? Math.floor(timestamp / (minuteBucketSize * 60 * 1000)) * minuteBucketSize * 60 * 1000
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

  if (!chart.labels.length || !chart.models.length) {
    return <EmptyState title='暂无模型分析数据' description='开始使用模型后，这里会自动生成时间趋势。' />
  }

  const width = 760
  const height = 280
  const left = 36
  const right = 24
  const top = 18
  const bottom = 40
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const maxValue = Math.max(
    1,
    ...chart.labels.flatMap((label) => chart.models.map((model) => chart.buckets.get(label)?.get(model) || 0))
  )
  const gridRows = 4
  const tickStep = Math.max(1, Math.ceil(chart.labels.length / 6))

  return (
    <div className='usage-trend-card'>
      <svg viewBox={`0 0 ${width} ${height}`} className='usage-trend-svg' role='img' aria-label='模型调用分析趋势图'>
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

        {chart.models.map((model, modelIndex) => {
          const values = chart.labels.map((label) => chart.buckets.get(label)?.get(model) || 0)
          const points = values.map((value, index) => {
            const x = left + (chartWidth * index) / Math.max(chart.labels.length - 1, 1)
            const y = top + chartHeight - (value / maxValue) * chartHeight
            return { x, y }
          })

          return (
            <g key={model}>
              <path d={buildSmoothLinePath(points)} fill='none' stroke={USAGE_CHART_COLORS[modelIndex % USAGE_CHART_COLORS.length]} strokeWidth='2.5' strokeLinecap='round' />
              {points.map((point, index) => (
                <circle key={`${model}-${index}`} cx={point.x} cy={point.y} r='3' fill={USAGE_CHART_COLORS[modelIndex % USAGE_CHART_COLORS.length]}>
                  <title>{`${model} · ${chart.formatLabel(chart.labels[index])} · ${formatQuota(values[index])}`}</title>
                </circle>
              ))}
            </g>
          )
        })}

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

function MarkdownMessageContent(props: {
  content: string
}) {
  const { content } = props

  return (
    <div className='markdown-body'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const target = href || ''
            const isLocalPath =
              /^file:\/\//i.test(target) ||
              /^[A-Za-z]:[\\/]/.test(target) ||
              /^\/(Users|home|var|private|Volumes)\//.test(target)

            if (isLocalPath) {
              const resolved = target.replace(/^file:\/\/\/?/i, '')
              return (
                <button
                  type='button'
                  className='markdown-inline-link'
                  onClick={() => void openDesktopTarget(decodeURIComponent(resolved))}
                >
                  {children}
                </button>
              )
            }

            return (
              <a
                href={target}
                target='_blank'
                rel='noreferrer'
                onClick={(event) => {
                  event.preventDefault()
                  void window.desktopBridge?.openExternal(target)
                }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function MessageAttachmentGallery(props: {
  attachments?: Array<{
    id: string
    name: string
    filePath: string
    kind: 'image' | 'file'
  }>
}) {
  const { attachments = [] } = props
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
          onClick={() => void openDesktopTarget(item.filePath)}
          title={`打开附件：${item.filePath}`}
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
  files?: Array<{
    path: string
    kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  }>
}) {
  const { files = [] } = props
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
          onClick={() => void openDesktopTarget(item.path)}
          title={item.path}
        >
          <FileText size={14} />
          <span>{item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path}</span>
        </button>
      ))}
    </div>
  )
}

function CliLogBubble(props: {
  item: Extract<CliTimelineEntry, { kind: 'log' }>
  expanded: boolean
  onToggle: () => void
  onOpenFile: (path: string) => void
  onCopy: () => void
}) {
  const { item, expanded, onToggle, onOpenFile, onCopy } = props
  const uniqueFiles = Array.from(new Map(item.files.map((file) => [file.path, file])).values())

  return (
    <div className={`message-bubble system cli-log-bubble ${item.level === 'error' ? 'error' : ''}`}>
      <button className='cli-log-card-head' type='button' onClick={onToggle}>
        <span className='message-role'>{item.level === 'error' ? '运行异常' : '运行日志'}</span>
        <strong>{`已执行 ${item.content.length} 步`}</strong>
        <small>{expanded ? '点击收起' : '点击展开'}</small>
      </button>
      <ul className='cli-log-list'>
        {(expanded ? item.content : item.content.slice(0, 1)).map((line, index) => (
          <li key={`${item.id}-${index}`}>{line}</li>
        ))}
      </ul>
      {item.files.length > 0 && (
        <div className='cli-log-files'>
          {uniqueFiles.slice(0, expanded ? undefined : 4).map((fileItem) => (
            <button
              key={fileItem.path}
              className='ghost-button tiny cli-log-file'
              type='button'
              onClick={() => onOpenFile(fileItem.path)}
              title={fileItem.path}
            >
              <FileText size={14} />
              <span>{fileItem.path.split(/[\\/]/).filter(Boolean).at(-1) || fileItem.path}</span>
            </button>
          ))}
        </div>
      )}
      <BubbleMeta
        side='left'
        createdAt={item.createdAt}
        actions={[
          {
            key: 'copy',
            label: '复制',
            icon: Copy,
            onClick: onCopy,
          },
        ]}
      />
    </div>
  )
}

function normalizeProjectKey(value?: string) {
  return (value || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

function resolveProjectNameFromPath(value?: string) {
  const normalized = (value || '').split(/[\\/]/).filter(Boolean)
  return normalized.at(-1) || ''
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

function mergeCliMessages(left: CliMessage[], right: CliMessage[]) {
  const seen = new Set<string>()
  return [...left, ...right]
    .map((item) => ({
      ...item,
      createdAt: normalizeTimestampMs(item.createdAt),
    }))
    .sort((a, b) => a.createdAt - b.createdAt)
    .filter((item) => {
      const key = `${item.role}:${item.createdAt}:${item.content}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
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
      const key = `${item.level}:${item.createdAt}:${item.content}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}

function PasswordField(props: {
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  const { value, placeholder, onChange } = props
  const [revealed, setRevealed] = useState(false)

  return (
    <div className='password-field'>
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
}) {
  const { toast } = props
  const [models, setModels] = useState<ChatModelOption[]>([])
  const [favoriteModels, setFavoriteModels] = useState<string[]>(() => loadFavoriteModels('oneapi-desktop-chat-favorites'))
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [draft, setDraft] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [sending, setSending] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [assistantName, setAssistantName] = useState('')
  const [assistantDescription, setAssistantDescription] = useState('')
  const [assistantPrompt, setAssistantPrompt] = useState('')
  const [initialAssistantsState] = useState(loadInitialAssistantsState)
  const [assistants, setAssistants] = useState(initialAssistantsState.assistants)
  const [activeAssistantId, setActiveAssistantId] = useState(initialAssistantsState.activeAssistantId)
  const {
    attachments,
    inputRef: attachmentInputRef,
    clearAttachments,
    removeAttachment,
    handleInputChange: handleAttachmentInputChange,
    handlePaste: handleAttachmentPaste,
  } = useComposerAttachments(toast)
  const { ref: draftRef, resize: resizeDraft } = useAutosizeTextarea(draft)
  const assistantMenuRef = useRef<HTMLDivElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const pendingRequestIdRef = useRef('')
  const stoppingRef = useRef(false)

  const activeAssistant = useMemo(
    () => assistants.find((item) => item.id === activeAssistantId) ?? assistants[0] ?? null,
    [assistants, activeAssistantId]
  )
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

  const activeModelLabel = useMemo(
    () =>
      chatModeModels.find((item) => item.value === selectedModel)?.label ||
      selectedModel ||
      activeAssistant?.model ||
      '默认模型',
    [activeAssistant?.model, chatModeModels, selectedModel]
  )

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

      if (assistantMenuOpen && assistantMenuRef.current && !assistantMenuRef.current.contains(target)) {
        setAssistantMenuOpen(false)
      }

      if (modelMenuOpen && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setModelMenuOpen(false)
      }

      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        setHistoryOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [assistantMenuOpen, historyOpen, modelMenuOpen])

  useEffect(() => {
    function handleOpenHistory() {
      setHistoryOpen(true)
    }
    window.addEventListener('oneapi:open-assistant-history', handleOpenHistory as EventListener)
    return () => window.removeEventListener('oneapi:open-assistant-history', handleOpenHistory as EventListener)
  }, [])

  function handleCreateAssistant() {
    if (!assistantName.trim() || !assistantPrompt.trim()) {
      toast('请填写助手名称和提示词。')
      return
    }

    const next = createAssistant({
      name: assistantName.trim(),
      description: assistantDescription.trim() || '自定义助手',
      prompt: assistantPrompt.trim(),
      model: selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL),
      temperature: 0.7,
    })
    const all = [next, ...assistants]
    setAssistants(all)
    saveAssistants(all)
    setActiveAssistantId(next.id)
    saveActiveAssistantId(next.id)
    setAssistantName('')
    setAssistantDescription('')
    setAssistantPrompt('')
    setAssistantMenuOpen(false)
    toast('自定义助手已创建。')
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
    window.setTimeout(() => resizeDraft(), 0)
    setHistoryOpen(false)
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

    const resolvedModel = selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model)
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
    const userMessage: ChatMessage = {
      id: `user-${createdAt}`,
      role: 'user',
      content: userMessageContent,
      createdAt,
      attachments: toMessageAttachments(attachments),
    }
    const pendingAssistantMessage: ChatBubbleMessage = {
      id: pendingAssistantId,
      role: 'assistant',
      content: 'thinking...',
      createdAt: createdAt + 1,
      modelLabel: resolvedModelLabel,
      pending: true,
    }

    const history = [...messages, userMessage, pendingAssistantMessage]
    syncActiveSession((session) => ({
      ...session,
      assistantId: activeAssistant?.id || session.assistantId,
      model: resolvedModel,
      group: selectedGroup,
      updatedAt: Date.now(),
      title: clipText(userMessage.content.replace(/\s+/g, ' '), 24) || session.title,
      messages: history,
    }))
    pendingRequestIdRef.current = requestId
    stoppingRef.current = false
    setDraft('')
    clearAttachments()
    window.setTimeout(() => resizeDraft(), 0)
    setSending(true)

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
        const imageItem = response.data?.[0]
        const imageUrl = resolveImageMessageSource(imageItem)
        if (!imageUrl) {
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
                  content: imageItem?.revised_prompt || normalizedDraft,
                  createdAt: Date.now(),
                  imageUrl,
                  modelLabel: resolvedModelLabel,
                }
              : item
          ),
        }))
      } else {
        const systemMessage = toAssistantSystemMessage(activeAssistant)
        const response = await sendChatCompletion({
          model: resolvedModel,
          group: selectedGroup || undefined,
          temperature: activeAssistant?.temperature ?? 0.7,
          messages: [
            ...(systemMessage ? [systemMessage] : []),
            ...history.map((item) => ({
              role: item.role,
              content:
                item.id === userMessage.id
                  ? buildChatAttachmentContent(item.content, attachments)
                  : item.content,
            })),
          ],
        }, {
          requestId,
        })

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
                  content: toMessageText(response.choices?.[0]?.message?.content),
                  createdAt: Date.now(),
                  usage: response.usage,
                  modelLabel: resolvedModelLabel,
                }
              : item
          ),
        }))
      }
    } catch (error) {
      syncActiveSession((session) => ({
        ...session,
        messages: session.messages.filter((item) => item.id !== pendingAssistantId),
      }))
      if (!stoppingRef.current && !isAbortError(error)) {
        toast(error instanceof Error ? error.message : '聊天请求失败')
      }
    } finally {
      pendingRequestIdRef.current = ''
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
    setActiveAssistantId(session.assistantId || activeAssistantId)
    saveActiveAssistantId(session.assistantId || activeAssistantId)
    setSelectedModel(
      session.model || resolvePreferredModel(models, DEFAULT_CHAT_MODEL, activeAssistant?.model)
    )
    setSelectedGroup(session.group || selectedGroup)
    setDraft('')
    window.setTimeout(() => resizeDraft(), 0)
    setHistoryOpen(false)
  }

  return (
    <section className='workspace-page chat-page'>
      <div className={`chat-layout ${historyOpen ? 'history-open' : ''}`}>
        <article className='panel conversation-panel chat-panel-surface'>
          <div className='message-stream'>
            {messages.map((item) => (
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
                <MessageAttachmentGallery attachments={item.attachments} />
                {item.imageUrl ? (
                  <div className='chat-image-result'>
                    <img src={item.imageUrl} alt={item.content || '生成图片'} />
                  </div>
                ) : (
                  <MarkdownMessageContent content={item.content} />
                )}
                <BubbleMeta
                  side={item.role === 'user' ? 'right' : 'left'}
                  createdAt={item.createdAt}
                  actions={
                    item.role === 'system'
                      ? [
                          {
                            key: 'copy',
                            label: '复制',
                            icon: Copy,
                            onClick: () => void copyText(item.content),
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

          {renderComposer({
            inputRef: attachmentInputRef,
            onAttachmentInputChange: handleAttachmentInputChange,
            textareaRef: draftRef,
            value: draft,
            placeholder: '输入你的问题、任务或上下文。',
            onChange: (value) => {
              setDraft(value)
              resizeDraft()
            },
            onPaste: handleAttachmentPaste,
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
                        setAssistantMenuOpen((current) => !current)
                      }}
                      title='助手提示词'
                    >
                      <Sparkles size={16} />
                      <strong>{activeAssistant?.name || '通用助手'}</strong>
                    </button>
                    {assistantMenuOpen && (
                      <div className='picker-menu assistant-menu'>
                        <div className='picker-menu-head'>
                          <strong>助手提示词</strong>
                          <span>点击即可切换当前助手</span>
                        </div>
                        <div className='picker-menu-list'>
                          {assistants.map((item) => (
                            <button
                              key={item.id}
                              type='button'
                              className={`picker-option ${item.id === activeAssistantId ? 'active' : ''}`}
                              onClick={() => {
                                setActiveAssistantId(item.id)
                                saveActiveAssistantId(item.id)
                                setAssistantMenuOpen(false)
                              }}
                            >
                              <strong>{item.name}</strong>
                              <span>{item.description}</span>
                            </button>
                          ))}
                        </div>
                        <div className='picker-divider' />
                        <div className='subform assistant-inline-form'>
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
                          <button className='secondary-button full' type='button' onClick={handleCreateAssistant}>
                            <Plus size={16} />
                            <span>新建自定义助手</span>
                          </button>
                        </div>
                      </div>
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
                        setModelMenuOpen((current) => !current)
                      }}
                      title='AI 选择'
                    >
                      <Bot size={16} />
                      <strong>{activeModelLabel}</strong>
                    </button>
                    {modelMenuOpen && (
                      <div className='picker-menu model-menu'>
                        <div className='picker-menu-head'>
                          <strong>AI 选择</strong>
                          <span>切换当前对话所用模型</span>
                        </div>
                        <div className='picker-menu-list'>
                          {chatModeModels.map((item) => (
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
                              <span>{item.value}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ),
              },
            ],
            fileAssets: attachments.map((item) => ({
              id: item.id,
              name: item.name,
              previewUrl: item.previewUrl,
              kind: item.kind,
              onRemove: () => removeAttachment(item.id),
            })),
            sendButton: (
              <button
                className={`primary-button icon-only send-button ${sending ? 'stop-button' : ''}`}
                type='button'
                onClick={() => void (sending ? handleStopMessage() : handleSendMessage())}
                title={sending ? '停止回复' : '发送消息'}
                aria-label={sending ? '停止回复' : '发送消息'}
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
              <span className='eyebrow dark'>历史记录</span>
              <h2>最近会话</h2>
            </div>
            <div className='inline-actions'>
              <button className='secondary-button tiny' type='button' onClick={createChatSession}>
                <Plus size={16} />
                <span>新对话</span>
              </button>
            </div>
          </div>

          <div className='side-pane-scroll'>
            {chatSessions.length === 0 ? (
              <EmptyState title='当前没有聊天会话' description='发送第一条消息后，会话会出现在这里。' />
            ) : (
              <div className='history-project-groups'>
                {Object.entries(
                  chatSessions.reduce<Record<string, ChatSessionRecord[]>>((groups, item) => {
                    const key = item.group || 'default'
                    groups[key] = [...(groups[key] || []), item]
                    return groups
                  }, {})
                ).map(([groupKey, items]) => (
                  <div key={groupKey} className='history-group'>
                    <div className='history-group-head'>
                      <strong>{groupKey}</strong>
                      <span>{items.length} 条</span>
                    </div>
                    <div className='subrecords compact-records'>
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type='button'
                          className={`record-row action-row session-row ${item.id === resolvedActiveSessionId ? 'highlighted' : ''}`}
                          onClick={() => handleSelectChatSession(item)}
                        >
                          <span className='session-row-preview'>{clipText(item.title, 56)}</span>
                          <small>{formatDateTime(item.updatedAt)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
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
  const [buyingPlanId, setBuyingPlanId] = useState(0)
  const activeSubscriptions = subscriptionSelf?.subscriptions || []
  const allSubscriptions = subscriptionSelf?.all_subscriptions || []

  const refreshSubscriptions = useCallback(async () => {
    const [nextPlans, nextSelf, nextPaymentInfo] = await Promise.all([
      getPublicPlans(),
      getSelfSubscriptions(),
      getSubscriptionPaymentInfo(),
    ])
    setPlans(nextPlans.filter((item) => item.plan.enabled))
    setSubscriptionSelf(nextSelf)
    setPaymentInfo(nextPaymentInfo ?? null)
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextPlans, nextSelf, nextPaymentInfo] = await Promise.all([
          getPublicPlans(),
          getSelfSubscriptions(),
          getSubscriptionPaymentInfo(),
        ])

        if (disposed) {
          return
        }

        setPlans(nextPlans.filter((item) => item.plan.enabled))
        setSubscriptionSelf(nextSelf)
        setPaymentInfo(nextPaymentInfo ?? null)
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
            <span className='eyebrow dark'>订阅</span>
            <h2>套餐订阅与额度使用</h2>
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
              <strong>{paymentInfo?.enable_wallet_payment ? '钱包可购' : '待配置'}</strong>
              <span>支付状态</span>
            </div>
          </div>

          <div className='content-grid subscription-layout'>
            <div className='subscription-grid wide-grid'>
              {plans.length === 0 ? (
                <EmptyState title='当前没有可购买套餐' description='请稍后刷新或检查服务端套餐配置。' />
              ) : (
                plans.map((item) => (
                  <article key={item.plan.id} className='pricing-card'>
                    <strong>{item.plan.title}</strong>
                    <span>{item.plan.subtitle || '适合稳定桌面端高频使用。'}</span>
                    <b>{formatPrice(item.plan.price_amount, item.plan.currency || 'USD')}</b>
                    <small>总额度 {formatQuota(item.plan.total_amount)}</small>
                    <div className='pricing-actions'>
                      {paymentInfo?.enable_wallet_payment && (
                        <button
                          className='primary-button tiny'
                          type='button'
                          disabled={buyingPlanId === item.plan.id}
                          onClick={() => void handleBuyPlan(item.plan.id, 'wallet')}
                        >
                          钱包购买
                        </button>
                      )}
                    </div>
                  </article>
                ))
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
                      <div key={item.subscription.id} className='record-row'>
                        <div>
                          <strong>{plans.find((plan) => plan.plan.id === item.subscription.plan_id)?.plan.title || `订阅 #${item.subscription.id}`}</strong>
                          <span>
                            已用 {formatQuota(item.subscription.amount_used)} / {formatQuota(item.subscription.amount_total)}
                          </span>
                        </div>
                        <div className='subscription-progress-inline'>
                          <div className='usage-bar-track'>
                            <div
                              className='usage-bar-fill'
                              style={{ width: `${percentageOf(item.subscription.amount_used, item.subscription.amount_total)}%` }}
                            />
                          </div>
                        </div>
                        <small>{item.subscription.status}</small>
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
  const [billing, setBilling] = useState<BillingHistoryData | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [perfMetrics, setPerfMetrics] = useState<{ requestCount24h: number; avgLatencyMs: number } | null>(null)

  const recentBills = billing?.items || []
  const completedBillCount = recentBills.filter((item) => item.status === 'success').length
  const walletBalance = Number(user.remain_balance || 0)
  const tokenBalance = Number(user.quota || 0)
  const tokenExpense = Number(user.used_quota || 0)
  const requestCount24h = perfMetrics?.requestCount24h ?? 0
  const modelSummary = useMemo(
    () => usageModelSummary(usageData?.items || []),
    [usageData?.items]
  )
  const totalQuota = modelSummary.reduce((sum, item) => sum + item.quota, 0)
  const topModels = modelSummary.slice(0, 8)
  const maxBillAmount = recentBills.reduce((max, item) => Math.max(max, Number(item.amount || item.money || 0)), 0)
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

  function formatBillingLabel(item: BillingHistoryData['items'][number]) {
    if (item.plan_title?.trim()) {
      return item.plan_title.trim()
    }
    const trade = String(item.trade_no || '').replace(/SUBWALLETUSR1NO[a-zA-Z0-9_-]*/g, '').trim()
    const payment = String(item.payment_method || '').replace(/^wallet$/i, '').trim()
    return trade || payment || '购买记录'
  }

  const refreshWallet = useCallback(async () => {
    const nextBilling = await getBillingHistory()
    setBilling(nextBilling ?? null)
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextBilling, nextUsageData, nextPerfMetrics] = await Promise.all([
          getBillingHistory(),
          getUserUsageLogs(1, 200),
          getPerfMetricsSummary(24).catch(() => null),
        ])

        if (disposed) {
          return
        }

        setBilling(nextBilling ?? null)
        setUsageData(nextUsageData ?? null)
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
            <span className='eyebrow dark'>钱包</span>
            <h2>余额、充值与账单记录</h2>
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
                <strong>{formatPrice(walletBalance, 'CNY')}</strong>
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
                    {(billing?.items || []).map((item, index) => (
                      <div key={String(item.trade_no || index)} className='billing-card'>
                          <div
                            className='billing-card-fill'
                            style={{
                              width: `${percentageOf(Number(item.amount || item.money || 0), maxBillAmount || 1)}%`,
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
              {topModels.length === 0 ? (
                <EmptyState title='当前没有用量记录' description='模型调用后会在这里显示消耗分布。' />
              ) : (
                <div className='usage-bars'>
                  {topModels.map((item) => (
                    <div key={item.model} className='usage-bar-row'>
                      <div className='usage-bar-head'>
                        <strong>{item.model}</strong>
                        <span>{formatQuota(item.quota)}</span>
                      </div>
                      <div className='usage-bar-track'>
                        <div className='usage-bar-fill' style={{ width: `${percentageOf(item.quota, totalQuota)}%` }} />
                      </div>
                      <small>占比 {percentageOf(item.quota, totalQuota).toFixed(1)}%</small>
                    </div>
                  ))}
                </div>
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

function MeWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
}) {
  const { user, toast } = props
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
  const [newKeyName, setNewKeyName] = useState('桌面端专用 Key')
  const [accessToken, setAccessToken] = useState('')
  const [accessTokenVisible, setAccessTokenVisible] = useState(false)

  const refreshMe = useCallback(async () => {
    const nextKeys = await getApiKeys()
    setApiKeys(nextKeys?.items ?? [])
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
        const result = await createDesktopCliKey(
          newKeyName.trim() || '桌面端专用 Key',
          user.group || ''
        )
        setRevealedKey(result.key)
        toast('新的 API Key 已创建。')
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

  return (
    <>
      <section className='workspace-page full-bleed-page'>
        <article className='panel scroll-panel page-surface'>
          <div className='panel-header compact'>
            <div>
              <span className='eyebrow dark'>我的</span>
              <h2>账户与敏感操作</h2>
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

                <div className='panel-block me-key-list-card'>
                  <div className='list-block-header'>
                    <strong>已有 Key</strong>
                  </div>
                  <div className='subrecords'>
                    {apiKeys.length === 0 ? (
                      <EmptyState title='当前还没有 API Key' description='验证密码后即可直接新建桌面端专用 Key。' />
                    ) : (
                      apiKeys.map((item) => (
                        <div key={item.id} className='record-row'>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{item.group || 'default'} · 创建于 {formatDateTime(item.created_time)}</span>
                          </div>
                          <div className='record-actions'>
                            <small>{item.status === 1 ? '启用中' : '已停用'}</small>
                            <button
                              className='ghost-button'
                              type='button'
                              onClick={() => openPasswordGate('view-key', item.id)}
                            >
                              查看
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className='panel-block me-key-create-card'>
                  <div className='subform me-key-create'>
                    <div className='list-block-header'>
                      <strong>新建 Key</strong>
                    </div>
                    <div className='inline-fields'>
                      <input
                        value={newKeyName}
                        onChange={(event) => setNewKeyName(event.target.value)}
                        placeholder='新 Key 名称'
                      />
                      <button
                        className='secondary-button'
                        type='button'
                        onClick={() => openPasswordGate('create-key')}
                      >
                        新建 Key
                      </button>
                    </div>
                    <p className='helper-copy'>
                      查看 Key 或新建 Key 需要校验一次密码，验证后 30 分钟内无需重复输入。
                    </p>
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
                <CliSetupCard client='claude' user={user} toast={toast} className='me-claude-card' />
                <CliSetupCard client='codex' user={user} toast={toast} className='me-codex-card' />
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

function CliWorkspace(props: {
  client: CliClient
  toast: (message: string) => void
  openSettings: () => void
  active: boolean
}) {
  const { client, toast, openSettings, active } = props
  const [status, setStatus] = useState<CliStatus>(() => readCachedCliStatus(client))
  const [history, setHistory] = useState<CliHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [favoriteModels, setFavoriteModels] = useState<string[]>(() => loadFavoriteModels(`oneapi-desktop-${client}-favorites`))
  const [projectPath, setProjectPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [fullAccess, setFullAccess] = useState(false)
  const [projectSessionMap, setProjectSessionMap] = useState<Record<string, string>>({})
  const [sessionProjectPathMap, setSessionProjectPathMap] = useState<Record<string, string>>({})
  const [sessionMessagesMap, setSessionMessagesMap] = useState<Record<string, CliMessage[]>>({})
  const [sessionLogsMap, setSessionLogsMap] = useState<Record<string, CliLogEntry[]>>({})
  const [sessionPartialMap, setSessionPartialMap] = useState<Record<string, string>>({})
  const [expandedLogGroupId, setExpandedLogGroupId] = useState('')
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string; content: string } | null>(null)
  const [hiddenSessionIds, setHiddenSessionIds] = useState<string[]>(() =>
    readJsonStorage<string[]>(`oneapi-desktop-${client}-hidden-sessions`, [])
  )
  const [historyVisibilityTab, setHistoryVisibilityTab] = useState<HistoryVisibilityTab>('visible')
  const [requestSessionMap, setRequestSessionMap] = useState<
    Record<string, { sessionId: string; projectPath: string }>
  >({})
  const [cliModels, setCliModels] = useState<ChatModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState(client === 'claude' ? 'high' : 'medium')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const {
    attachments,
    inputRef: attachmentInputRef,
    clearAttachments,
    handleInputChange: handleAttachmentInputChange,
    handlePaste: handleAttachmentPaste,
  } = useComposerAttachments(toast)
  const { ref: promptRef, resize: resizePrompt } = useAutosizeTextarea(prompt)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const effortMenuRef = useRef<HTMLDivElement | null>(null)
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const requestSessionMapRef = useRef(requestSessionMap)
  const activeRequestIdRef = useRef('')
  const stoppingRunRef = useRef(false)

  const currentProjectKey = useMemo(() => normalizeProjectKey(projectPath), [projectPath])
  const activeSessionId = currentProjectKey ? projectSessionMap[currentProjectKey] || '' : ''
  const activeMessages = activeSessionId ? sessionMessagesMap[activeSessionId] || [] : []
  const activeLogs = activeSessionId ? sessionLogsMap[activeSessionId] || [] : []
  const activePartial = activeSessionId ? sessionPartialMap[activeSessionId] || '' : ''
  const reasoningOptions = client === 'claude' ? CLAUDE_REASONING_OPTIONS : CLI_REASONING_OPTIONS
  const preferredCliModel = client === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL
  const fallbackCliModels = useMemo(
    () => [
      {
        label: preferredCliModel,
        value: preferredCliModel,
      },
    ],
    [preferredCliModel]
  )
  const compatibleCliModels = useMemo(
    () =>
      prioritizeFavoriteModels(
        filterAssistantModels(client, withFavoriteFlag(cliModels, favoriteModels), fallbackCliModels)
      ),
    [client, cliModels, favoriteModels, fallbackCliModels]
  )
  const selectedModelLabel =
    compatibleCliModels.find((item) => item.value === selectedModel)?.label || selectedModel || preferredCliModel
  const selectedEffortLabel =
    reasoningOptions.find((item) => item.value === reasoningEffort)?.label || reasoningEffort
  const recentSessions = useMemo(
    () =>
      buildCliRecentSessions({
        history,
        sessionMessagesMap,
        sessionLogsMap,
        sessionProjectPathMap,
      }),
    [history, sessionLogsMap, sessionMessagesMap, sessionProjectPathMap]
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

  useEffect(() => {
    requestSessionMapRef.current = requestSessionMap
  }, [requestSessionMap])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const models = await getUserModels()
        if (!disposed) {
          setCliModels(models)
          setSelectedModel((current) =>
            resolveCompatibleModel(client, [...models, ...fallbackCliModels], current, preferredCliModel)
          )
        }
      } catch {
        if (!disposed) {
          setSelectedModel((current) =>
            resolveCompatibleModel(client, fallbackCliModels, current, preferredCliModel)
          )
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [client, fallbackCliModels, preferredCliModel])

  useEffect(() => {
    window.setTimeout(() => {
      void refreshCliState(true)
    }, 0)
    const timer = window.setInterval(() => {
      void refreshCliState(true)
    }, 30000)

    return () => {
      window.clearInterval(timer)
    }
  }, [refreshCliState])

  useEffect(() => {
    const unsubscribe = onCliProgress((payload: CliProgressPayload) => {
      if (payload.client !== client) {
        return
      }

      const tracked = requestSessionMapRef.current[payload.requestId]
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
      }

      const targetSessionId = payload.sessionId || tracked?.sessionId || currentSession

      if (payload.kind === 'partial') {
        setSessionPartialMap((current) => ({
          ...current,
          [targetSessionId]: payload.message,
        }))
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

      setSessionLogsMap((current) => {
        const nextEntry = {
          id: `${payload.requestId}-${payload.kind}-${payload.createdAt}-${currentSession}`,
          requestId: payload.requestId,
          sessionId: targetSessionId,
          level: payload.kind === 'error' ? 'error' : 'status',
          content: payload.message,
          createdAt: payload.createdAt,
          files: payload.files,
        } satisfies CliLogEntry
        const previous = current[targetSessionId] || []
        const lastEntry = previous.at(-1)
        if (
          lastEntry?.level === nextEntry.level &&
          lastEntry.content === nextEntry.content &&
          JSON.stringify(lastEntry.files || []) === JSON.stringify(nextEntry.files || [])
        ) {
          return current
        }
        return {
          ...current,
          [targetSessionId]: [...previous, nextEntry],
        }
      })

      if (payload.done) {
        setSessionPartialMap((current) => ({
          ...current,
          [targetSessionId]: '',
        }))
      }
    })

    return unsubscribe
  }, [client])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }

      if (modelMenuOpen && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setModelMenuOpen(false)
      }

      if (effortMenuOpen && effortMenuRef.current && !effortMenuRef.current.contains(target)) {
        setEffortMenuOpen(false)
      }

      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        setHistoryOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [effortMenuOpen, historyOpen, modelMenuOpen])

  useEffect(() => {
    function handleOpenHistory() {
      setHistoryOpen(true)
    }
    window.addEventListener(`oneapi:open-${client}-history`, handleOpenHistory as EventListener)
    return () => window.removeEventListener(`oneapi:open-${client}-history`, handleOpenHistory as EventListener)
  }, [client])

  useEffect(() => {
    if (active) {
      void setDesktopWindowTitle(projectName)
    }
  }, [active, projectName])

  function applyProjectPath(nextPath: string) {
    setProjectPath(nextPath)
    setProjectName(resolveProjectNameFromPath(nextPath))
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

  function bindProjectSession(nextProjectPath: string, sessionId: string) {
    const nextProjectKey = normalizeProjectKey(nextProjectPath)
    if (!nextProjectKey || !sessionId) {
      return
    }
    setSessionProjectPathMap((current) => ({
      ...current,
      [sessionId]: nextProjectPath,
    }))
    setProjectSessionMap((current) => ({
      ...current,
      [nextProjectKey]: sessionId,
    }))
  }

  function hydrateCliSession(
    details: CliSessionDetails,
    options: {
      activateProject?: boolean
    } = {}
  ) {
    const normalizedUpdatedAt = normalizeTimestampMs(details.updatedAt)
    const normalizedMessages = details.messages.map((message) => ({
      ...message,
      createdAt: normalizeTimestampMs(message.createdAt),
    }))

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
      [details.id]: normalizedMessages,
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
    window.setTimeout(() => resizePrompt(), 0)

    if (sessionMessagesMap[item.id]?.length) {
      setHistoryOpen(false)
      return
    }

    try {
      const details = await getCliSession(client, item.id)
      if (!details) {
        toast('未能读取完整会话记录。')
        return
      }
      hydrateCliSession(details, { activateProject })
      setHistoryOpen(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取会话失败')
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

  async function handlePreviewFile(targetPath: string) {
    try {
      const details = await readDesktopFilePreview(targetPath)
      setPreviewFile(details)
    } catch (error) {
      toast(error instanceof Error ? error.message : '文件预览失败')
    }
  }

  function loadPromptForEdit(content: string) {
    setPrompt(content)
    window.setTimeout(() => {
      syncTextareaHeight(promptRef.current)
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(content.length, content.length)
    }, 0)
  }

  async function handleRun() {
    if (!projectPath.trim() || !prompt.trim() || running) {
      toast('请选择项目目录并输入消息。')
      return
    }

    const nextPrompt = prompt.trim()
    const requestId = `${client}-${Date.now()}`
    const requestProjectPath = projectPath
    const requestProjectKey = normalizeProjectKey(requestProjectPath)
    const currentSessionKey = activeSessionId || `draft-${client}-${Date.now()}`
    const promptWithAttachments = `${nextPrompt}${buildCliAttachmentReferenceText(attachments)}`.trim()
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: nextPrompt,
      createdAt: Date.now(),
      attachments: toMessageAttachments(attachments),
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
    setSessionMessagesMap((current) => ({
      ...current,
      [currentSessionKey]: [...(current[currentSessionKey] || []), userMessage],
    }))
    setSessionPartialMap((current) => ({
      ...current,
      [currentSessionKey]: 'thinking...',
    }))
    setPrompt('')
    clearAttachments()
    window.setTimeout(() => resizePrompt(), 0)
    setRunning(true)

    try {
      const response = await runCliPrompt({
        client,
        requestId,
        projectPath: requestProjectPath,
        prompt: promptWithAttachments,
        sessionId: getCliResumeSessionId(activeSessionId),
        model: resolveCompatibleModel(client, compatibleCliModels, selectedModel, preferredCliModel) || undefined,
        reasoningEffort,
        fullAccess,
      })

      const nextSessionId = response.sessionId || currentSessionKey
      bindProjectSession(requestProjectPath, nextSessionId)

      if (nextSessionId !== currentSessionKey) {
        setSessionMessagesMap((current) => {
          const previous = current[currentSessionKey] || []
          const incoming = current[nextSessionId] || []
          const next = {
            ...current,
            [nextSessionId]: mergeCliMessages(previous, incoming),
          }
          delete next[currentSessionKey]
          return next
        })
        setSessionLogsMap((current) => {
          const previous = current[currentSessionKey] || []
          const incoming = current[nextSessionId] || []
          const next = {
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

      if (!response.success && response.metadata?.aborted !== true) {
        toast(response.error || `${client} 执行失败`)
      }
      await refreshCliState()
    } catch (error) {
      if (!stoppingRunRef.current && !isAbortError(error)) {
        toast(error instanceof Error ? error.message : '执行失败')
      }
    } finally {
      setRequestSessionMap((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      activeRequestIdRef.current = ''
      stoppingRunRef.current = false
      setRunning(false)
    }
  }

  async function handleStopRun() {
    if (!activeRequestIdRef.current) {
      return
    }

    stoppingRunRef.current = true
    try {
      await stopCliPrompt(activeRequestIdRef.current)
      toast(`已停止 ${client === 'codex' ? 'Codex' : 'Claude'} 当前回复。`)
    } catch (error) {
      toast(error instanceof Error ? error.message : '停止失败')
    }
  }

  return (
    <section className='workspace-page cli-page'>
      <div className={`cli-layout ${historyOpen ? 'history-open' : ''}`}>
        <article className='panel cli-main-panel cli-panel-surface'>
          {(!status.installed || !status.hasConfig) && (
            <div className='inline-notice warn'>
              <span>当前环境还未完成安装或配置，请先前往设置完成一键部署。</span>
              <button className='secondary-button tiny' type='button' onClick={openSettings}>
                前往设置
              </button>
            </div>
          )}

          <div className='cli-thread'>
            {activeTimeline.map((item) => {
              if (item.kind === 'log') {
                const expanded = expandedLogGroupId === item.id
                return (
                  <CliLogBubble
                    key={item.id}
                    item={item}
                    expanded={expanded}
                    onToggle={() => setExpandedLogGroupId((current) => (current === item.id ? '' : item.id))}
                    onOpenFile={(path) => void handlePreviewFile(path)}
                    onCopy={() => void copyText(item.content.join('\n'))}
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
                  <MessageAttachmentGallery attachments={'attachments' in item ? item.attachments : undefined} />
                  <MarkdownMessageContent content={item.content} />
                  {'fileChanges' in item && item.role === 'assistant' ? (
                    <MessageFileChangeLinks files={item.fileChanges} />
                  ) : null}
                  <BubbleMeta
                    side={item.role === 'user' ? 'right' : 'left'}
                    createdAt={item.createdAt}
                    actions={[
                      {
                        key: 'copy',
                        label: '复制',
                        icon: Copy,
                        onClick: () => void copyText(item.content),
                      },
                      {
                        key: 'edit',
                        label: '编辑',
                        icon: PencilLine,
                        onClick: () => loadPromptForEdit(item.content),
                      },
                    ]}
                  />
                </div>
              )
            })}
          </div>

          {renderComposer({
            inputRef: attachmentInputRef,
            onAttachmentInputChange: handleAttachmentInputChange,
            textareaRef: promptRef,
            value: prompt,
            placeholder: `输入要发给 ${client} 的消息，例如：阅读当前项目并总结关键模块。`,
            onChange: (value) => {
              setPrompt(value)
              resizePrompt()
            },
            onPaste: handleAttachmentPaste,
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
                    className={`ghost-button tiny icon-pill-trigger ${fullAccess ? 'selected-toggle' : ''}`}
                    type='button'
                    onClick={() => setFullAccess((current) => !current)}
                    title='全权限'
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
                      <div className='picker-menu model-menu'>
                        <div className='picker-menu-head'>
                          <strong>AI 版本</strong>
                          <span>切换当前 CLI 会话模型</span>
                        </div>
                        <div className='picker-menu-list'>
                          {compatibleCliModels.map((item: ChatModelOption) => (
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
                              <span>{item.value}</span>
                            </button>
                          ))}
                        </div>
                      </div>
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
                      <div className='picker-menu model-menu'>
                        <div className='picker-menu-head'>
                          <strong>思考长度</strong>
                          <span>控制当前 CLI 对话的推理强度</span>
                        </div>
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
                              <span>{item.value}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ),
              },
            ],
            sendButton: (
              <button
                className={`primary-button icon-only send-button ${running ? 'stop-button' : ''}`}
                type='button'
                onClick={() => void (running ? handleStopRun() : handleRun())}
                title={running ? '停止回复' : '发送消息'}
                aria-label={running ? '停止回复' : '发送消息'}
              >
                {running ? <Square size={14} /> : <Send size={16} />}
              </button>
            ),
          })}
        </article>

        <aside
          ref={historyPanelRef}
          className={`panel cli-history-panel ${historyOpen ? 'open' : ''}`}
          tabIndex={historyOpen ? 0 : -1}
        >
          <div className='panel-header compact'>
            <div>
              <span className='eyebrow dark'>历史记录</span>
              <h2>最近会话</h2>
            </div>
              <div className='inline-actions'>
                <button className='ghost-button tiny' type='button' onClick={() => void refreshCliState()}>
                  刷新
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
                {Object.entries(sessionsByProject).map(([projectName, items]) => (
                  <div key={projectName} className='history-group'>
                    <div className='history-group-head'>
                      <strong>{projectName}</strong>
                      <span>{items.length} 条</span>
                    </div>
                    <div className='subrecords compact-records'>
                      {items.map((item: CliHistoryEntry) => (
                        <div
                          key={item.id}
                          className={`record-row action-row session-row ${item.id === activeSessionId ? 'highlighted' : ''}`}
                          role='button'
                          tabIndex={0}
                          onClick={() => void handleOpenHistory(item)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void handleOpenHistory(item)
                            }
                          }}
                        >
                          <span className='session-row-preview'>{clipText(item.preview || item.title, 74)}</span>
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
      {previewFile && (
        <div className='modal-mask' onClick={() => setPreviewFile(null)}>
          <div className='modal-card file-preview-modal' onClick={(event) => event.stopPropagation()}>
            <div className='panel-header compact'>
              <div>
                <span className='eyebrow dark'>文件预览</span>
                <h2>{previewFile.name}</h2>
              </div>
              <button className='ghost-button icon-only tiny' type='button' onClick={() => setPreviewFile(null)}>
                <X size={16} />
              </button>
            </div>
            <code className='file-preview-path'>{previewFile.path}</code>
            <pre className='file-preview-content'>{previewFile.content}</pre>
          </div>
        </div>
      )}
    </section>
  )
}

function CliSetupCard(props: {
  client: CliClient
  user: UserProfile
  toast: (message: string) => void
  className?: string
}) {
  const { client, user, toast, className } = props
  const [status, setStatus] = useState<CliStatus>(buildEmptyCliStatus(client))
  const [deploying, setDeploying] = useState(false)
  const [deployLog, setDeployLog] = useState<DeployProgressPayload[]>([])
  const [freshCliKey, setFreshCliKey] = useState('')
  const [preset, setPreset] = useState<{ apiKey: string; model: string; baseUrl: string } | null>(null)

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
        void (async () => {
          const cliStatusAll = await getCliStatus()
          const nextStatus = client === 'codex' ? cliStatusAll.codex : cliStatusAll.claude
          writeCachedCliStatus(nextStatus)
          setStatus((current) => (sameCliStatus(current, nextStatus) ? current : nextStatus))
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
      setDeployLog([])
      const generated = await createDesktopCliKey(`${client.toUpperCase()} 桌面安装 Key`, user.group || '')
      setFreshCliKey(generated.key)
      await deployCli({
        client,
        apiKey: preset?.apiKey || generated.key,
        baseUrl: preset?.baseUrl || 'http://ai.oneapi.center',
        model: preset?.model || (client === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL),
      })
      toast(`${client} 安装任务已开始。`)
    } catch (error) {
      setDeploying(false)
      toast(error instanceof Error ? error.message : '安装初始化失败')
    }
  }

  return (
    <article className={`panel settings-card inline-settings-card ${className || ''}`.trim()}>
      <div className='panel-header compact'>
        <div>
          <span className='eyebrow dark'>{client.toUpperCase()}</span>
          <h2>{client === 'codex' ? 'Codex 环境配置' : 'Claude 环境配置'}</h2>
        </div>
        <div className='inline-actions'>
          <button className='primary-button tiny' type='button' disabled={deploying} onClick={() => void handleDeploy()}>
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

      {freshCliKey && (
        <div className='key-reveal'>
          <strong>本次部署生成的专用 Key</strong>
          <code>{freshCliKey}</code>
        </div>
      )}

      <div className='timeline-list'>
        {deployLog.length === 0 ? (
          <EmptyState title='部署进度会显示在这里' description='包含检测、安装、配置、测试四段结果。' />
        ) : (
          deployLog.map((item, index) => (
            <div key={`${item.jobId}-${item.step}-${index}`} className={`timeline-row ${item.status}`}>
              <div className='timeline-dot' />
              <div>
                <strong>{item.message}</strong>
                <span>{item.detail || item.step}</span>
              </div>
            </div>
          ))
        )}
      </div>
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
}) {
  const { mode, setMode, toast, openSettings, visible, enabledModes } = props

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
          <AssistantsChatWorkspace toast={toast} />
        </div>
        <div className={mode === 'codex' ? 'workspace-shell active' : 'workspace-shell'}>
          <CliWorkspace client='codex' toast={toast} openSettings={openSettings} active={visible && mode === 'codex'} />
        </div>
        <div className={mode === 'claude' ? 'workspace-shell active' : 'workspace-shell'}>
          <CliWorkspace client='claude' toast={toast} openSettings={openSettings} active={visible && mode === 'claude'} />
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
      const profile = await requireSuccess(getSelfProfile())
      const nextUser = profile as UserProfile
      saveStoredDesktopUserId(nextUser.id)
      onLoginSuccess(nextUser)
      toast('登录成功。')
    } catch (error) {
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
          <h1>统一 AI 客户端工作台</h1>
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
          <div className='panel-header compact'>
            <div>
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
                placeholder='用户名'
              />
              <input
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                placeholder={emailVerificationRequired ? '邮箱（必填）' : '邮箱（选填）'}
              />
              <PasswordField
                value={registerPasswordValue}
                onChange={setRegisterPasswordValue}
                placeholder='密码'
              />
              <PasswordField
                value={registerConfirmPassword}
                onChange={setRegisterConfirmPassword}
                placeholder='确认密码'
              />
              {emailVerificationRequired && (
                <div className='inline-fields verification-inline-fields'>
                  <input
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value)}
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
              <button className='ghost-button' type='button' onClick={() => setMode('login')}>
                返回登录
              </button>
            </div>
          ) : (
            <div className='subform'>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder='账号或邮箱'
              />
              <PasswordField value={password} onChange={setPassword} placeholder='密码' />
              <button className='primary-button full' type='button' disabled={submitting} onClick={() => void handlePasswordLogin()}>
                {submitting ? <LoaderCircle className='spin' size={16} /> : <LockKeyhole size={16} />}
                <span>{submitting ? '登录中' : '登录'}</span>
              </button>
              {registerEnabled && (
                <button className='ghost-button' type='button' onClick={() => setMode('register')}>
                  <UserPlus size={16} />
                  <span>注册新账号</span>
                </button>
              )}
            </div>
          )}
        </div>
      </section>
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
  const [platformLabel, setPlatformLabel] = useState('Windows')
  const [productName, setProductName] = useState('OneAPI Desktop')
  const [iconPath, setIconPath] = useState('')
  const { message, setMessage } = useToastState()
  const [cliStatus, setCliStatus] = useState<{ codex: CliStatus; claude: CliStatus } | null>(null)
  const enabledAssistantModes = useMemo(() => {
    const next: AssistantMode[] = ['chat']
    if (cliStatus?.codex.installed && cliStatus?.codex.hasConfig) {
      next.push('codex')
    }
    if (cliStatus?.claude.installed && cliStatus?.claude.hasConfig) {
      next.push('claude')
    }
    return next
  }, [cliStatus])

  useEffect(() => {
    setBootstrapping(true)
    const persistedUser = useAuthStore.getState().user
    if (persistedUser?.id) {
      saveStoredDesktopUserId(persistedUser.id)
    }

    getDesktopBridge()
      .getAppMeta()
      .then((meta) => {
        setPlatformLabel(meta.platform === 'darwin' ? 'macOS' : 'Windows')
        setProductName(meta.productName)
        setIconPath(meta.iconPath)
      })
      .catch(() => undefined)

    getDesktopBridge()
      .getCliStatus()
      .then((status) => {
        setCliStatus(status)
      })
      .catch(() => undefined)

    requireSuccess(getSelfProfile())
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
    if (!enabledAssistantModes.includes(assistantMode)) {
      setAssistantMode(enabledAssistantModes[0] || 'chat')
    }
  }, [assistantMode, enabledAssistantModes])

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
    auth.reset()
    auth.setUser(null)
    setMessage('已退出登录。')
  }

  if (auth.bootstrapping) {
    return (
      <div className='boot-screen'>
        <LoaderCircle className='spin' size={22} />
        <span>正在初始化桌面工作台...</span>
      </div>
    )
  }

  if (!auth.user) {
    return (
      <>
        <LoginScreen
          platformLabel={platformLabel}
          productName={productName}
          onLoginSuccess={(user) => {
            auth.setUser(user)
          }}
          toast={setMessage}
        />
        {message && <div className='toast-bar'>{message}</div>}
      </>
    )
  }

  return (
    <>
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
                &lt;
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
                <div className='sidebar-user-row'>
                  <span className='user-pill'>{auth.user.username}</span>
                  <span className='user-pill secondary'>{auth.user.display_name || 'Root User'}</span>
                  <button
                    className='ghost-button icon-only tiny'
                    type='button'
                    onClick={() => void handleLogout()}
                    title='退出'
                    aria-label='退出'
                  >
                    <LogOut size={16} />
                  </button>
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
          <div className='workspace-host'>
            <AssistantWorkspace
              mode={assistantMode}
              setMode={setAssistantMode}
              toast={setMessage}
              openSettings={() => setSideTab('me')}
              visible={sideTab === 'assistants'}
              enabledModes={enabledAssistantModes}
            />
            {sideTab === 'subscriptions' && <SubscriptionsWorkspace toast={setMessage} />}
            {sideTab === 'wallet' && <WalletWorkspace user={auth.user} toast={setMessage} />}
            {sideTab === 'me' && <MeWorkspace user={auth.user} toast={setMessage} />}
            {/* settings removed */}
          </div>
        </main>
      </div>

      {message && <div className='toast-bar'>{message}</div>}
    </>
  )
}
