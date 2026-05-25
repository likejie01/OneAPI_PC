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
  const candidates = [
    currentServerBaseUrl,
    defaultServerBaseUrl,
  ]
    .map((value) => normalizeDesktopUpdateBaseUrl(value))
    .filter(Boolean)

  return [...new Set(candidates)].map((baseUrl) => `${baseUrl}/api/download/desktop-release`)
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
