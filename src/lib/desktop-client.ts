import type { DesktopApiRequest } from '../shared/desktop'
import type { ApiEnvelope } from '../shared/contracts'

const DESKTOP_USER_ID_KEY = 'uid'
export const AUTH_EXPIRED_EVENT = 'oneapi:auth-expired'

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

  const requestPath = input.path.split('?')[0] || input.path
  const shouldAttachUserId =
    !requestPath.startsWith('/api/user/login') &&
    requestPath !== '/api/user/register' &&
    requestPath !== '/api/status' &&
    requestPath !== '/api/verification'

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

function isAuthExpiredMessage(message: string) {
  const normalized = message.toLowerCase()
  return (
    message.includes('未登录且未提供 access token') ||
    message.includes('access token 无效') ||
    normalized.includes('not logged in and no access token provided') ||
    normalized.includes('access token invalid')
  )
}

export function notifyDesktopAuthExpiredIfNeeded(status: number, message: string) {
  if (status !== 401 && !isAuthExpiredMessage(message)) {
    return
  }

  clearStoredDesktopUserId()
  window.dispatchEvent(
    new CustomEvent(AUTH_EXPIRED_EVENT, {
      detail: {
        message,
        status,
      },
    })
  )
}

export async function desktopRequest<T>(input: DesktopApiRequest) {
  const response = await getBridge().request(withDesktopAuthHeaders(input))

  if (!response.ok) {
    const message = getResponseErrorMessage(response.data, response.status)
    notifyDesktopAuthExpiredIfNeeded(response.status, message)
    throw new Error(message)
  }

  return response.data as T
}

export async function desktopEnvelope<T>(input: DesktopApiRequest) {
  const response = await getBridge().request(withDesktopAuthHeaders(input))
  const data = response.data as ApiEnvelope<T>

  if (!response.ok) {
    const message = getResponseErrorMessage(response.data, response.status)
    notifyDesktopAuthExpiredIfNeeded(response.status, message)
    throw new Error(message)
  }

  return data
}

export function desktopBridge() {
  return getBridge()
}
