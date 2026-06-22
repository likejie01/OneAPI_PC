export type DesktopApiKeyItem = {
  id: number
  status: number
  created_time?: number
}

export const API_KEY_STATUS_ENABLED = 1
export const API_KEY_STATUS_DISABLED = 2
export const ALL_CHANNEL_GROUPS_KEY_GROUP = 'default'
export const SELECTED_DESKTOP_API_KEY_STORAGE_PREFIX = 'oneapi-desktop-selected-api-key'
export const SELECTED_DESKTOP_API_KEY_FALLBACK_STORAGE_KEY = `${SELECTED_DESKTOP_API_KEY_STORAGE_PREFIX}-last`

export function getSelectedDesktopApiKeyStorageKey(userId: number | string) {
  return `${SELECTED_DESKTOP_API_KEY_STORAGE_PREFIX}-${userId}`
}

type JsonStorageReader = <T>(key: string, fallback: T) => T
type JsonStorageWriter = <T>(key: string, value: T) => void
type StorageRemover = (key: string) => void

export function readSelectedDesktopApiKeyId(
  userId: number | string,
  readJsonStorage: JsonStorageReader
) {
  const selectedApiKeyStorageKey = getSelectedDesktopApiKeyStorageKey(userId)
  return readJsonStorage<number | null>(
    selectedApiKeyStorageKey,
    readJsonStorage<number | null>(SELECTED_DESKTOP_API_KEY_FALLBACK_STORAGE_KEY, null)
  )
}

export function writeSelectedDesktopApiKeyId(
  userId: number | string,
  nextId: number,
  writeJsonStorage: JsonStorageWriter
) {
  const selectedApiKeyStorageKey = getSelectedDesktopApiKeyStorageKey(userId)
  writeJsonStorage(selectedApiKeyStorageKey, nextId)
  writeJsonStorage(SELECTED_DESKTOP_API_KEY_FALLBACK_STORAGE_KEY, nextId)
}

export function clearSelectedDesktopApiKeyId(
  userId: number | string,
  removeStorage: StorageRemover
) {
  removeStorage(getSelectedDesktopApiKeyStorageKey(userId))
  removeStorage(SELECTED_DESKTOP_API_KEY_FALLBACK_STORAGE_KEY)
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
