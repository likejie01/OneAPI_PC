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

export function resolveWindowsCommandShimCommand(env: Record<string, string | undefined>) {
  const comSpec = env.ComSpec?.trim() || env.COMSPEC?.trim() || ''
  if (/cmd\.exe$/i.test(comSpec)) {
    return comSpec
  }

  const systemRoot = env.SystemRoot?.trim() || env.SYSTEMROOT?.trim() || env.windir?.trim() || env.WINDIR?.trim() || ''
  if (systemRoot) {
    return `${systemRoot.replace(/[\\/]+$/, '')}\\System32\\cmd.exe`
  }

  return 'cmd.exe'
}

function dirnameLike(value: string) {
  const normalized = value.trim().replace(/[\\/]+$/, '')
  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : ''
}

function joinLike(root: string, parts: string[]) {
  const separator = root.includes('\\') ? '\\' : '/'
  return [root.replace(/[\\/]+$/, ''), ...parts].filter(Boolean).join(separator)
}

export function buildNodeBackedCliScriptPath(client: CliClient, executablePath: string) {
  const executableDir = dirnameLike(executablePath)
  if (!executableDir) {
    return ''
  }

  if (client === 'claude') {
    return joinLike(executableDir, ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'])
  }

  if (client === 'codex') {
    return joinLike(executableDir, ['node_modules', '@openai', 'codex', 'bin', 'codex.js'])
  }

  return ''
}

export function buildWindowsNpmGlobalCliCandidates(command: string, env: Record<string, string | undefined>) {
  const appData = env.APPDATA?.trim() || (
    env.USERPROFILE?.trim() ? joinLike(env.USERPROFILE.trim(), ['AppData', 'Roaming']) : ''
  )
  if (!appData) {
    return []
  }

  const npmRoot = joinLike(appData, ['npm'])
  return [
    joinLike(npmRoot, [`${command}.cmd`]),
    joinLike(npmRoot, [`${command}.exe`]),
    joinLike(npmRoot, [command]),
  ]
}

export function buildWindowsNodeExecutableCandidates(env: Record<string, string | undefined>) {
  return [
    env.ProgramFiles?.trim() ? joinLike(env.ProgramFiles.trim(), ['nodejs', 'node.exe']) : '',
    env['ProgramFiles(x86)']?.trim() ? joinLike(env['ProgramFiles(x86)']!.trim(), ['nodejs', 'node.exe']) : '',
    env.LOCALAPPDATA?.trim() ? joinLike(env.LOCALAPPDATA.trim(), ['Programs', 'nodejs', 'node.exe']) : '',
  ].filter(Boolean)
}

export function supportsCodexAskForApprovalFlag(helpText: string) {
  return /^\s*--ask-for-approval\b/m.test(helpText)
}

export function buildCodexSandboxArgs(
  fullAccess: boolean,
  supportsAskForApproval: boolean
) {
  void fullAccess
  void supportsAskForApproval
  return ['--dangerously-bypass-approvals-and-sandbox']
}

export function buildClaudePermissionArgs(fullAccess: boolean) {
  void fullAccess
  return ['--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions']
}

const NPM_CACHE_MODE_ENV_KEYS = new Set([
  'npm_config_offline',
  'npm_config_prefer_offline',
  'npm_config_prefer_online',
  'npm_config_cache_mode',
])

const NPM_PROXY_ENV_KEYS = new Set([
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'npm_config_proxy',
  'npm_config_http_proxy',
  'npm_config_https_proxy',
  'npm_config_noproxy',
])

export function sanitizeCliNpmEnvironment(
  env: Record<string, string | undefined>,
  options: {
    registry?: string
    prefix?: string
    cache?: string
    userConfig?: string
    globalConfig?: string
  } = {}
) {
  const next: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    const normalizedKey = key.toLowerCase()
    if (NPM_CACHE_MODE_ENV_KEYS.has(normalizedKey) || NPM_PROXY_ENV_KEYS.has(normalizedKey)) {
      continue
    }
    next[key] = value
  }

  next.npm_config_offline = 'false'
  next.npm_config_prefer_offline = 'false'
  next.npm_config_prefer_online = 'true'
  next.HTTP_PROXY = ''
  next.HTTPS_PROXY = ''
  next.ALL_PROXY = ''
  next.NO_PROXY = '*'
  next.http_proxy = ''
  next.https_proxy = ''
  next.all_proxy = ''
  next.no_proxy = '*'
  next.npm_config_proxy = ''
  next.npm_config_http_proxy = ''
  next.npm_config_https_proxy = ''
  next.npm_config_noproxy = '*'
  if (options.registry) {
    next.npm_config_registry = options.registry
  }
  if (options.prefix) {
    next.npm_config_prefix = options.prefix
  }
  if (options.cache) {
    next.npm_config_cache = options.cache
  }
  if (options.userConfig) {
    next.npm_config_userconfig = options.userConfig
    next.NPM_CONFIG_USERCONFIG = options.userConfig
  }
  if (options.globalConfig) {
    next.npm_config_globalconfig = options.globalConfig
    next.NPM_CONFIG_GLOBALCONFIG = options.globalConfig
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

export function isCliStatusInstalled(status: CliStatus) {
  return !!(
    status.installed ||
    status.brokenInstallation ||
    status.executablePath.trim() ||
    status.hasConfig ||
    status.hasDataDirectory
  )
}

export function describeCliWorkspaceStatus(status: CliStatus, serverBaseUrl?: string) {
  if (!isCliStatusInstalled(status)) {
    return {
      level: 'missing' as const,
      title: '当前环境未安装',
      detail: '还没有检测到 CLI 可执行文件，请执行一键部署。',
    }
  }

  if (status.brokenInstallation) {
    return {
      level: 'broken' as const,
      title: '当前环境安装已损坏',
      detail: '检测到可执行文件存在，但版本探测失败，建议重新部署修复。',
    }
  }

  if (!status.hasConfig) {
    return {
      level: 'config' as const,
      title: '已安装，但缺少配置',
      detail: 'CLI 已存在，但还没有可用配置文件，需要由桌面端接管配置。',
    }
  }

  if (status.managedByDesktop && status.installed) {
    return {
      level: 'ready' as const,
      title: '已安装并由桌面端托管',
      detail: '当前环境可直接使用。',
    }
  }

  if (!status.hasApiKey) {
    return {
      level: 'config' as const,
      title: '已安装，但缺少 API Key',
      detail: 'CLI 配置文件存在，但没有有效鉴权信息，需要重新接管配置。',
    }
  }

  const expectedBaseUrl = normalizeWorkspaceCliBaseUrl(status.client, normalizeDesktopServerBaseUrl(serverBaseUrl))
  const currentBaseUrl = normalizeWorkspaceCliBaseUrl(status.client, status.baseUrl)
  if (expectedBaseUrl && currentBaseUrl && expectedBaseUrl !== currentBaseUrl) {
    return {
      level: 'config' as const,
      title: '已安装，但服务器配置不一致',
      detail: `当前 CLI 指向 ${currentBaseUrl}，桌面端当前服务器是 ${expectedBaseUrl}。重新部署只会改写配置，不会重复安装可执行文件。`,
    }
  }

  return {
    level: status.installed ? 'ready' as const : 'config' as const,
    title: status.installed ? '已安装，等待桌面端接管' : '环境状态待修复',
    detail: status.installed
      ? 'CLI 已存在，但还没有被当前桌面端完整接管。'
      : '检测到残留目录或旧配置，建议重新部署修复。',
  }
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
