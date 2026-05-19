import { desktopBridge, desktopEnvelope, desktopRequest } from '../lib/desktop-client'
import type {
  ApiEnvelope,
  ChatContentPart,
  ChatCompletionResponse,
  ChatGroupOption,
  ChatModelOption,
  ImageGenerationResponse,
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
  reasoningEffort?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | ChatContentPart[]
  }>
  temperature?: number
}, options: {
  requestId?: string
} = {}) {
  const { reasoningEffort, ...rest } = payload
  return desktopRequest<ChatCompletionResponse>({
    method: 'POST',
    path: '/pg/chat/completions',
    requestId: options.requestId,
    body: {
      ...rest,
      reasoning_effort: reasoningEffort,
      stream: false,
    },
  })
}

export function stopChatCompletion(requestId: string) {
  return desktopBridge().stopRequest(requestId)
}

export async function sendImageGeneration(payload: {
  model: string
  group?: string
  prompt: string
  n?: number
  size?: string
  quality?: string
  response_format?: 'url' | 'b64_json'
  style?: string
}, options: {
  requestId?: string
} = {}) {
  return desktopRequest<ImageGenerationResponse>({
    method: 'POST',
    path: '/pg/images/generations',
    requestId: options.requestId,
    body: {
      ...payload,
      stream: false,
    },
  })
}

export async function requireEnvelopeData<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
