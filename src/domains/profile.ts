import { desktopEnvelope } from '../lib/desktop-client'
import type { ApiEnvelope, UserProfile } from '../shared/contracts'

export function getSelfProfile() {
  return desktopEnvelope<UserProfile>({
    method: 'GET',
    path: '/api/user/self',
  })
}

export function generateAccessToken() {
  return desktopEnvelope<string>({
    method: 'GET',
    path: '/api/user/token',
  })
}

export async function verifyCurrentPassword(profile: UserProfile, password: string) {
  const response = await desktopEnvelope({
    method: 'PUT',
    path: '/api/user/self',
    body: {
      username: profile.username,
      display_name: profile.display_name,
      original_password: password,
    },
  })

  if (!response.success) {
    throw new Error(response.message || '密码验证失败')
  }

  return true
}

export async function requireSuccess<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
