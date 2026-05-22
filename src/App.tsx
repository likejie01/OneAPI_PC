import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, Dispatch, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from 'react'
import {
  Blocks,
  Bot,
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
import {
  getUserGroups,
  getUserModels,
  saveImageToDisk,
  sendDirectImageGeneration,
  sendImageEdit,
  sendImageGeneration,
  streamChatCompletion,
  stopChatCompletion,
} from './domains/chat'
import {
  deleteCliMessage,
  deployCli,
  getCliSession,
  getCliDeployPreset,
  getCliStatus,
  listCliExtensions,
  listCliHistory,
  openAssistantHistoryFolder,
  openCliSessionFolder,
  onCliProgress,
  onDeployProgress,
  pickProjectDirectory,
  readDesktopFilePreview,
  runCliPrompt,
  setDesktopWindowTitle,
  stopCliPrompt,
  syncAssistantHistory,
} from './domains/cli'
import { createDesktopCliKey, ensureDesktopServiceKey, fetchApiKeySecret, getApiKeys } from './domains/keys'
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
  isImageGenerationModel as isImageGenerationModelOption,
  prioritizeFavoriteModels,
  resolveCompatibleModel,
} from './lib/assistant-workspace'
import {
  getCliResumeSessionId,
} from './lib/cli-session'
import { AUTH_EXPIRED_EVENT, clearStoredDesktopUserId, saveStoredDesktopUserId } from './lib/desktop-client'
import { deriveDesktopChatDisplayState, normalizeStoredDesktopChatMessage } from './lib/chat-reasoning'
import {
  buildCliExtensionAugmentedPrompt,
  resolveCliSlashTriggerState,
  translateCliExtensionDescription,
} from './lib/cli-extensions'
import { resolveCliSetupPeerState } from './lib/desktop-service'
import { clipText, formatDateTime, formatPrice, formatQuota, formatQuotaAsUsd } from './lib/format'
import { readJsonStorage, writeJsonStorage } from './lib/storage'
import dayjs from 'dayjs'
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
  CliExtensionEntry,
  CliHistoryEntry,
  CliLogKind,
  CliProgressPayload,
  CliSessionDetails,
  CliSessionMessage,
  CliStatus,
  DeployProgressPayload,
} from './shared/desktop'
import { useAuthStore } from './stores/auth-store'

const MarkdownMessageContentLazy = lazy(async () => {
  const module = await import('./components/MarkdownMessageContent')
  return { default: module.MarkdownMessageContent }
})

type AssistantMode = 'chat' | 'draw' | 'codex' | 'claude'
type SideTab = 'assistants' | 'subscriptions' | 'wallet' | 'me'
type HistoryVisibilityTab = 'visible' | 'hidden'
type ThemeMode = 'light' | 'dark'

const AURORA_OPACITY_STORAGE_KEY = 'oneapi-desktop-aurora-opacity'
const DEFAULT_AURORA_OPACITY = 100

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
  { key: 'wallet', label: '用量账单', icon: Wallet, desc: '余额、支付入口与账单记录' },
  { key: 'me', label: '环境部署', icon: KeyRound, desc: '个人信息、Key 与安全操作' },
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

const CLI_EXECUTION_POLICY = [
  '执行策略：',
  '1. 先选择最小修改量、最高成功率、最少副作用的方案。',
  '2. 如果当前方案失败，先分析失败原因，再列出可替代方案。',
  '3. 将替代方案按“最小修改量、最高有效性、最低风险”的顺序排序后继续尝试。',
  '4. 只有在问题解决，或已穷尽所有合理方案仍无法解决时，才结束任务。',
  '5. 回复中要明确写出失败原因、尝试顺序、最终采用的方案或无法解决的结论。',
].join('\n')

function buildCliExecutionPrompt(prompt: string) {
  return `${CLI_EXECUTION_POLICY}\n\n用户任务：\n${prompt.trim()}`
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
  createdAt: number
  files?: CliSessionMessage['fileChanges']
  detail?: string
  command?: string
  exitCode?: number
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
      </div>
      {overlayPanel ? <div className='composer-overlay-panel'>{overlayPanel}</div> : null}
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

function useAutoFollowScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
  dependencies: readonly unknown[]
) {
  const shouldFollowRef = useRef(true)

  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const handleScroll = () => {
      const remaining = node.scrollHeight - node.scrollTop - node.clientHeight
      shouldFollowRef.current = remaining <= 48
    }

    handleScroll()
    node.addEventListener('scroll', handleScroll, { passive: true })
    return () => node.removeEventListener('scroll', handleScroll)
  }, [containerRef])

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || !shouldFollowRef.current) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [containerRef, ...dependencies])
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

function ConversationScrollDock(props: {
  containerRef: React.RefObject<HTMLDivElement | null>
  itemSelector?: string
}) {
  const { containerRef, itemSelector = '.message-bubble' } = props

  return (
    <div className='conversation-scroll-dock' aria-label='会话导航'>
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

const CLI_REASONING_OPTIONS = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
] as const

const CLAUDE_REASONING_OPTIONS = [
  ...CLI_REASONING_OPTIONS,
  { label: '极限', value: 'max' },
] as const

const DEFAULT_CHAT_MODEL = 'gpt-5.5'
const DEFAULT_DRAW_MODEL = 'gpt-image-2'
const DEFAULT_CODEX_MODEL = 'gpt-5.5'
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-7'
const DEFAULT_SERVER_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_BASE_URL = 'https://ai.oneapi.center/v1'
const DEFAULT_CLAUDE_BASE_URL = 'https://ai.oneapi.center'
const CHAT_SESSIONS_STORAGE_KEY = 'oneapi-desktop-chat-sessions'
const CHAT_ACTIVE_SESSION_STORAGE_KEY = 'oneapi-desktop-chat-active-session'
const CHAT_REASONING_STORAGE_KEY = 'oneapi-desktop-chat-reasoning'
const CHAT_CONTEXT_WINDOW_STORAGE_KEY = 'oneapi-desktop-chat-context-window'
const DRAW_SESSIONS_STORAGE_KEY = 'oneapi-desktop-draw-sessions'
const DRAW_ACTIVE_SESSION_STORAGE_KEY = 'oneapi-desktop-draw-active-session'
const CHAT_PENDING_MESSAGE_LABEL = 'Thinking...'
const CLI_PENDING_MESSAGE_LABEL = 'Coding...'
const DRAW_PENDING_MESSAGE_LABEL = 'Thinking...'
const DRAW_PENDING_IMAGE_URL = '__oneapi_draw_pending__'
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

type ChatContextWindow = (typeof CHAT_CONTEXT_WINDOW_OPTIONS)[number]['value']

function isImageGenerationModel(value: string) {
  return isImageGenerationModelOption(value)
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
  extra?: ReactNode
}) {
  const { side, createdAt, actions, extra } = props

  return (
    <div className={`message-meta ${side}`}>
      <div className='message-meta-main'>
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

  if (total > 0) {
    return `Tokens ${total}${prompt || completion ? ` · 输入 ${prompt} · 输出 ${completion}` : ''}`
  }

  if (prompt > 0 || completion > 0) {
    return `输入 ${prompt} · 输出 ${completion}`
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

function LazyMarkdownContent(props: {
  content: string
  className?: string
}) {
  const { content, className } = props

  return (
    <Suspense fallback={<div className={className || 'markdown-body'}>{content}</div>}>
      <MarkdownMessageContentLazy
        content={content}
        onOpenLocalPath={openDesktopTarget}
        onOpenExternal={(target) => window.desktopBridge?.openExternal(target)}
      />
    </Suspense>
  )
}

function ReasoningMessageContent(props: {
  content: string
  pending?: boolean
}) {
  const { content, pending = false } = props
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
        <LazyMarkdownContent content={content} />
      </div>
    </details>
  )
}

function PendingImageContent() {
  return (
    <div className='pending-image-card' aria-label='图片生成中'>
      <div className='pending-image-shimmer' />
      <div className='pending-image-meta'>
        <LoaderCircle className='spin' size={14} />
        <span>{DRAW_PENDING_MESSAGE_LABEL}</span>
      </div>
    </div>
  )
}

type SessionContextMenuState = {
  x: number
  y: number
  title: string
  items: Array<{
    key: string
    label: string
    onSelect: () => void | Promise<void>
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

  useEffect(() => {
    if (!menu) {
      return
    }

    function handleClose() {
      onClose()
    }

    window.addEventListener('pointerdown', handleClose)
    window.addEventListener('resize', handleClose)
    window.addEventListener('scroll', handleClose, true)
    return () => {
      window.removeEventListener('pointerdown', handleClose)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('scroll', handleClose, true)
    }
  }, [menu, onClose])

  if (!menu) {
    return null
  }

  return (
    <div
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
          className='session-context-menu-item'
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
  onClose: () => void
}) {
  const { preview, onClose } = props
  if (!preview) {
    return null
  }

  let previewContent: ReactNode
  if (preview.mode === 'image') {
    previewContent = <img src={preview.src} alt={preview.name} className='image-preview-full' />
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
      <div className='image-preview-modal attachment-preview-modal' onClick={(event) => event.stopPropagation()}>
        <div className='image-preview-actions'>
          <div className='attachment-preview-title-block'>
            <strong>{preview.name}</strong>
            <span title={preview.path}>{preview.path}</span>
          </div>
          <button className='ghost-button tiny' type='button' onClick={onClose}>
            <X size={14} />
            <span>关闭</span>
          </button>
        </div>
        <div className='image-preview-stage attachment-preview-stage'>
          {previewContent}
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

function CliExtensionPalette(props: {
  client: CliClient
  loading: boolean
  filteredExtensions: CliExtensionEntry[]
  highlightedIndex: number
  searchValue: string
  onSearchChange: (value: string) => void
  onSelect: (item: CliExtensionEntry) => void
  onInsert: (item: CliExtensionEntry) => void
  onCopyName: (item: CliExtensionEntry) => void
  onHoverIndex: (index: number) => void
  onRefresh: () => void
  searchActive: boolean
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}) {
  const {
    client,
    loading,
    filteredExtensions,
    highlightedIndex,
    searchValue,
    onSearchChange,
    onSelect,
    onInsert,
    onCopyName,
    onHoverIndex,
    onRefresh,
    searchActive,
    onKeyDown,
  } = props

  return (
    <div className='picker-menu cli-extension-menu'>
      <div className='picker-menu-head cli-extension-menu-head'>
        <strong>{client === 'codex' ? 'Codex 技能与插件' : 'Claude 技能与插件'}</strong>
        <input
          className='cli-extension-search'
          value={searchValue}
          placeholder='搜索扩展'
          autoFocus
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className='cli-extension-toolbar'>
        <button
          className='ghost-button icon-only tiny'
          type='button'
          onClick={onRefresh}
          title={loading ? '正在刷新' : searchActive ? '搜索已生效' : '刷新扩展'}
        >
          {loading ? <LoaderCircle className='spin' size={14} /> : searchActive ? <Search size={14} /> : <RotateCcw size={14} />}
        </button>
        <span className='cli-extension-toolbar-status'>
          {loading
            ? '正在刷新扩展列表...'
            : searchActive
              ? `搜索中，命中 ${filteredExtensions.length} 项`
              : `共 ${filteredExtensions.length} 项`}
        </span>
      </div>
      <div className='cli-extension-list'>
        {loading ? (
          <div className='cli-extension-empty'>正在读取本机扩展...</div>
        ) : filteredExtensions.length === 0 ? (
          <div className='cli-extension-empty'>未找到匹配的技能、命令或插件。</div>
        ) : filteredExtensions.map((item, index) => {
          const translatedDescription = translateCliExtensionDescription(item.name, item.description)
          const compactDescription = translatedDescription || item.description || '未提供描述'
          return (
            <button
              key={item.id}
              type='button'
              className={`cli-extension-card ${index === highlightedIndex ? 'selected' : ''}`}
              onMouseEnter={() => onHoverIndex(index)}
              onClick={() => onSelect(item)}
              aria-selected={index === highlightedIndex}
            >
              <div className='cli-extension-name-row'>
                <div className='cli-extension-name-meta'>
                  <strong>{item.name}</strong>
                  <span className='cli-extension-meta'>{getCliExtensionKindLabel(item)}{item.source ? ` · ${item.source}` : ''}</span>
                </div>
                <div className='cli-extension-inline-actions'>
                  <button
                    className='ghost-button icon-only tiny cli-extension-inline-action'
                    type='button'
                    title='复制名称'
                    aria-label='复制名称'
                    onClick={(event) => {
                      event.stopPropagation()
                      onCopyName(item)
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
                      onInsert(item)
                    }}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
              <div className='cli-extension-desc-line' title={compactDescription}>
                {compactDescription}
              </div>
              <div className='cli-extension-tooltip'>
                {translatedDescription && translatedDescription !== item.description ? (
                  <p>{translatedDescription}</p>
                ) : null}
                {item.description && item.description !== translatedDescription ? (
                  <p>{item.description}</p>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
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
  onToggle: () => void
  expandedEventIds: string[]
  onToggleEvent: (eventId: string) => void
  onOpenFile: (ownerId: string, path: string) => void
  onCopy: () => void
  previewFile?: {
    ownerId: string
    path: string
    name: string
    content: string
  } | null
}) {
  const { item, expanded, onToggle, expandedEventIds, onToggleEvent, onOpenFile, onCopy, previewFile } = props
  const uniqueFiles = Array.from(new Map(item.files.map((file) => [file.path, file])).values())

  return (
    <div className={`message-bubble system cli-log-bubble ${item.level === 'error' ? 'error' : ''}`}>
      <button className='cli-log-card-head' type='button' onClick={onToggle}>
        <span className='message-role'>{item.level === 'error' ? '运行异常' : '运行日志'}</span>
        <strong>{`已执行 ${item.events.length} 步`}</strong>
        <small>{expanded ? '点击收起' : '点击展开'}</small>
      </button>
      <div className='cli-log-event-list'>
        {(expanded ? item.events : item.events.slice(0, 1)).map((eventItem) => {
          const eventFiles = Array.from(new Map(eventItem.files.map((file) => [file.path, file])).values())
          const hasExpandableContent =
            !!eventItem.command?.trim() ||
            !!eventItem.detail?.trim() ||
            eventFiles.length > 0
          const eventExpanded = expandedEventIds.includes(eventItem.id)

          return (
            <div key={eventItem.id} className={`cli-log-event-row ${eventItem.kind} ${eventItem.level}`}>
              <div className='cli-log-event-dot' />
              <div className='cli-log-event-body'>
                <div className='cli-log-event-head'>
                  <div className='cli-log-event-copy'>
                    <strong>{eventItem.message}</strong>
                    <small>
                      {[
                        resolveCliLogKindLabel(eventItem.kind),
                        formatCliSourceKind(eventItem.sourceKind),
                        formatCliLogTime(eventItem.createdAt),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </div>
                  {hasExpandableContent ? (
                    <button
                      className='cli-log-inline-toggle'
                      type='button'
                      title={eventExpanded ? '收起详情' : '展开详情'}
                      aria-label={eventExpanded ? '收起详情' : '展开详情'}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleEvent(eventItem.id)
                      }}
                    >
                      {eventExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  ) : null}
                </div>
                {eventExpanded && (
                  <div className='cli-log-event-details'>
                    {eventItem.command?.trim() ? (
                      <div className='cli-log-detail-block'>
                        <span className='cli-log-detail-label'>执行命令</span>
                        <pre className='cli-log-detail-window'>{eventItem.command}</pre>
                      </div>
                    ) : null}
                    {eventItem.detail?.trim() ? (
                      <div className='cli-log-detail-block'>
                        <pre className='cli-log-detail-window'>{eventItem.detail}</pre>
                      </div>
                    ) : null}
                    {eventFiles.length > 0 ? (
                      <div className='cli-log-detail-block'>
                        <span className='cli-log-detail-label'>相关文件</span>
                        <div className='cli-log-files inline-expanded'>
                          {eventFiles.map((fileItem) => (
                            <button
                              key={fileItem.path}
                              className='ghost-button tiny cli-log-file'
                              type='button'
                              onClick={() => onOpenFile(eventItem.id, fileItem.path)}
                              title={fileItem.path}
                            >
                              <FileText size={14} />
                              <span>{fileItem.path.split(/[\\/]/).filter(Boolean).at(-1) || fileItem.path}</span>
                            </button>
                          ))}
                        </div>
                        {previewFile && previewFile.ownerId === eventItem.id ? (
                          <div className='inline-file-preview'>
                            <code className='inline-file-preview-path'>{previewFile.path}</code>
                            <pre className='inline-file-preview-content'>{previewFile.content}</pre>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {uniqueFiles.length > 0 && !expanded && (
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
      )}
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
      const key = `${item.level}:${item.logKind || ''}:${item.sourceKind || ''}:${item.createdAt}:${item.content}:${item.command || ''}:${item.detail || ''}`
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

function formatCliSourceKind(value?: string) {
  const normalized = value?.trim()
  if (!normalized) {
    return ''
  }
  return normalized.replace(/[_\s]+/g, '.')
}

function serializeCliLogEvent(item: {
  kind?: CliLogKind
  sourceKind?: string
  message: string
  command?: string
  detail?: string
  exitCode?: number
}) {
  const kindLabel = resolveCliLogKindLabel(item.kind)
  return [
    kindLabel ? `[${kindLabel}] ${item.message}` : item.message,
    item.sourceKind ? `sourceKind: ${item.sourceKind}` : '',
    item.command ? `command:\n${item.command}` : '',
    item.detail ? `detail:\n${item.detail}` : '',
    item.exitCode !== undefined ? `exitCode: ${item.exitCode}` : '',
  ].filter(Boolean).join('\n\n')
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
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>(() => loadStoredChatSessions())
  const [activeSessionId, setActiveSessionId] = useState(() =>
    readJsonStorage<string>(CHAT_ACTIVE_SESSION_STORAGE_KEY, '')
  )
  const [draft, setDraft] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
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
  const [renamingChatSession, setRenamingChatSession] = useState<SessionRenameDraft>(null)
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
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
  const selectedReasoningLabel =
    CLI_REASONING_OPTIONS.find((item) => item.value === reasoningEffort)?.label || reasoningEffort
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
  const visibleChatSessions = useMemo(
    () => chatSessions.filter((item) => !hiddenChatSessionIds.includes(item.id)),
    [chatSessions, hiddenChatSessionIds]
  )
  const hiddenChatSessions = useMemo(
    () => chatSessions.filter((item) => hiddenChatSessionIds.includes(item.id)),
    [chatSessions, hiddenChatSessionIds]
  )
  const historySessions = historyVisibilityTab === 'hidden' ? hiddenChatSessions : visibleChatSessions

  useAutoFollowScroll(messageStreamRef, [messages, sending])

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

      if (reasoningMenuOpen && reasoningMenuRef.current && !reasoningMenuRef.current.contains(target)) {
        setReasoningMenuOpen(false)
      }

      if (contextMenuOpen && contextMenuRef.current && !contextMenuRef.current.contains(target)) {
        setContextMenuOpen(false)
      }

      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        setHistoryOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [assistantMenuOpen, contextMenuOpen, historyOpen, modelMenuOpen, reasoningMenuOpen])

  useEffect(() => {
    function handleOpenHistory() {
      setHistoryOpen(true)
    }
    window.addEventListener('oneapi:open-assistant-history', handleOpenHistory as EventListener)
    return () => window.removeEventListener('oneapi:open-assistant-history', handleOpenHistory as EventListener)
  }, [])

  useEffect(() => {
    const hasPending = chatSessions.some((session) => session.messages.some((item) => item.pending))
    if (persistChatSessionsTimerRef.current) {
      window.clearTimeout(persistChatSessionsTimerRef.current)
    }
    persistChatSessionsTimerRef.current = window.setTimeout(() => {
      writeJsonStorage(CHAT_SESSIONS_STORAGE_KEY, chatSessions)
      persistChatSessionsTimerRef.current = null
    }, hasPending ? 220 : 0)

    return () => {
      if (persistChatSessionsTimerRef.current) {
        window.clearTimeout(persistChatSessionsTimerRef.current)
        persistChatSessionsTimerRef.current = null
      }
    }
  }, [chatSessions])

  useEffect(() => {
    writeJsonStorage(CHAT_ACTIVE_SESSION_STORAGE_KEY, resolvedActiveSessionId)
  }, [resolvedActiveSessionId])

  useEffect(() => {
    const hasPending = chatSessions.some((session) => session.messages.some((item) => item.pending))
    if (persistChatHistoryTimerRef.current) {
      window.clearTimeout(persistChatHistoryTimerRef.current)
    }
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
    }, hasPending ? 360 : 0)

    return () => {
      if (persistChatHistoryTimerRef.current) {
        window.clearTimeout(persistChatHistoryTimerRef.current)
        persistChatHistoryTimerRef.current = null
      }
    }
  }, [chatSessions])

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
    pendingRequestIdRef.current = requestId
    stoppingRef.current = false
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
        const abortController = new AbortController()
        pendingStreamAbortRef.current = abortController

        await streamChatCompletion(
          {
            model: resolvedModel,
            group: selectedGroup || undefined,
            temperature: activeAssistant?.temperature ?? 0.7,
            reasoningEffort,
            messages: [
              ...(systemMessage ? [systemMessage] : []),
              ...requestHistory.map((item) => ({
                role: item.role,
                content:
                  item.id === userMessage.id
                    ? buildChatAttachmentContent(item.content, attachments)
                    : item.content,
              })),
            ],
          },
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
        const finalVisibleContent = finalDisplayState.visibleContent
        const finalReasoningContent = finalDisplayState.reasoningContent.trim()
        const hasFinalVisibleContent = finalVisibleContent.trim().length > 0

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
                      : finalReasoningContent
                        ? ''
                        : CHAT_PENDING_MESSAGE_LABEL,
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

  function deleteChatMessage(messageId: string) {
    syncActiveSession((session) => ({
      ...session,
      updatedAt: Date.now(),
      messages: session.messages.filter((item) => item.id !== messageId),
    }))
  }

  function resolveAssistantHistoryGroup(session: ChatSessionRecord) {
    return assistants.find((item) => item.id === session.assistantId)?.name || '通用助手'
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
    void openAssistantHistoryFolder('chat', sessionId).catch((error) => {
      toast(error instanceof Error ? error.message : '打开会话目录失败')
    })
  }

  function handleChatSessionContextMenu(event: MouseEvent, session: ChatSessionRecord) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: session.title,
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
      ],
    })
  }

  return (
    <section className='workspace-page chat-page'>
      <div className={`chat-layout ${historyOpen ? 'history-open' : ''}`}>
        <article className='panel conversation-panel chat-panel-surface'>
          <div className='conversation-scroll-region'>
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
                  <ReasoningMessageContent content={item.reasoningContent || ''} pending={!!item.reasoningPending} />
                  {item.imageUrl ? (
                    <div className='chat-image-result'>
                      <img src={item.imageUrl} alt={item.content || '生成图片'} />
                    </div>
                  ) : (
                    item.pending && (!item.content.trim() || item.content === CHAT_PENDING_MESSAGE_LABEL)
                      ? <PendingMessageContent label={CHAT_PENDING_MESSAGE_LABEL.replace(/\.+$/, '')} />
                      : <LazyMarkdownContent content={item.content} />
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
            <ConversationScrollDock containerRef={messageStreamRef} />
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
                      <div className='picker-menu model-menu'>
                        <div className='picker-menu-head'>
                          <strong>思考长度</strong>
                        </div>
                        <div className='picker-menu-list'>
                          {CLI_REASONING_OPTIONS.map((item) => (
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
                      </div>
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
                      <div className='picker-menu model-menu'>
                        <div className='picker-menu-head'>
                          <strong>上下文</strong>
                        </div>
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
                      </div>
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
                    <div className='history-group-head'>
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
      <AttachmentPreviewModal preview={attachmentPreview} onClose={() => setAttachmentPreview(null)} />
      <SessionContextMenu menu={sessionContextMenu} onClose={() => setSessionContextMenu(null)} />
    </section>
  )
}

function DrawWorkspace(props: {
  toast: (message: string) => void
}) {
  const { toast } = props
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
  const [sending, setSending] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('')
  const [drawSize, setDrawSize] = useState<(typeof DRAW_SIZE_OPTIONS)[number]['value']>('1024x1024')
  const [drawQuality, setDrawQuality] = useState<(typeof DRAW_QUALITY_OPTIONS)[number]['value']>('high')
  const [drawRandomSeed, setDrawRandomSeed] = useState(true)
  const [drawSizeMenuOpen, setDrawSizeMenuOpen] = useState(false)
  const [drawQualityMenuOpen, setDrawQualityMenuOpen] = useState(false)
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [renamingDrawSession, setRenamingDrawSession] = useState<SessionRenameDraft>(null)
  const [previewImage, setPreviewImage] = useState<{
    src: string
    name: string
  } | null>(null)
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
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const messageStreamRef = useRef<HTMLDivElement | null>(null)
  const drawSizeMenuRef = useRef<HTMLDivElement | null>(null)
  const drawQualityMenuRef = useRef<HTMLDivElement | null>(null)

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

  useAutoFollowScroll(messageStreamRef, [messages, sending])

  useEffect(() => {
    writeJsonStorage(DRAW_SESSIONS_STORAGE_KEY, drawSessions)
  }, [drawSessions])

  useEffect(() => {
    writeJsonStorage(DRAW_ACTIVE_SESSION_STORAGE_KEY, resolvedActiveSessionId)
  }, [resolvedActiveSessionId])

  useEffect(() => {
    void syncAssistantHistory(
      'draw',
      drawSessions.map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        data: JSON.stringify(session),
      }))
    )
  }, [drawSessions])

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
      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        setHistoryOpen(false)
      }
      if (drawSizeMenuOpen && drawSizeMenuRef.current && !drawSizeMenuRef.current.contains(target)) {
        setDrawSizeMenuOpen(false)
      }
      if (drawQualityMenuOpen && drawQualityMenuRef.current && !drawQualityMenuRef.current.contains(target)) {
        setDrawQualityMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [drawQualityMenuOpen, drawSizeMenuOpen, historyOpen])

  useEffect(() => {
    function handleOpenHistory() {
      setHistoryOpen(true)
    }
    window.addEventListener('oneapi:open-draw-history', handleOpenHistory as EventListener)
    return () => window.removeEventListener('oneapi:open-draw-history', handleOpenHistory as EventListener)
  }, [])

  function updateDrawSession(sessionId: string, updater: (session: DrawSessionRecord) => DrawSessionRecord) {
    setDrawSessions((current) =>
      current.map((item) => (item.id === sessionId ? updater(item) : item)).sort((a, b) => b.updatedAt - a.updatedAt)
    )
  }

  function createDrawSession() {
    const next = createDefaultDrawSession()
    setDrawSessions((current) => [next, ...current])
    setActiveSessionId(next.id)
    setDraft('')
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
    setHistoryOpen(false)
    setDraft('')
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
    void openAssistantHistoryFolder('draw', sessionId).catch((error) => {
      toast(error instanceof Error ? error.message : '打开会话目录失败')
    })
  }

  function handleDrawSessionContextMenu(event: MouseEvent, session: DrawSessionRecord) {
    event.preventDefault()
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: session.title || '新绘图',
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

  function deleteDrawMessage(messageId: string) {
    updateDrawSession(resolvedActiveSessionId, (session) => ({
      ...session,
      updatedAt: Date.now(),
      messages: session.messages.filter((item) => item.id !== messageId),
    }))
  }

  async function handleSendDrawMessage() {
    if (!draft.trim() || sending) {
      toast('请输入绘图提示词。')
      return
    }

    const nextSessionId = ensureDrawSession()
    const imageAttachment = attachments.find((item) => item.kind === 'image')
    const now = Date.now()
    const userMessage: ChatBubbleMessage = {
      id: `draw-user-${now}`,
      role: 'user',
      content: draft.trim(),
      createdAt: now,
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
      title: clipText(draft.trim(), 32),
      updatedAt: now + 1,
      messages: [...session.messages, userMessage, pendingMessage],
    }))

    const nextDraft = draft.trim()
    setDraft('')
    clearAttachments()
    window.setTimeout(() => resizeDraft(), 0)
    setSending(true)

    try {
      const response = imageAttachment
        ? await sendImageEdit({
            model: DEFAULT_DRAW_MODEL,
            prompt: nextDraft,
            imageName: imageAttachment.name,
            mimeType: imageAttachment.mimeType,
            dataBase64: imageAttachment.dataBase64,
            size: drawSize,
            quality: drawQuality,
          })
        : await (async () => {
            const serviceKey = await ensureDesktopServiceKey({
              name: 'OneAPI Desktop Internal Key',
              group: selectedGroup || '',
              preferredNames: ['桌面端专用 Key', 'CODEX 桌面安装 Key', 'CLAUDE 桌面安装 Key'],
            })
            return sendDirectImageGeneration({
              apiKey: serviceKey.key,
              model: DEFAULT_DRAW_MODEL,
              prompt: nextDraft,
              size: drawSize,
              quality: drawQuality,
              seed: drawRandomSeed ? undefined : 1,
              response_format: 'b64_json',
            })
          })()

      const firstImage = response.data?.[0]
      const imageSource = resolveImageMessageSource(firstImage)
      if (!imageSource) {
        throw new Error('模型没有返回可展示的图片。')
      }

      replacePendingDrawMessage(nextSessionId, {
        id: `draw-assistant-${Date.now()}`,
        role: 'assistant',
        content: firstImage?.revised_prompt?.trim() || nextDraft,
        createdAt: Date.now(),
        imageUrl: imageSource,
        imagePrompt: firstImage?.revised_prompt?.trim() || nextDraft,
        modelLabel: DEFAULT_DRAW_MODEL,
      })
    } catch (error) {
      replacePendingDrawMessage(nextSessionId, {
        id: `draw-assistant-error-${Date.now()}`,
        role: 'assistant',
        content: error instanceof Error ? error.message : '图片生成失败',
        createdAt: Date.now(),
        modelLabel: DEFAULT_DRAW_MODEL,
      })
      toast(error instanceof Error ? error.message : '图片生成失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className='workspace-page chat-page'>
      <div className={`chat-layout ${historyOpen ? 'history-open' : ''}`}>
        <article className='panel chat-main-panel chat-panel-surface'>
          <div className='conversation-scroll-region'>
            <div ref={messageStreamRef} className='message-stream'>
              {messages.length === 0 ? (
                <EmptyState title='开始绘图' description='输入提示词后，使用 gpt-image-2 直接生图；拖拽或粘贴图片后，会自动走修图接口。' icon={Sparkles} />
              ) : (
                messages.map((message) => {
                  const isUser = message.role === 'user'
                  const isPendingImage = message.pending && message.imageUrl === DRAW_PENDING_IMAGE_URL
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
                        <PendingImageContent />
                      ) : message.imageUrl ? (
                        <div className='generated-image-block'>
                          <button
                            type='button'
                            className='generated-image-button'
                            onClick={() =>
                              setPreviewImage({
                                src: message.imageUrl || '',
                                name: `${clipText(message.imagePrompt || 'oneapi-image', 24).replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'oneapi-image'}.png`,
                              })
                            }
                          >
                            <img src={message.imageUrl} alt={message.imagePrompt || '生成图片'} className='generated-image' />
                          </button>
                          <div className='generated-image-actions'>
                            <button
                              className='ghost-button tiny'
                              type='button'
                              onClick={() => void handleDownloadImage(message.imageUrl || '', 'oneapi-image.png')}
                            >
                              <Download size={14} />
                              <span>下载图片</span>
                            </button>
                          </div>
            <LazyMarkdownContent content={message.content} />
                        </div>
                      ) : (
                        <LazyMarkdownContent content={message.content} />
                      )}
                      <BubbleMeta
                        side={isUser ? 'right' : 'left'}
                        createdAt={message.createdAt}
                        actions={[
                          {
                            key: 'copy',
                            label: '复制',
                            icon: Copy,
                            onClick: () => void copyText(message.content),
                          },
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
            <ConversationScrollDock containerRef={messageStreamRef} />
          </div>

          {renderComposer({
            inputRef: attachmentInputRef,
            onAttachmentInputChange: handleAttachmentInputChange,
            textareaRef: draftRef,
            value: draft,
            placeholder: '输入绘图提示词；粘贴、拖拽图片后会自动进入修图模式',
            onChange: (value) => {
              setDraft(value)
              window.setTimeout(() => resizeDraft(), 0)
            },
            onPaste: handleAttachmentPaste,
            onDrop: handleAttachmentDrop,
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
                key: 'draw-size',
                node: (
                  <div className='toolbar-picker' ref={drawSizeMenuRef}>
                    <button
                      className={`ghost-button icon-only tiny toolbar-icon-button ${drawSizeMenuOpen ? 'selected-toggle' : ''}`}
                      type='button'
                      title={`图片尺寸：${drawSizeLabel}`}
                      aria-label={`图片尺寸：${drawSizeLabel}`}
                      aria-expanded={drawSizeMenuOpen}
                      onClick={() => {
                        setDrawQualityMenuOpen(false)
                        setDrawSizeMenuOpen((current) => !current)
                      }}
                    >
                      <Crop size={16} />
                    </button>
                    {drawSizeMenuOpen && (
                      <div className='picker-menu image-config-menu'>
                        <div className='picker-menu-head'>
                          <strong>尺寸</strong>
                        </div>
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
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'draw-quality',
                node: (
                  <div className='toolbar-picker' ref={drawQualityMenuRef}>
                    <button
                      className={`ghost-button icon-only tiny toolbar-icon-button ${drawQualityMenuOpen ? 'selected-toggle' : ''}`}
                      type='button'
                      title={`图片质量：${drawQualityLabel}`}
                      aria-label={`图片质量：${drawQualityLabel}`}
                      aria-expanded={drawQualityMenuOpen}
                      onClick={() => {
                        setDrawSizeMenuOpen(false)
                        setDrawQualityMenuOpen((current) => !current)
                      }}
                    >
                      <SlidersHorizontal size={16} />
                    </button>
                    {drawQualityMenuOpen && (
                      <div className='picker-menu image-config-menu'>
                        <div className='picker-menu-head'>
                          <strong>质量</strong>
                        </div>
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
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'draw-random',
                node: (
                  <button
                    className={`ghost-button icon-only tiny toolbar-icon-button ${drawRandomSeed ? 'active' : ''}`}
                    type='button'
                    title={`随机种子：${drawRandomSeed ? '开启' : '固定'}`}
                    aria-label={`随机种子：${drawRandomSeed ? '开启' : '固定'}`}
                    onClick={() => setDrawRandomSeed((current) => !current)}
                  >
                    <Shuffle size={16} />
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
                title='发送绘图请求'
                aria-label='发送绘图请求'
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
                <div className='history-group'>
                  <div className='history-group-head'>
                    <strong>绘图会话</strong>
                    <span>{drawSessions.length} 条</span>
                  </div>
                  <div className='subrecords compact-records'>
                    {drawSessions.map((session) => (
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
              </div>
            )}
          </div>
        </aside>
      </div>

      {previewImage && (
        <div className='modal-mask image-preview-modal-mask' onClick={() => setPreviewImage(null)}>
          <div className='image-preview-modal' onClick={(event) => event.stopPropagation()}>
            <div className='image-preview-actions'>
              <button className='ghost-button tiny' type='button' onClick={() => void handleDownloadImage(previewImage.src, previewImage.name)}>
                <Download size={14} />
                <span>下载图片</span>
              </button>
              <button className='ghost-button tiny' type='button' onClick={() => setPreviewImage(null)}>
                <X size={14} />
                <span>关闭</span>
              </button>
            </div>
            <div className='image-preview-stage'>
              <img src={previewImage.src} alt={previewImage.name} className='image-preview-full' />
            </div>
          </div>
        </div>
      )}
      <AttachmentPreviewModal preview={attachmentPreview} onClose={() => setAttachmentPreview(null)} />
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
  const [quotaPerUnit, setQuotaPerUnit] = useState(500_000)
  const [billing, setBilling] = useState<BillingHistoryData | null>(null)
  const [walletPlans, setWalletPlans] = useState<PlanRecord[]>([])
  const [walletSubscriptionSelf, setWalletSubscriptionSelf] = useState<SubscriptionSelfData | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [perfMetrics, setPerfMetrics] = useState<{ requestCount24h: number; avgLatencyMs: number } | null>(null)

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
  const topModels = modelSummary.slice(0, 8)
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
            <h2>余额与账单记录</h2>
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
  const [newKeyName, setNewKeyName] = useState('桌面端专用 Key')
  const [accessToken, setAccessToken] = useState('')
  const [accessTokenVisible, setAccessTokenVisible] = useState(false)
  const [activeDeployClient, setActiveDeployClient] = useState<CliClient | null>(null)

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

                <div className='panel-block me-key-list-card'>
                  <div className='list-block-header'>
                    <strong>已有 Key</strong>
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
  const [expandedLogGroupIds, setExpandedLogGroupIds] = useState<string[]>([])
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
  const [renamingHistorySession, setRenamingHistorySession] = useState<SessionRenameDraft>(null)
  const [requestSessionMap, setRequestSessionMap] = useState<
    Record<string, { sessionId: string; projectPath: string }>
  >({})
  const [cliModels, setCliModels] = useState<ChatModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState(client === 'claude' ? 'high' : 'medium')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const [extensionsMenuOpen, setExtensionsMenuOpen] = useState(false)
  const [extensionsLoading, setExtensionsLoading] = useState(false)
  const [extensionSearch, setExtensionSearch] = useState('')
  const [cliExtensions, setCliExtensions] = useState<CliExtensionEntry[]>([])
  const [selectedExtensions, setSelectedExtensions] = useState<CliExtensionEntry[]>([])
  const [highlightedExtensionIndex, setHighlightedExtensionIndex] = useState(0)
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
  const historyPanelRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
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
  const filteredCliExtensions = useMemo(() => {
    const normalizedSearch = extensionSearch.trim().toLowerCase()
    if (!normalizedSearch) {
      return cliExtensions
    }

    return cliExtensions.filter((item) =>
      [
        item.name,
        item.description,
        translateCliExtensionDescription(item.name, item.description),
        item.source || '',
        item.path,
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
    )
  }, [cliExtensions, extensionSearch])
  const composerTokenItems = useMemo(
    () =>
      selectedExtensions.map((item) => ({
        id: item.id,
        label: item.name,
        kindLabel: getCliExtensionKindLabel(item),
        onRemove: () => {
          setSelectedExtensions((current) => current.filter((entry) => entry.id !== item.id))
          window.setTimeout(() => promptRef.current?.focus(), 0)
        },
      })),
    [promptRef, selectedExtensions]
  )
  const effectiveHighlightedExtensionIndex = filteredCliExtensions.length
    ? Math.min(highlightedExtensionIndex, filteredCliExtensions.length - 1)
    : 0
  const recentSessions = useMemo(
    () =>
      buildCliRecentSessions({
        history,
        sessionMessagesMap,
        sessionLogsMap,
        sessionProjectPathMap,
      }).map((item) => ({
        ...item,
        title: historyTitleOverrides[item.id] || item.title,
        preview: historyTitleOverrides[item.id] || item.preview,
      })),
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
  const latestAssistantMessageId = useMemo(
    () => [...activeMessages].reverse().find((item) => item.role === 'assistant')?.id || '',
    [activeMessages]
  )

  useEffect(() => {
    if (!running && latestAssistantMessageId) {
      const timer = window.setTimeout(() => {
        setExpandedLogGroupIds([])
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [latestAssistantMessageId, running])
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
    } catch (error) {
      if (!silent) {
        toast(error instanceof Error ? error.message : '读取技能与插件失败')
      }
    } finally {
      setExtensionsLoading(false)
    }
  }, [client, toast])

  const closeCliExtensionsMenu = useCallback((focusPrompt = false) => {
    setExtensionsMenuOpen(false)
    setExtensionSearch('')
    setHighlightedExtensionIndex(0)
    if (focusPrompt) {
      window.setTimeout(() => promptRef.current?.focus(), 0)
    }
  }, [promptRef])

  const openCliExtensionsMenu = useCallback(() => {
    setModelMenuOpen(false)
    setEffortMenuOpen(false)
    setExtensionsMenuOpen(true)
    setExtensionSearch('')
    setHighlightedExtensionIndex(0)
    void refreshCliExtensions(true)
  }, [refreshCliExtensions])

  const insertCliExtension = useCallback((item: CliExtensionEntry) => {
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
  }, [closeCliExtensionsMenu, resizePrompt])

  const selectHighlightedCliExtension = useCallback(() => {
    const target = filteredCliExtensions[effectiveHighlightedExtensionIndex]
    if (target) {
      insertCliExtension(target)
    }
  }, [effectiveHighlightedExtensionIndex, filteredCliExtensions, insertCliExtension])

  const handleCliExtensionPaletteKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!extensionsMenuOpen) {
      return false
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeCliExtensionsMenu(true)
      return true
    }

    if (!filteredCliExtensions.length) {
      return false
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedExtensionIndex((current) => (current + 1) % filteredCliExtensions.length)
      return true
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedExtensionIndex((current) =>
        current <= 0 ? filteredCliExtensions.length - 1 : current - 1
      )
      return true
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      selectHighlightedCliExtension()
      return true
    }

    return false
  }, [closeCliExtensionsMenu, extensionsMenuOpen, filteredCliExtensions, selectHighlightedCliExtension])

  useEffect(() => {
    requestSessionMapRef.current = requestSessionMap
  }, [requestSessionMap])

  useEffect(() => {
    writeJsonStorage(`oneapi-desktop-${client}-pinned-groups`, pinnedHistoryGroups)
  }, [client, pinnedHistoryGroups])

  useEffect(() => {
    writeJsonStorage(`oneapi-desktop-${client}-history-title-overrides`, historyTitleOverrides)
  }, [client, historyTitleOverrides])

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
    window.setTimeout(() => {
      void refreshCliExtensions(true)
    }, 0)
  }, [refreshCliExtensions])

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
          logKind: payload.logKind || (payload.kind === 'error' ? 'error' : 'status'),
          sourceKind: payload.sourceKind,
          content: payload.message,
          createdAt: payload.createdAt,
          files: payload.files,
          detail: payload.detail,
          command: payload.command,
          exitCode: payload.exitCode,
        } satisfies CliLogEntry
        const previous = current[targetSessionId] || []
        const lastEntry = previous.at(-1)
        if (
          lastEntry?.level === nextEntry.level &&
          lastEntry.logKind === nextEntry.logKind &&
          lastEntry.sourceKind === nextEntry.sourceKind &&
          lastEntry.content === nextEntry.content &&
          lastEntry.detail === nextEntry.detail &&
          lastEntry.command === nextEntry.command &&
          lastEntry.exitCode === nextEntry.exitCode &&
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
    setExpandedLogGroupIds([])
    setExpandedLogEventMap({})
    setPreviewFile(null)
    setExtensionsMenuOpen(false)
    setExtensionSearch('')
    setSelectedExtensions([])
  }, [activeSessionId])

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

      if (extensionsMenuOpen && extensionsMenuRef.current && !extensionsMenuRef.current.contains(target)) {
        setExtensionsMenuOpen(false)
      }

      if (historyOpen && historyPanelRef.current && !historyPanelRef.current.contains(target)) {
        setHistoryOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [effortMenuOpen, extensionsMenuOpen, historyOpen, modelMenuOpen])

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

  function togglePinnedHistoryGroup(groupKey: string) {
    setPinnedHistoryGroups((current) =>
      current.includes(groupKey)
        ? current.filter((item) => item !== groupKey)
        : [groupKey, ...current]
    )
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

  function toggleLogGroup(groupId: string) {
    setExpandedLogGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((item) => item !== groupId)
        : [...current, groupId]
    )
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
            openCliSessionFolder(client, item.id).catch((error) => {
              toast(error instanceof Error ? error.message : '打开会话目录失败')
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

    if (!message.sourceFilePath || !message.sourceLineNumber) {
      toast('当前消息还没有稳定的源文件定位信息，暂时不能删除。')
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
    }>
  ) {
    setPrompt(content)
    replaceAttachments(rehydrateCliComposerAttachments(messageAttachments))
    setSelectedExtensions([])
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
    } = {}
  ) => {
    const targetProjectPath = options.targetProjectPath?.trim() || projectPath.trim()
    const targetAttachments = options.nextAttachments ?? attachments
    const cleanedPrompt = promptValue.trim()

    if (!targetProjectPath || !cleanedPrompt || running) {
      if (!options.silentValidation) {
        toast('请选择项目目录并输入消息。')
      }
      return
    }

    const requestId = `${client}-${Date.now()}`
    const requestProjectPath = targetProjectPath
    const requestProjectKey = normalizeProjectKey(requestProjectPath)
    const currentSessionKey = activeSessionId || `draft-${client}-${Date.now()}`
    const promptBody = buildCliExtensionAugmentedPrompt(
      `${cleanedPrompt}${buildCliAttachmentReferenceText(targetAttachments)}`,
      selectedExtensions
    )
    const promptWithAttachments = buildCliExecutionPrompt(
      promptBody
    )
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: cleanedPrompt,
      createdAt: Date.now(),
      attachments: toMessageAttachments(targetAttachments),
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
      [currentSessionKey]: CLI_PENDING_MESSAGE_LABEL,
    }))
    setPrompt('')
    setSelectedExtensions([])
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
  }, [
    activeSessionId,
    attachments,
    clearAttachments,
    client,
    compatibleCliModels,
    preferredCliModel,
    projectPath,
    reasoningEffort,
    refreshCliState,
    resizePrompt,
    running,
    selectedModel,
    selectedExtensions,
    toast,
    fullAccess,
    hydrateCliSession,
  ])

  async function handleRun() {
    await submitCliPrompt(prompt)
  }

  useEffect(() => {
    if (!active || running || prompt.trim() || !status.installed || !status.hasConfig) {
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
  }, [active, client, projectPath, prompt, running, status.dataPath, status.hasConfig, status.installed, submitCliPrompt])

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

          <div className='conversation-scroll-region'>
            <div ref={threadRef} className='cli-thread'>
              {activeTimeline.length === 0 ? (
                <EmptyState
                  title={`开始 ${client === 'codex' ? 'Codex' : 'Claude'} 会话`}
                  description='选择项目后输入任务，执行日志会显示在回复上方，完成后可从最近会话再次进入。'
                  icon={Bot}
                />
              ) : activeTimeline.map((item) => {
                if (item.kind === 'log') {
                  const expanded = expandedLogGroupIds.includes(item.id)
                  return (
                    <CliLogBubble
                      key={item.id}
                      item={item}
                      expanded={expanded}
                      onToggle={() => toggleLogGroup(item.id)}
                      expandedEventIds={expandedLogEventMap[item.id] || []}
                      onToggleEvent={(eventId) => toggleLogEvent(item.id, eventId)}
                      onOpenFile={(ownerId, path) => void handlePreviewFile(ownerId, path)}
                      onCopy={() => void copyText(item.events.map((eventItem) => serializeCliLogEvent(eventItem)).join('\n\n'))}
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
                    {item.kind === 'partial' && item.content === CLI_PENDING_MESSAGE_LABEL ? (
                      <PendingMessageContent />
                    ) : (
                      <LazyMarkdownContent content={item.content} />
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
                          disabled: running || item.kind === 'partial',
                        },
                        {
                          key: 'edit',
                          label: '编辑',
                          icon: PencilLine,
                          onClick: () => loadPromptForEdit(item.content, 'attachments' in item ? item.attachments : undefined),
                        },
                      ]}
                    />
                  </div>
                )
              })}
            </div>
            <ConversationScrollDock
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
              placeholder: `输入要发给 ${client} 的消息，例如：阅读当前项目并总结关键模块。`,
              onChange: (value) => {
                setPrompt(value)
                resizePrompt()
              },
              onKeyDown: (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !running) {
                  event.preventDefault()
                  void handleRun()
                  return
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
                  openCliExtensionsMenu()
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
              overlayPanel: extensionsMenuOpen ? (
                <CliExtensionPalette
                  client={client}
                  loading={extensionsLoading}
                  filteredExtensions={filteredCliExtensions}
                  highlightedIndex={effectiveHighlightedExtensionIndex}
                  searchValue={extensionSearch}
                  onSearchChange={(value) => {
                    setExtensionSearch(value)
                    setHighlightedExtensionIndex(0)
                  }}
                  onSelect={insertCliExtension}
                  onInsert={insertCliExtension}
                  onCopyName={(item) => void copyText(item.name)}
                  onHoverIndex={setHighlightedExtensionIndex}
                  onRefresh={() => void refreshCliExtensions()}
                  searchActive={extensionSearch.trim().length > 0}
                  onKeyDown={handleCliExtensionPaletteKeyDown}
                />
              ) : null,
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
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'extensions',
                node: (
                  <div className='toolbar-picker'>
                    <button
                      className='ghost-button tiny picker-trigger icon-picker-trigger'
                      type='button'
                      aria-expanded={extensionsMenuOpen}
                      onClick={() => {
                        if (extensionsMenuOpen) {
                          closeCliExtensionsMenu(true)
                        } else {
                          openCliExtensionsMenu()
                        }
                      }}
                      title={client === 'codex' ? '技能与插件' : '命令与插件'}
                    >
                      <Blocks size={16} />
                      <strong>{client === 'codex' ? '技能/插件' : '命令/插件'}</strong>
                    </button>
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
                    <div className='history-group-head'>
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
                            displayValue={item.preview || item.title}
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
      <AttachmentPreviewModal preview={attachmentPreview} onClose={() => setAttachmentPreview(null)} />
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
  const [preset, setPreset] = useState<{ apiKey: string; model: string; baseUrl: string } | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const peerState = resolveCliSetupPeerState(client, activeDeployClient)

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
        preferredNames: ['桌面端专用 Key', `${client.toUpperCase()} 桌面安装 Key`],
      })
      await deployCli({
        client,
        apiKey: preset?.apiKey || generated.key,
        baseUrl: preset?.baseUrl || (client === 'codex' ? DEFAULT_CODEX_BASE_URL : DEFAULT_CLAUDE_BASE_URL),
        model: preset?.model || (client === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL),
      })
      toast(`${client} 安装任务已开始。`)
    } catch (error) {
      setDeploying(false)
      setActiveDeployClient((current) => (current === client ? null : current))
      toast(error instanceof Error ? error.message : '安装初始化失败')
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

      {!peerState.isPeerDeploying && (
        <div className='timeline-list deploy-timeline-list' ref={timelineRef}>
          {deployLog.length === 0 ? (
          <EmptyState title='部署进度会显示在这里' description='包含检测、安装、配置、测试四段结果。' />
        ) : (
          deployLog.map((item, index) => (
            <div key={`${item.jobId}-${item.step}-${index}`} className={`timeline-row ${item.status}`}>
              <div className='timeline-dot' />
              <div className='timeline-content'>
                <strong>{item.message}</strong>
                <span>{formatDateTime(item.createdAt)}</span>
                {item.command ? <pre className='timeline-code'>{item.command}</pre> : null}
                {item.detail ? <pre className='timeline-detail'>{maskSecretText(item.detail)}</pre> : null}
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
        <div className={mode === 'draw' ? 'workspace-shell active' : 'workspace-shell'}>
          <DrawWorkspace toast={toast} />
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readJsonStorage<ThemeMode>('oneapi-desktop-theme-mode', 'light')
  )
  const [auroraOpacity] = useState<number>(() => {
    const value = readJsonStorage<number>(AURORA_OPACITY_STORAGE_KEY, DEFAULT_AURORA_OPACITY)
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : DEFAULT_AURORA_OPACITY))
  })
  const [platformLabel, setPlatformLabel] = useState('Windows')
  const [productName, setProductName] = useState('OneAPI Desktop')
  const [iconPath, setIconPath] = useState('')
  const [serverBaseUrl, setServerBaseUrl] = useState('')
  const [serverBaseUrlDraft, setServerBaseUrlDraft] = useState('')
  const [serverBaseUrlDialogOpen, setServerBaseUrlDialogOpen] = useState(false)
  const [rightCtrlHeld, setRightCtrlHeld] = useState(false)
  const [, setSidebarSecretClicks] = useState(0)
  const { message, setMessage } = useToastState()
  const [cliStatus, setCliStatus] = useState<{ codex: CliStatus; claude: CliStatus } | null>(null)
  const enabledAssistantModes = useMemo(() => {
    const next: AssistantMode[] = ['chat', 'draw']
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
      setUser(persistedUser)
    }

    getDesktopBridge()
      .getAppMeta()
      .then((meta) => {
        setPlatformLabel(meta.platform === 'darwin' ? 'macOS' : 'Windows')
        setProductName(meta.productName)
        setIconPath(meta.iconPath)
        setServerBaseUrl(meta.serverBaseUrl)
        setServerBaseUrlDraft(meta.serverBaseUrl)
      })
      .catch(() => undefined)

    window.setTimeout(() => {
      getDesktopBridge()
        .getCliStatus()
        .then((status) => {
          setCliStatus(status)
        })
        .catch(() => undefined)
    }, 0)

    if (!persistedUser?.id) {
      clearStoredDesktopUserId()
      setUser(null)
      setBootstrapping(false)
      return
    }

    setBootstrapping(false)
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
  }, [setBootstrapping, setUser])

  useEffect(() => {
    if (sideTab !== 'assistants') {
      void setDesktopWindowTitle('')
    }
  }, [sideTab])

  useEffect(() => {
    function handleAuthExpired(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      clearStoredDesktopUserId()
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
    writeJsonStorage('oneapi-desktop-theme-mode', themeMode)
    void getDesktopBridge().setThemeMode(themeMode).catch(() => undefined)
  }, [themeMode])

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

  async function handleSaveServerBaseUrl() {
    try {
      const result = await window.desktopBridge?.setServerBaseUrl(serverBaseUrlDraft.trim())
      const nextBaseUrl = result?.serverBaseUrl || serverBaseUrlDraft.trim()
      setServerBaseUrl(nextBaseUrl)
      setServerBaseUrlDraft(nextBaseUrl)
      setServerBaseUrlDialogOpen(false)
      setSidebarSecretClicks(0)
      clearStoredDesktopUserId()
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
      <DesktopWindowFrame iconPath={iconPath} productName={productName}>
        <div className='boot-screen'>
          <LoaderCircle className='spin' size={22} />
          <span>正在初始化桌面工作台...</span>
        </div>
      </DesktopWindowFrame>
    )
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
                  <div className='sidebar-user-row' onClick={handleSidebarSecretClick}>
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
            <div className='workspace-host workspace-content-layer'>
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
              <MeWorkspace
                user={auth.user}
                toast={setMessage}
                themeMode={themeMode}
                onToggleTheme={() => setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'))}
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
    </>
  )
}
