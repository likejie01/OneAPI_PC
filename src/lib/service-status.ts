export type ConfiguredServiceKey = 'claude' | 'codex' | 'gemini' | 'deepseek' | 'mimo'

export type ServiceHealthTone = 'up' | 'down' | 'maintenance' | 'unknown'

export type ConfiguredChannel = {
  id: number
  type: number
  name?: string
  models?: string
  base_url?: string | null
  tag?: string | null
  remark?: string
}

export type StatusPageMonitor = {
  id: number
  name: string
  type?: string
}

export type StatusPageGroup = {
  id: number
  name: string
  monitorList: StatusPageMonitor[]
}

export type StatusPageSnapshot = {
  config?: {
    slug?: string
    title?: string
    autoRefreshInterval?: number
  }
  publicGroupList: StatusPageGroup[]
}

export type StatusPageHeartbeatItem = {
  status?: number
  ping?: number
  time?: number | string
  msg?: string
}

export type StatusHeartbeatSnapshot = {
  heartbeatList: Record<string, StatusPageHeartbeatItem[]>
}

export type ChannelProbeResult = {
  ok: boolean
  responseTime?: number
  message?: string
  checkedAt: number
  channelId: number
}

export type ServiceStatusItem = {
  id: string
  serviceKey: ConfiguredServiceKey
  title: string
  subtitle: string
  tone: ServiceHealthTone
  latencyMs?: number
  checkedAt?: number
  detail?: string
  source: 'status-page' | 'channel-test'
  history?: ServiceStatusHistoryEntry[]
}

export type ServiceStatusHistoryEntry = {
  tone: ServiceHealthTone
  checkedAt: number
  latencyMs?: number
  detail?: string
}

export type CachedServiceStatusItem = ServiceStatusItem & {
  history: ServiceStatusHistoryEntry[]
}

export type ServiceStatusCacheStore = {
  items: CachedServiceStatusItem[]
  refreshedAt: number
  mode: 'status-page' | 'channel-test'
}

export const MAX_SERVICE_STATUS_HISTORY = 24

const SERVICE_LABELS: Record<ConfiguredServiceKey, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  mimo: 'XiaomiMIMO',
}

function normalizeText(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

function normalizeConfiguredServiceHost(value?: string | null) {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    return ''
  }
  try {
    const target = new URL(trimmed)
    return target.host.trim().toLowerCase()
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .trim()
      .toLowerCase()
  }
}

export function classifyConfiguredService(channel: ConfiguredChannel): ConfiguredServiceKey | null {
  const baseHost = normalizeConfiguredServiceHost(channel.base_url)
  const text = [
    channel.name,
    channel.models,
    channel.tag,
    channel.remark,
    baseHost,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ')

  if (channel.type === 57) {
    return 'codex'
  }
  if (channel.type === 58) {
    return 'mimo'
  }
  if (channel.type === 43) {
    return 'deepseek'
  }
  if (channel.type === 24) {
    return 'gemini'
  }
  if (channel.type === 14) {
    return 'claude'
  }
  if (text.includes('codex')) {
    return 'codex'
  }
  if (text.includes('xiaomimimo') || text.includes('mimo')) {
    return 'mimo'
  }
  if (text.includes('deepseek')) {
    return 'deepseek'
  }
  if (text.includes('gemini')) {
    return 'gemini'
  }
  if (text.includes('claude') || text.includes('anthropic')) {
    return 'claude'
  }
  return null
}

export function collectConfiguredServices(channels: ConfiguredChannel[]) {
  const grouped = new Map<ConfiguredServiceKey, ConfiguredChannel[]>()
  for (const channel of channels) {
    const service = classifyConfiguredService(channel)
    if (!service) {
      continue
    }
    grouped.set(service, [...(grouped.get(service) || []), channel])
  }
  return grouped
}

function classifyStatusPageService(groupName?: string, monitorName?: string): ConfiguredServiceKey | null {
  const text = `${normalizeText(groupName)} ${normalizeText(monitorName)}`
  if (text.includes('codex')) {
    return 'codex'
  }
  if (text.includes('gemini')) {
    return 'gemini'
  }
  if (text.includes('claude')) {
    return 'claude'
  }
  return null
}

export function normalizeHeartbeatTone(value?: number): ServiceHealthTone {
  if (value === 1) {
    return 'up'
  }
  if (value === 0) {
    return 'down'
  }
  if (value === 3) {
    return 'maintenance'
  }
  return 'unknown'
}

function resolveHeartbeatTimestamp(value?: number | string) {
  const numeric = Number(value || 0)
  if (!numeric) {
    return undefined
  }
  return numeric > 10_000_000_000 ? numeric : numeric * 1000
}

function createHistoryEntry(input: {
  tone: ServiceHealthTone
  checkedAt?: number
  latencyMs?: number
  detail?: string
}) {
  if (!input.checkedAt || !Number.isFinite(input.checkedAt)) {
    return null
  }

  return {
    tone: input.tone,
    checkedAt: input.checkedAt,
    latencyMs: input.latencyMs,
    detail: input.detail,
  } satisfies ServiceStatusHistoryEntry
}

export function normalizeServiceStatusHistory(entries: ServiceStatusHistoryEntry[]) {
  const deduped = new Map<string, ServiceStatusHistoryEntry>()

  for (const entry of entries) {
    if (!entry.checkedAt || !Number.isFinite(entry.checkedAt)) {
      continue
    }

    const key = [
      entry.checkedAt,
      entry.tone,
      entry.latencyMs || '',
      entry.detail?.trim() || '',
    ].join(':')
    deduped.set(key, {
      tone: entry.tone,
      checkedAt: entry.checkedAt,
      latencyMs: entry.latencyMs,
      detail: entry.detail?.trim() || undefined,
    })
  }

  return [...deduped.values()]
    .sort((left, right) => left.checkedAt - right.checkedAt)
    .slice(-MAX_SERVICE_STATUS_HISTORY)
}

export function hydrateServiceStatusItems(
  items: ServiceStatusItem[],
  cachedItems: CachedServiceStatusItem[] = []
) {
  const cachedMap = new Map(cachedItems.map((item) => [item.id, item]))

  return items.map((item) => {
    const cached = cachedMap.get(item.id)
    const cachedSnapshot = cached ? createHistoryEntry(cached) : null
    const latestSnapshot = createHistoryEntry(item)
    const nextHistory = normalizeServiceStatusHistory([
      ...(cached?.history || []),
      ...(cachedSnapshot ? [cachedSnapshot] : []),
      ...(latestSnapshot ? [latestSnapshot] : []),
    ])

    return {
      ...item,
      history: nextHistory,
    } satisfies CachedServiceStatusItem
  })
}

export function buildServiceStatusItems(input: {
  channels: ConfiguredChannel[]
  statusPage?: StatusPageSnapshot | null
  heartbeat?: StatusHeartbeatSnapshot | null
  fallbackResults?: Partial<Record<ConfiguredServiceKey, ChannelProbeResult>>
}) {
  const configuredServices = collectConfiguredServices(input.channels)
  const items: ServiceStatusItem[] = []
  const pageBackedServices = new Set<ConfiguredServiceKey>()

  for (const group of input.statusPage?.publicGroupList || []) {
    for (const monitor of group.monitorList || []) {
      const serviceKey = classifyStatusPageService(group.name, monitor.name)
      if (!serviceKey || !configuredServices.has(serviceKey)) {
        continue
      }
      const records = input.heartbeat?.heartbeatList?.[String(monitor.id)] || []
      const latest = records.at(-1)
      const history = normalizeServiceStatusHistory(
        records.flatMap((record) => {
          const checkedAt = resolveHeartbeatTimestamp(record?.time)
          if (!checkedAt) {
            return []
          }
          return [{
            tone: normalizeHeartbeatTone(record?.status),
            checkedAt,
            latencyMs: Number(record?.ping || 0) > 0 ? Number(record.ping) : undefined,
            detail: record?.msg?.trim() || undefined,
          }]
        })
      )
      pageBackedServices.add(serviceKey)
      items.push({
        id: `status-page:${monitor.id}`,
        serviceKey,
        title: monitor.name,
        subtitle: group.name,
        tone: normalizeHeartbeatTone(latest?.status),
        latencyMs: Number(latest?.ping || 0) > 0 ? Number(latest?.ping) : undefined,
        checkedAt: resolveHeartbeatTimestamp(latest?.time),
        detail: latest?.msg?.trim() || undefined,
        source: 'status-page',
        history,
      })
    }
  }

  for (const [serviceKey, channels] of configuredServices.entries()) {
    if (pageBackedServices.has(serviceKey)) {
      continue
    }
    const fallback = input.fallbackResults?.[serviceKey]
    for (const channel of channels) {
      const title = channel.name?.trim() || SERVICE_LABELS[serviceKey]
      items.push({
        id: `channel-test:${channel.id}`,
        serviceKey,
        title,
        subtitle: title === SERVICE_LABELS[serviceKey] ? `渠道 #${channel.id}` : SERVICE_LABELS[serviceKey],
        tone: fallback ? (fallback.ok ? 'up' : 'down') : 'unknown',
        latencyMs: fallback?.responseTime,
        checkedAt: fallback?.checkedAt,
        detail: fallback?.message?.trim() || undefined,
        source: 'channel-test',
      })
    }
  }

  return items.sort((left, right) => {
    if (left.serviceKey !== right.serviceKey) {
      return left.serviceKey.localeCompare(right.serviceKey)
    }
    return left.title.localeCompare(right.title)
  })
}
