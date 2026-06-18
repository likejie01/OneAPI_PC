import { desktopBridge, desktopEnvelope } from '../lib/desktop-client'
import type { DesktopMobileBridgeDevice } from '../shared/desktop'

export interface MobileDesktopBinding {
  appId: string
  appName: string
  deviceId: string
  createdAt: number
  updatedAt: number
}

export interface MobileDesktopDevice {
  deviceId: string
  name: string
  platform: string
  clientVersion: string
  status: string
  lastSeenAt: number
  lastError?: string
  bound?: boolean
  boundAppId?: string
  boundAppName?: string
  boundAt?: number
}

export interface MobileDesktopAssistantSnapshot {
  id: string
  scope: 'chat' | 'image' | 'draw'
  name: string
  description?: string
  prompt?: string
  model?: string
  temperature?: number
}

export async function getLocalMobileBridgeDevice(): Promise<DesktopMobileBridgeDevice> {
  return desktopBridge().getMobileBridgeDevice()
}

export async function resetLocalMobileBridgeDevice(): Promise<DesktopMobileBridgeDevice> {
  return desktopBridge().resetMobileBridgeDevice()
}

export async function getMobileDesktopDevices() {
  const response = await desktopEnvelope<MobileDesktopDevice[]>({
    method: 'GET',
    path: '/api/mobile/desktop-devices',
  })
  return response.data ?? []
}

export async function getMobileDesktopBindings() {
  const response = await desktopEnvelope<MobileDesktopBinding[]>({
    method: 'GET',
    path: '/api/mobile/desktop-bindings',
  })
  return response.data ?? []
}

export async function deleteMobileDesktopBinding(deviceId: string, appId?: string) {
  const response = await desktopEnvelope({
    method: 'DELETE',
    path: `/api/mobile/desktop-bindings/${encodeURIComponent(deviceId)}`,
    query: {
      appId,
    },
  })
  if (!response.success) {
    throw new Error(response.message || '解除绑定失败')
  }
}

export async function deleteMobileDesktopDevice(deviceId: string) {
  const response = await desktopEnvelope({
    method: 'DELETE',
    path: `/api/mobile/desktop-devices/${encodeURIComponent(deviceId)}`,
  })
  if (!response.success) {
    throw new Error(response.message || '删除旧设备标识失败')
  }
}

export async function syncMobileDesktopAssistantsSnapshot(
  deviceId: string,
  scope: 'chat' | 'image' | 'draw',
  assistants: MobileDesktopAssistantSnapshot[]
) {
  if (!deviceId) {
    return
  }
  const response = await desktopEnvelope({
    method: 'POST',
    path: '/api/mobile/desktop-assistants/snapshot',
    query: {
      device_id: deviceId,
      scope,
    },
    body: assistants,
  })
  if (!response.success) {
    throw new Error(response.message || '同步助手失败')
  }
}
