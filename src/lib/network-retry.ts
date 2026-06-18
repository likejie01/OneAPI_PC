export function isRecoverableNetworkError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  const normalized = message.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return (
    normalized.includes('fetch failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('网络') ||
    normalized.includes('离线') ||
    normalized.includes('断开')
  )
}
