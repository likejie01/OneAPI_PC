import type { ChatMessage } from '../shared/contracts'

export type DrawHistorySessionLike = {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

export function resolveDrawSessionAssistantGroup(
  session: DrawHistorySessionLike,
  presetTitleById: Record<string, string> = {}
) {
  const latestStyledUserMessage = [...session.messages]
    .reverse()
    .find(
      (item) =>
        item.role === 'user' &&
        (item.imageStylePresetTitle?.trim() || presetTitleById[item.imageStylePresetId || '']?.trim())
    )

  return (
    latestStyledUserMessage?.imageStylePresetTitle?.trim() ||
    presetTitleById[latestStyledUserMessage?.imageStylePresetId || '']?.trim() ||
    '未使用提示词助手'
  )
}

export function groupDrawSessionsByAssistant(
  sessions: DrawHistorySessionLike[],
  presetTitleById: Record<string, string> = {}
) {
  const groups = new Map<string, DrawHistorySessionLike[]>()

  for (const session of sessions) {
    const key = resolveDrawSessionAssistantGroup(session, presetTitleById)
    groups.set(key, [...(groups.get(key) || []), session])
  }

  return [...groups.entries()]
}
