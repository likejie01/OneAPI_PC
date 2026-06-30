import { createContext, forwardRef, lazy, memo, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type * as React from 'react'
import type { CSSProperties, ChangeEvent, ClipboardEvent, Dispatch, DragEvent, HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode, SetStateAction } from 'react'
import { Bot, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, CircleHelp, Copy, Download, FileText, Languages, LoaderCircle, MessageSquareText, PencilLine, Plus, RotateCcw, Search, Star, Trash2, X } from 'lucide-react'
import dayjs from 'dayjs'
import { copyImageToClipboard, getUserModels, saveImageToDisk, sendChatCompletion } from '../../domains/chat'
import { readDesktopFilePreview } from '../../domains/cli'
import { applyConversationSearchHighlights, clearConversationSearchHighlights } from '../../lib/conversation-search'
import { shouldDismissContextMenu } from '../../lib/context-menu'
import { filterAssistantModels, isImageGenerationModel as isImageGenerationModelOption, resolveCliLogGroupStatus, type CliTimelineEntry, type ModelVendorFilter } from '../../lib/assistant-workspace'
import { buildCliExtensionDisplayName, canUseCliExtension, collectCliToolNames, translateCliExtensionDescription, type CliExtensionViewItem, type CliMessageOverlay } from '../../lib/cli-extensions'
import { type CliBuiltinCommand } from '../../lib/cli-commands'
import { type ImageStylePreset } from '../../lib/image-style-presets'
import {
  buildCliFileChangePreview,
  formatCliLogRunTitle,
  formatCliLogStatusSummary,
  formatCliNarrativeTitle,
  formatCliProcessHeadline,
  formatCliToolDisplayName,
  shouldRenderCliLogCommandBlock,
  shouldRenderCliLogEventRow,
  shouldRenderCliLogOutputEntry,
} from '../../lib/cli-log-rendering'
import { deriveDesktopChatDisplayState, normalizeStoredDesktopChatMessage } from '../../lib/chat-reasoning'
import { compactAssistantSessionsForStorage } from '../../lib/chat-session'
import { normalizeCliProjectKey } from '../../lib/cli-project-state'
import { clipText, formatDateTime } from '../../lib/format'
import { createPromptHistoryState, commitPromptHistoryEntry, navigatePromptHistory, setPromptHistoryEditingState } from '../../lib/prompt-history'
import { readJsonStorage, writeJsonStorage } from '../../lib/storage'
import { AUTO_TEXTAREA_MIN_ROWS, syncTextareaHeight } from '../../hooks/use-autosize-textarea'
import { isEmbeddedPreviewableFile, isImagePreviewableFile, isInlinePreviewableFile, isMarkdownPreviewableFile, toRenderableFileUrl, type ComposerAttachment } from '../../hooks/use-composer-attachments'
import { type PendingDrawRetryRequest } from '../../lib/draw-request'
import { type AiChatProviderState } from '../../lib/aichat-provider'
import type { AssistantRecord, ChatMessage, ChatModelOption } from '../../shared/contracts'
import type { CliClient, CliExtensionEntry, CliFileChange, CliInteractionAction, CliInteractionPrompt, CliLogKind, CliSessionMessage, CliStatus } from '../../shared/desktop'

const MarkdownMessageContentLazy = lazy(async () => {
  const module = await import('../../components/MarkdownMessageContent')
  return { default: module.MarkdownMessageContent }
})

export type AppPerformanceMode = 'performance' | 'efficiency'
export const AppPerformanceModeContext = createContext<AppPerformanceMode>('performance')

export function useAppPerformanceMode() {
  return useContext(AppPerformanceModeContext)
}

export async function openDesktopTarget(targetPath: string) {
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

export async function openDesktopFile(targetPath: string) {
  const normalized = targetPath.trim()
  if (!normalized) {
    return
  }
  await window.desktopBridge?.openFile(normalized)
}

export async function openDesktopFolder(targetPath: string, treatAsFile = false) {
  const normalized = targetPath.trim()
  if (!normalized) {
    return
  }

  const resolvedPath = treatAsFile
    ? normalized.replace(/[/\\][^/\\]+$/, '') || normalized
    : normalized

  await window.desktopBridge?.openPath(resolvedPath)
}

export type ChatBubbleMessage = ChatMessage & {
  modelLabel?: string
}

export type CliMessage = CliSessionMessage
export type CliPaletteTab = 'command' | 'skill' | 'plugin'

export type CliLogEntry = {
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

export type CliExtensionPreferenceBucket = {
  favoriteIds: string[]
  notes: Record<string, string>
  autoInvokeEnabled: boolean
}

export type CliExtensionPreferenceStore = Record<string, CliExtensionPreferenceBucket>
export type CliExtensionTranslationCache = Record<string, string>

export type CliMessageOverlayStore = Record<string, CliMessageOverlay[]>

export function hashStorageText(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

export function resolveCliExtensionTranslationCacheKey(client: CliClient, item: CliExtensionViewItem, description: string) {
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

export type ComposerActionItem = {
  key: string
  node: ReactNode
}

export type ComposerFileAsset = {
  id: string
  name: string
  filePath: string
  previewUrl?: string
  kind: 'image' | 'file'
  onPreview?: () => void
  onRemove?: () => void
}

export type ComposerTokenItem = {
  id: string
  label: string
  kindLabel: string
  onEdit?: () => void
  onRemove?: () => void
}

export function renderComposer(props: {
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

export function useComposerPromptHistory(storageKey: string) {
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

export function focusTextareaToEnd(textarea: HTMLTextAreaElement | null, value: string) {
  if (!textarea) {
    return
  }

  textarea.focus()
  textarea.setSelectionRange(value.length, value.length)
}

export function findClosestConversationBubble(
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

export function scrollBubbleIntoView(
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

export const CONVERSATION_SCROLL_DOCK_VIEWPORT_INSET = 8
export const CONVERSATION_SCROLL_DOCK_VERTICAL_INSET = 72
export const CONVERSATION_SCROLL_DOCK_UPDATE_THROTTLE_MS = 140

export function ConversationScrollDock(props: {
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

export type ChatSessionRecord = {
  id: string
  title: string
  assistantId: string
  model: string
  group: string
  updatedAt: number
  messages: ChatBubbleMessage[]
}

export type DrawSessionRecord = {
  id: string
  title: string
  updatedAt: number
  messages: ChatBubbleMessage[]
}

export type PendingDrawRetryState = {
  sessionId: string
  request: PendingDrawRetryRequest
}

export const REASONING_OPTIONS = [
  { label: '关闭', value: 'off' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '极高', value: 'xhigh' },
] as const

export const CLI_REASONING_OPTIONS = REASONING_OPTIONS
export const CHAT_REASONING_OPTIONS = REASONING_OPTIONS
export const CLAUDE_REASONING_OPTIONS = REASONING_OPTIONS

export const DEFAULT_CHAT_MODEL = 'mimo-v2.5-pro'
export const DEFAULT_DRAW_MODEL = 'gpt-image-2'
export const DEFAULT_CODEX_MODEL = 'gpt-5.4'
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'
export const DEFAULT_SERVER_BASE_URL = 'https://ai.oneapi.center'
export const DEFAULT_CODEX_BASE_URL = 'https://ai.oneapi.center/v1'
export const DEFAULT_CLAUDE_BASE_URL = 'https://ai.oneapi.center'
export const CHAT_SESSIONS_STORAGE_KEY = 'oneapi-desktop-chat-sessions'
export const CHAT_ACTIVE_SESSION_STORAGE_KEY = 'oneapi-desktop-chat-active-session'
export const CHAT_REASONING_STORAGE_KEY = 'oneapi-desktop-chat-reasoning'
export const CHAT_CONTEXT_WINDOW_STORAGE_KEY = 'oneapi-desktop-chat-context-window'
export const DRAW_SESSIONS_STORAGE_KEY = 'oneapi-desktop-draw-sessions'
export const DRAW_ACTIVE_SESSION_STORAGE_KEY = 'oneapi-desktop-draw-active-session'
export const CHAT_PENDING_MESSAGE_LABEL = 'Thinking...'
export const CLI_PENDING_MESSAGE_LABEL = 'Coding...'
export const DRAW_PENDING_MESSAGE_LABEL = 'Drawing...'
export const DRAW_PENDING_IMAGE_URL = '__oneapi_draw_pending__'
export function hasKnownImageModelForProvider(providerState: AiChatProviderState) {
  if (providerState.mode !== 'custom') {
    return true
  }
  return (
    providerState.models.length === 0 ||
    providerState.models.some((item) => item.trim().toLowerCase() === DEFAULT_DRAW_MODEL)
  )
}
export const MODEL_VENDOR_FILTER_OPTIONS: Array<{ value: ModelVendorFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xiaomimimo', label: 'XiaomiMIMO' },
]
export const CHAT_CONTEXT_WINDOW_OPTIONS = [
  { label: '10 条', value: 10 },
  { label: '20 条', value: 20 },
  { label: '30 条', value: 30 },
  { label: '全部', value: 'all' as const },
] as const
export const DRAW_SIZE_OPTIONS = [
  { label: '方图', value: '1024x1024' },
  { label: '竖图', value: '1024x1536' },
  { label: '横图', value: '1536x1024' },
] as const
export const DRAW_QUALITY_OPTIONS = [
  { label: '标准', value: 'medium' },
  { label: '高清', value: 'high' },
] as const

export type PickerMenuWidthStyle = CSSProperties & {
  '--picker-menu-width'?: string
  '--picker-menu-safe-width'?: string
  '--picker-menu-list-height'?: string
  '--picker-menu-list-max-height'?: string
}

export type GlassPickerMenuProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export const GlassPickerMenu = forwardRef<HTMLDivElement, GlassPickerMenuProps>(function GlassPickerMenu(
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

export function estimatePickerTextUnits(value: string) {
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

export function createPickerMenuWidthStyle(
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

export type ChatContextWindow = (typeof CHAT_CONTEXT_WINDOW_OPTIONS)[number]['value']

export function isImageGenerationModel(value: string) {
  return isImageGenerationModelOption(value)
}

export function shouldAttachPromptCacheKey(model: string) {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('deepseek') || normalized.startsWith('mimo')
}

export function isVisionChatModel(model: string) {
  const normalized = model.trim().toLowerCase()
  return (
    normalized.startsWith('gpt') ||
    normalized.startsWith('gemini') ||
    normalized.startsWith('claude')
  )
}

export function resolveChatModelForAttachments(
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

export function normalizeTimestampMs(value: number) {
  if (!value) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

export function getCurrentTimestamp() {
  return Date.now()
}


export type BubbleActionConfig = {
  key: string
  label: string
  icon: typeof Copy
  onClick: () => void
  disabled?: boolean
}

export type AttachmentPreviewState =
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

export function resolvePreferredModel(
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

export function extractModelRank(value: string) {
  const normalized = value.trim().toLowerCase()
  const matched = normalized.match(/(\d+(?:\.\d+)+|\d+)/g)
  if (!matched?.length) {
    return [0]
  }
  return matched.flatMap((item) => item.split('.').map((part) => Number(part || 0)))
}

export function compareModelRank(left: string, right: string) {
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

export function resolveSmartDefaultChatModel(options: ChatModelOption[]) {
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

export async function translateSelectedText(options: {
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

export function storeFavoriteModels(key: string, value: string[]) {
  writeJsonStorage(key, value)
}

export function loadFavoriteModels(key: string) {
  return readJsonStorage<string[]>(key, [])
}

export function withFavoriteFlag(models: ChatModelOption[], favorites: string[]) {
  return models.map((item) => ({
    ...item,
    favorite: favorites.includes(item.value),
  }))
}

export function isAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('请求已取消') || error.message.includes('已停止')
}

export function BubbleMeta(props: {
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

export function getStoredVerificationKey(userId: number) {
  return `oneapi-desktop-verify-${userId}`
}

export function clearVerificationValid(userId: number) {
  window.localStorage.removeItem(getStoredVerificationKey(userId))
}

export function getPendingCliVerificationKey(client: CliClient) {
  return `oneapi-desktop-${client}-pending-verify`
}

export function hasPendingCliVerification(client: CliClient) {
  return window.localStorage.getItem(getPendingCliVerificationKey(client)) === '1'
}

export function clearPendingCliVerification(client: CliClient) {
  window.localStorage.removeItem(getPendingCliVerificationKey(client))
}

export function buildEmptyCliStatus(client: CliClient): CliStatus {
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

export const CLI_STATUS_CACHE_KEY = 'oneapi-desktop-cli-status'

export function readCachedCliStatus(client: CliClient) {
  const cache = readJsonStorage<Partial<Record<CliClient, CliStatus>>>(CLI_STATUS_CACHE_KEY, {})
  return cache[client] ?? buildEmptyCliStatus(client)
}

export function writeCachedCliStatus(status: CliStatus) {
  const cache = readJsonStorage<Partial<Record<CliClient, CliStatus>>>(CLI_STATUS_CACHE_KEY, {})
  cache[status.client] = status
  writeJsonStorage(CLI_STATUS_CACHE_KEY, cache)
}

export function sameCliStatus(left: CliStatus, right: CliStatus) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function resolvePendingReasoningState(
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

export function PendingMessageContent(props: {
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

export const LazyMarkdownContent = memo(function LazyMarkdownContent(props: {
  content: string
  className?: string
  onSelectionContextMenu?: (event: MouseEvent<HTMLDivElement>, selectedText: string) => void
  onOpenLocalPath?: (targetPath: string) => void | Promise<void>
  onLocalPathContextMenu?: (event: MouseEvent<HTMLElement>, targetPath: string) => void
  localPathBase?: string
  renderMermaid?: boolean
}) {
  const {
    content,
    className,
    onOpenLocalPath = openDesktopTarget,
    onLocalPathContextMenu,
    onSelectionContextMenu,
    localPathBase,
    renderMermaid = true,
  } = props

  return (
    <Suspense fallback={<div className={className || 'markdown-body'}>{content}</div>}>
      <MarkdownMessageContentLazy
        content={content}
        onOpenLocalPath={onOpenLocalPath}
        onLocalPathContextMenu={onLocalPathContextMenu}
        onOpenExternal={(target) => window.desktopBridge?.openExternal(target)}
        onSelectionContextMenu={onSelectionContextMenu}
        localPathBase={localPathBase}
        renderMermaid={renderMermaid}
      />
    </Suspense>
  )
})

export const ReasoningMessageContent = memo(function ReasoningMessageContent(props: {
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

export function formatDownloadSize(value?: number) {
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

export function PendingImageContent(props: {
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

export type SessionContextMenuState = {
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

export type MessageAttachmentItem = {
  id: string
  name: string
  filePath: string
  kind: 'image' | 'file'
}

export function showAttachmentContextMenu(
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

export function resolveChatRetryFallbackText(hasReasoningContent: boolean) {
  return hasReasoningContent ? '模型已完成思考，但本次没有返回可显示的正文内容。' : CHAT_PENDING_MESSAGE_LABEL
}

export type SessionRenameDraft = {
  id: string
  value: string
} | null

export function SessionTitleEditor(props: {
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

export function SessionContextMenu(props: {
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

export function AttachmentPreviewModal(props: {
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
            <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={() => {
              onClose()
              toast('图片预览已关闭。')
            }} title='关闭' aria-label='关闭'>
              <X size={15} />
            </button>
          </div>
          {previewContent}
        </div>
      </div>
    </div>
  )
}

export function TranslationResultModal(props: {
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

export function getCliExtensionKindLabel(item: CliExtensionEntry) {
  if (item.kind === 'skill') {
    return '技能'
  }
  if (item.kind === 'command') {
    return '命令'
  }
  return '插件'
}

export function getCliBuiltinCommandKindLabel() {
  return '命令'
}

export function getCliPaletteTabLabel(tab: CliPaletteTab) {
  if (tab === 'command') {
    return '命令'
  }
  if (tab === 'skill') {
    return '技能'
  }
  return '插件'
}

const CLI_PALETTE_TAB_ORDER: CliPaletteTab[] = ['command', 'skill', 'plugin']

export type CliPaletteItem =
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

export function MessageCliExtensionChips(props: {
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

export function CliExtensionPalette(props: {
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
          {CLI_PALETTE_TAB_ORDER.map((tab) => {
            const disabled = !availableTabs.includes(tab)
            return (
              <button
                key={tab}
                className={`picker-filter-chip ${activeTab === tab ? 'active' : ''}`}
                type='button'
                disabled={disabled}
                onClick={() => {
                  if (!disabled) {
                    onChangeTab(tab)
                  }
                }}
              >
                <span>{getCliPaletteTabLabel(tab)}</span>
              </button>
            )
          })}
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

export function ImageStylePresetPalette(props: {
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

export function useAttachmentPreview(toast: (message: string) => void) {
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

export function MessageAttachmentGallery(props: {
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

export function MessageFileChangeLinks(props: {
  ownerId: string
  files?: CliFileChange[]
  previewFile?: {
    ownerId: string
    path: string
    name: string
    content: string
  } | null
  onOpenFile: (ownerId: string, path: string) => void
  onFileContextMenu?: (event: MouseEvent<HTMLButtonElement>, path: string) => void
}) {
  const { ownerId, files = [], previewFile, onFileContextMenu, onOpenFile } = props
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
          onContextMenu={(event) => onFileContextMenu?.(event, item.path)}
          title={item.path}
        >
          <FileText size={14} />
          <span>{item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path}</span>
        </button>
      ))}
      {previewFile && previewFile.ownerId === ownerId && (
        <InlineFileChangePreview
          file={uniqueFiles.find((item) => item.path === previewFile.path) || {
            path: previewFile.path,
            kind: 'unknown',
            content: previewFile.content,
          }}
          fallbackContent={previewFile.content}
        />
      )}
    </div>
  )
}

function InlineFileChangePreview(props: {
  file: CliFileChange
  fallbackContent?: string
}) {
  const { file, fallbackContent = '' } = props
  const preview = buildCliFileChangePreview({
    path: file.path,
    kind: file.kind,
    content: file.content || fallbackContent,
    diff: file.diff,
  })

  return (
    <div className='inline-file-preview'>
      <div className='inline-file-preview-head'>
        <code className='inline-file-preview-path' title={file.path}>{preview.fileName || file.path}</code>
        <span className='inline-file-preview-stats'>{`增 +${preview.added} · 删 -${preview.deleted}`}</span>
      </div>
      {preview.lines.length > 0 ? (
        <div className='inline-file-preview-content diff'>
          {preview.lines.map((line, index) => (
            <div key={`${index}-${line.text}`} className={`inline-file-preview-line ${line.type}`}>
              <span className='inline-file-preview-line-number'>{index + 1}</span>
              <code>{line.text || ' '}</code>
            </div>
          ))}
        </div>
      ) : (
        <pre className='inline-file-preview-content'>{fallbackContent}</pre>
      )}
    </div>
  )
}

export function CliLogBubble(props: {
  item: Extract<CliTimelineEntry, { kind: 'log' }>
  expanded: boolean
  expandedEventIds: string[]
  onToggleEvent: (eventId: string) => void
  onOpenFile: (ownerId: string, path: string) => void
  onFileContextMenu?: (event: MouseEvent<HTMLButtonElement>, path: string) => void
  onCopy: () => void
  onDelete: () => void
  onRespondInteraction: (requestId: string, interactionId: string, action: CliInteractionAction) => void
  respondingInteractionIds: string[]
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
    onFileContextMenu,
    onCopy,
    onDelete,
    onRespondInteraction,
    respondingInteractionIds,
    previewFile,
  } = props
  const uniqueFiles = Array.from(new Map(item.files.map((file) => [file.path, file])).values())
  const executedToolNames = collectCliToolNames(item.events.map((eventItem) => eventItem.sourceKind))
  const headerExtensionTags = item.selectedExtensions || []
  const logStatus = resolveCliLogGroupStatus(item.events, item.requestTerminalEvent)
  const visibleEvents = expanded ? item.events : item.events.slice(0, 1)
  const visualBlocks = buildCliVisualLogBlocks(visibleEvents)
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<string[]>([])
  const [collapsedTimeGroupIds, setCollapsedTimeGroupIds] = useState<string[]>([])
  const eventTotals = useMemo(() => summarizeCliEventTotals(item.events), [item.events])
  const logRunTitle = formatCliLogRunTitle({
    eventCount: item.events.length,
    statusTone: logStatus.tone,
    commandCount: eventTotals.commandCount,
    toolCount: eventTotals.toolCount,
    diagnosticCount: eventTotals.diagnosticCount,
    interactionCount: eventTotals.interactionCount,
  })
  const statusSummary = formatCliLogStatusSummary({
    eventCount: item.events.length,
    commandCount: eventTotals.commandCount,
    toolCount: eventTotals.toolCount,
    diagnosticCount: eventTotals.diagnosticCount,
    interactionCount: eventTotals.interactionCount,
    updatedAt: formatCliLogTime(item.createdAt),
  })
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
        const summary = row.type === 'output'
          ? resolveCliOutputGroupHeadline(row.items) || row.summary
          : formatCliProcessHeadline(row.event)
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
  const formatDetailText = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      return ''
    }
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return trimmed
    }
  }
  const resolveDetailWindowClassName = (value: string, compact = false) => {
    const trimmed = value.trim()
    const codeLike = /^[{[]/.test(trimmed) || /<\/?[a-z][\s\S]*>/i.test(trimmed) || /(?:powershell|cmd|bash|npm|node|python)\b/i.test(trimmed)
    return ['cli-log-detail-window', compact ? 'compact' : '', codeLike ? 'code-like' : '']
      .filter(Boolean)
      .join(' ')
  }

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
        {shouldRenderCliLogCommandBlock({ command, detail }) ? (
          <div className='cli-log-detail-block'>
            <span className='cli-log-detail-label'>执行命令</span>
            <pre className='cli-log-detail-window'>{command}</pre>
          </div>
        ) : null}
        {detail?.trim() ? (
          <div className='cli-log-detail-block'>
            <pre className={resolveDetailWindowClassName(detail)}>{formatDetailText(detail)}</pre>
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
                  onContextMenu={(event) => onFileContextMenu?.(event, fileItem.path)}
                  title={fileItem.path}
                >
                  <FileText size={14} />
                  <span>{fileItem.path.split(/[\\/]/).filter(Boolean).at(-1) || fileItem.path}</span>
                </button>
              ))}
            </div>
            {previewFile && previewFile.ownerId === ownerId ? (
              <InlineFileChangePreview
                file={{
                  path: previewFile.path,
                  kind: 'unknown',
                  content: previewFile.content,
                  ...uniqueEventFiles.find((item) => item.path === previewFile.path),
                }}
                fallbackContent={previewFile.content}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`cli-log-entry ${logStatus.tone === 'error' ? 'error' : ''}`}>
      <div className='cli-log-card-head'>
        <div className='cli-log-card-title'>
          <span className='message-role'>{logStatus.tone === 'error' ? '运行异常' : 'AI 执行过程'}</span>
          <div className='cli-log-title-inline-tags'>
            {headerExtensionTags.map((extension) => (
              <div key={`${extension.kind}-${extension.id}`} className='message-extension-chip subtle'>
                <span className='message-extension-kind'>{getCliExtensionKindLabel(extension)}</span>
                <strong>{buildCliExtensionDisplayName(extension.name, extension.note)}</strong>
              </div>
            ))}
            {executedToolNames.map((itemName) => (
              <div key={itemName} className='message-extension-chip subtle'>
                <span className='message-extension-kind'>工具</span>
                <strong>{formatCliToolDisplayName(itemName)}</strong>
              </div>
            ))}
          </div>
          <strong>{logRunTitle}</strong>
        </div>
      </div>
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
                                formatCliProcessHeadline(eventItem) ||
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
                                    (
                                      normalizeComparable(entry.headline) === normalizeComparable(effectiveHeadline || '') ||
                                      normalizeComparable(entry.headline) === normalizeComparable(headline)
                                    )
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
                                        {entry.detail ? (
                                          <pre className={resolveDetailWindowClassName(entry.detail, true)}>
                                            {formatDetailText(entry.detail)}
                                          </pre>
                                        ) : null}
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
                              {hasExpandableContent ? (
                                <button
                                  className='cli-log-event-dot-button'
                                  type='button'
                                  title={eventExpanded ? '收起详情' : '展开详情'}
                                  aria-label={eventExpanded ? '收起详情' : '展开详情'}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onToggleEvent(eventItem.id)
                                  }}
                                >
                                  <span className='cli-log-event-dot' />
                                </button>
                              ) : (
                                <span className='cli-log-event-dot-spacer' aria-hidden='true' />
                              )}
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
                                          <strong>{formatCliProcessHeadline(eventItem)}</strong>
                                        </button>
                                      ) : (
                                        <strong>{formatCliProcessHeadline(eventItem)}</strong>
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
      {!expanded ? <CliLogStatusFooter logStatus={logStatus} summary={statusSummary} label='Thinking' /> : null}
      {uniqueFiles.length > 0 && !expanded ? (
        <div className='cli-log-files'>
          {uniqueFiles.slice(0, 4).map((fileItem) => (
            <button
              key={fileItem.path}
              className='ghost-button tiny cli-log-file'
              type='button'
              onClick={() => onOpenFile(item.id, fileItem.path)}
              onContextMenu={(event) => onFileContextMenu?.(event, fileItem.path)}
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

export function CliLogStatusFooter(props: {
  logStatus: ReturnType<typeof resolveCliLogGroupStatus>
  summary: string
  label?: string
}) {
  const { logStatus, summary, label } = props
  return (
    <div className='cli-log-status-bar'>
      <span className={`cli-log-status-pill ${logStatus.tone}`}>
        {logStatus.tone === 'running' ? <LoaderCircle className='spin' size={13} /> : null}
        {label || logStatus.label}
      </span>
      <small>{summary}</small>
    </div>
  )
}

export function CliLogCompletionFooter(props: {
  item: Extract<CliTimelineEntry, { kind: 'log' }>
}) {
  const { item } = props
  const logStatus = resolveCliLogGroupStatus(item.events, item.requestTerminalEvent)
  const eventTotals = summarizeCliEventTotals(item.events)
  const summary = formatCliLogStatusSummary({
    eventCount: item.events.length,
    commandCount: eventTotals.commandCount,
    toolCount: eventTotals.toolCount,
    diagnosticCount: eventTotals.diagnosticCount,
    interactionCount: eventTotals.interactionCount,
    updatedAt: formatCliLogTime(item.createdAt),
  })
  return <CliLogStatusFooter logStatus={logStatus} summary={summary} />
}

export function ConversationFindBar(props: {
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

export function normalizeProjectKey(value?: string) {
  return normalizeCliProjectKey(value)
}

export function resolveProjectNameFromPath(value?: string) {
  const normalized = (value || '').split(/[\\/]/).filter(Boolean)
  return normalized.at(-1) || ''
}

export function resolveCliExtensionPreferenceProjectKey(projectPath?: string) {
  return normalizeProjectKey(projectPath) || '__global__'
}

export function createEmptyCliExtensionPreferenceBucket(): CliExtensionPreferenceBucket {
  return {
    favoriteIds: [],
    notes: {},
    autoInvokeEnabled: true,
  }
}

export function createDefaultChatSession(
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

export function resolveExistingAssistantId(assistants: AssistantRecord[], requestedId?: string) {
  if (requestedId && assistants.some((item) => item.id === requestedId)) {
    return requestedId
  }
  return assistants[0]?.id || ''
}

export function loadStoredChatSessions() {
  const sessions = readJsonStorage<ChatSessionRecord[]>(CHAT_SESSIONS_STORAGE_KEY, [])
  return compactAssistantSessionsForStorage(sessions
    .map((session) => ({
      ...session,
      messages: (session.messages || [])
        .filter((message) => !message.pending)
        .map((message) => normalizeStoredDesktopChatMessage(message))
        .sort((left, right) => left.createdAt - right.createdAt),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt))
}

export function createDefaultDrawSession(): DrawSessionRecord {
  return {
    id: `draw-session-${Date.now()}`,
    title: '新绘图',
    updatedAt: Date.now(),
    messages: [],
  }
}

export function loadStoredDrawSessions() {
  const sessions = readJsonStorage<DrawSessionRecord[]>(DRAW_SESSIONS_STORAGE_KEY, [])
  return compactAssistantSessionsForStorage(sessions
    .map((session) => ({
      ...session,
      messages: (session.messages || [])
        .filter((message) => !message.pending)
        .sort((left, right) => left.createdAt - right.createdAt),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt))
}

export function orderGroupedEntries<T extends { updatedAt?: number }>(
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

export function extractDataUrlBase64(value: string) {
  const match = value.match(/^data:[^;]+;base64,(.+)$/)
  return match?.[1] || ''
}

export function mergeCliLogs(left: CliLogEntry[], right: CliLogEntry[]) {
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

export function formatCliLogTime(timestamp: number) {
  return dayjs(normalizeTimestampMs(timestamp)).format('HH:mm:ss')
}

export function shouldReplaceStreamingCliIntentEntry(previous: CliLogEntry | undefined, next: CliLogEntry) {
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

export function resolveCliLogKindLabel(kind?: CliLogKind) {
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

export function isCliIntentEvent(item: {
  kind?: CliLogKind
  sourceKind?: string
  interaction?: CliInteractionPrompt
  assistantChunk?: string
}) {
  const sourceKind = (item.sourceKind || '').trim().toLowerCase()
  return sourceKind.startsWith('orchestrator.intent') || sourceKind.startsWith('intent.') || item.kind === 'intent'
}

export function buildCliVisualLogBlocks<T extends {
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

export function isCliMetaIntentSourceKind(sourceKind?: string) {
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

export function resolveCliVisualBlockTitle<T extends {
  intent?: {
    assistantChunk?: string
    detail?: string
    message: string
    sourceKind?: string
  }
  label: string
}>(block: T, index: number) {
  const detail = block.intent?.detail?.trim() || ''
  const sourceKind = block.intent?.sourceKind?.trim() || ''
  const meaningfulDetail = detail && detail !== sourceKind ? detail : ''
  if (block.intent && !isCliMetaIntentSourceKind(block.intent.sourceKind)) {
    return formatCliNarrativeTitle({
      assistantChunk: block.intent.assistantChunk,
      detail: meaningfulDetail,
      message: block.intent.message,
      fallback: `${block.label} ${index + 1}`,
    })
  }
  return ''
}

export function isCliDiagnosticEvent(item: {
  kind?: CliLogKind
  sourceKind?: string
}) {
  const sourceKind = (item.sourceKind || '').trim().toLowerCase()
  return item.kind === 'stderr' || sourceKind.startsWith('stderr')
}

export function resolveCliDiagnosticDetail(item: {
  detail?: string
  command?: string
  message: string
}) {
  return item.detail?.trim() || item.command?.trim() || item.message.trim()
}

export function resolveCliOutputFamily(item: {
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

export function canGroupCliOutputEvents(
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

export function resolveCliOutputGroupTitle(items: Array<{
  kind?: CliLogKind
  sourceKind?: string
  detail?: string
}>) {
  const family = resolveCliOutputFamily(items[0] || {})
  if (family === 'stderr') {
    return items.length > 1 ? `执行诊断 ${items.length} 条` : '执行诊断'
  }
  if (family === 'stdout') {
    return items.length > 1 ? `命令输出 ${items.length} 条` : '命令输出'
  }
  return items.length > 1 ? `执行输出 ${items.length} 条` : '执行输出'
}

export function resolveCliOutputGroupSummary(items: Array<{
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

export function resolveCliDiagnosticSummary(items: Array<{
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

export function resolveCliOutputGroupHeadline(items: Array<{
  kind?: CliLogKind
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
  const processHeadline = items
    .map((item) => formatCliProcessHeadline(item))
    .find((headline) => headline && headline !== '执行进度')
  return processHeadline || resolveCliDiagnosticSummary(items)
}

export function summarizeCliBlockRows(rows: Array<
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
    stdoutGroupCount > 0 ? `输出 ${stdoutGroupCount} 组/${stdoutItemCount} 条` : '',
    stderrGroupCount > 0 ? `诊断 ${stderrGroupCount} 组/${stderrItemCount} 条` : '',
    interactionCount > 0 ? `确认 ${interactionCount}` : '',
  ].filter(Boolean).join(' · ')
}

export function summarizeCliEventTotals(events: Array<{ kind?: CliLogKind; interaction?: CliInteractionPrompt }>) {
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

export function serializeCliLogEvent(item: {
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

export function buildCliLogFilesSignature(files?: CliFileChange[]) {
  if (!files?.length) {
    return ''
  }
  return files.map((item) => `${item.kind}:${item.path}:${item.diff || item.content || ''}`).join('|')
}

export function buildCliInteractionSignature(interaction?: CliInteractionPrompt) {
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

export function isSameCliLogEntry(left?: CliLogEntry, right?: CliLogEntry) {
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

export function isAssistantHistoryTriggerTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('.assistant-history-button')
}

export function percentageOf(value: number, total: number) {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, (value / total) * 100))
}

export function formatUsageSummary(usage?: ChatMessage['usage']) {
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
      ? `缓存 ${cacheHitRatio.toFixed(cacheHitRatio >= 10 ? 0 : 1)}%`
      : ''

  if (total > 0) {
    return [
      `总计 ${total}`,
      prompt || completion ? `输入 ${prompt}` : '',
      prompt || completion ? `输出 ${completion}` : '',
      cacheHitSummary,
    ].filter(Boolean).join(' · ')
  }

  if (prompt > 0 || completion > 0 || cacheHitTokens > 0) {
    return [
      `输入 ${prompt}`,
      `输出 ${completion}`,
      cacheHitSummary,
    ].filter(Boolean).join(' · ')
  }

  return ''
}

export function EmptyState(props: { title: string; description: string; icon?: typeof Bot }) {
  const { title, description, icon: Icon = MessageSquareText } = props
  return (
    <div className='empty-card'>
      <Icon size={20} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}
