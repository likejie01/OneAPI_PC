import { desktopEnvelope } from '../lib/desktop-client'
import type { ServiceStatusCacheStore } from '../lib/service-status'

export async function getServiceStatusSnapshot() {
  const response = await desktopEnvelope<ServiceStatusCacheStore>({
    method: 'GET',
    path: '/api/service-status',
  })

  if (!response.success || !response.data) {
    throw new Error(response.message || '读取服务状态失败')
  }

  return {
    items: response.data.items || [],
    refreshedAt: Number(response.data.refreshedAt || 0),
    mode: response.data.mode === 'status-page' ? 'status-page' : 'channel-test',
  } satisfies ServiceStatusCacheStore
}
