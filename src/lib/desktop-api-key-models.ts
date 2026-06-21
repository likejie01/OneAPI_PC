import type { ChatModelOption } from '../shared/contracts'
import { isAllChannelGroupsDesktopApiKeyGroup } from './desktop-api-keys.ts'

export type DesktopApiKeyModelFilterKey = {
  id: number
  group?: string
  model_limits_enabled?: boolean
  model_limits?: string
}

function normalizeModelValue(value: string) {
  return value.trim().toLowerCase()
}

function normalizeKnownBridgeModelFamily(value: string) {
  return normalizeModelValue(value)
    .replace(/^xiaomi[-_]?mimo[-_]?/, 'mimo-')
    .replace(/^xiaomimimo[-_]?/, 'mimo-')
}

function isKnownDeepSeekBridgeModel(value: string) {
  const normalized = normalizeModelValue(value)
  return normalized === 'deepseek-v4-flash' || normalized === 'deepseek-v4-pro'
}

function isKnownMimoBridgeModel(value: string) {
  const normalized = normalizeKnownBridgeModelFamily(value)
  return normalized === 'mimo-v2.5' || normalized === 'mimo-v2.5-pro'
}

function selectedGroupLooksLikeDeepSeekOrMimo(groups: string[]) {
  return groups.some((group) => {
    const normalized = normalizeModelValue(group)
    return normalized.includes('deepseek') || normalized.includes('mimo') || normalized.includes('xiaomi')
  })
}

function parseModelLimits(value?: string) {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function applyModelLimits(models: ChatModelOption[], apiKey: DesktopApiKeyModelFilterKey | null | undefined) {
  if (!apiKey?.model_limits_enabled) {
    return models
  }
  const allowed = parseModelLimits(apiKey.model_limits)
  if (!allowed.size) {
    return []
  }
  return models.filter((item) => allowed.has(item.value))
}

function normalizeGroupAlias(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  const firstToken = trimmed.split(/\s+/)[0] || trimmed
  const withoutX = firstToken.toLowerCase().replace(/x$/, '')
  const numeric = Number(withoutX)
  if (Number.isFinite(numeric) && withoutX) {
    return `${numeric.toFixed(2)}x`
  }
  return firstToken
}

function expandGroupCandidates(value: string) {
  const trimmed = value.trim()
  const alias = normalizeGroupAlias(trimmed)
  return new Set([trimmed, alias].filter(Boolean))
}

function groupsMatch(left: string, right: string) {
  const leftCandidates = expandGroupCandidates(left)
  const rightCandidates = expandGroupCandidates(right)
  for (const item of leftCandidates) {
    if (rightCandidates.has(item)) {
      return true
    }
  }
  return false
}

function parseApiKeyGroups(value?: string) {
  const normalized = (value || '').trim()
  if (isAllChannelGroupsDesktopApiKeyGroup(normalized) || normalized === 'auto') {
    return []
  }
  return normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function modelMatchesApiKeyGroup(item: ChatModelOption, apiKeyGroups: string[]) {
  const modelGroups = item.enableGroups || []
  if (modelGroups.includes('all')) {
    return true
  }
  if (
    modelGroups.length === 0 &&
    selectedGroupLooksLikeDeepSeekOrMimo(apiKeyGroups) &&
    (isKnownDeepSeekBridgeModel(item.value) || isKnownMimoBridgeModel(item.value))
  ) {
    return true
  }
  return modelGroups.some((modelGroup) =>
    apiKeyGroups.some((apiKeyGroup) => groupsMatch(apiKeyGroup, modelGroup))
  )
}

export function filterModelsForDesktopApiKey(
  models: ChatModelOption[],
  apiKey: DesktopApiKeyModelFilterKey | null | undefined
) {
  if (!apiKey?.id) {
    return []
  }
  const apiKeyGroups = parseApiKeyGroups(apiKey.group)
  const groupFiltered = apiKeyGroups.length
    ? models.filter((item) => modelMatchesApiKeyGroup(item, apiKeyGroups))
    : models
  return applyModelLimits(groupFiltered, apiKey)
}
