import { desktopEnvelope } from '../lib/desktop-client'
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
}) {
  const response = await desktopEnvelope<ChatCompletionResponse>({
    method: 'POST',
    path: '/pg/chat/completions',
    body: {
      ...payload,
      stream: false,
    },
  })

  if (!response.success || !response.data) {
    throw new Error(response.message || '聊天请求失败')
  }

  return response.data
}

export async function requireEnvelopeData<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
