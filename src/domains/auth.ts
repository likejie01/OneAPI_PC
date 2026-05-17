import { desktopBridge, desktopEnvelope } from '../lib/desktop-client'
import type {
  ApiEnvelope,
  AuthStatus,
  LoginPayload,
  LoginResult,
  RegisterPayload,
} from '../shared/contracts'

function getEnvelopeMessage(data: unknown, fallbackStatus: number) {
  if (typeof data === 'object' && data) {
    if ('message' in data && typeof data.message === 'string' && data.message.trim()) {
      return data.message
    }
  }

  return `请求失败（${fallbackStatus}）`
}

async function requestPublicEnvelope<T>(input: {
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
}) {
  const response = await desktopBridge().request(input)
  const data = response.data as ApiEnvelope<T>

  if (!response.ok) {
    throw new Error(getEnvelopeMessage(response.data, response.status))
  }

  return data
}

export function login(payload: LoginPayload) {
  return desktopEnvelope<LoginResult>({
    method: 'POST',
    path: '/api/user/login',
    body: payload,
  })
}

export function login2fa(code: string) {
  return desktopEnvelope<LoginResult>({
    method: 'POST',
    path: '/api/user/login/2fa',
    body: { code },
  })
}

export function logout() {
  return desktopEnvelope({
    method: 'GET',
    path: '/api/user/logout',
  })
}

export function getAuthStatus() {
  return requestPublicEnvelope<AuthStatus>({
    method: 'GET',
    path: '/api/status',
  })
}

export async function registerUser(payload: RegisterPayload) {
  const response = await desktopBridge().request({
    method: 'POST',
    path: '/api/user/register',
    body: payload,
  })
  const data = response.data as ApiEnvelope<null>

  if (response.status === 429) {
    throw new Error('此IP已拥有账号')
  }

  if (!response.ok) {
    throw new Error(getEnvelopeMessage(response.data, response.status))
  }

  return data
}

export async function sendEmailVerification(email: string) {
  const response = await desktopBridge().request({
    method: 'GET',
    path: '/api/verification',
    query: {
      email,
    },
  })
  const data = response.data as ApiEnvelope<null>

  if (!response.ok) {
    throw new Error(getEnvelopeMessage(response.data, response.status))
  }

  return data
}

export async function unwrapEnvelope<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
