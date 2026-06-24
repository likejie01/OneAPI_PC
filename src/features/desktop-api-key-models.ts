import type { ApiKeyRecord, ChatModelOption } from '../shared/contracts.ts'
import type { CliClient } from '../shared/desktop.ts'
import { resolveCompatibleModel } from '../lib/assistant-workspace.ts'
import { isAllChannelGroupsDesktopApiKeyGroup, resolveSelectedDesktopApiKeyId } from '../lib/desktop-api-keys.ts'
import { filterModelsForDesktopApiKey } from '../lib/desktop-api-key-models.ts'

export type ActiveDesktopApiKeyRecord = Pick<
  ApiKeyRecord,
  'id' | 'name' | 'status' | 'group' | 'created_time' | 'model_limits_enabled' | 'model_limits'
>
export type ActiveDesktopApiKeySummary = ActiveDesktopApiKeyRecord | null

export type ActiveKeyModelLoader = {
  fetchApiKeySecret: (id: number) => Promise<string>
  getApiKeyModels: (apiKey: string) => Promise<ChatModelOption[]>
  getUserModels: () => Promise<ChatModelOption[]>
}

export const defaultActiveKeyModelLoader: ActiveKeyModelLoader = {
  fetchApiKeySecret: async (id) => {
    const { fetchApiKeySecret } = await import('../domains/keys.ts')
    return fetchApiKeySecret(id)
  },
  getApiKeyModels: async (apiKey) => {
    const { getApiKeyModels } = await import('../domains/chat.ts')
    return getApiKeyModels(apiKey)
  },
  getUserModels: async () => {
    const { getUserModels } = await import('../domains/chat.ts')
    return getUserModels()
  },
}

export function resolveActiveDesktopApiKeySummary<T extends ActiveDesktopApiKeyRecord>(
  keys: T[],
  selectedApiKeyId: number | null = null
): ActiveDesktopApiKeySummary {
  const activeId = resolveSelectedDesktopApiKeyId(keys, selectedApiKeyId)
  return keys.find((item) => item.id === activeId) || null
}

export function resolveOneApiRequestGroupForActiveKey(
  activeApiKey: ActiveDesktopApiKeySummary,
  selectedGroup?: string
) {
  const activeKeyGroup = activeApiKey?.group?.trim() || ''
  if (activeKeyGroup && !isAllChannelGroupsDesktopApiKeyGroup(activeKeyGroup)) {
    return activeKeyGroup
  }
  return selectedGroup?.trim() || ''
}

export function sameActiveDesktopApiKeySummary(
  left: ActiveDesktopApiKeySummary,
  right: ActiveDesktopApiKeySummary
) {
  return (
    (left?.id ?? null) === (right?.id ?? null) &&
    (left?.status ?? null) === (right?.status ?? null) &&
    (left?.name ?? '') === (right?.name ?? '') &&
    (left?.group ?? '') === (right?.group ?? '') &&
    (left?.model_limits_enabled ?? false) === (right?.model_limits_enabled ?? false) &&
    (left?.model_limits ?? '') === (right?.model_limits ?? '') &&
    (left?.created_time ?? 0) === (right?.created_time ?? 0)
  )
}

export function resolveCliDeployModelForActiveKey(
  client: CliClient,
  models: ChatModelOption[],
  defaultModel: string,
  presetModel?: string
) {
  const requestedModel = presetModel?.trim() || defaultModel
  return resolveCompatibleModel(client, models, requestedModel, defaultModel)
}

function mergeModelOptions(left: ChatModelOption[], right: ChatModelOption[]) {
  const seen = new Set<string>()
  const merged: ChatModelOption[] = []
  for (const item of [...left, ...right]) {
    const key = item.value.trim()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(item)
  }
  return merged
}

export async function loadOneApiModelsForActiveKey(
  activeApiKey: ActiveDesktopApiKeySummary,
  loader: ActiveKeyModelLoader = defaultActiveKeyModelLoader
) {
  if (!activeApiKey?.id) {
    return []
  }
  let scopedModels: ChatModelOption[] = []
  try {
    const apiKey = await loader.fetchApiKeySecret(activeApiKey.id)
    scopedModels = await loader.getApiKeyModels(apiKey)
  } catch {
    // Older servers may not expose key-scoped /v1/models consistently.
  }
  const fallbackModels = await loader.getUserModels()
  return mergeModelOptions(scopedModels, filterModelsForDesktopApiKey(fallbackModels, activeApiKey))
}

export async function refreshOneApiModelsForActiveKey(activeApiKey: ActiveDesktopApiKeySummary) {
  return loadOneApiModelsForActiveKey(activeApiKey)
}
