import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Plus,
  RefreshCcw,
  Send,
  Sparkles,
  Wallet,
  Wrench,
} from 'lucide-react'
import { loadAssistants, saveAssistants, createAssistant, loadActiveAssistantId, saveActiveAssistantId } from './domains/assistants'
import { login, login2fa, logout, unwrapEnvelope } from './domains/auth'
import { getUserGroups, getUserModels, sendChatCompletion } from './domains/chat'
import { createDesktopCliKey, fetchApiKeySecret, getApiKeys } from './domains/keys'
import { deployCli, getCliStatus, listCliHistory, onDeployProgress, pickProjectDirectory, runCliPrompt } from './domains/cli'
import { generateAccessToken, getSelfProfile, requireSuccess, verifyCurrentPassword } from './domains/profile'
import { getPublicPlans, getSelfSubscriptions, getSubscriptionPaymentInfo, paySubscription } from './domains/subscriptions'
import { getUserUsageLogs, getUserUsageStat } from './domains/usage'
import { getBillingHistory, getTopupInfo, redeemTopupCode, requestWalletPayment } from './domains/wallet'
import { clearStoredDesktopUserId, saveStoredDesktopUserId } from './lib/desktop-client'
import { formatDateTime, formatPrice, formatQuota, clipText } from './lib/format'
import { useAuthStore } from './stores/auth-store'
import type {
  AssistantRecord,
  BillingHistoryData,
  ChatGroupOption,
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
  CliRunResponse,
  CliStatus,
  DeployProgressPayload,
} from './shared/desktop'

type TopTab = 'chat' | 'codex' | 'claude'
type SideTab = 'assistants' | 'subscriptions' | 'wallet' | 'usage' | 'me'

const topTabs: { key: TopTab; label: string }[] = [
  { key: 'chat', label: '聊天' },
  { key: 'codex', label: 'Codex' },
  { key: 'claude', label: 'Claude' },
]

const sideTabs: {
  key: SideTab
  label: string
  icon: typeof Sparkles
  desc: string
}[] = [
  { key: 'assistants', label: '助手', icon: Sparkles, desc: '提示词助手与模型模板' },
  { key: 'subscriptions', label: '订阅', icon: CreditCard, desc: '套餐购买、订阅状态和额度' },
  { key: 'wallet', label: '钱包', icon: Wallet, desc: '余额、支付入口与账单记录' },
  { key: 'usage', label: '用量', icon: ChartColumn, desc: '消耗趋势与调用分析' },
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

function ChatWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
  sideTab: SideTab
  setSideTab: (tab: SideTab) => void
}) {
  const { user, toast, sideTab, setSideTab } = props
  const [models, setModels] = useState<ChatModelOption[]>([])
  const [groups, setGroups] = useState<ChatGroupOption[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [sending, setSending] = useState(false)
  const [assistantName, setAssistantName] = useState('')
  const [assistantDescription, setAssistantDescription] = useState('')
  const [assistantPrompt, setAssistantPrompt] = useState('')

  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [subscriptionSelf, setSubscriptionSelf] = useState<SubscriptionSelfData | null>(null)
  const [paymentInfo, setPaymentInfo] = useState<SubscriptionPaymentInfo | null>(null)
  const [buyingPlanId, setBuyingPlanId] = useState(0)

  const [topupInfo, setTopupInfo] = useState<TopupInfo | null>(null)
  const [billing, setBilling] = useState<BillingHistoryData | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [walletAmount, setWalletAmount] = useState(100)
  const [walletPaymentMethod, setWalletPaymentMethod] = useState('alipay')

  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [usageStat, setUsageStat] = useState<UsageStat | null>(null)

  const [apiKeys, setApiKeys] = useState<Array<{ id: number; name: string; status: number; group?: string; remain_quota: number; created_time: number }>>([])
  const [accessToken, setAccessToken] = useState('')
  const [passwordGateOpen, setPasswordGateOpen] = useState(false)
  const [passwordGatePurpose, setPasswordGatePurpose] = useState<'view-key' | 'create-key'>('view-key')
  const [passwordInput, setPasswordInput] = useState('')
  const [pendingKeyId, setPendingKeyId] = useState<number | null>(null)
  const [revealedKey, setRevealedKey] = useState('')
  const [newKeyName, setNewKeyName] = useState('桌面端专用 Key')
  const [initialAssistantsState] = useState(loadInitialAssistantsState)
  const [assistants, setAssistants] = useState(initialAssistantsState.assistants)
  const [activeAssistantId, setActiveAssistantId] = useState(initialAssistantsState.activeAssistantId)

  const activeAssistant = useMemo(
    () => assistants.find((item) => item.id === activeAssistantId) ?? assistants[0] ?? null,
    [assistants, activeAssistantId]
  )

  async function refreshSubscriptions() {
    const [nextPlans, nextSelf, nextPaymentInfo] = await Promise.all([
      getPublicPlans(),
      getSelfSubscriptions(),
      getSubscriptionPaymentInfo(),
    ])
    setPlans(nextPlans.filter((item) => item.plan.enabled))
    setSubscriptionSelf(nextSelf)
    setPaymentInfo(nextPaymentInfo ?? null)
  }

  async function refreshWallet() {
    const [nextTopupInfo, nextBilling] = await Promise.all([getTopupInfo(), getBillingHistory()])
    setTopupInfo(nextTopupInfo ?? null)
    setBilling(nextBilling ?? null)
    if (nextTopupInfo?.pay_methods?.[0]?.type) {
      setWalletPaymentMethod(nextTopupInfo.pay_methods[0].type)
    }
  }

  async function refreshMe() {
    const [nextKeys, nextAccessToken] = await Promise.all([
      getApiKeys(),
      requireSuccess(generateAccessToken()),
    ])
    setApiKeys(nextKeys?.items ?? [])
    setAccessToken(nextAccessToken ?? '')
  }

  useEffect(() => {
    let disposed = false

    void (async () => {
      const [nextModels, nextGroups, nextPlans, nextSelf, nextPaymentInfo, nextTopupInfo, nextBilling, nextUsageData, nextUsageStat, nextKeys, nextAccessToken] =
        await Promise.all([
          getUserModels(),
          getUserGroups(),
          getPublicPlans(),
          getSelfSubscriptions(),
          getSubscriptionPaymentInfo(),
          getTopupInfo(),
          getBillingHistory(),
          getUserUsageLogs(),
          getUserUsageStat(),
          getApiKeys(),
          requireSuccess(generateAccessToken()),
        ])

      if (disposed) {
        return
      }

      setModels(nextModels)
      setGroups(nextGroups)
      setPlans(nextPlans.filter((item) => item.plan.enabled))
      setSubscriptionSelf(nextSelf)
      setPaymentInfo(nextPaymentInfo ?? null)
      setTopupInfo(nextTopupInfo ?? null)
      setBilling(nextBilling ?? null)
      setUsageData(nextUsageData ?? null)
      setUsageStat(nextUsageStat ?? null)
      setApiKeys(nextKeys?.items ?? [])
      setAccessToken(nextAccessToken ?? '')

      if (nextTopupInfo?.pay_methods?.[0]?.type) {
        setWalletPaymentMethod(nextTopupInfo.pay_methods[0].type)
      }
      setSelectedModel((current) => current || nextModels[0]?.value || '')
      setSelectedGroup((current) => current || nextGroups[0]?.value || '')
    })()

    return () => {
      disposed = true
    }
  }, [])

  async function handleSendMessage() {
    if (!draft.trim() || !selectedModel || sending) {
      return
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: draft.trim(),
      createdAt: Date.now(),
    }

    const history = [...messages, userMessage]
    setMessages(history)
    setDraft('')
    setSending(true)

    try {
      const systemMessage = toAssistantSystemMessage(activeAssistant)
      const response = await sendChatCompletion({
        model: activeAssistant?.model || selectedModel,
        group: selectedGroup,
        temperature: activeAssistant?.temperature ?? 0.7,
        messages: [
          ...(systemMessage ? [systemMessage] : []),
          ...history.map((item) => ({
            role: item.role,
            content: item.content,
          })),
        ],
      })

      const reply = response.choices[0]?.message?.content || '模型未返回内容。'
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: reply,
          createdAt: Date.now(),
          usage: response.usage,
        },
      ])
    } catch (error) {
      toast(error instanceof Error ? error.message : '发送消息失败')
    } finally {
      setSending(false)
    }
  }

  function handleCreateAssistant() {
    if (!assistantName.trim() || !assistantPrompt.trim()) {
      toast('请填写助手名称和提示词。')
      return
    }
    const next = createAssistant({
      name: assistantName.trim(),
      description: assistantDescription.trim() || '自定义助手',
      prompt: assistantPrompt.trim(),
      model: selectedModel,
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
    toast('自定义助手已创建。')
  }

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

  async function handleRedeem() {
    if (!redeemCode.trim()) {
      toast('请输入兑换码。')
      return
    }
    try {
      await redeemTopupCode(redeemCode.trim())
      setRedeemCode('')
      toast('兑换成功，钱包余额已刷新。')
      await Promise.all([refreshWallet(), refreshMe()])
    } catch (error) {
      toast(error instanceof Error ? error.message : '兑换失败')
    }
  }

  async function handleWalletPay() {
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
    purpose: 'view-key' | 'create-key',
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
        const result = await createDesktopCliKey(newKeyName.trim() || '桌面端专用 Key', user.group || '')
        setRevealedKey(result.key)
        toast('新的 API Key 已创建。')
        await refreshMe()
      } catch (error) {
        toast(error instanceof Error ? error.message : '创建 Key 失败')
      }
    }
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
      <section className='workspace-main'>
        <div className='workspace-header'>
          <div>
            <span className='eyebrow dark'>AIChat</span>
            <h1>无感连接你的 OneAPI 账户</h1>
            <p>
              登录后自动拉取模型、分组和账户能力。当前默认助手为
              <strong>{activeAssistant?.name || '未选择助手'}</strong>。
            </p>
          </div>
          <div className='workspace-meta'>
            <span className='metric-pill'>模型数 {models.length}</span>
            <span className='metric-pill'>助手数 {assistants.length}</span>
            <span className='metric-pill'>账户额度 {formatQuota(user.quota)}</span>
          </div>
        </div>

        <section className='chat-hero-grid'>
          <article className='panel chat-panel'>
            <div className='panel-header'>
              <div>
                <span className='eyebrow dark'>主聊天区</span>
                <h2>AIChat 工作区</h2>
              </div>
              <div className='chat-config'>
                <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                  {models.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
                  {groups.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className='message-stream'>
              {messages.length === 0 ? (
                <div className='empty-card large'>
                  <Bot size={24} />
                  <strong>从这里开始中文对话</strong>
                  <p>可直接切换模型，或先在右侧助手区创建一个专用提示词助手。</p>
                </div>
              ) : (
                messages.map((item) => (
                  <div key={item.id} className={`message-bubble ${item.role}`}>
                    <span className='message-role'>
                      {item.role === 'assistant' ? 'AI' : item.role === 'system' ? '系统' : '你'}
                    </span>
                    <p>{item.content}</p>
                    <small>{formatDateTime(item.createdAt)}</small>
                  </div>
                ))
              )}
            </div>

            <div className='composer'>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder='输入你的问题、任务或上下文，回车发送。'
              />
              <button className='primary-button' type='button' onClick={handleSendMessage} disabled={sending}>
                {sending ? <LoaderCircle className='spin' size={16} /> : <Send size={16} />}
                <span>{sending ? '发送中' : '发送'}</span>
              </button>
            </div>
          </article>

          <aside className='panel side-domain-panel'>
            <div className='domain-switch'>
              {sideTabs.map((item) => {
                const Icon = item.icon
                const active = item.key === sideTab
                return (
                  <button
                    key={item.key}
                    type='button'
                    className={`domain-pill ${active ? 'active' : ''}`}
                    onClick={() => setSideTab(item.key)}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>

            {sideTab === 'assistants' && (
              <div className='domain-section'>
                <div className='panel-header compact'>
                  <div>
                    <span className='eyebrow dark'>助手</span>
                    <h2>提示词助手中心</h2>
                  </div>
                </div>

                <div className='assistant-list'>
                  {assistants.map((item) => (
                    <button
                      key={item.id}
                      type='button'
                      className={`assistant-card ${item.id === activeAssistantId ? 'active' : ''}`}
                      onClick={() => {
                        setActiveAssistantId(item.id)
                        saveActiveAssistantId(item.id)
                      }}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <small>{clipText(item.prompt, 66)}</small>
                    </button>
                  ))}
                </div>

                <div className='subform'>
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

            {sideTab === 'subscriptions' && (
              <div className='domain-section'>
                <div className='panel-header compact'>
                  <div>
                    <span className='eyebrow dark'>订阅</span>
                    <h2>套餐订阅与用量</h2>
                  </div>
                </div>

                <div className='subscription-grid'>
                  {plans.map((item) => (
                    <article key={item.plan.id} className='pricing-card'>
                      <strong>{item.plan.title}</strong>
                      <span>{item.plan.subtitle || '适合稳定桌面端高频使用。'}</span>
                      <b>{formatPrice(item.plan.price_amount, item.plan.currency || 'USD')}</b>
                      <small>总额度 {formatQuota(item.plan.total_amount)}</small>
                      <div className='pricing-actions'>
                        {(paymentInfo?.pay_methods || []).slice(0, 2).map((method) => (
                          <button
                            key={method.type}
                            className='secondary-button tiny'
                            type='button'
                            disabled={buyingPlanId === item.plan.id}
                            onClick={() => void handleBuyPlan(item.plan.id, method.type)}
                          >
                            {buyingPlanId === item.plan.id ? '处理中' : method.name}
                          </button>
                        ))}
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
                  ))}
                </div>

                <div className='subrecords'>
                  {(subscriptionSelf?.all_subscriptions || []).slice(0, 4).map((item) => (
                    <div key={item.subscription.id} className='record-row'>
                      <div>
                        <strong>订阅 #{item.subscription.id}</strong>
                        <span>
                          已用 {formatQuota(item.subscription.amount_used)} / {formatQuota(item.subscription.amount_total)}
                        </span>
                      </div>
                      <small>{item.subscription.status}</small>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sideTab === 'wallet' && (
              <div className='domain-section'>
                <div className='panel-header compact'>
                  <div>
                    <span className='eyebrow dark'>钱包</span>
                    <h2>余额、充值与账单</h2>
                  </div>
                </div>

                <div className='stats-inline'>
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

                  <button className='primary-button full' type='button' onClick={() => void handleWalletPay()}>
                    拉起支付
                  </button>
                </div>

                <div className='subrecords'>
                  {(billing?.items || []).slice(0, 4).map((item, index) => (
                    <div key={String(item.trade_no || index)} className='record-row'>
                      <div>
                        <strong>{String(item.payment_method || '订单')}</strong>
                        <span>{formatDateTime(Number(item.create_time || 0))}</span>
                      </div>
                      <small>{String(item.status || 'pending')}</small>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sideTab === 'usage' && (
              <div className='domain-section'>
                <div className='panel-header compact'>
                  <div>
                    <span className='eyebrow dark'>用量</span>
                    <h2>消耗分布与模型调用</h2>
                  </div>
                </div>

                <div className='stats-inline'>
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
                </div>

                <div className='subrecords'>
                  {(usageData?.items || []).slice(0, 5).map((item) => (
                    <div key={item.id} className='record-row'>
                      <div>
                        <strong>{item.model_name || '未标注模型'}</strong>
                        <span>{item.token_name || '系统路由'} · {formatDateTime(item.created_at || item.created_time || 0)}</span>
                      </div>
                      <small>{formatQuota(item.quota)}</small>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sideTab === 'me' && (
              <div className='domain-section'>
                <div className='panel-header compact'>
                  <div>
                    <span className='eyebrow dark'>我的</span>
                    <h2>账户、Key 与敏感操作</h2>
                  </div>
                </div>

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
                      <span>{clipText(accessToken, 36)}</span>
                    </div>
                    <small>自动生成</small>
                  </div>
                </div>

                <div className='subform'>
                  <div className='inline-fields'>
                    <input
                      value={newKeyName}
                      onChange={(event) => setNewKeyName(event.target.value)}
                      placeholder='新 Key 名称'
                    />
                    <button className='secondary-button' type='button' onClick={() => openPasswordGate('create-key')}>
                      新建 Key
                    </button>
                  </div>
                  {revealedKey && (
                    <div className='key-reveal'>
                      <strong>最近查看 / 创建的 Key</strong>
                      <code>{revealedKey}</code>
                    </div>
                  )}
                </div>

                <div className='subrecords'>
                  {apiKeys.slice(0, 6).map((item) => (
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
                  ))}
                </div>
              </div>
            )}
          </aside>
        </section>
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

function CliWorkspace(props: { client: CliClient; user: UserProfile; toast: (message: string) => void }) {
  const { client, user, toast } = props
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [history, setHistory] = useState<CliHistoryEntry[]>([])
  const [projectPath, setProjectPath] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CliRunResponse | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [deployLog, setDeployLog] = useState<DeployProgressPayload[]>([])
  const [freshCliKey, setFreshCliKey] = useState('')
  const emptyCliStatus = useMemo<CliStatus>(
    () => ({
      client,
      installed: false,
      version: '',
      executablePath: '',
      configPath: '',
      dataPath: '',
      hasConfig: false,
      hasDataDirectory: false,
    }),
    [client]
  )

  const loadCliSnapshot = useCallback(async () => {
    try {
      const [cliStatusAll, cliHistory] = await Promise.all([
        getCliStatus(),
        listCliHistory(client),
      ])
      return {
        status: client === 'codex' ? cliStatusAll.codex : cliStatusAll.claude,
        history: cliHistory,
        errorMessage: '',
      }
    } catch (error) {
      return {
        status: emptyCliStatus,
        history: [],
        errorMessage: error instanceof Error ? error.message : `${client} 环境检测失败`,
      }
    }
  }, [client, emptyCliStatus])

  const refreshCliState = useCallback(async () => {
    const snapshot = await loadCliSnapshot()
    setStatus(snapshot.status)
    setHistory(snapshot.history)
    if (snapshot.errorMessage) {
      toast(snapshot.errorMessage)
    }
  }, [loadCliSnapshot, toast])

  useEffect(() => {
    let disposed = false

    void (async () => {
      const snapshot = await loadCliSnapshot()
      if (disposed) {
        return
      }
      setStatus(snapshot.status)
      setHistory(snapshot.history)
      if (snapshot.errorMessage) {
        toast(snapshot.errorMessage)
      }
    })()

    return () => {
      disposed = true
    }
  }, [loadCliSnapshot, toast])

  useEffect(() => {
    const unsubscribe = onDeployProgress((payload) => {
      if (payload.client !== client) {
        return
      }
      setDeployLog((current) => [...current, payload])
      if (payload.step === 'complete' || payload.status === 'error') {
        setDeploying(false)
        void refreshCliState()
      }
    })
    return unsubscribe
  }, [client, refreshCliState])

  async function handlePickProject() {
    const selected = await pickProjectDirectory()
    if (selected) {
      setProjectPath(selected)
    }
  }

  async function handleRun() {
    if (!projectPath.trim() || !prompt.trim() || running) {
      toast('请选择项目目录并输入消息。')
      return
    }
    setRunning(true)
    try {
      const response = await runCliPrompt({
        client,
        projectPath,
        prompt,
      })
      setResult(response)
      if (!response.success) {
        toast(response.error || `${client} 执行失败`)
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '执行失败')
    } finally {
      setRunning(false)
    }
  }

  async function handleDeploy() {
    try {
      setDeployLog([])
      setDeploying(true)
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
    <section className='workspace-main'>
      <div className='workspace-header'>
        <div>
          <span className='eyebrow dark'>{client.toUpperCase()}</span>
          <h1>{client === 'codex' ? 'Codex 轻量工作台' : 'Claude 轻量工作台'}</h1>
          <p>直接在客户端中选择项目、读取历史、输入消息即可，不扩展控制台和浏览器等附加面板。</p>
        </div>
        <div className='workspace-meta'>
          <span className={`metric-pill ${status?.installed ? 'success' : 'warn'}`}>
            {status?.installed ? '已安装' : '未安装'}
          </span>
          <span className='metric-pill'>{status?.version || '版本未知'}</span>
        </div>
      </div>

      <section className='cli-grid'>
        <article className='panel'>
          <div className='panel-header'>
            <div>
              <span className='eyebrow dark'>环境状态</span>
              <h2>安装、配置与测试</h2>
            </div>
            <div className='inline-actions'>
              <button className='ghost-button' type='button' onClick={() => void refreshCliState()}>
                <RefreshCcw size={16} />
                <span>刷新</span>
              </button>
              <button className='primary-button' type='button' disabled={deploying} onClick={() => void handleDeploy()}>
                <Wrench size={16} />
                <span>{deploying ? '部署中' : '管理员一键部署'}</span>
              </button>
            </div>
          </div>

          <div className='status-grid'>
            <div className='status-card'>
              <strong>可执行文件</strong>
              <span>{status?.executablePath || '尚未检测到'}</span>
            </div>
            <div className='status-card'>
              <strong>配置文件</strong>
              <span>{status?.configPath || '尚未生成'}</span>
            </div>
            <div className='status-card'>
              <strong>数据目录</strong>
              <span>{status?.dataPath || '尚未生成'}</span>
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
              <div className='empty-card'>
                <CheckCircle2 size={20} />
                <strong>点击“一键部署”后将显示完整进度</strong>
                <p>包括检测、安装、配置、测试四段结果，安装镜像使用国内源。</p>
              </div>
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

        <article className='panel'>
          <div className='panel-header'>
            <div>
              <span className='eyebrow dark'>项目会话</span>
              <h2>打开项目并发送消息</h2>
            </div>
          </div>

          <div className='subform'>
            <div className='inline-fields'>
              <input
                value={projectPath}
                onChange={(event) => setProjectPath(event.target.value)}
                placeholder='选择或输入项目目录'
              />
              <button className='secondary-button' type='button' onClick={() => void handlePickProject()}>
                <FolderOpen size={16} />
                <span>选择目录</span>
              </button>
            </div>

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={`输入要发给 ${client} 的消息，例如：阅读当前项目并总结关键模块。`}
            />
            <button className='primary-button full' type='button' disabled={running} onClick={() => void handleRun()}>
              {running ? <LoaderCircle className='spin' size={16} /> : <Send size={16} />}
              <span>{running ? '执行中' : '发送消息'}</span>
            </button>
          </div>

          <div className='result-block'>
            <strong>最近输出</strong>
            <pre>{result?.output || '尚未执行。'}</pre>
          </div>
        </article>

        <article className='panel'>
          <div className='panel-header'>
            <div>
              <span className='eyebrow dark'>历史记录</span>
              <h2>最近项目与会话</h2>
            </div>
          </div>

          <div className='subrecords'>
            {history.length === 0 ? (
              <div className='empty-card'>
                <MessageSquareText size={20} />
                <strong>当前没有可读取的本地历史</strong>
                <p>部署或使用后，客户端会自动读取本地 CLI 会话记录。</p>
              </div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  className='record-row action-row'
                  onClick={() => {
                    if (item.projectPath) {
                      setProjectPath(item.projectPath)
                    }
                    setPrompt(item.preview)
                  }}
                >
                  <div>
                    <strong>{item.title}</strong>
                    <span>{clipText(item.preview, 84)}</span>
                  </div>
                  <small>{formatDateTime(item.updatedAt)}</small>
                </button>
              ))
            )}
          </div>
        </article>
      </section>
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
            一个账号即可使用聊天、助手、订阅、钱包、用量、我的，以及
            Codex / Claude 轻量客户端能力。
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
              <PasswordField
                value={password}
                onChange={setPassword}
                placeholder='密码'
              />
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
  const [topTab, setTopTab] = useState<TopTab>('chat')
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
            className='collapse-button'
            type='button'
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed && <span>收起边栏</span>}
          </button>

          <nav className='side-nav'>
            {sideTabs.map((item) => {
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
        </aside>

        <main className='main-panel'>
          <header className='topbar'>
            <div className='topbar-left'>
              <span className='chip'>{platformLabel}</span>
              <span className='title'>统一 AI 工作台</span>
            </div>

            <div className='top-tabs'>
              {topTabs.map((item) => (
                <button
                  key={item.key}
                  type='button'
                  className={`top-tab ${item.key === topTab ? 'active' : ''}`}
                  onClick={() => setTopTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className='topbar-right'>
              <span className='user-pill'>{auth.user.display_name || auth.user.username}</span>
              <button className='ghost-button' type='button' onClick={() => void handleLogout()}>
                退出
              </button>
            </div>
          </header>

          {topTab === 'chat' && (
            <ChatWorkspace user={auth.user} toast={setMessage} sideTab={sideTab} setSideTab={setSideTab} />
          )}
          {topTab === 'codex' && (
            <CliWorkspace client='codex' user={auth.user} toast={setMessage} />
          )}
          {topTab === 'claude' && (
            <CliWorkspace client='claude' user={auth.user} toast={setMessage} />
          )}
        </main>
      </div>

      {message && <div className='toast-bar'>{message}</div>}
    </>
  )
}
