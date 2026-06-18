import type { CliHistoryEntry } from '../shared/desktop'

export function normalizeCliProjectKey(value?: string) {
  return (value || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

export function resolveCliHistorySessionForProject(input: {
  history: CliHistoryEntry[]
  projectPath: string
  preferredSessionId?: string
}) {
  const projectKey = normalizeCliProjectKey(input.projectPath)
  if (!projectKey) {
    return null
  }

  const matchedSessions = input.history.filter(
    (item) => normalizeCliProjectKey(item.projectPath) === projectKey
  )

  if (!matchedSessions.length) {
    return null
  }

  if (input.preferredSessionId?.trim()) {
    const preferred = matchedSessions.find((item) => item.id === input.preferredSessionId)
    if (preferred) {
      return preferred
    }
  }

  return [...matchedSessions].sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

export function resolvePreferredCliSessionId(input: {
  projectPath: string
  projectSessionMap: Record<string, string>
  lastOpenedSessionId?: string
  lastOpenedProjectPath?: string
}) {
  const projectKey = normalizeCliProjectKey(input.projectPath)
  if (!projectKey) {
    return ''
  }

  const mappedSessionId = input.projectSessionMap[projectKey]?.trim() || ''
  if (mappedSessionId) {
    return mappedSessionId
  }

  const lastOpenedSessionId = input.lastOpenedSessionId?.trim() || ''
  if (!lastOpenedSessionId) {
    return ''
  }

  return normalizeCliProjectKey(input.lastOpenedProjectPath) === projectKey ? lastOpenedSessionId : ''
}
