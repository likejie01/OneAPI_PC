export function isDraftCliSessionId(sessionId?: string | null) {
  const normalized = sessionId?.trim() ?? ''
  return normalized.startsWith('draft-codex-') || normalized.startsWith('draft-claude-')
}

export function getCliResumeSessionId(sessionId?: string | null) {
  const normalized = sessionId?.trim() ?? ''
  if (!normalized || isDraftCliSessionId(normalized)) {
    return undefined
  }
  return normalized
}

export function shouldAppendCliAssistantFallback(input: {
  responseSessionId?: string | null
  responseAborted: boolean
  hydratedSessionId?: string | null
}) {
  if (input.responseAborted) {
    return true
  }

  const responseSessionId = getCliResumeSessionId(input.responseSessionId)
  if (!responseSessionId) {
    return true
  }

  return getCliResumeSessionId(input.hydratedSessionId) !== responseSessionId
}
