import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, ReactNode } from 'react'
import {
  Bot,
  ChartColumn,
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
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  PencilLine,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  Settings2,
  Square,
  Sparkles,
  UserPlus,
  Wallet,
  Wrench,
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
import { getUserUsageLogs, getUserUsageStat } from './domains/usage'
import {
  getBillingHistory,
  redeemTopupCode,
} from './domains/wallet'
import {
  buildCliRecentSessions,
  buildCliTimeline,
  filterAssistantModels,
  resolveCompatibleModel,
} from './lib/assistant-workspace'
import {
  getCliResumeSessionId,
} from './lib/cli-session'
import { clearStoredDesktopUserId, saveStoredDesktopUserId } from './lib/desktop-client'
import { clipText, formatDateTime, formatPrice, formatQuota } from './lib/format'
import { readJsonStorage, writeJsonStorage } from './lib/storage'
import type {
  AssistantRecord,
  AuthStatus,
  BillingHistoryData,
  ChatMessage,
  ChatModelOption,
  PlanRecord,
  SubscriptionPaymentInfo,
  SubscriptionSelfData,
  UsageData,
  UsageStat,
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
type SideTab = 'assistants' | 'subscriptions' | 'wallet' | 'usage' | 'me' | 'settings'

type ComposerAttachment = {
  id: string
  name: string
  filePath: string
  size: number
  kind: 'image' | 'file'
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
  { key: 'usage', label: '用量', icon: ChartColumn, desc: '消耗趋势与调用分析' },
  { key: 'settings', label: '配置', icon: Settings2, desc: 'Codex 与 Claude 安装配置' },
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

function buildAttachmentReferenceText(attachments: ComposerAttachment[]) {
  if (!attachments.length) {
    return ''
  }

  const lines = attachments.map((item, index) => `${index + 1}. ${item.name} -> ${item.filePath}`)
  return `\n\n附件引用：\n${lines.join('\n')}\n请结合这些附件路径处理本次任务。`
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
          const filePath =
            fileWithPath.path?.trim() ||
            (
              await getDesktopBridge().saveAttachment({
                name: file.name || 'clipboard-file',
                mimeType: file.type,
                dataBase64: await fileToBase64(file),
              })
            ).path

          return {
            id: globalThis.crypto.randomUUID(),
            name: file.name || filePath.split(/[\\/]/).filter(Boolean).at(-1) || '未命名附件',
            filePath,
            size: file.size,
            kind: guessAttachmentKind(file, filePath),
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
  return value.trim().toLowerCase() === 'image2'
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

function normalizeLogTimestamp(value?: number) {
  if (!value) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
}

function buildUsageTrendData(items: UsageData['items']) {
  const grouped = new Map<number, Map<string, number>>()
  const modelTotals = new Map<string, number>()

  for (const item of items) {
    const model = item.model_name || item.token_name || '未标注模型'
    const timestamp = normalizeLogTimestamp(Number(item.created_at || item.created_time || 0))
    if (!timestamp) {
      continue
    }
    const timeKey = Math.floor(timestamp / 60) * 60
    const timeMap = grouped.get(timeKey) ?? new Map<string, number>()
    const quota = Number(item.quota || 0)
    timeMap.set(model, (timeMap.get(model) || 0) + quota)
    grouped.set(timeKey, timeMap)
    modelTotals.set(model, (modelTotals.get(model) || 0) + quota)
  }

  const timeline = [...grouped.entries()].sort((left, right) => left[0] - right[0])
  const labels = timeline.map(([timestamp]) => {
    const date = new Date(timestamp * 1000)
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  })
  const models = [...modelTotals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([model]) => model)

  const series = models.map((model, index) => ({
    model,
    color: USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length],
    values: timeline.map(([, values]) => values.get(model) || 0),
    total: modelTotals.get(model) || 0,
  }))

  const maxValue = Math.max(0, ...series.flatMap((item) => item.values))
  return {
    labels,
    series,
    maxValue,
  }
}

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

function UsageTrendChart(props: {
  items: UsageData['items']
}) {
  const { items } = props
  const chart = useMemo(() => buildUsageTrendData(items), [items])

  if (!chart.labels.length || !chart.series.length) {
    return <EmptyState title='暂无模型分析数据' description='开始使用模型后，这里会自动生成时间趋势。' />
  }

  const width = 760
  const height = 280
  const left = 18
  const right = 20
  const top = 18
  const bottom = 40
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const maxValue = chart.maxValue || 1
  const gridRows = 4

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

        {chart.series.map((series) => {
          const points = series.values.map((value, index) => {
            const x = left + (chartWidth * index) / Math.max(chart.labels.length, 1)
            const y = top + chartHeight - (value / maxValue) * chartHeight
            return { x, y }
          })

          return (
            <g key={series.model}>
              <path d={buildSmoothLinePath(points)} fill='none' stroke={series.color} strokeWidth='2.5' strokeLinecap='round' />
              {points.map((point, index) => (
                <circle key={`${series.model}-${index}`} cx={point.x} cy={point.y} r='3' fill={series.color}>
                  <title>{`${series.model} · ${chart.labels[index]} · ${formatQuota(series.values[index])}`}</title>
                </circle>
              ))}
            </g>
          )
        })}

        {chart.labels.map((label, index) => {
          const x = left + (chartWidth * (index + 0.5)) / Math.max(chart.labels.length, 1)
          return (
            <text key={label} x={x} y={height - 14} textAnchor='middle' className='usage-trend-axis'>
              {label.slice(5)}
            </text>
          )
        })}
      </svg>

      <div className='usage-trend-legend'>
        {chart.series.map((series) => (
          <div key={series.model} className='usage-trend-legend-item'>
            <span className='usage-trend-swatch' style={{ backgroundColor: series.color }} />
            <strong>{series.model}</strong>
            <span>{formatQuota(series.total)}</span>
          </div>
        ))}
      </div>
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
  return [...left, ...right].filter((item) => {
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
    () => filterAssistantModels('chat', models),
    [models]
  )
  const chatModeModels = useMemo(
    () => [{ label: 'image2 生图', value: 'image2' }, ...compatibleChatModels],
    [compatibleChatModels]
  )

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
    const userMessage: ChatMessage = {
      id: `user-${createdAt}`,
      role: 'user',
      content: `${normalizedDraft}${buildAttachmentReferenceText(attachments)}`.trim(),
      createdAt,
    }

    const history = [...messages, userMessage]
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
          messages: [
            ...session.messages,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: imageItem?.revised_prompt || normalizedDraft,
              createdAt: Date.now(),
              imageUrl,
              modelLabel: resolvedModelLabel,
            },
          ],
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
              content: item.content,
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
          messages: [
            ...session.messages,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: toMessageText(response.choices?.[0]?.message?.content),
              createdAt: Date.now(),
              usage: response.usage,
              modelLabel: resolvedModelLabel,
            },
          ],
        }))
      }
    } catch (error) {
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
          <div className='workspace-corner-tools'>
            {!historyOpen && (
              <button
                className='ghost-button icon-only'
                type='button'
                onClick={() => setHistoryOpen(true)}
                title='最近会话'
                aria-label='最近会话'
              >
                <PanelRightOpen size={16} />
              </button>
            )}
          </div>

          <div className='message-stream'>
            {messages.map((item) => (
              <div
                key={item.id}
                className={`message-bubble ${item.role} ${item.imageUrl ? 'image-bubble' : ''}`}
              >
                <span className='message-role'>
                  {item.role === 'assistant'
                    ? item.modelLabel || activeModelLabel
                    : item.role === 'system'
                      ? '系统'
                    : '你'}
                </span>
                {item.imageUrl ? (
                  <div className='chat-image-result'>
                    <img src={item.imageUrl} alt={item.content || '生成图片'} />
                    <p>{item.content}</p>
                  </div>
                ) : (
                  <p>{item.content}</p>
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
                              className={`picker-option ${item.value === selectedModel ? 'active' : ''}`}
                              onClick={() => {
                                setSelectedModel(item.value)
                                setModelMenuOpen(false)
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
            <button className='secondary-button tiny' type='button' onClick={createChatSession}>
              <Plus size={16} />
              <span>新对话</span>
            </button>
          </div>

          <div className='side-pane-scroll'>
            {chatSessions.length === 0 ? (
              <EmptyState title='当前没有聊天会话' description='发送第一条消息后，会话会出现在这里。' />
            ) : (
              <div className='subrecords compact-records'>
                {chatSessions.map((item) => (
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
                          <strong>订阅 #{item.subscription.id}</strong>
                          <span>
                            已用 {formatQuota(item.subscription.amount_used)} / {formatQuota(item.subscription.amount_total)}
                          </span>
                        </div>
                        <small>{item.subscription.status}</small>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className='panel-block'>
                <div className='list-block-header'>
                  <strong>订阅概览</strong>
                  <span>当前账户的套餐使用摘要</span>
                </div>
                <div className='subrecords'>
                  <div className='record-row'>
                    <div>
                      <strong>生效订阅</strong>
                      <span>{activeSubscriptions.length > 0 ? '当前存在可用套餐，可优先抵扣。' : '当前没有生效中的订阅。'}</span>
                    </div>
                    <small>{activeSubscriptions.length}</small>
                  </div>
                  <div className='record-row'>
                    <div>
                      <strong>账单偏好</strong>
                      <span>{subscriptionSelf?.billing_preference || '使用服务端默认配置'}</span>
                    </div>
                    <small>计费策略</small>
                  </div>
                  <div className='record-row'>
                    <div>
                      <strong>钱包支付</strong>
                      <span>{paymentInfo?.enable_wallet_payment ? '已开启，可直接用钱包购买套餐。' : '未开启钱包购买。'}</span>
                    </div>
                    <small>{paymentInfo?.enable_wallet_payment ? '可用' : '关闭'}</small>
                  </div>
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

  const recentBills = billing?.items || []
  const completedBillCount = recentBills.filter((item) => item.status === 'success').length
  const tokenBalance = Number(user.quota || 0)
  const tokenExpense = Number(user.used_quota || 0)

  const refreshWallet = useCallback(async () => {
    const nextBilling = await getBillingHistory()
    setBilling(nextBilling ?? null)
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const nextBilling = await getBillingHistory()

        if (disposed) {
          return
        }

        setBilling(nextBilling ?? null)
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
                <strong>{formatQuota(tokenBalance)}</strong>
                <span>当前余额</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(tokenExpense)}</strong>
                <span>累计消耗</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{billing?.total || 0}</strong>
                <span>账单条目</span>
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
                  (billing?.items || []).map((item, index) => (
                    <div key={String(item.trade_no || index)} className='record-row'>
                      <div>
                        <strong>{String(item.payment_method || '订单')} · {formatPrice(item.money || item.amount || 0, 'CNY')}</strong>
                        <span>{String(item.trade_no || '无交易号')} · {formatDateTime(Number(item.create_time || 0))}</span>
                      </div>
                      <small>{String(item.status || 'pending')}</small>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </article>
    </section>
  )
}

function UsageWorkspace(props: {
  toast: (message: string) => void
}) {
  const { toast } = props
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [usageStat, setUsageStat] = useState<UsageStat | null>(null)
  const modelSummary = useMemo(
    () => usageModelSummary(usageData?.items || []),
    [usageData?.items]
  )
  const totalQuota = modelSummary.reduce((sum, item) => sum + item.quota, 0)
  const totalCalls = modelSummary.reduce((sum, item) => sum + item.count, 0)
  const topModels = modelSummary.slice(0, 8)

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextUsageData, nextUsageStat] = await Promise.all([
          getUserUsageLogs(1, 200),
          getUserUsageStat(),
        ])

        if (disposed) {
          return
        }

        setUsageData(nextUsageData ?? null)
        setUsageStat(nextUsageStat ?? null)
      } catch (error) {
        if (!disposed) {
          toast(error instanceof Error ? error.message : '加载用量信息失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [toast])

  return (
    <section className='workspace-page full-bleed-page'>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <span className='eyebrow dark'>用量</span>
            <h2>消耗分布与模型调用分析</h2>
          </div>
        </div>

        <div className='panel-scroll'>
          <div className='stats-inline page-stats-grid'>
            <div className='mini-stat'>
              <strong>{formatQuota(usageStat?.quota)}</strong>
              <span>区间额度</span>
            </div>
            <div className='mini-stat'>
              <strong>{formatQuota(usageStat?.rpm)}</strong>
              <span>RPM</span>
            </div>
            <div className='mini-stat'>
              <strong>{formatQuota(usageStat?.tpm)}</strong>
              <span>TPM</span>
            </div>
            <div className='mini-stat'>
              <strong>{totalCalls}</strong>
              <span>模型调用次数</span>
            </div>
          </div>

          <div className='content-grid usage-grid'>
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
                        <div
                          className='usage-bar-fill'
                          style={{ width: `${percentageOf(item.quota, totalQuota)}%` }}
                        />
                      </div>
                      <small>
                        占比 {percentageOf(item.quota, totalQuota).toFixed(1)}% · 调用 {item.count} 次
                      </small>
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
            <div className='content-grid two-column page-blocks'>
              <div className='panel-block'>
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

              <div className='panel-block'>
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
  const [projectPath, setProjectPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [projectSessionMap, setProjectSessionMap] = useState<Record<string, string>>({})
  const [sessionProjectPathMap, setSessionProjectPathMap] = useState<Record<string, string>>({})
  const [sessionMessagesMap, setSessionMessagesMap] = useState<Record<string, CliMessage[]>>({})
  const [sessionLogsMap, setSessionLogsMap] = useState<Record<string, CliLogEntry[]>>({})
  const [sessionPartialMap, setSessionPartialMap] = useState<Record<string, string>>({})
  const [expandedLogGroupId, setExpandedLogGroupId] = useState('')
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string; content: string } | null>(null)
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
    openPicker: openAttachmentPicker,
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
    () => filterAssistantModels(client, cliModels, fallbackCliModels),
    [client, cliModels, fallbackCliModels]
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
        } satisfies CliLogEntry
        const previous = current[targetSessionId] || []
        const lastEntry = previous.at(-1)
        if (lastEntry?.level === nextEntry.level && lastEntry.content === nextEntry.content) {
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
    if (active) {
      void setDesktopWindowTitle(projectName)
    }
  }, [active, projectName])

  function applyProjectPath(nextPath: string) {
    setProjectPath(nextPath)
    setProjectName(resolveProjectNameFromPath(nextPath))
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
      [details.id]: details.messages,
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
    const promptWithAttachments = `${nextPrompt}${buildAttachmentReferenceText(attachments)}`.trim()
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: promptWithAttachments,
      createdAt: Date.now(),
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
      [currentSessionKey]: '',
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
          <div className='workspace-corner-tools'>
            {!historyOpen && (
              <button
                className='ghost-button icon-only'
                type='button'
                onClick={() => setHistoryOpen(true)}
                title='最近会话'
                aria-label='最近会话'
              >
                <PanelRightOpen size={16} />
              </button>
            )}
          </div>

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
                  <div key={item.id} className={`message-bubble system cli-log-bubble ${item.level === 'error' ? 'error' : ''}`}>
                    <button
                      className='cli-log-card-head'
                      type='button'
                      onClick={() => setExpandedLogGroupId((current) => current === item.id ? '' : item.id)}
                    >
                      <span className='message-role'>{item.level === 'error' ? '运行异常' : '运行日志'}</span>
                      <strong>{item.title}</strong>
                      <small>{item.content.length} 步</small>
                    </button>
                    <ul className='cli-log-list'>
                      {(expanded ? item.content : item.content.slice(0, 1)).map((line, index) => (
                        <li key={`${item.id}-${index}`}>{line}</li>
                      ))}
                    </ul>
                    {expanded && item.files.length > 0 && (
                      <div className='cli-log-files'>
                        {Array.from(new Set(item.files)).map((filePath) => (
                          <button
                            key={filePath}
                            className='ghost-button tiny cli-log-file'
                            type='button'
                            onClick={() => void handlePreviewFile(filePath)}
                            title={filePath}
                          >
                            <FileText size={14} />
                            <span>{filePath.split(/[\\/]/).filter(Boolean).at(-1) || filePath}</span>
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
                          onClick: () => void copyText(item.content.join('\n')),
                        },
                      ]}
                    />
                  </div>
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
                      : '你'}
                  </span>
                  <p>{item.content}</p>
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
                key: 'attachment',
                node: (
                  <button
                    className='ghost-button tiny icon-pill-trigger'
                    type='button'
                    onClick={openAttachmentPicker}
                    title='添加附件'
                  >
                    <Paperclip size={16} />
                    <strong>{attachments.length > 0 ? `附件 ${attachments.length}` : '添加附件'}</strong>
                  </button>
                ),
              },
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
                key: 'refresh',
                node: (
                  <button className='ghost-button tiny icon-pill-trigger' type='button' onClick={() => void refreshCliState()}>
                    <RefreshCcw size={16} />
                    <strong>刷新</strong>
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
                          {compatibleCliModels.map((item) => (
                            <button
                              key={item.value}
                              type='button'
                              className={`picker-option ${item.value === selectedModel ? 'active' : ''}`}
                              onClick={() => {
                                setSelectedModel(item.value)
                                setModelMenuOpen(false)
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
              {
                key: 'status-installed',
                node: (
                  <span className={`metric-pill ${status.installed ? 'success' : 'warn'}`}>
                    {status.installed ? '已安装' : '未安装'}
                  </span>
                ),
              },
              {
                key: 'status-version',
                node: <span className='metric-pill'>{status.version || '版本未知'}</span>,
              },
              {
                key: 'status-config',
                node: <span className='metric-pill'>{status.hasConfig ? '配置已就绪' : '待配置'}</span>,
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
          </div>

          <div className='side-pane-scroll'>
            {recentSessions.length === 0 ? (
              <EmptyState
                title='当前没有可读取的历史'
                description={projectPath ? '当前项目还没有本地 CLI 会话记录。' : '使用过本地 CLI 后，会话会显示在这里。'}
              />
            ) : (
              <div className='subrecords compact-records'>
                {recentSessions.map((item) => (
                  <button
                    key={item.id}
                    type='button'
                    className={`record-row action-row session-row ${item.id === activeSessionId ? 'highlighted' : ''}`}
                    onClick={() => void handleOpenHistory(item)}
                  >
                    <span className='session-row-preview'>{clipText(item.preview || item.title, 74)}</span>
                    <small>{formatDateTime(item.updatedAt)}</small>
                  </button>
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
}) {
  const { client, user, toast } = props
  const [status, setStatus] = useState<CliStatus>(buildEmptyCliStatus(client))
  const [deploying, setDeploying] = useState(false)
  const [deployLog, setDeployLog] = useState<DeployProgressPayload[]>([])
  const [freshCliKey, setFreshCliKey] = useState('')
  const [preset, setPreset] = useState<{ apiKey: string; model: string; baseUrl: string } | null>(null)

  const refreshStatus = useCallback(async (silent = false) => {
    try {
      const cliStatusAll = await getCliStatus()
      const nextStatus = client === 'codex' ? cliStatusAll.codex : cliStatusAll.claude
      writeCachedCliStatus(nextStatus)
      setStatus((current) => (sameCliStatus(current, nextStatus) ? current : nextStatus))
    } catch (error) {
      if (!silent) {
        toast(error instanceof Error ? error.message : `${client} 环境检测失败`)
      }
    }
  }, [client, toast])

  useEffect(() => {
    window.setTimeout(() => {
      void refreshStatus(true)
    }, 0)
    const timer = window.setInterval(() => {
      void refreshStatus(true)
    }, 30000)

    return () => {
      window.clearInterval(timer)
    }
  }, [refreshStatus])

  useEffect(() => {
    const unsubscribe = onDeployProgress((payload) => {
      if (payload.client !== client) {
        return
      }
      setDeployLog((current) => [...current, payload])
      if (payload.step === 'complete' || payload.status === 'error') {
        setDeploying(false)
        void refreshStatus(true)
      }
    })

    return unsubscribe
  }, [client, refreshStatus])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const nextPreset = await getCliDeployPreset(client)
        if (!disposed) {
          setPreset({
            apiKey: nextPreset.apiKey,
            model: nextPreset.model,
            baseUrl: nextPreset.baseUrl,
          })
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

    try {
      const resolvedPath = filePath ? targetPath.replace(/[/\\][^/\\]+$/, '') : targetPath
      await window.desktopBridge?.openPath(resolvedPath)
    } catch (error) {
      toast(error instanceof Error ? error.message : '打开文件夹失败')
    }
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
    <article className='panel settings-card'>
      <div className='panel-header compact'>
        <div>
          <span className='eyebrow dark'>{client.toUpperCase()}</span>
          <h2>{client === 'codex' ? 'Codex 环境配置' : 'Claude 环境配置'}</h2>
        </div>
        <div className='inline-actions'>
          <button className='ghost-button tiny' type='button' onClick={() => void refreshStatus()}>
            <RefreshCcw size={16} />
            <span>刷新</span>
          </button>
          <button className='primary-button tiny' type='button' disabled={deploying} onClick={() => void handleDeploy()}>
            <Wrench size={16} />
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
          <EmptyState
            title='部署进度会显示在这里'
            description='包含检测、安装、配置、测试四段结果，安装镜像使用国内源。'
          />
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

function SettingsWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
}) {
  const { user, toast } = props

  return (
    <section className='workspace-page single-panel-page'>
      <div className='settings-grid'>
        <CliSetupCard client='codex' user={user} toast={toast} />
        <CliSetupCard client='claude' user={user} toast={toast} />
      </div>
    </section>
  )
}

function AssistantWorkspace(props: {
  mode: AssistantMode
  setMode: (mode: AssistantMode) => void
  toast: (message: string) => void
  openSettings: () => void
  visible: boolean
}) {
  const { mode, setMode, toast, openSettings, visible } = props

  return (
    <section className={`workspace-page assistant-page ${visible ? '' : 'workspace-hidden'}`}>
      <div className='assistant-mode-float' role='tablist' aria-label='聊天形态切换'>
        {assistantModes.map((item) => (
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
  const { message, setMessage } = useToastState()

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
              {!collapsed && (
                <div>
                  <div className='brand-name'>OneAPI Center</div>
                  <div className='brand-sub'>Windows 客户端</div>
                </div>
              )}
            </div>

            <button
              className='collapse-button icon-only'
              type='button'
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? '展开边栏' : '收起边栏'}
              title={collapsed ? '展开边栏' : '收起边栏'}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
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
              openSettings={() => setSideTab('settings')}
              visible={sideTab === 'assistants'}
            />
            {sideTab === 'subscriptions' && <SubscriptionsWorkspace toast={setMessage} />}
            {sideTab === 'wallet' && <WalletWorkspace user={auth.user} toast={setMessage} />}
            {sideTab === 'usage' && <UsageWorkspace toast={setMessage} />}
            {sideTab === 'me' && <MeWorkspace user={auth.user} toast={setMessage} />}
            {sideTab === 'settings' && <SettingsWorkspace user={auth.user} toast={setMessage} />}
          </div>
        </main>
      </div>

      {message && <div className='toast-bar'>{message}</div>}
    </>
  )
}
