export type AssistantSwitchChatSessionLike = {
  assistantId: string
  model: string
  group: string
  updatedAt: number
  messages: Array<unknown>
}

export function shouldCreateAssistantSwitchChatSession(
  currentSession: AssistantSwitchChatSessionLike | null,
  nextAssistantId: string
) {
  if (!currentSession) {
    return true
  }

  if (currentSession.assistantId === nextAssistantId) {
    return false
  }

  return currentSession.messages.length > 0
}

export function applyAssistantSelectionToEmptyChatSession<T extends AssistantSwitchChatSessionLike>(
  session: T,
  nextAssistantId: string,
  nextModel: string,
  nextGroup: string,
  now = Date.now()
) {
  return {
    ...session,
    assistantId: nextAssistantId,
    model: nextModel,
    group: nextGroup,
    updatedAt: Math.max(now, session.updatedAt),
  }
}
