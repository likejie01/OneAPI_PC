import {
  sendChatCompletion,
  sendImageGeneration,
  streamChatCompletion,
} from './chat'
import type {
  AiChatProviderState,
} from '../lib/aichat-provider'
import type {
  ChatCompletionResponse,
  ChatContentPart,
  ImageGenerationResponse,
} from '../shared/contracts'
import type { DesktopChatStreamPayload } from '../shared/desktop'
import { desktopBridge } from '../lib/desktop-client'

export interface AiChatCompletionPayload {
  model: string
  group?: string
  promptCacheKey?: string
  reasoningEffort?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | ChatContentPart[]
  }>
  temperature?: number
}

export interface AiImageGenerationPayload {
  model: string
  group?: string
  prompt: string
  n?: number
  size?: string
  quality?: string
  response_format?: 'url' | 'b64_json'
}

function assertProviderAvailable(provider: AiChatProviderState) {
  if (provider.mode === 'unavailable') {
    throw new Error(provider.reason || '请先登录 OneAPI 或配置自定义 API 通道。')
  }
}

export async function sendAiChatCompletion(
  provider: AiChatProviderState,
  payload: AiChatCompletionPayload,
  options: { requestId?: string } = {}
): Promise<ChatCompletionResponse> {
  assertProviderAvailable(provider)
  if (provider.mode === 'custom') {
    return desktopBridge().sendCustomChatCompletion({
      requestId: options.requestId,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: payload.model,
      messages: payload.messages,
      temperature: payload.temperature,
    })
  }
  return sendChatCompletion(payload, options)
}

export async function streamAiChatCompletion(
  provider: AiChatProviderState,
  payload: AiChatCompletionPayload,
  handlers: {
    requestId?: string
    signal: AbortSignal
    onDelta: (text: string) => void
    onReasoningDelta?: (text: string) => void
    onDone?: (usage?: ChatCompletionResponse['usage']) => void
  }
) {
  assertProviderAvailable(provider)
  if (provider.mode !== 'custom') {
    return streamChatCompletion(payload, handlers)
  }

  const bridge = desktopBridge()
  const requestId =
    handlers.requestId ||
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `custom-chat-stream-${Date.now()}`)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      unsubscribe()
      handlers.signal.removeEventListener('abort', handleAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    const handleAbort = () => {
      void bridge.stopRequest(requestId).catch(() => undefined)
      finish(() => reject(new DOMException('请求已取消', 'AbortError')))
    }
    const unsubscribe = bridge.onChatStream((event: DesktopChatStreamPayload) => {
      if (event.requestId !== requestId) {
        return
      }
      if (event.type === 'delta' && event.text) {
        handlers.onDelta(event.text)
        return
      }
      if (event.type === 'reasoning' && event.text) {
        handlers.onReasoningDelta?.(event.text)
        return
      }
      if (event.type === 'error') {
        finish(() => reject(new Error(event.message || '自定义 API 聊天请求失败')))
        return
      }
      if (event.type === 'done') {
        finish(() => {
          handlers.onDone?.(event.usage)
          resolve()
        })
      }
    })

    if (handlers.signal.aborted) {
      handleAbort()
      return
    }
    handlers.signal.addEventListener('abort', handleAbort, { once: true })

    void bridge
      .streamCustomChatCompletion({
        requestId,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: payload.model,
        messages: payload.messages,
        temperature: payload.temperature,
      })
      .catch((error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error('自定义 API 聊天请求失败')))
      })
  })
}

export async function sendAiImageGeneration(
  provider: AiChatProviderState,
  payload: AiImageGenerationPayload,
  options: { requestId?: string } = {}
): Promise<ImageGenerationResponse> {
  assertProviderAvailable(provider)
  if (provider.mode === 'custom') {
    return desktopBridge().sendCustomImageGeneration({
      requestId: options.requestId,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: payload.model,
      prompt: payload.prompt,
      n: payload.n,
      size: payload.size,
      quality: payload.quality,
      response_format: payload.response_format,
    })
  }
  return sendImageGeneration(payload, options)
}

export function listCustomAiChatProviderModels(provider: AiChatProviderState) {
  if (provider.mode !== 'custom') {
    return Promise.resolve<string[]>([])
  }
  return desktopBridge().listCustomProviderModels({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  })
}
