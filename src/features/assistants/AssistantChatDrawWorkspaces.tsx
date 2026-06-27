import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Bot, Copy, Crop, Download, Eye, EyeOff, LoaderCircle, MessageSquareText, PencilLine, Pin, Plus, RotateCcw, Send, Shuffle, SlidersHorizontal, Sparkles, Square, Star, Trash2, X } from 'lucide-react'
import { createAssistant, loadAssistants, saveActiveAssistantId, saveAssistants } from '../../domains/assistants'
import { createImageStylePreset, loadImageStylePresets, saveImageStylePresets } from '../../domains/image-style-presets'
import { copyImageToClipboard, getUserGroups, saveImageToDisk, sendDirectImageGeneration, sendImageEdit, stopChatCompletion } from '../../domains/chat'
import { sendAiChatCompletion, sendAiImageEdit, sendAiImageGeneration, streamAiChatCompletion } from '../../domains/aichat-provider'
import { getLocalMobileBridgeDevice, syncMobileDesktopAssistantsSnapshot } from '../../domains/mobile-bridge'
import { filterAssistantModels, filterModelsByVendor, prioritizeFavoriteModels, resolveCompatibleModel, type ModelVendorFilter } from '../../lib/assistant-workspace'
import { loadOneApiModelsForActiveKey, resolveOneApiRequestGroupForActiveKey, type ActiveDesktopApiKeySummary } from '../desktop-api-key-models'
import { decorateAssistants } from '../../lib/assistants'
import { resolveVisibleDrawMessageContent } from '../../lib/draw-message'
import { buildImageStyleAugmentedPrompt, decorateImageStylePresets, type ImageStylePreset } from '../../lib/image-style-presets'
import { groupDrawSessionsByAssistant } from '../../lib/draw-history'
import { resolveImageGenerationResult, resolveImageResponseErrorMessage } from '../../lib/image-generation'
import { buildPendingDrawRetryRequest, type PendingDrawRetryRequest } from '../../lib/draw-request'
import { isRecoverableNetworkError } from '../../lib/network-retry'
import { buildImageEditRequest } from '../../process/image-editing/build-edit-request'
import { mapImageEditError } from '../../process/image-editing/map-edit-error'
import { useAutoFollowScroll } from '../../hooks/use-auto-follow-scroll'
import { useAutosizeTextarea } from '../../hooks/use-autosize-textarea'
import { buildChatAttachmentContent, buildPersistedChatRequestContent, fileToBase64, resolveChatMessageRequestContent, toMessageAttachments, useComposerAttachments } from '../../hooks/use-composer-attachments'
import { useDebouncedJsonStorage } from '../../hooks/use-debounced-json-storage'
import { buildChatSessionExportMarkdown, buildDrawSessionExportMarkdown, buildSessionExportFileName } from '../../lib/session-history'
import { readJsonStorage, writeJsonStorage } from '../../lib/storage'
import { listCustomAiChatProviderModels, type AiChatProviderState } from '../../lib/aichat-provider'
import { applyAssistantSelectionToEmptyChatSession, resolveChatSessionAssistant, shouldCreateAssistantSwitchChatSession } from '../../lib/chat-session'
import { deriveDesktopChatDisplayState } from '../../lib/chat-reasoning'
import { clipText, formatDateTime } from '../../lib/format'
import { formatUserFacingMessage } from '../../lib/user-facing-message'
import { exportTextFile, onTranslateSelectionRequested, openAssistantHistoryFolder, syncAssistantHistory } from '../../domains/cli'
import { fetchApiKeySecret } from '../../domains/keys'
import type { AssistantRecord, ChatMessage, ChatModelOption, ImageGenerationResponse } from '../../shared/contracts'
import type { DesktopAttachmentSaveRequest, DesktopAttachmentSaveResult } from '../../shared/desktop'
import {
  AttachmentPreviewModal,
  BubbleMeta,
  CHAT_ACTIVE_SESSION_STORAGE_KEY,
  CHAT_CONTEXT_WINDOW_OPTIONS,
  CHAT_CONTEXT_WINDOW_STORAGE_KEY,
  CHAT_PENDING_MESSAGE_LABEL,
  CHAT_REASONING_OPTIONS,
  CHAT_REASONING_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  ConversationFindBar,
  ConversationScrollDock,
  DRAW_ACTIVE_SESSION_STORAGE_KEY,
  DRAW_PENDING_IMAGE_URL,
  DRAW_PENDING_MESSAGE_LABEL,
  DRAW_QUALITY_OPTIONS,
  DRAW_SESSIONS_STORAGE_KEY,
  DRAW_SIZE_OPTIONS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_DRAW_MODEL,
  EmptyState,
  GlassPickerMenu,
  ImageStylePresetPalette,
  LazyMarkdownContent,
  MessageAttachmentGallery,
  MODEL_VENDOR_FILTER_OPTIONS,
  PendingImageContent,
  ReasoningMessageContent,
  SessionContextMenu,
  SessionTitleEditor,
  TranslationResultModal,
  createDefaultChatSession,
  createDefaultDrawSession,
  createPickerMenuWidthStyle,
  extractDataUrlBase64,
  focusTextareaToEnd,
  formatUsageSummary,
  getCurrentTimestamp,
  hasKnownImageModelForProvider,
  isAbortError,
  isAssistantHistoryTriggerTarget,
  isImageGenerationModel,
  loadFavoriteModels,
  loadStoredChatSessions,
  loadStoredDrawSessions,
  openDesktopFolder,
  orderGroupedEntries,
  renderComposer,
  resolveChatModelForAttachments,
  resolveChatRetryFallbackText,
  resolveExistingAssistantId,
  resolvePendingReasoningState,
  resolvePreferredModel,
  shouldAttachPromptCacheKey,
  showAttachmentContextMenu,
  storeFavoriteModels,
  translateSelectedText,
  useAppPerformanceMode,
  useAttachmentPreview,
  useComposerPromptHistory,
  withFavoriteFlag,
  type ChatBubbleMessage,
  type ChatContextWindow,
  type ChatSessionRecord,
  type DrawSessionRecord,
  type AttachmentPreviewState,
  type PendingDrawRetryState,
  type SessionContextMenuState,
  type SessionRenameDraft,
} from './AssistantWorkspaceSupport'

type HistoryVisibilityTab = 'visible' | 'hidden'

const ASSISTANT_FAVORITES_STORAGE_KEY = 'oneapi-desktop-chat-assistant-favorites'
const IMAGE_STYLE_FAVORITES_STORAGE_KEY = 'oneapi-desktop-image-style-favorites'
const CHAT_PROMPT_HISTORY_STORAGE_KEY = 'oneapi-desktop-chat-prompt-history'
const DRAW_PROMPT_HISTORY_STORAGE_KEY = 'oneapi-desktop-draw-prompt-history'

function getDesktopBridge() {
  if (!window.desktopBridge) {
    throw new Error('桌面桥接未初始化')
  }
  return window.desktopBridge
}

function saveDesktopAttachment(input: DesktopAttachmentSaveRequest): Promise<DesktopAttachmentSaveResult> {
  return getDesktopBridge().saveAttachment(input)
}

function loadInitialAssistantsState() {
  const assistants = decorateAssistants(loadAssistants(), [], '')
  return {
    assistants,
    activeAssistantId: resolveExistingAssistantId(
      assistants,
      readJsonStorage<string>('oneapi-desktop-active-assistant-id', '')
    ),
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

export function AssistantsChatWorkspace(props: {
  toast: (message: string) => void
  active: boolean
  providerState: AiChatProviderState
  activeApiKey: ActiveDesktopApiKeySummary
}) {
  const { toast, active, providerState, activeApiKey } = props
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
  } = useComposerAttachments(toast, saveDesktopAttachment)
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

  const resolvedActiveSessionId =
    activeSessionId && chatSessions.some((item) => item.id === activeSessionId)
      ? activeSessionId
      : chatSessions[0]?.id || ''
  const activeSession = useMemo(
    () => chatSessions.find((item) => item.id === resolvedActiveSessionId) ?? null,
    [chatSessions, resolvedActiveSessionId]
  )
  const activeAssistant = useMemo(
    () => resolveChatSessionAssistant(assistants, activeSession, activeAssistantId),
    [activeAssistantId, activeSession, assistants]
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

  const messages = activeSession?.messages || []
  const customProviderModels = useMemo<ChatModelOption[]>(
    () => listCustomAiChatProviderModels(providerState),
    [providerState]
  )
  const availableChatModels = providerState.mode === 'custom' ? customProviderModels : models
  const compatibleChatModels = useMemo(
    () => prioritizeFavoriteModels(filterAssistantModels('chat', withFavoriteFlag(availableChatModels, favoriteModels))),
    [availableChatModels, favoriteModels]
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
  const oneApiRequestGroup = useMemo(
    () => resolveOneApiRequestGroupForActiveKey(activeApiKey, selectedGroup),
    [activeApiKey?.group, selectedGroup]
  )

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
        { min: 320, max: 420, padding: 96, itemCount: chatModeModels.length, rowHeight: 42, maxListHeight: 260 }
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
        selectedModel || resolvePreferredModel(availableChatModels, providerState.defaultModel || DEFAULT_CHAT_MODEL, activeAssistant?.model),
        selectedGroup
      ),
    ]
  }, [activeAssistant?.model, activeAssistantId, assistants, availableChatModels, providerState.defaultModel, selectedGroup, selectedModel])

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
      const resolvedModel =
        selectedModel || resolvePreferredModel(availableChatModels, providerState.defaultModel || DEFAULT_CHAT_MODEL, activeAssistant?.model)
      if (!resolvedModel) {
        throw new Error('当前没有可用于翻译的模型。')
      }

      const response = await sendAiChatCompletion(providerState, {
        model: resolvedModel,
        group: providerState.mode === 'oneapi' ? oneApiRequestGroup || undefined : undefined,
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
  }, [activeAssistant, availableChatModels, oneApiRequestGroup, providerState, selectedModel, toast])

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
        if (providerState.mode === 'custom') {
          const customModels = listCustomAiChatProviderModels(providerState)
          if (disposed) {
            return
          }
          setModels(customModels)
          setSelectedModel((current) => current || customModels[0]?.value || '')
          setSelectedGroup('')
          setChatSessions((current) => {
            if (current.length > 0) {
              return current
            }
            return [
              createDefaultChatSession(
                activeAssistant?.id || initialAssistantsState.assistants[0]?.id || '',
                customModels[0]?.value || providerState.defaultModel || DEFAULT_CHAT_MODEL,
                ''
              ),
            ]
          })
          return
        }

        if (providerState.mode !== 'oneapi') {
          if (!disposed) {
            setModels([])
            setSelectedGroup('')
            setChatSessions((current) => current.length > 0
              ? current
              : [
                  createDefaultChatSession(
                    activeAssistant?.id || initialAssistantsState.assistants[0]?.id || '',
                    '',
                    ''
                  ),
                ])
          }
          return
        }

        const [nextModels, nextGroups] = await Promise.all([
          loadOneApiModelsForActiveKey(activeApiKey),
          getUserGroups(),
        ])

        if (disposed) {
          return
        }

        setModels(nextModels)
        setSelectedModel((current) =>
          resolveCompatibleModel('chat', nextModels, current, resolvePreferredModel(nextModels, DEFAULT_CHAT_MODEL, activeAssistant?.model))
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
          setModels([])
          setSelectedModel('')
          toast(error instanceof Error ? error.message : '加载聊天配置失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [
    activeAssistant?.id,
    activeAssistant?.model,
    activeApiKey?.group,
    activeApiKey?.id,
    activeApiKey?.model_limits,
    activeApiKey?.model_limits_enabled,
    initialAssistantsState.assistants,
    providerState.defaultModel,
    providerState.mode,
    providerState.models,
    toast,
  ])

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
      : {
          ...createAssistant({
            name: normalizedName,
            description: normalizedDescription,
            prompt: normalizedPrompt,
            model: selectedModel || resolvePreferredModel(models, DEFAULT_CHAT_MODEL),
            temperature: 0.7,
          }),
          favorite: false,
        }

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

    if (providerState.mode === 'unavailable') {
      toast(providerState.reason || '请先登录 OneAPI 或配置自定义 API 通道。')
      return
    }

    const preferredModel =
      selectedModel || resolvePreferredModel(availableChatModels, providerState.defaultModel || DEFAULT_CHAT_MODEL, activeAssistant?.model)
    const resolvedModel = resolveChatModelForAttachments(selectedModel, preferredModel, chatModeModels, attachments)
    if (!resolvedModel) {
      toast('当前没有可用模型。')
      return
    }
    const requestGroup = providerState.mode === 'oneapi' ? oneApiRequestGroup : selectedGroup
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
      group: requestGroup,
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
        group: requestGroup,
        updatedAt: Date.now(),
        messages: session.messages.map((item) =>
          item.id === pendingAssistantId
            ? {
                ...item,
                content: hasVisibleContent ? visibleContent : '',
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
        const response = await sendAiImageGeneration(
          providerState,
          {
            model: resolvedModel,
            group: providerState.mode === 'oneapi' ? requestGroup || undefined : undefined,
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
          group: requestGroup,
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
          group: providerState.mode === 'oneapi' ? requestGroup || undefined : undefined,
          promptCacheKey: providerState.mode === 'oneapi' && shouldAttachPromptCacheKey(resolvedModel) && !requestHasAttachments
            ? resolvedActiveSessionId
            : undefined,
          temperature: activeAssistant?.temperature ?? 0.7,
          reasoningEffort: providerState.mode === 'oneapi' ? reasoningEffort : undefined,
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

        await streamAiChatCompletion(
          providerState,
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
            const retryResponse = await sendAiChatCompletion(providerState, chatRequestPayload, { requestId: `${requestId}-fallback` })
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
          group: requestGroup,
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
                      ? null
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

export function DrawWorkspace(props: {
  toast: (message: string) => void
  active: boolean
  providerState: AiChatProviderState
  activeApiKey: ActiveDesktopApiKeySummary
}) {
  const { toast, active, providerState, activeApiKey } = props
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
  const oneApiRequestGroup = useMemo(
    () => resolveOneApiRequestGroupForActiveKey(activeApiKey, selectedGroup),
    [activeApiKey?.group, selectedGroup]
  )
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
  const [oneApiDrawModels, setOneApiDrawModels] = useState<ChatModelOption[]>([])
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
  const effectiveDrawModel = DEFAULT_DRAW_MODEL
  const hasAvailableDrawModel =
    providerState.mode === 'oneapi'
      ? oneApiDrawModels.some((item) => item.value.trim().toLowerCase() === DEFAULT_DRAW_MODEL)
      : hasKnownImageModelForProvider(providerState)
  const drawModelButtonLabel =
    providerState.mode === 'unavailable' || !hasAvailableDrawModel
      ? '渠道无效'
      : effectiveDrawModel
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

  useEffect(() => {
    let disposed = false
    void (async () => {
      if (providerState.mode !== 'oneapi') {
        setOneApiDrawModels([])
        return
      }
      try {
        const nextModels = await loadOneApiModelsForActiveKey(activeApiKey)
        if (!disposed) {
          setOneApiDrawModels(nextModels)
        }
      } catch {
        if (!disposed) {
          setOneApiDrawModels([])
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
    providerState.mode,
  ])

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
        group: oneApiRequestGroup || undefined,
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
  }, [oneApiRequestGroup, toast])

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
      let activeApiKeySecret = ''
      if (providerState.mode === 'oneapi') {
        if (!activeApiKey?.id) {
          throw new Error('请先在已有 Key 中启用一个 Key。')
        }
        activeApiKeySecret = await fetchApiKeySecret(activeApiKey.id)
      } else if (providerState.mode !== 'custom') {
        throw new Error(providerState.reason || '请先登录 OneAPI 或配置自定义 API 通道。')
      }
      if (providerState.mode === 'custom' && (!providerState.apiKey.trim() || !providerState.baseUrl.trim())) {
        throw new Error('请先在 AIChat 服务通道中配置 Base URL 和 API Key。')
      }

      try {
        const editRequest = buildImageEditRequest({
          apiKey: activeApiKeySecret,
          model: request.model,
          fallbackModel: DEFAULT_DRAW_MODEL,
          prompt: request.prompt,
          imageName: request.imageName,
          mimeType: request.mimeType,
          dataBase64: request.dataBase64,
          size: request.size,
          quality: request.quality,
        })
        return providerState.mode === 'custom'
          ? await sendAiImageEdit(providerState, editRequest)
          : await sendImageEdit(editRequest)
      } catch (error) {
        throw new Error(mapImageEditError(error), { cause: error })
      }
    }

    if (providerState.mode === 'custom') {
      return sendAiImageGeneration(providerState, {
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        response_format: request.response_format,
      })
    }

    if (providerState.mode !== 'oneapi') {
      throw new Error(providerState.reason || '请先登录 OneAPI 或配置自定义 API 通道。')
    }
    if (!activeApiKey?.id) {
      throw new Error('请先在已有 Key 中启用一个 Key。')
    }
    const activeApiKeySecret = await fetchApiKeySecret(activeApiKey.id)

    return sendDirectImageGeneration({
      apiKey: activeApiKeySecret,
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
    const displayPrompt = draft.trim() || selectedImageStylePreset?.title || selectedImageStylePreset?.prompt.trim() || ''
    if (!hasAvailableDrawModel) {
      toast(providerState.mode === 'custom'
        ? '当前自定义通道没有检测到 Image 生图模型，请在默认模型中填写可用的图片模型。'
        : '当前启用 Key 没有可用的 Image 生图模型，请切换 Key 或修复服务器图片渠道。')
      return
    }

    const nextPrompt = buildImageStyleAugmentedPrompt(draft, selectedImageStylePreset || { prompt: '' })
    const userMessage: ChatBubbleMessage = {
      id: `draw-user-${now}`,
      role: 'user',
      content: displayPrompt,
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
      modelLabel: effectiveDrawModel,
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
        model: effectiveDrawModel,
        prompt: nextPrompt,
        group: oneApiRequestGroup || '',
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
            model: effectiveDrawModel,
            prompt: nextPrompt,
            group: oneApiRequestGroup || '',
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
        modelLabel: effectiveDrawModel,
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
                    <button
                      className={`ghost-button tiny picker-trigger icon-picker-trigger ${providerState.mode === 'unavailable' ? 'invalid-channel' : ''}`}
                      type='button'
                      title={providerState.mode === 'unavailable' ? providerState.reason || '渠道无效' : '当前模型'}
                    >
                      <Sparkles size={16} />
                      <strong>{drawModelButtonLabel}</strong>
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
            className='image-preview-modal image-only'
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
                <button className='ghost-button icon-only tiny image-preview-icon-button' type='button' onClick={() => {
                  setPreviewImage(null)
                  toast('图片预览已关闭。')
                }} title='关闭' aria-label='关闭'>
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
