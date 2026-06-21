export type DesktopApiKeyItem = {
  id: number
  status: number
  created_time?: number
}

export const API_KEY_STATUS_ENABLED = 1
export const API_KEY_STATUS_DISABLED = 2
export const ALL_CHANNEL_GROUPS_KEY_GROUP = 'default'
export const SELECTED_DESKTOP_API_KEY_STORAGE_PREFIX = 'oneapi-desktop-selected-api-key'

export function getSelectedDesktopApiKeyStorageKey(userId: number | string) {
  return `${SELECTED_DESKTOP_API_KEY_STORAGE_PREFIX}-${userId}`
}

export function isAllChannelGroupsDesktopApiKeyGroup(group: string | null | undefined) {
  const normalized = (group || '').trim()
  return normalized === '' || normalized === ALL_CHANNEL_GROUPS_KEY_GROUP
}

export function getActiveDesktopApiKey<T extends DesktopApiKeyItem>(items: T[]) {
  return items.find((item) => item.status === API_KEY_STATUS_ENABLED) || null
}

export function resolveSelectedDesktopApiKeyId<T extends DesktopApiKeyItem>(
  items: T[],
  selectedId: number | null
) {
  const selected = selectedId ? items.find((item) => item.id === selectedId) || null : null
  if (selected?.status === API_KEY_STATUS_ENABLED) {
    return selected.id
  }

  return getActiveDesktopApiKey(items)?.id ?? null
}

export function applySingleActiveDesktopApiKey<T extends DesktopApiKeyItem>(
  items: T[],
  activeId: number
) {
  return items.map((item) => ({
    ...item,
    status: item.id === activeId ? API_KEY_STATUS_ENABLED : API_KEY_STATUS_DISABLED,
  }))
}
