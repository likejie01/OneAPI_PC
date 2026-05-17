import { desktopEnvelope } from '../lib/desktop-client'
import type { ApiEnvelope, ApiKeyFormInput, ApiKeyPageData } from '../shared/contracts'

export async function getApiKeys(page = 1, size = 10) {
  const response = await desktopEnvelope<ApiKeyPageData>({
    method: 'GET',
    path: '/api/token/',
    query: {
      p: page,
      size,
    },
  })
  return response.data
}

export async function searchApiKeys(keyword: string) {
  const response = await desktopEnvelope<ApiKeyPageData>({
    method: 'GET',
    path: '/api/token/search',
    query: {
      keyword,
      p: 1,
      size: 20,
    },
  })
  return response.data?.items ?? []
}

export async function createApiKey(payload: ApiKeyFormInput) {
  const response = await desktopEnvelope({
    method: 'POST',
    path: '/api/token/',
    body: payload,
  })

  if (!response.success) {
    throw new Error(response.message || '创建 Key 失败')
  }

  return true
}

export async function fetchApiKeySecret(id: number) {
  const response = await desktopEnvelope<{ key: string }>({
    method: 'POST',
    path: `/api/token/${id}/key`,
  })

  if (!response.success || !response.data) {
    throw new Error(response.message || '读取 Key 失败')
  }

  return response.data.key
}

export async function createDesktopCliKey(name: string, group: string) {
  await createApiKey({
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group,
    cross_group_retry: group === 'auto',
  })

  const keys = await searchApiKeys(name)
  const target = keys.find((item) => item.name === name)
  if (!target) {
    throw new Error('专用 Key 已创建，但未能定位到新 Key 记录。')
  }

  const secret = await fetchApiKeySecret(target.id)
  return {
    id: target.id,
    key: secret,
  }
}

export async function expectSuccess<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
