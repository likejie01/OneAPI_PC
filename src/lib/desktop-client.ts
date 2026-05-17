import type { DesktopApiRequest } from '../shared/desktop'
import type { ApiEnvelope } from '../shared/contracts'

const DESKTOP_USER_ID_KEY = 'uid'

function getBridge() {
  if (!window.desktopBridge) {
    throw new Error('桌面桥接不可用，请重新启动客户端。')
  }
  return window.desktopBridge
}

export function getStoredDesktopUserId() {
  try {
    return window.localStorage.getItem(DESKTOP_USER_ID_KEY) || ''
  } catch {
    return ''
  }
}

export function saveStoredDesktopUserId(userId: number | string) {
  try {
    window.localStorage.setItem(DESKTOP_USER_ID_KEY, String(userId))
  } catch {
    /* empty */
  }
}

export function clearStoredDesktopUserId() {
  try {
    window.localStorage.removeItem(DESKTOP_USER_ID_KEY)
  } catch {
    /* empty */
  }
}

function withDesktopAuthHeaders(input: DesktopApiRequest) {
  const headers = {
    ...(input.headers ?? {}),
  }

  const shouldAttachUserId =
    !input.path.startsWith('/api/user/login') && input.path !== '/api/user/register'

  if (shouldAttachUserId && !headers['New-Api-User']) {
    const userId = getStoredDesktopUserId()
    if (userId) {
      headers['New-Api-User'] = userId
    }
  }

  return {
    ...input,
    headers,
  }
}

function getResponseErrorMessage(data: unknown, status: number) {
  if (typeof data === 'object' && data) {
    if ('message' in data && typeof data.message === 'string') {
      return data.message
    }

    if (
      'error' in data &&
      typeof data.error === 'object' &&
      data.error &&
      'message' in data.error &&
      typeof data.error.message === 'string'
    ) {
      return data.error.message
    }
  }

  return `请求失败（${status}）`
}

export async function desktopRequest<T>(input: DesktopApiRequest) {
  const response = await getBridge().request(withDesktopAuthHeaders(input))

  if (!response.ok) {
    throw new Error(getResponseErrorMessage(response.data, response.status))
  }

  return response.data as T
}

export async function desktopEnvelope<T>(input: DesktopApiRequest) {
  const response = await getBridge().request(withDesktopAuthHeaders(input))
  const data = response.data as ApiEnvelope<T>

  if (!response.ok) {
    throw new Error(getResponseErrorMessage(response.data, response.status))
  }

  return data
}

export function desktopBridge() {
  return getBridge()
}
