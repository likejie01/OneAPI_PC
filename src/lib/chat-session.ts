export type AssistantSwitchChatSessionLike = {
  assistantId: string
  model: string
  group: string
  updatedAt: number
  messages: Array<unknown>
}

export type ChatAssistantIdentity = {
  id: string
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

export function resolveChatSessionAssistant<T extends ChatAssistantIdentity>(
  assistants: T[],
  currentSession: { assistantId?: string | null } | null,
  fallbackAssistantId?: string | null
) {
  const sessionAssistant = currentSession?.assistantId
    ? assistants.find((item) => item.id === currentSession.assistantId)
    : null
  if (sessionAssistant) {
    return sessionAssistant
  }

  return (
    (fallbackAssistantId ? assistants.find((item) => item.id === fallbackAssistantId) : null) ??
    assistants[0] ??
    null
  )
}
