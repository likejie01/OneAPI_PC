export function normalizeClaudeApiKey(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith('sk-') ? trimmed : `sk-${trimmed}`
}

export function normalizeClaudeApiKeyForSource(value: string, apiKeySource?: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return apiKeySource === 'custom' ? trimmed : normalizeClaudeApiKey(trimmed)
}

export function pickClaudeApiKeyFromUnknown(input: unknown) {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const source = input as Record<string, unknown>
  return typeof source.ANTHROPIC_API_KEY === 'string' ? source.ANTHROPIC_API_KEY.trim() : ''
}

export function pickClaudeBaseUrlFromUnknown(input: unknown) {
  if (!input || typeof input !== 'object') {
    return ''
  }

  const source = input as Record<string, unknown>
  return typeof source.ANTHROPIC_BASE_URL === 'string' ? source.ANTHROPIC_BASE_URL.trim() : ''
}

export function resolveClaudeDesktopEnv(input: {
  currentEnv?: Record<string, string>
  authDocument?: unknown
  fallbackApiKey?: string
  defaultBaseUrl: string
}) {
  const currentEnv = input.currentEnv || {}
  const currentApiKey = pickClaudeApiKeyFromUnknown(currentEnv)
  const authApiKey = pickClaudeApiKeyFromUnknown(input.authDocument)
  const authSource =
    input.authDocument && typeof input.authDocument === 'object' && 'ONEAPI_API_KEY_SOURCE' in input.authDocument
      ? String((input.authDocument as Record<string, unknown>).ONEAPI_API_KEY_SOURCE || '').trim()
      : ''
  const apiKeySource = currentEnv.ONEAPI_API_KEY_SOURCE?.trim() || authSource
  const resolvedApiKey = normalizeClaudeApiKeyForSource(
    currentApiKey || input.fallbackApiKey || authApiKey,
    apiKeySource
  )
  const resolvedBaseUrl =
    currentEnv.ANTHROPIC_BASE_URL?.trim() ||
    pickClaudeBaseUrlFromUnknown(input.authDocument) ||
    input.defaultBaseUrl.trim()

  const nextEnv: Record<string, string> = {
    ...currentEnv,
  }
  delete nextEnv.ANTHROPIC_AUTH_TOKEN
  delete nextEnv.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN

  if (resolvedApiKey) {
    nextEnv.ANTHROPIC_API_KEY = resolvedApiKey
  }

  if (apiKeySource) {
    nextEnv.ONEAPI_API_KEY_SOURCE = apiKeySource
  }

  if (resolvedBaseUrl) {
    nextEnv.ANTHROPIC_BASE_URL = resolvedBaseUrl
  }

  return nextEnv
}
