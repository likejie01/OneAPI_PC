import { desktopEnvelope } from '../lib/desktop-client'
import type { UsageData, UsageStat } from '../shared/contracts'

export async function getUserUsageLogs(page = 1, pageSize = 10) {
  const response = await desktopEnvelope<UsageData>({
    method: 'GET',
    path: '/api/log/self',
    query: {
      p: page,
      page_size: pageSize,
    },
  })
  return response.data
}

export async function getUserUsageStat() {
  const response = await desktopEnvelope<UsageStat>({
    method: 'GET',
    path: '/api/log/self/stat',
  })
  return response.data
}

export async function getPerfMetricsSummary(hours = 24) {
  const response = await desktopEnvelope<{
    models?: Array<{
      model_name: string
      avg_latency_ms: number
      request_count: number
    }>
  }>({
    method: 'GET',
    path: '/api/perf-metrics/summary',
    query: { hours },
  })
  return response.data
}
