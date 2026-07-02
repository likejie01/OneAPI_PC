const OFFICIAL_SERVER_BASE_URL = 'https://ai.oneapi.center'

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

type ViteImportMeta = ImportMeta & {
  env?: Record<string, string | undefined>
}

function readViteEnv(key: string) {
  return (import.meta as ViteImportMeta).env?.[key] || ''
}

export const DEFAULT_SERVER_BASE_URL =
  normalizeBaseUrl(readViteEnv('VITE_ONEAPI_SERVER_BASE_URL') || OFFICIAL_SERVER_BASE_URL)

export const DEFAULT_CODEX_BASE_URL =
  normalizeBaseUrl(readViteEnv('VITE_ONEAPI_CODEX_BASE_URL') || `${DEFAULT_SERVER_BASE_URL}/v1`)

export const DEFAULT_CLAUDE_BASE_URL =
  normalizeBaseUrl(readViteEnv('VITE_ONEAPI_CLAUDE_BASE_URL') || DEFAULT_SERVER_BASE_URL)
