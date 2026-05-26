function normalizeDesktopVersionPart(value: string) {
  const match = value.match(/\d+/)
  return match ? Number.parseInt(match[0], 10) : 0
}

function normalizeDesktopUpdateBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }
  try {
    const target = new URL(trimmed)
    if (!/^https?:$/i.test(target.protocol)) {
      return ''
    }
    return target.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function buildDesktopUpdateBaseCandidates(currentServerBaseUrl: string, defaultServerBaseUrl: string) {
  return [
    currentServerBaseUrl,
    defaultServerBaseUrl,
  ]
    .map((value) => normalizeDesktopUpdateBaseUrl(value))
    .filter(Boolean)
}

export function resolveDesktopUpdateUrl(
  rawUrl: string,
  currentServerBaseUrl: string,
  defaultServerBaseUrl: string
) {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return ''
  }

  try {
    const target = new URL(trimmed)
    if (!/^https?:$/i.test(target.protocol)) {
      return ''
    }
    return target.toString()
  } catch {
    for (const baseUrl of buildDesktopUpdateBaseCandidates(currentServerBaseUrl, defaultServerBaseUrl)) {
      try {
        return new URL(trimmed, `${baseUrl}/`).toString()
      } catch {
        continue
      }
    }
    return ''
  }
}

export function resolveDesktopUpdateFeedUrl(installerUrl: string) {
  const trimmed = installerUrl.trim()
  if (!trimmed) {
    return ''
  }
  try {
    const target = new URL(trimmed)
    if (!/^https?:$/i.test(target.protocol)) {
      return ''
    }
    const pathname = target.pathname.replace(/\/+$/, '')
    const lastSlashIndex = pathname.lastIndexOf('/')
    if (lastSlashIndex <= 0) {
      return ''
    }
    target.pathname = pathname.slice(0, lastSlashIndex)
    target.search = ''
    target.hash = ''
    return target.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function compareDesktopVersions(currentVersion: string, nextVersion: string) {
  const currentParts = currentVersion.split('.').map(normalizeDesktopVersionPart)
  const nextParts = nextVersion.split('.').map(normalizeDesktopVersionPart)
  const maxLength = Math.max(currentParts.length, nextParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const left = currentParts[index] ?? 0
    const right = nextParts[index] ?? 0
    if (left === right) {
      continue
    }
    return left > right ? 1 : -1
  }

  return 0
}

export function buildDesktopReleaseManifestUrlCandidates(
  currentServerBaseUrl: string,
  defaultServerBaseUrl: string
) {
  const candidates = buildDesktopUpdateBaseCandidates(currentServerBaseUrl, defaultServerBaseUrl)

  return [...new Set(candidates)].map((baseUrl) => new URL('./api/download/desktop-release', `${baseUrl}/`).toString())
}

export function resolveDesktopUpdateStatusSummary(input: {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up_to_date' | 'error'
  message?: string
}) {
  if (input.status === 'up_to_date') {
    return '当前已是最新版。'
  }
  if (input.status === 'downloaded') {
    return '更新包已下载完成，点击“现在安装”开始安装。'
  }
  if (input.status === 'downloading') {
    return '发现新版本，正在自动下载更新包。'
  }
  if (input.status === 'checking') {
    return '正在检查最新版本信息...'
  }
  if (input.status === 'error') {
    const detail = input.message?.trim()
    return detail ? `检查更新失败：${detail}` : '检查更新失败，请稍后重试。'
  }
  if (input.status === 'available') {
    return '发现新版本，准备开始下载。'
  }
  return '点击“检查更新”获取最新版本。'
}

export function getDesktopUpdateDayKey(now: Date) {
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shouldAutoCheckDesktopUpdate(
  now: Date,
  minimumCheckHour: number,
  lastCheckedDayKey?: string | null
) {
  if (now.getHours() < minimumCheckHour) {
    return false
  }
  return getDesktopUpdateDayKey(now) !== (lastCheckedDayKey || '')
}
