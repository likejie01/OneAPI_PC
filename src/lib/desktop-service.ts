import type { ApiKeyRecord } from '../shared/contracts'
import type { CliClient, CliStatus } from '../shared/desktop'

type ApiKeyCandidate = Pick<ApiKeyRecord, 'id' | 'name' | 'status' | 'group' | 'created_time'>

export const MIN_DESKTOP_CLI_NODE_MAJOR = 18

export function parseNodeMajorVersion(version: string) {
  const matched = version.trim().match(/^v?(\d+)(?:\.|$)/i)
  return matched ? Number.parseInt(matched[1], 10) : null
}

export function isDesktopCliNodeVersionSupported(version: string) {
  const major = parseNodeMajorVersion(version)
  return typeof major === 'number' && Number.isFinite(major) && major >= MIN_DESKTOP_CLI_NODE_MAJOR
}

export function resolveCliProbeResult(input: {
  executablePath: string
  version: string
  versionExitCode?: number | null
}) {
  const hasExecutable = input.executablePath.trim().length > 0
  const probeSucceeded = hasExecutable && input.versionExitCode === 0

  return {
    installed: probeSucceeded,
    version: input.version.trim(),
    brokenInstallation: hasExecutable && !probeSucceeded,
  }
}

export function shouldUseWindowsCommandShimForPath(command: string, platform = 'unknown') {
  if (platform !== 'win32') {
    return false
  }

  const normalized = command.trim().replace(/[/\\]+/g, '/').toLowerCase()
  const baseName = normalized.split('/').pop() || normalized
  if (baseName.endsWith('.cmd') || baseName.endsWith('.bat')) {
    return true
  }

  return baseName === 'codex' || baseName === 'claude' || baseName === 'npm' || baseName === 'npx'
}

export function quoteWindowsCommandArg(arg: string) {
  if (arg.length === 0) {
    return '""'
  }

  const escaped = arg.replace(/%/g, '%%').replace(/"/g, '""')
  return /[\s"&()<>^|]/.test(escaped) ? `"${escaped}"` : escaped
}

export function buildWindowsCommandShimArgs(command: string, args: string[]) {
  return [
    '/d',
    '/c',
    ['call', command, ...args].map(quoteWindowsCommandArg).join(' '),
  ]
}

const NPM_CACHE_MODE_ENV_KEYS = new Set([
  'npm_config_offline',
  'npm_config_prefer_offline',
  'npm_config_prefer_online',
  'npm_config_cache_mode',
])

export function sanitizeCliNpmEnvironment(
  env: Record<string, string | undefined>,
  options: {
    registry?: string
    prefix?: string
    cache?: string
  } = {}
) {
  const next: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (NPM_CACHE_MODE_ENV_KEYS.has(key.toLowerCase())) {
      continue
    }
    next[key] = value
  }

  next.npm_config_offline = 'false'
  next.npm_config_prefer_offline = 'false'
  next.npm_config_prefer_online = 'true'
  if (options.registry) {
    next.npm_config_registry = options.registry
  }
  if (options.prefix) {
    next.npm_config_prefix = options.prefix
  }
  if (options.cache) {
    next.npm_config_cache = options.cache
  }

  return next
}

function normalizeDesktopServerBaseUrl(serverBaseUrl?: string) {
  const normalized = (serverBaseUrl || '').trim().replace(/\/+$/, '')
  return normalized || 'https://ai.oneapi.center'
}

function normalizeWorkspaceCliBaseUrl(client: CliClient, baseUrl?: string) {
  const normalized = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!normalized) {
    return ''
  }
  return client === 'codex'
    ? normalized.toLowerCase().endsWith('/v1')
      ? normalized
      : `${normalized}/v1`
    : normalized
}

export function isCliStatusReadyForWorkspace(status: CliStatus, serverBaseUrl?: string) {
  if (!status.installed || !status.hasConfig) {
    return false
  }

  if (status.managedByDesktop) {
    return true
  }

  if (!status.hasApiKey) {
    return false
  }

  const expectedBaseUrl = normalizeWorkspaceCliBaseUrl(status.client, normalizeDesktopServerBaseUrl(serverBaseUrl))
  const currentBaseUrl = normalizeWorkspaceCliBaseUrl(status.client, status.baseUrl)
  return !!expectedBaseUrl && currentBaseUrl === expectedBaseUrl
}

export function selectReusableDesktopApiKey(
  keys: ApiKeyCandidate[],
  options: {
    group?: string
    preferredNames?: string[]
  } = {}
) {
  const preferredNames = new Set(
    (options.preferredNames || []).map((item) => item.trim()).filter(Boolean)
  )
  const group = (options.group || '').trim()
  const activeKeys = keys.filter((item) => item.status === 1)
  const source = activeKeys.length > 0 ? activeKeys : keys

  const ranked = [...source].sort((left, right) => {
    const leftPreferred = preferredNames.has(left.name) ? 1 : 0
    const rightPreferred = preferredNames.has(right.name) ? 1 : 0
    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred
    }

    const leftGroupMatch = group && left.group === group ? 1 : 0
    const rightGroupMatch = group && right.group === group ? 1 : 0
    if (leftGroupMatch !== rightGroupMatch) {
      return rightGroupMatch - leftGroupMatch
    }

    return (right.created_time || 0) - (left.created_time || 0)
  })

  return ranked[0] || null
}

export function resolveCliSetupPeerState(
  cardClient: CliClient,
  activeDeployClient: CliClient | null
) {
  const isActiveDeploy = activeDeployClient === cardClient
  const isPeerDeploying = !!activeDeployClient && activeDeployClient !== cardClient

  return {
    isActiveDeploy,
    isPeerDeploying,
    disableDeployButton: !!activeDeployClient && activeDeployClient !== cardClient,
    showDeployPlaceholder: !isPeerDeploying,
  }
}
