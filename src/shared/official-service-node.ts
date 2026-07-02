const OFFICIAL_SERVER_BASE_URL = 'https://ai.oneapi.center'

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export const DEFAULT_SERVER_BASE_URL =
  normalizeBaseUrl(process.env.ONEAPI_SERVER_BASE_URL || OFFICIAL_SERVER_BASE_URL)

export const DEFAULT_CODEX_BASE_URL =
  normalizeBaseUrl(process.env.ONEAPI_CODEX_BASE_URL || `${DEFAULT_SERVER_BASE_URL}/v1`)

export const DEFAULT_CLAUDE_BASE_URL =
  normalizeBaseUrl(process.env.ONEAPI_CLAUDE_BASE_URL || DEFAULT_SERVER_BASE_URL)
