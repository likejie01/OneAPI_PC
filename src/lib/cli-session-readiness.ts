import type { CliSessionDetails } from '../shared/desktop.ts'

function normalizeTimestampMs(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return 0
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
}

export function isCliSessionReadyForLatestTurn(
  details: CliSessionDetails,
  options: {
    expectedUserContent?: string
    minUpdatedAtMs?: number
    normalizeUserContent: (value: string) => string
  }
) {
  if (!details.messages.length) {
    return false
  }

  const normalizedExpected = options.normalizeUserContent(options.expectedUserContent || '')
  if (!normalizedExpected) {
    return true
  }

  const recentMessages = details.messages.slice(-12)
  const matchedUserIndex = recentMessages.findLastIndex(
    (item) =>
      item.role === 'user' &&
      options.normalizeUserContent(item.content) === normalizedExpected
  )

  if (matchedUserIndex < 0) {
    return false
  }

  const matchedUser = recentMessages[matchedUserIndex]
  const matchedUserAtMs = normalizeTimestampMs(matchedUser.createdAt)
  const sessionUpdatedAtMs = normalizeTimestampMs(details.updatedAt)

  if (options.minUpdatedAtMs) {
    const freshnessMs = Math.max(matchedUserAtMs, sessionUpdatedAtMs)
    if (freshnessMs < options.minUpdatedAtMs - 10_000) {
      return false
    }
  }

  return recentMessages
    .slice(matchedUserIndex + 1)
    .some((item) => item.role === 'assistant')
}
