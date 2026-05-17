import { desktopBridge, desktopEnvelope, desktopRequest } from '../lib/desktop-client'
import type {
  ApiEnvelope,
  ChatCompletionResponse,
  ChatGroupOption,
  ChatModelOption,
} from '../shared/contracts'

export async function getUserModels() {
  const response = await desktopEnvelope<string[]>({
    method: 'GET',
    path: '/api/user/models',
  })

  return (response.data ?? []).map(
    (model): ChatModelOption => ({
      label: model,
      value: model,
    })
  )
}

export async function getUserGroups() {
  const response = await desktopEnvelope<Record<string, { desc: string; ratio: number }>>({
    method: 'GET',
    path: '/api/user/self/groups',
  })

  return Object.entries(response.data ?? {}).map(
    ([group, info]): ChatGroupOption => ({
      label: group,
      value: group,
      ratio: Number(info.ratio),
      desc: info.desc,
    })
  )
}

export async function sendChatCompletion(payload: {
  model: string
  group?: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
}, options: {
  requestId?: string
} = {}) {
  return desktopRequest<ChatCompletionResponse>({
    method: 'POST',
    path: '/pg/chat/completions',
    requestId: options.requestId,
    body: {
      ...payload,
      stream: false,
    },
  })
}

export function stopChatCompletion(requestId: string) {
  return desktopBridge().stopRequest(requestId)
}

export async function requireEnvelopeData<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
