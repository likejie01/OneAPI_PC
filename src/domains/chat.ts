import {
  desktopBridge,
  desktopEnvelope,
  desktopRequest,
  getStoredDesktopUserId,
  notifyDesktopAuthExpiredIfNeeded,
} from '../lib/desktop-client'
import type {
  ApiEnvelope,
  ChatContentPart,
  ChatCompletionResponse,
  ChatGroupOption,
  ImageGenerationResponse,
} from '../shared/contracts'
import type { DesktopChatStreamPayload } from '../shared/desktop'
import { mergePricingAndUserModels, type PricingModelLike } from '../lib/model-options'
import { resolveDesktopRequestTimeoutMs } from '../lib/request-timeouts'

export async function getUserModels() {
  let pricingModels: PricingModelLike[] = []
  try {
    const pricingResponse = await desktopEnvelope<PricingModelLike[]>({
      method: 'GET',
      path: '/api/pricing',
    })

    if (pricingResponse.success && Array.isArray(pricingResponse.data) && pricingResponse.data.length) {
      pricingModels = pricingResponse.data
    }
  } catch {
    // Fallback for older servers that do not expose pricing metadata consistently.
  }

  if (pricingModels.length) {
    return mergePricingAndUserModels(pricingModels, [])
  }

  const response = await desktopEnvelope<string[]>({
    method: 'GET',
    path: '/api/user/models',
  })

  return mergePricingAndUserModels(pricingModels, response.data ?? [])
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
  promptCacheKey?: string
  reasoningEffort?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | ChatContentPart[]
  }>
  temperature?: number
}, options: {
  requestId?: string
} = {}) {
  const { reasoningEffort, promptCacheKey, ...rest } = payload
  return desktopRequest<ChatCompletionResponse>({
    method: 'POST',
    path: '/pg/chat/completions',
    requestId: options.requestId,
    body: {
      ...rest,
      prompt_cache_key: promptCacheKey,
      reasoning_effort: reasoningEffort,
      stream: false,
    },
  })
}

export async function streamChatCompletion(
  payload: {
    model: string
    group?: string
    promptCacheKey?: string
    reasoningEffort?: string
    messages: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string | ChatContentPart[]
    }>
    temperature?: number
  },
  handlers: {
    requestId?: string
    signal: AbortSignal
    onDelta: (text: string) => void
    onReasoningDelta?: (text: string) => void
    onDone?: (usage?: ChatCompletionResponse['usage']) => void
  }
) {
  const { reasoningEffort, promptCacheKey, ...rest } = payload
  const bridge = desktopBridge()
  const requestId =
    handlers.requestId ||
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `chat-stream-${Date.now()}`)
  const userId = getStoredDesktopUserId()
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
        notifyDesktopAuthExpiredIfNeeded(event.status ?? 0, event.message || '聊天请求失败')
        finish(() => reject(new Error(event.message || '聊天请求失败')))
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
      .streamChatCompletion({
        requestId,
        userId,
        ...rest,
        promptCacheKey,
        reasoningEffort,
      })
      .catch((error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error('聊天请求失败')))
      })
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
    timeoutMs: resolveDesktopRequestTimeoutMs('/pg/images/generations'),
    body: {
      ...payload,
      stream: false,
    },
  })
}

export async function sendDirectImageGeneration(payload: {
  apiKey: string
  model: string
  prompt: string
  n?: number
  size?: string
  quality?: string
  seed?: number
  response_format?: 'url' | 'b64_json'
  style?: string
}, options: {
  requestId?: string
} = {}) {
  return desktopRequest<ImageGenerationResponse>({
    method: 'POST',
    path: '/v1/images/generations',
    requestId: options.requestId,
    timeoutMs: resolveDesktopRequestTimeoutMs('/v1/images/generations'),
    headers: {
      Authorization: `Bearer ${payload.apiKey}`,
    },
    body: {
      model: payload.model,
      prompt: payload.prompt,
      n: payload.n,
      size: payload.size,
      quality: payload.quality,
      seed: payload.seed,
      response_format: payload.response_format,
      style: payload.style,
    },
  })
}

export async function sendImageEdit(payload: {
  apiKey: string
  model: string
  prompt: string
  imageName: string
  mimeType?: string
  dataBase64: string
  size?: string
  quality?: string
}) {
  return desktopBridge().editImage({
    ...payload,
    userId: getStoredDesktopUserId(),
  })
}

export async function saveImageToDisk(payload: {
  suggestedName: string
  sourceUrl?: string
  dataBase64?: string
}) {
  return desktopBridge().saveImage(payload)
}

export async function copyImageToClipboard(payload: {
  sourceUrl?: string
  dataBase64?: string
  filePath?: string
}) {
  return desktopBridge().copyImageToClipboard(payload)
}

export async function requireEnvelopeData<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
