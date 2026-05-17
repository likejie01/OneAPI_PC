import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChartColumn,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCcw,
  Send,
  Settings2,
  Sparkles,
  Wallet,
  Wrench,
} from 'lucide-react'
import {
  createAssistant,
  loadActiveAssistantId,
  loadAssistants,
  saveActiveAssistantId,
  saveAssistants,
} from './domains/assistants'
import { login, login2fa, logout, unwrapEnvelope } from './domains/auth'
import { getUserGroups, getUserModels, sendChatCompletion } from './domains/chat'
import {
  deployCli,
  getCliSession,
  getCliStatus,
  listCliHistory,
  onDeployProgress,
  pickProjectDirectory,
  runCliPrompt,
  setDesktopWindowTitle,
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
  getTopupInfo,
  redeemTopupCode,
  requestWalletPayment,
} from './domains/wallet'
import { clearStoredDesktopUserId, saveStoredDesktopUserId } from './lib/desktop-client'
import { clipText, formatDateTime, formatPrice, formatQuota } from './lib/format'
import { readJsonStorage, writeJsonStorage } from './lib/storage'
import type {
  AssistantRecord,
  BillingHistoryData,
  ChatMessage,
  ChatModelOption,
  PlanRecord,
  SubscriptionPaymentInfo,
  SubscriptionSelfData,
  TopupInfo,
  UsageData,
  UsageStat,
  UserProfile,
} from './shared/contracts'
import type {
  CliClient,
  CliHistoryEntry,
  CliSessionDetails,
  CliSessionMessage,
  CliStatus,
  DeployProgressPayload,
} from './shared/desktop'
import { useAuthStore } from './stores/auth-store'

type AssistantMode = 'chat' | 'codex' | 'claude'
type SideTab = 'assistants' | 'subscriptions' | 'wallet' | 'usage' | 'me' | 'settings'

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

function syncTextareaHeight(node: HTMLTextAreaElement | null) {
  if (!node) {
    return
  }

  node.style.height = 'auto'
  const nextHeight = Math.min(node.scrollHeight, AUTO_TEXTAREA_MAX_HEIGHT)
  node.style.height = `${nextHeight}px`
  node.style.overflowY = node.scrollHeight > AUTO_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
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

type CliHistoryGroup = {
  projectName: string
  projectPath?: string
  items: CliHistoryEntry[]
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

function groupCliHistoryByProject(items: CliHistoryEntry[]) {
  const grouped = new Map<string, CliHistoryGroup>()

  for (const item of items) {
    const key = item.projectPath || item.projectName || '未命名项目'
    const current = grouped.get(key) ?? {
      projectName: item.projectName || '未命名项目',
      projectPath: item.projectPath,
      items: [],
    }
    current.items.push(item)
    grouped.set(key, current)
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => right.updatedAt - left.updatedAt),
    }))
    .sort((left, right) => (right.items[0]?.updatedAt || 0) - (left.items[0]?.updatedAt || 0))
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
  const [messages, setMessages] = useState<ChatBubbleMessage[]>([])
  const [draft, setDraft] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [sending, setSending] = useState(false)
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [assistantName, setAssistantName] = useState('')
  const [assistantDescription, setAssistantDescription] = useState('')
  const [assistantPrompt, setAssistantPrompt] = useState('')
  const [initialAssistantsState] = useState(loadInitialAssistantsState)
  const [assistants, setAssistants] = useState(initialAssistantsState.assistants)
  const [activeAssistantId, setActiveAssistantId] = useState(initialAssistantsState.activeAssistantId)
  const { ref: draftRef, resize: resizeDraft } = useAutosizeTextarea(draft)
  const assistantMenuRef = useRef<HTMLDivElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)

  const activeAssistant = useMemo(
    () => assistants.find((item) => item.id === activeAssistantId) ?? assistants[0] ?? null,
    [assistants, activeAssistantId]
  )

  const activeModelLabel = useMemo(
    () => models.find((item) => item.value === selectedModel)?.label || selectedModel || activeAssistant?.model || '默认模型',
    [activeAssistant?.model, models, selectedModel]
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

        setModels(nextModels)
        setSelectedModel((current) => current || activeAssistant?.model || nextModels[0]?.value || '')
        setSelectedGroup((current) => current || nextGroups[0]?.value || '')
      } catch (error) {
        if (!disposed) {
          toast(error instanceof Error ? error.message : '加载聊天配置失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [activeAssistant?.model, toast])

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
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [assistantMenuOpen, modelMenuOpen])

  function handleCreateAssistant() {
    if (!assistantName.trim() || !assistantPrompt.trim()) {
      toast('请填写助手名称和提示词。')
      return
    }

    const next = createAssistant({
      name: assistantName.trim(),
      description: assistantDescription.trim() || '自定义助手',
      prompt: assistantPrompt.trim(),
      model: selectedModel || models[0]?.value || 'gpt-4o',
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

  async function handleSendMessage() {
    if (!draft.trim() || sending) {
      return
    }

    const resolvedModel = selectedModel || activeAssistant?.model
    if (!resolvedModel) {
      toast('当前没有可用模型。')
      return
    }
    const resolvedModelLabel =
      models.find((item) => item.value === resolvedModel)?.label || resolvedModel

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: draft.trim(),
      createdAt: Date.now(),
    }

    const history = [...messages, userMessage]
    setMessages(history)
    setDraft('')
    window.setTimeout(() => resizeDraft(), 0)
    setSending(true)

    try {
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
      })

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: toMessageText(response.choices?.[0]?.message?.content),
          createdAt: Date.now(),
          usage: response.usage,
          modelLabel: resolvedModelLabel,
        },
      ])
    } catch (error) {
      toast(error instanceof Error ? error.message : '聊天请求失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className='workspace-page chat-page'>
      <article className='panel conversation-panel chat-panel-surface'>
        <div className='message-stream'>
          {messages.length > 0 &&
            messages.map((item) => (
              <div key={item.id} className={`message-bubble ${item.role}`}>
                <span className='message-role'>
                  {item.role === 'assistant'
                    ? item.modelLabel || activeModelLabel
                    : item.role === 'system'
                      ? '系统'
                      : '你'}
                </span>
                <p>{item.content}</p>
                <small>{formatDateTime(item.createdAt)}</small>
              </div>
            ))}
        </div>

        <div className='composer shell-composer chat-composer'>
          <textarea
            ref={draftRef}
            value={draft}
            rows={1}
            onChange={(event) => {
              setDraft(event.target.value)
              resizeDraft()
            }}
            onInput={(event) => syncTextareaHeight(event.currentTarget)}
            placeholder='输入你的问题、任务或上下文。'
          />
          <div className='composer-toolbar'>
            <div className='composer-actions left chat-toolbar-actions'>
              <div className='toolbar-picker' ref={assistantMenuRef}>
                <button
                  className='ghost-button tiny picker-trigger icon-picker-trigger'
                  type='button'
                  aria-expanded={assistantMenuOpen}
                  onClick={() => {
                    setModelMenuOpen(false)
                    setAssistantMenuOpen((value) => !value)
                  }}
                  title='助手提示词'
                >
                  <Sparkles size={16} />
                  <strong>{activeAssistant?.name || '通用助手'}</strong>
                </button>
                {assistantMenuOpen && (
                  <div className='picker-menu assistant-menu'>
                    <div className='picker-menu-head'>
                      <strong>助手示词</strong>
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
              <div className='toolbar-picker' ref={modelMenuRef}>
                <button
                  className='ghost-button tiny picker-trigger icon-picker-trigger'
                  type='button'
                  aria-expanded={modelMenuOpen}
                  onClick={() => {
                    setAssistantMenuOpen(false)
                    setModelMenuOpen((value) => !value)
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
                      {models.map((item) => (
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
            </div>
            <div className='composer-actions right'>
              <button className='primary-button icon-only send-button' type='button' disabled={sending} onClick={() => void handleSendMessage()}>
                {sending ? <LoaderCircle className='spin' size={16} /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </article>
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
      </article>
    </section>
  )
}

function WalletWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
}) {
  const { user, toast } = props
  const [topupInfo, setTopupInfo] = useState<TopupInfo | null>(null)
  const [billing, setBilling] = useState<BillingHistoryData | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [walletAmount, setWalletAmount] = useState(100)
  const [walletPaymentMethod, setWalletPaymentMethod] = useState('alipay')

  const recentBills = billing?.items || []
  const availableMethods = topupInfo?.pay_methods || []
  const amountOptions = topupInfo?.amount_options?.length
    ? topupInfo.amount_options
    : [50, 100, 200, 500]
  const minTopupValue =
    Number(availableMethods.find((item) => item.type === walletPaymentMethod)?.min_topup) ||
    Number(topupInfo?.min_topup) ||
    0
  const completedBillCount = recentBills.filter((item) => item.status === 'success').length

  const refreshWallet = useCallback(async () => {
    const [nextTopupInfo, nextBilling] = await Promise.all([
      getTopupInfo(),
      getBillingHistory(),
    ])
    setTopupInfo(nextTopupInfo ?? null)
    setBilling(nextBilling ?? null)
    if (nextTopupInfo?.pay_methods?.[0]?.type) {
      setWalletPaymentMethod(nextTopupInfo.pay_methods[0].type)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextTopupInfo, nextBilling] = await Promise.all([
          getTopupInfo(),
          getBillingHistory(),
        ])

        if (disposed) {
          return
        }

        setTopupInfo(nextTopupInfo ?? null)
        setBilling(nextBilling ?? null)
        if (nextTopupInfo?.pay_methods?.[0]?.type) {
          setWalletPaymentMethod(nextTopupInfo.pay_methods[0].type)
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

  async function handleWalletPay() {
    if (!walletAmount || walletAmount <= 0) {
      toast('请输入有效的充值金额。')
      return
    }

    if (minTopupValue > 0 && walletAmount < minTopupValue) {
      toast(`当前支付方式最低充值金额为 ${minTopupValue}。`)
      return
    }

    try {
      const result = await requestWalletPayment(walletAmount, walletPaymentMethod)
      if (result?.url) {
        await getDesktopBridge().openExternal(result.url)
      }
      toast('支付入口已发起。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '支付发起失败')
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
          <div className='stats-inline page-stats-grid'>
            <div className='mini-stat'>
              <strong>{formatQuota(user.quota)}</strong>
              <span>当前余额</span>
            </div>
            <div className='mini-stat'>
              <strong>{formatQuota(user.used_quota)}</strong>
              <span>累计消耗</span>
            </div>
            <div className='mini-stat'>
              <strong>{billing?.total || 0}</strong>
              <span>账单条目</span>
            </div>
            <div className='mini-stat'>
              <strong>{user.request_count || 0}</strong>
              <span>累计请求数</span>
            </div>
          </div>

          <div className='content-grid wallet-grid'>
            <div className='panel-block hero-panel-block wallet-overview-card'>
              <div className='wallet-overview-head'>
                <div>
                  <span className='eyebrow dark'>账户统计</span>
                  <h3>钱包总览</h3>
                </div>
                <span className='metric-pill success'>已完成账单 {completedBillCount}</span>
              </div>
              <div className='wallet-overview-grid'>
                <div className='wallet-overview-metric'>
                  <strong>{formatQuota(user.quota)}</strong>
                  <span>可用余额</span>
                </div>
                <div className='wallet-overview-metric'>
                  <strong>{formatQuota(user.used_quota)}</strong>
                  <span>历史消耗</span>
                </div>
                <div className='wallet-overview-metric'>
                  <strong>{user.request_count || 0}</strong>
                  <span>请求次数</span>
                </div>
              </div>
            </div>

            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>充值与兑换</strong>
                <span>支持钱包充值和兑换码快速入账</span>
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

                <div className='inline-fields'>
                  <input
                    type='number'
                    value={walletAmount}
                    onChange={(event) => setWalletAmount(Number(event.target.value) || 0)}
                    placeholder='充值金额'
                  />
                  <select
                    value={walletPaymentMethod}
                    onChange={(event) => setWalletPaymentMethod(event.target.value)}
                  >
                    {(topupInfo?.pay_methods || []).map((method) => (
                      <option key={method.type} value={method.type}>
                        {method.name}
                      </option>
                    ))}
                  </select>
                </div>

                {amountOptions.length > 0 && (
                  <div className='quick-amounts'>
                    {amountOptions.slice(0, 8).map((amount) => (
                      <button
                        key={amount}
                        className={`ghost-button tiny quick-amount-chip ${walletAmount === amount ? 'active' : ''}`}
                        type='button'
                        onClick={() => setWalletAmount(amount)}
                      >
                        {amount}
                      </button>
                    ))}
                  </div>
                )}

                <div className='wallet-meta-grid'>
                  <div className='status-card'>
                    <strong>可用支付方式</strong>
                    <span>{availableMethods.map((item) => item.name).join(' / ') || '待服务端配置'}</span>
                  </div>
                  <div className='status-card'>
                    <strong>最低充值金额</strong>
                    <span>{minTopupValue > 0 ? String(minTopupValue) : '未限制'}</span>
                  </div>
                </div>

                <button className='primary-button full' type='button' onClick={() => void handleWalletPay()}>
                  拉起支付
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
          getUserUsageLogs(),
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
                <span>展示调用次数、Token 和最近调用时间</span>
              </div>
              <div className='subrecords'>
                {topModels.length === 0 ? (
                  <EmptyState title='暂无模型分析数据' description='开始使用模型后，这里会自动汇总分析。' />
                ) : (
                  topModels.map((item) => (
                    <div key={`${item.model}-analysis`} className='record-row'>
                      <div>
                        <strong>{item.model}</strong>
                        <span>
                          Prompt {formatQuota(item.promptTokens)} · Completion {formatQuota(item.completionTokens)}
                        </span>
                      </div>
                      <small>
                        {item.count} 次 · {formatDateTime(item.lastAt)}
                      </small>
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
        const [nextKeys, nextAccessToken] = await Promise.all([
          getApiKeys(),
          requireSuccess(generateAccessToken()),
        ])

        if (disposed) {
          return
        }

        setApiKeys(nextKeys?.items ?? [])
        setAccessToken(nextAccessToken ?? '')
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
      setAccessTokenVisible(true)
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
                      <span>{accessTokenVisible ? clipText(accessToken, 52) : '默认隐藏，仅在验证密码后可临时查看。'}</span>
                    </div>
                    <div className='record-actions'>
                      <small>高敏感</small>
                      <button className='ghost-button' type='button' onClick={() => void handleRevealAccessToken()}>
                        {accessTokenVisible ? '已显示' : '查看'}
                      </button>
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

                <div className='subform'>
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
}) {
  const { client, toast, openSettings } = props
  const [status, setStatus] = useState<CliStatus>(() => readCachedCliStatus(client))
  const [history, setHistory] = useState<CliHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activeHistoryId, setActiveHistoryId] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sessionMessagesMap, setSessionMessagesMap] = useState<Record<string, CliMessage[]>>({})
  const [cliModels, setCliModels] = useState<ChatModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState(client === 'claude' ? 'high' : 'medium')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const { ref: promptRef, resize: resizePrompt } = useAutosizeTextarea(prompt)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const effortMenuRef = useRef<HTMLDivElement | null>(null)

  const historyGroups = useMemo(() => groupCliHistoryByProject(history), [history])
  const activeMessages = activeSessionId ? sessionMessagesMap[activeSessionId] || [] : []
  const reasoningOptions = client === 'claude' ? CLAUDE_REASONING_OPTIONS : CLI_REASONING_OPTIONS
  const selectedModelLabel =
    cliModels.find((item) => item.value === selectedModel)?.label || selectedModel || '默认模型'
  const selectedEffortLabel =
    reasoningOptions.find((item) => item.value === reasoningEffort)?.label || reasoningEffort

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
    let disposed = false

    void (async () => {
      try {
        const models = await getUserModels()
        if (!disposed) {
          setCliModels(models)
          setSelectedModel((current) => current || models[0]?.value || '')
        }
      } catch {
        /* ignore model loading errors */
      }
    })()

    return () => {
      disposed = true
    }
  }, [])

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
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [effortMenuOpen, modelMenuOpen])

  useEffect(() => {
    void setDesktopWindowTitle(projectName)
  }, [projectName])

  function applyProjectPath(nextPath: string) {
    setProjectPath(nextPath)
    const segments = nextPath.split(/[\\/]/).filter(Boolean)
    setProjectName(segments.at(-1) || '')
  }

  async function handlePickProject() {
    const selected = await pickProjectDirectory()
    if (selected) {
      applyProjectPath(selected)
    }
  }

  function hydrateCliSession(details: CliSessionDetails) {
    setActiveHistoryId(details.id)
    setActiveSessionId(details.id)
    if (details.projectPath) {
      applyProjectPath(details.projectPath)
    } else {
      setProjectName(details.projectName || '')
    }
    setSessionMessagesMap((current) => ({
      ...current,
      [details.id]: details.messages,
    }))
  }

  async function handleOpenHistory(item: CliHistoryEntry) {
    setActiveHistoryId(item.id)
    setActiveSessionId(item.id)
    if (item.projectPath) {
      applyProjectPath(item.projectPath)
    } else {
      setProjectName(item.projectName || item.title)
    }
    setPrompt('')
    window.setTimeout(() => resizePrompt(), 0)

    if (sessionMessagesMap[item.id]?.length) {
      return
    }

    try {
      const details = await getCliSession(client, item.id)
      if (!details) {
        toast('未能读取完整会话记录。')
        return
      }
      hydrateCliSession(details)
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取会话失败')
    }
  }

  async function handleRun() {
    if (!projectPath.trim() || !prompt.trim() || running) {
      toast('请选择项目目录并输入消息。')
      return
    }

    const nextPrompt = prompt.trim()
    const currentSessionKey = activeSessionId || `draft-${client}-${Date.now()}`
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: nextPrompt,
      createdAt: Date.now(),
    }

    setActiveSessionId(currentSessionKey)
    setSessionMessagesMap((current) => ({
      ...current,
      [currentSessionKey]: [...(current[currentSessionKey] || []), userMessage],
    }))
    setPrompt('')
    window.setTimeout(() => resizePrompt(), 0)
    setRunning(true)

    try {
      const response = await runCliPrompt({
        client,
        projectPath,
        prompt: nextPrompt,
        sessionId: activeSessionId || undefined,
        model: selectedModel || undefined,
        reasoningEffort,
      })

      const nextSessionId = response.sessionId || currentSessionKey
      setActiveSessionId(nextSessionId)
      setSessionMessagesMap((current) => {
        const existing =
          nextSessionId === currentSessionKey
            ? current[currentSessionKey] || []
            : current[currentSessionKey] || current[nextSessionId] || []
        const nextMap = {
          ...current,
          [nextSessionId]: [
            ...existing,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant' as const,
              content: response.output || response.error || '未返回结果。',
              createdAt: Date.now(),
              modelLabel: client === 'codex' ? 'Codex' : selectedModelLabel || 'Claude',
            },
          ],
        }

        if (nextSessionId !== currentSessionKey) {
          delete nextMap[currentSessionKey]
        }

        return nextMap
      })

      if (!response.success) {
        toast(response.error || `${client} 执行失败`)
      }
      await refreshCliState()
    } catch (error) {
      toast(error instanceof Error ? error.message : '执行失败')
    } finally {
      setRunning(false)
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
            {activeMessages.map((item) => (
              <div key={item.id} className={`message-bubble ${item.role}`}>
                <span className='message-role'>
                  {item.role === 'assistant'
                    ? item.modelLabel || (client === 'codex' ? 'Codex' : 'Claude')
                    : '你'}
                </span>
                <p>{item.content}</p>
                <small>{formatDateTime(item.createdAt)}</small>
              </div>
            ))}
          </div>

          <div className='cli-composer shell-composer'>
            <textarea
              ref={promptRef}
              value={prompt}
              rows={1}
              onChange={(event) => {
                setPrompt(event.target.value)
                resizePrompt()
              }}
              onInput={(event) => syncTextareaHeight(event.currentTarget)}
              placeholder={`输入要发给 ${client} 的消息，例如：阅读当前项目并总结关键模块。`}
            />
            <div className='composer-toolbar'>
              <div className='composer-actions left cli-toolbar-actions'>
                <button className='ghost-button tiny icon-pill-trigger' type='button' onClick={() => void handlePickProject()}>
                  <FolderOpen size={16} />
                  <strong>{projectName || '选择目录'}</strong>
                </button>
                <button className='ghost-button tiny icon-pill-trigger' type='button' onClick={() => void refreshCliState()}>
                  <RefreshCcw size={16} />
                  <strong>刷新</strong>
                </button>
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
                        {cliModels.map((item) => (
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
                <span className={`metric-pill ${status.installed ? 'success' : 'warn'}`}>
                  {status.installed ? '已安装' : '未安装'}
                </span>
                <span className='metric-pill'>{status.version || '版本未知'}</span>
                <span className='metric-pill'>{status.hasConfig ? '配置已就绪' : '待配置'}</span>
              </div>
              <div className='composer-actions right'>
                <button className='ghost-button icon-only' type='button' onClick={() => setHistoryOpen((value) => !value)}>
                  {historyOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </button>
                <button className='primary-button icon-only send-button' type='button' disabled={running} onClick={() => void handleRun()}>
                  {running ? <LoaderCircle className='spin' size={16} /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        </article>

        <aside className={`panel cli-history-panel ${historyOpen ? 'open' : ''}`}>
          <div className='panel-header compact'>
            <div>
              <span className='eyebrow dark'>历史记录</span>
              <h2>最近会话</h2>
            </div>
          </div>

          <div className='side-pane-scroll'>
            {historyGroups.length === 0 ? (
              <EmptyState title='当前没有可读取的历史' description='使用过本地 CLI 后，会话会显示在这里。' />
            ) : (
              <div className='subrecords history-groups'>
                {historyGroups.map((group) => (
                  <div key={group.projectPath || group.projectName} className='history-group'>
                    <div className='history-group-head'>
                      <strong>{group.projectName}</strong>
                      <span>{group.items.length} 个会话</span>
                    </div>
                    <div className='subrecords compact-records'>
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          type='button'
                          className={`record-row action-row session-row ${item.id === activeHistoryId ? 'highlighted' : ''}`}
                          onClick={() => void handleOpenHistory(item)}
                        >
                          <span className='session-row-preview'>{clipText(item.preview, 74)}</span>
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

  async function handleDeploy() {
    try {
      setDeploying(true)
      setDeployLog([])
      const generated = await createDesktopCliKey(
        `${client.toUpperCase()} 桌面安装 Key`,
        user.group || ''
      )
      setFreshCliKey(generated.key)
      await deployCli({
        client,
        apiKey: generated.key,
        baseUrl: 'http://ai.oneapi.center',
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
          <button className='ghost-button' type='button' onClick={() => void refreshStatus()}>
            <RefreshCcw size={16} />
            <span>刷新</span>
          </button>
          <button className='primary-button' type='button' disabled={deploying} onClick={() => void handleDeploy()}>
            <Wrench size={16} />
            <span>{deploying ? '部署中' : '一键部署'}</span>
          </button>
        </div>
      </div>

      <div className='panel-subcopy'>
        <span className={`metric-pill ${status.installed ? 'success' : 'warn'}`}>
          {status.installed ? '已安装' : '未安装'}
        </span>
        <span className='metric-pill'>{status.version || '版本未知'}</span>
        <span className='metric-pill'>{status.hasConfig ? '配置已存在' : '尚未配置'}</span>
        <span className='metric-pill'>{status.hasDataDirectory ? '数据目录已创建' : '数据目录待创建'}</span>
      </div>

      <div className='status-grid'>
        <div className='status-card'>
          <strong>可执行文件</strong>
          <span>{status.executablePath || '尚未检测到'}</span>
        </div>
        <div className='status-card'>
          <strong>配置文件</strong>
          <span>{status.configPath || '尚未生成'}</span>
        </div>
        <div className='status-card'>
          <strong>数据目录</strong>
          <span>{status.dataPath || '尚未生成'}</span>
        </div>
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
        <article className='panel settings-intro-card'>
          <div className='panel-header compact'>
            <div>
              <span className='eyebrow dark'>配置</span>
              <h2>客户端环境与部署</h2>
            </div>
          </div>
          <p className='helper-copy'>
            Codex 和 Claude 的安装、配置、测试统一放在这里处理。部署时会自动创建专用 Key，使用国内镜像安装，并写入对应的配置目录。
          </p>
          <div className='stats-inline'>
            <div className='mini-stat'>
              <strong>.codex</strong>
              <span>Codex 配置目录</span>
            </div>
            <div className='mini-stat'>
              <strong>.claude</strong>
              <span>Claude 配置目录</span>
            </div>
            <div className='mini-stat'>
              <strong>国内镜像</strong>
              <span>安装与依赖下载</span>
            </div>
          </div>
        </article>

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
}) {
  const { mode, setMode, toast, openSettings } = props

  return (
    <section className='workspace-page assistant-page'>
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
        {mode === 'chat' && <AssistantsChatWorkspace toast={toast} />}
        {mode === 'codex' && <CliWorkspace client='codex' toast={toast} openSettings={openSettings} />}
        {mode === 'claude' && <CliWorkspace client='claude' toast={toast} openSettings={openSettings} />}
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [require2fa, setRequire2fa] = useState(false)
  const [submitting, setSubmitting] = useState(false)

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
              <span className='eyebrow dark'>账号登录</span>
              <h2>{require2fa ? '输入 2FA 验证码' : '登录你的 OneAPI 账号'}</h2>
            </div>
          </div>

          {!require2fa ? (
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
          ) : (
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
              <button className='ghost-button' type='button' onClick={() => setRequire2fa(false)}>
                返回账号密码登录
              </button>
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
              <div className='brand-mark'>O</div>
              {!collapsed && (
                <div>
                  <div className='brand-name'>{productName}</div>
                  <div className='brand-sub'>{platformLabel} 客户端</div>
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
                    <LockKeyhole size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className='main-panel'>
          <div className='workspace-host'>
            {sideTab === 'assistants' && (
              <AssistantWorkspace
                mode={assistantMode}
                setMode={setAssistantMode}
                toast={setMessage}
                openSettings={() => setSideTab('settings')}
              />
            )}
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
