import type { ApiKeyRecord } from '../shared/contracts'
import type { CliClient } from '../shared/desktop'

type ApiKeyCandidate = Pick<ApiKeyRecord, 'id' | 'name' | 'status' | 'group' | 'created_time'>

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
