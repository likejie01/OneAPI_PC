export const IMAGE_REQUEST_TIMEOUT_MS = 10 * 60_000

export function resolveDesktopRequestTimeoutMs(path: string) {
  const normalized = path.trim().toLowerCase()
  if (
    normalized === '/pg/images/generations' ||
    normalized === '/v1/images/generations' ||
    normalized === '/v1/images/edits'
  ) {
    return IMAGE_REQUEST_TIMEOUT_MS
  }
  return 0
}

export function formatDesktopRequestTimeoutMessage(timeoutMs: number) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000))
  return `请求超时（${seconds}s）`
}
