import type { UserProfile } from '../shared/contracts'

export type AiChatProviderMode = 'oneapi' | 'custom' | 'unavailable'

export interface AiChatProviderConfig {
  customEnabled: boolean
  customBaseUrl: string
  customApiKey: string
  customDefaultModel: string
  customModels: string[]
}

export interface AiChatProviderState {
  mode: AiChatProviderMode
  baseUrl: string
  apiKey: string
  defaultModel: string
  models: string[]
  reason?: string
}

export const AI_CHAT_PROVIDER_STORAGE_KEY = 'oneapi-desktop-aichat-provider-config'

export const DEFAULT_AI_CHAT_PROVIDER_CONFIG: AiChatProviderConfig = {
  customEnabled: false,
  customBaseUrl: '',
  customApiKey: '',
  customDefaultModel: '',
  customModels: [],
}

export function normalizeOpenAICompatibleBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, '')
  if (!normalized) {
    return ''
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Base URL 必须以 http:// 或 https:// 开头。')
  }
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`
}

export function normalizeAiChatProviderConfig(input?: Partial<AiChatProviderConfig> | null): AiChatProviderConfig {
  const customModels = Array.isArray(input?.customModels)
    ? Array.from(
        new Set(
          input.customModels
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      )
    : []

  return {
    customEnabled: input?.customEnabled === true,
    customBaseUrl: String(input?.customBaseUrl || '').trim(),
    customApiKey: String(input?.customApiKey || '').trim(),
    customDefaultModel: String(input?.customDefaultModel || '').trim(),
    customModels,
  }
}

export function hasUsableCustomAiChatProvider(config: AiChatProviderConfig) {
  if (!config.customEnabled) {
    return false
  }
  if (!config.customApiKey.trim() || !config.customBaseUrl.trim()) {
    return false
  }
  try {
    normalizeOpenAICompatibleBaseUrl(config.customBaseUrl)
    return true
  } catch {
    return false
  }
}

export function resolveAiChatProviderState(
  config: AiChatProviderConfig,
  user: UserProfile | null | undefined
): AiChatProviderState {
  if (hasUsableCustomAiChatProvider(config)) {
    return {
      mode: 'custom',
      baseUrl: normalizeOpenAICompatibleBaseUrl(config.customBaseUrl),
      apiKey: config.customApiKey.trim(),
      defaultModel: config.customDefaultModel.trim(),
      models: config.customModels,
    }
  }

  if (user?.id) {
    return {
      mode: 'oneapi',
      baseUrl: '',
      apiKey: '',
      defaultModel: '',
      models: [],
    }
  }

  return {
    mode: 'unavailable',
    baseUrl: '',
    apiKey: '',
    defaultModel: '',
    models: [],
    reason: '请先登录 OneAPI 或配置自定义 API 通道。',
  }
}

export function isOneApiBridgeOnlyCliModel(model: string) {
  const normalized = model.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return (
    normalized.includes('deepseek') ||
    normalized.includes('mimo') ||
    normalized.includes('xiaomi')
  )
}

export function shouldDisableCliModelForProvider(model: string, providerMode: AiChatProviderMode) {
  void model
  void providerMode
  return false
}
