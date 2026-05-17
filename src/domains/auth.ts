import { desktopEnvelope } from '../lib/desktop-client'
import type { ApiEnvelope, LoginPayload, LoginResult } from '../shared/contracts'

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

export async function unwrapEnvelope<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
