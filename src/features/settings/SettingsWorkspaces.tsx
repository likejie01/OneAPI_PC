import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Copy, Eye, EyeOff, LoaderCircle, Moon, Plus, RefreshCw, RotateCcw, Sun } from 'lucide-react'
import { listCustomAiChatProviderModels } from '../../domains/aichat-provider'
import { deployCli, getCliDeployPreset, getCliStatus, onDeployProgress } from '../../domains/cli'
import { ensureDesktopServiceKey, fetchApiKeySecret, getApiKeys, updateApiKeyStatus } from '../../domains/keys'
import { deleteMobileDesktopBinding, deleteMobileDesktopDevice, getLocalMobileBridgeDevice, getMobileDesktopDevices, resetLocalMobileBridgeDevice, type MobileDesktopDevice } from '../../domains/mobile-bridge'
import { verifyCurrentPassword } from '../../domains/profile'
import { resolveCliDeploySettings } from '../../lib/cli-deploy'
import { API_KEY_STATUS_DISABLED, API_KEY_STATUS_ENABLED, getSelectedDesktopApiKeyStorageKey, resolveSelectedDesktopApiKeyId } from '../../lib/desktop-api-keys'
import { describeCliWorkspaceStatus, resolveCliSetupPeerState } from '../../lib/desktop-service'
import { formatDateTime } from '../../lib/format'
import { normalizeOpenAICompatibleBaseUrl, type AiChatProviderConfig, type AiChatProviderState } from '../../lib/aichat-provider'
import { readJsonStorage, removeStorage, writeJsonStorage } from '../../lib/storage'
import { resolveActiveDesktopApiKeySummary, resolveCliDeployModelForActiveKey, refreshOneApiModelsForActiveKey, type ActiveDesktopApiKeySummary } from '../desktop-api-key-models'
import { PasswordField } from '../../components/PasswordField'
import type { CliClient, CliDeployPreset, CliStatus, DeployProgressPayload } from '../../shared/desktop'
import type { UserProfile } from '../../shared/contracts'

const DEFAULT_SERVER_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_BASE_URL = 'https://ai.oneapi.center/v1'
const DEFAULT_CLAUDE_BASE_URL = 'https://ai.oneapi.center'
const DEFAULT_CODEX_MODEL = 'gpt-5.4'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'
type ThemeMode = 'light' | 'dark'

function EmptyState(props: { title: string; description: string }) {
  const { title, description } = props
  return (
    <div className='empty-card'>
      <strong>{title}</strong>
      <p>{description}</p>
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

function buildEmptyCliStatus(client: CliClient): CliStatus {
  return {
    client,
    installed: false,
    version: '',
    executablePath: '',
    configPath: '',
    dataPath: '',
    hasConfig: false,
    hasApiKey: false,
    hasDataDirectory: false,
    managedByDesktop: false,
  }
}

function sameCliStatus(left: CliStatus, right: CliStatus) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function notifyCliStatusChanged(_status: CliStatus) {}
function writeCachedCliStatus(_status: CliStatus) {}
function markPendingCliVerification(_client: CliClient) {}

function maskSecretText(value?: string) {
  if (!value) {
    return ''
  }
  return value.replace(/sk-[A-Za-z0-9_\-]{8,}/g, (match) => match.slice(0, 6) + '...' + match.slice(-4))
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

export function AiChatProviderSettingsCard(props: {
  config: AiChatProviderConfig
  providerState: AiChatProviderState
  toast: (message: string) => void
  onChange: (updater: (current: AiChatProviderConfig) => AiChatProviderConfig) => void
}) {
  const { config, providerState, toast, onChange } = props
  const [testing, setTesting] = useState(false)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const providerStatus =
    providerState.mode === 'custom'
      ? '当前 AIChat 与 Image 使用自定义 API 通道'
      : providerState.mode === 'oneapi'
        ? '当前 AIChat 与 Image 使用 OneAPI 服务'
        : '请登录 OneAPI 或配置自定义 API 通道'

  async function handleTestCustomProvider() {
    try {
      setTesting(true)
      const baseUrl = normalizeOpenAICompatibleBaseUrl(config.customBaseUrl)
      const apiKey = config.customApiKey.trim()
      if (!baseUrl || !apiKey) {
        throw new Error('请先填写 Base URL 和 API Key。')
      }
      const models = await listCustomAiChatProviderModels({
        mode: 'custom',
        baseUrl,
        apiKey,
        defaultModel: config.customDefaultModel,
        models: config.customModels,
      })
      onChange((current) => ({
        ...current,
        customBaseUrl: baseUrl,
        customApiKey: apiKey,
        customModels: models,
        customDefaultModel: current.customDefaultModel || models[0] || '',
      }))
      toast(models.length ? `连接成功，已读取 ${models.length} 个模型。` : '连接成功，但服务未返回模型列表。')
    } catch (error) {
      toast(error instanceof Error ? error.message : '自定义 API 连接失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className='panel-block aichat-provider-card'>
      <div className='list-block-header'>
        <strong>AIChat 服务通道</strong>
        <small>{providerStatus}</small>
      </div>
      <div className='subrecords'>
        <label className='record-row provider-toggle-row'>
          <div>
            <strong>使用自定义 API 中转</strong>
            <span>兼容 OpenAI `/v1/chat/completions`、`/v1/images/generations` 和 `/v1/models`。</span>
          </div>
          <input
            type='checkbox'
            checked={config.customEnabled}
            onChange={(event) => onChange((current) => ({ ...current, customEnabled: event.target.checked }))}
          />
        </label>
        <div className='provider-form-grid'>
          <div className='provider-credential-row'>
            <label>
              <span>Base URL</span>
              <input
                value={config.customBaseUrl}
                onChange={(event) => onChange((current) => ({ ...current, customBaseUrl: event.target.value }))}
                placeholder='https://api.example.com/v1'
              />
            </label>
            <label>
              <span>API Key</span>
              <div className='inline-fields'>
                <input
                  type={apiKeyVisible ? 'text' : 'password'}
                  value={config.customApiKey}
                  onChange={(event) => onChange((current) => ({ ...current, customApiKey: event.target.value }))}
                  placeholder='sk-...'
                />
                <button
                  className='ghost-button icon-only tiny'
                  type='button'
                  onClick={() => setApiKeyVisible((current) => !current)}
                  title={apiKeyVisible ? '隐藏 Key' : '显示 Key'}
                  aria-label={apiKeyVisible ? '隐藏 Key' : '显示 Key'}
                >
                  {apiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>
        </div>
        <div className='record-row provider-model-row'>
          <div>
            <strong>模型列表</strong>
            <span>{config.customModels.length ? config.customModels.join(' · ') : '点击刷新后会尝试自动读取。'}</span>
          </div>
          <button className='ghost-button icon-only tiny provider-model-refresh' type='button' disabled={testing} onClick={() => void handleTestCustomProvider()} title={testing ? '刷新中' : '刷新模型'} aria-label={testing ? '刷新中' : '刷新模型'}>
            {testing ? <LoaderCircle className='spin' size={14} /> : <RotateCcw size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MeAnonymousWorkspace(props: {
  toast: (message: string) => void
  themeMode: ThemeMode
  onToggleTheme: () => void
  visible: boolean
  providerConfig: AiChatProviderConfig
  providerState: AiChatProviderState
  onProviderConfigChange: (updater: (current: AiChatProviderConfig) => AiChatProviderConfig) => void
}) {
  const { toast, themeMode, onToggleTheme, visible, providerConfig, providerState, onProviderConfigChange } = props
  return (
    <section className={`workspace-page full-bleed-page ${visible ? '' : 'workspace-hidden'}`}>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <h2>环境部署</h2>
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
              <div className='anonymous-mode-note'>
                <div className='subrecords'>
                  <div className='record-row highlighted'>
                    <div>
                      <strong>未登录模式</strong>
                      <span>可以配置自己的 OpenAI 兼容 API 使用 AIChat 与 Image；套餐购买、账单、App 互联需要登录 OneAPI。</span>
                    </div>
                  </div>
                </div>
              </div>
              <AiChatProviderSettingsCard
                config={providerConfig}
                providerState={providerState}
                toast={toast}
                onChange={onProviderConfigChange}
              />
            </div>
            <div className='me-column me-column-right anonymous-cli-column'>
              <div className='cli-setup-grid'>
                <CliSetupCard
                  client='claude'
                  user={null}
                  providerState={providerState}
                  toast={toast}
                  className='me-claude-card'
                  activeDeployClient={null}
                  setActiveDeployClient={() => undefined}
                  activeApiKey={null}
                />
                <CliSetupCard
                  client='codex'
                  user={null}
                  providerState={providerState}
                  toast={toast}
                  className='me-codex-card'
                  activeDeployClient={null}
                  setActiveDeployClient={() => undefined}
                  activeApiKey={null}
                />
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  )
}

export function MeWorkspace(props: {
  user: UserProfile | null
  toast: (message: string) => void
  themeMode: ThemeMode
  onToggleTheme: () => void
  visible: boolean
  providerConfig: AiChatProviderConfig
  providerState: AiChatProviderState
  onProviderConfigChange: (updater: (current: AiChatProviderConfig) => AiChatProviderConfig) => void
  onRequestLogin: () => void
  onActiveApiKeyChange: (apiKey: ActiveDesktopApiKeySummary) => void
}) {
  const { user, toast, themeMode, onToggleTheme, visible, providerConfig, providerState, onProviderConfigChange, onActiveApiKeyChange } = props
  useEffect(() => {
    if (!user) {
      onActiveApiKeyChange(null)
    }
  }, [onActiveApiKeyChange, user])

  if (!user) {
    return (
      <MeAnonymousWorkspace
        toast={toast}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        visible={visible}
        providerConfig={providerConfig}
        providerState={providerState}
        onProviderConfigChange={onProviderConfigChange}
      />
    )
  }
  return (
    <MeAuthenticatedWorkspace
      user={user}
      toast={toast}
      themeMode={themeMode}
      onToggleTheme={onToggleTheme}
      visible={visible}
      providerConfig={providerConfig}
      providerState={providerState}
      onProviderConfigChange={onProviderConfigChange}
      onActiveApiKeyChange={onActiveApiKeyChange}
    />
  )
}

export function MeAuthenticatedWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
  themeMode: ThemeMode
  onToggleTheme: () => void
  visible: boolean
  providerConfig: AiChatProviderConfig
  providerState: AiChatProviderState
  onProviderConfigChange: (updater: (current: AiChatProviderConfig) => AiChatProviderConfig) => void
  onActiveApiKeyChange: (apiKey: ActiveDesktopApiKeySummary) => void
}) {
  const { user, toast, themeMode, onToggleTheme, visible, providerConfig, providerState, onProviderConfigChange, onActiveApiKeyChange } = props
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
  const [passwordGatePurpose, setPasswordGatePurpose] = useState<'view-key' | 'create-key'>('view-key')
  const [passwordInput, setPasswordInput] = useState('')
  const [pendingKeyId, setPendingKeyId] = useState<number | null>(null)
  const [revealedKey, setRevealedKey] = useState('')
  const [activeDeployClient, setActiveDeployClient] = useState<CliClient | null>(null)
  const [mobileBridgeDevice, setMobileBridgeDevice] = useState<MobileDesktopDevice | null>(null)
  const [mobileBridgeLoading, setMobileBridgeLoading] = useState(false)
  const selectedApiKeyStorageKey = useMemo(() => getSelectedDesktopApiKeyStorageKey(user.id), [user.id])
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<number | null>(() =>
    readJsonStorage<number | null>(selectedApiKeyStorageKey, null)
  )
  const [updatingApiKeyId, setUpdatingApiKeyId] = useState<number | null>(null)
  const selectedActiveApiKey = useMemo(
    () => resolveActiveDesktopApiKeySummary(apiKeys, selectedApiKeyId),
    [apiKeys, selectedApiKeyId]
  )

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

  const persistSelectedApiKeyId = useCallback((nextId: number | null) => {
    if (nextId) {
      writeJsonStorage(selectedApiKeyStorageKey, nextId)
    } else {
      removeStorage(selectedApiKeyStorageKey)
    }
    setSelectedApiKeyId(nextId)
  }, [selectedApiKeyStorageKey])

  useEffect(() => {
    setSelectedApiKeyId((current) => {
      const resolved = resolveSelectedDesktopApiKeyId(apiKeys, current)
      if (resolved) {
        writeJsonStorage(selectedApiKeyStorageKey, resolved)
      } else {
        removeStorage(selectedApiKeyStorageKey)
      }
      return resolved
    })
  }, [apiKeys, selectedApiKeyStorageKey])

  useEffect(() => {
    onActiveApiKeyChange(selectedActiveApiKey)
  }, [onActiveApiKeyChange, selectedActiveApiKey])

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
        const result = await ensureDesktopServiceKey({
          name: resolveNextClientKeyName(apiKeys),
          group: user.group || '',
          preferredNames: apiKeys.map((item) => item.name),
        })
        persistSelectedApiKeyId(result.id)
        setRevealedKey(result.key)
        toast(result.reused ? '已复用服务器现有有效 Key。' : '新的 API Key 已创建。')
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

  async function handleToggleApiKey(item: { id: number; status: number }) {
    if (updatingApiKeyId) {
      return
    }

    const isEnabled = item.status === API_KEY_STATUS_ENABLED
    const isCurrent = selectedActiveApiKey?.id === item.id

    if (isEnabled && !isCurrent) {
      persistSelectedApiKeyId(item.id)
      toast('已切换当前 CLI 使用的 Key。')
      return
    }

    setUpdatingApiKeyId(item.id)
    try {
      if (isEnabled) {
        setApiKeys((current) =>
          current.map((key) =>
            key.id === item.id ? { ...key, status: API_KEY_STATUS_DISABLED } : key
          )
        )
        persistSelectedApiKeyId(null)
        await updateApiKeyStatus(item.id, API_KEY_STATUS_DISABLED)
        toast('该 Key 已关闭，CLI 请求不会再使用它。')
        await refreshMe()
        return
      }

      persistSelectedApiKeyId(item.id)
      setApiKeys((current) =>
        current.map((key) =>
          key.id === item.id ? { ...key, status: API_KEY_STATUS_ENABLED } : key
        )
      )
      await updateApiKeyStatus(item.id, API_KEY_STATUS_ENABLED)
      toast('已切换当前 CLI 使用的 Key。')
      await refreshMe()
    } catch (error) {
      toast(error instanceof Error ? error.message : '更新 Key 状态失败')
      await refreshMe().catch(() => undefined)
    } finally {
      setUpdatingApiKeyId(null)
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
                <AiChatProviderSettingsCard
                  config={providerConfig}
                  providerState={providerState}
                  toast={toast}
                  onChange={onProviderConfigChange}
                />

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
                    <div className='header-actions'>
                      <button
                        className='ghost-button tiny'
                        type='button'
                        onClick={() => void refreshMe().catch((error) => {
                          toast(error instanceof Error ? error.message : '刷新 Key 列表失败')
                        })}
                        title='刷新 Key 列表'
                      >
                        <RefreshCw size={14} />
                        <span>刷新</span>
                      </button>
                      <button
                        className='secondary-button tiny'
                        type='button'
                        onClick={() => openPasswordGate('create-key')}
                      >
                        <Plus size={14} />
                        <span>新建 Key</span>
                      </button>
                    </div>
                  </div>
                  <div className='subrecords'>
                    {apiKeys.length === 0 ? (
                      <EmptyState title='当前还没有 API Key' description='验证密码后即可直接新建桌面端专用 Key。' />
                    ) : (
                      <div className='me-key-grid'>
                        {apiKeys.map((item) => {
                          const isActive = item.status === API_KEY_STATUS_ENABLED
                          const isCurrent = selectedActiveApiKey?.id === item.id
                          return (
                          <div key={item.id} className={`record-row me-key-record ${isActive ? 'enabled-key' : ''} ${isCurrent ? 'current-key' : ''}`}>
                            <div className='me-key-record-line me-key-record-primary'>
                              <div className='me-key-title-line'>
                                <strong>{item.name}</strong>
                                <small>{item.group || 'default'}</small>
                              </div>
                              <button
                                className={`key-status-switch ${isActive ? 'enabled' : ''} ${isCurrent ? 'current' : ''}`}
                                type='button'
                                role='switch'
                                aria-checked={isCurrent}
                                disabled={updatingApiKeyId === item.id}
                                onClick={() => void handleToggleApiKey(item)}
                                title={isActive ? (isCurrent ? '关闭该 Key' : '切换为当前 CLI 使用的 Key') : '启用该 Key'}
                              >
                                <span className='switch-track-dot' />
                                <small>{isActive ? (isCurrent ? '使用中' : '可用') : '已停用'}</small>
                              </button>
                            </div>
                            <div className='me-key-record-line me-key-record-secondary'>
                              <span>创建于 {formatDateTime(item.created_time)}</span>
                              <button
                                className='ghost-button key-view-button'
                                type='button'
                                title='查看 Key'
                                aria-label='查看 Key'
                                onClick={() => openPasswordGate('view-key', item.id)}
                              >
                                <Eye size={14} />
                                <span>查看</span>
                              </button>
                            </div>
                          </div>
                          )
                        })}
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
                  providerState={providerState}
                  toast={toast}
                  className='me-claude-card'
                  activeDeployClient={activeDeployClient}
                  setActiveDeployClient={setActiveDeployClient}
                  activeApiKey={selectedActiveApiKey}
                />
                <CliSetupCard
                  client='codex'
                  user={user}
                  providerState={providerState}
                  toast={toast}
                  className='me-codex-card'
                  activeDeployClient={activeDeployClient}
                  setActiveDeployClient={setActiveDeployClient}
                  activeApiKey={selectedActiveApiKey}
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


export function CliSetupCard(props: {
  client: CliClient
  user: UserProfile | null
  providerState: AiChatProviderState
  toast: (message: string) => void
  className?: string
  activeDeployClient: CliClient | null
  setActiveDeployClient: Dispatch<SetStateAction<CliClient | null>>
  activeApiKey: ActiveDesktopApiKeySummary
}) {
  const { client, user, providerState, toast, className, activeDeployClient, setActiveDeployClient, activeApiKey } = props
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
      const useCustomProvider = providerState.mode === 'custom'
      if (!useCustomProvider && !user) {
        throw new Error('请先登录 OneAPI，或在 AIChat 服务通道中配置自定义 API。')
      }
      const activeApiKeySecret = useCustomProvider ? '' : await (async () => {
        if (!activeApiKey?.id) {
          throw new Error('请先在已有 Key 中启用一个 Key，再执行一键部署。')
        }
        return fetchApiKeySecret(activeApiKey.id)
      })()
      const defaultModel = client === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL
      const activeKeyDeployModel = useCustomProvider
        ? ''
        : resolveCliDeployModelForActiveKey(
            client,
            await refreshOneApiModelsForActiveKey(activeApiKey),
            defaultModel,
            preset?.model
          )
      if (!useCustomProvider && !activeKeyDeployModel) {
        throw new Error(
          client === 'codex'
            ? '当前启用 Key 没有可用于 Codex 的模型，请切换 Key 或修复服务器 Codex 渠道。'
            : '当前启用 Key 没有可用于 Claude 的模型，请切换 Key 或修复服务器 Claude 渠道。'
        )
      }
      const resolvedDeploySettings = useCustomProvider
        ? {
            apiKey: providerState.apiKey,
            baseUrl: client === 'codex'
              ? normalizeOpenAICompatibleBaseUrl(providerState.baseUrl)
              : providerState.baseUrl.replace(/\/v1$/i, ''),
            model: providerState.defaultModel || defaultModel,
            apiKeySource: 'custom' as const,
          }
        : {
            ...resolveCliDeploySettings({
              preset,
              generatedApiKey: activeApiKeySecret,
              defaultBaseUrl: client === 'codex' ? DEFAULT_CODEX_BASE_URL : DEFAULT_CLAUDE_BASE_URL,
              defaultModel: activeKeyDeployModel,
            }),
            model: activeKeyDeployModel,
            apiKeySource: 'oneapi' as const,
          }
      await deployCli({
        client,
        apiKey: resolvedDeploySettings.apiKey,
        apiKeySource: resolvedDeploySettings.apiKeySource,
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

