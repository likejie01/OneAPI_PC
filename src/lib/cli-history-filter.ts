export function isClaudeAssistantTerminalMessage(input: {
  role?: string
  stopReason?: unknown
  isApiErrorMessage?: boolean
}) {
  if (input.role !== 'assistant') {
    return false
  }

  if (input.isApiErrorMessage) {
    return true
  }

  return typeof input.stopReason === 'string' && input.stopReason.trim().length > 0
}
