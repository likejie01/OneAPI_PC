import { desktopBridge, desktopEnvelope, desktopRequest, getStoredDesktopUserId } from '../lib/desktop-client'
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

function resolveStreamDeltaText(data: unknown) {
  if (typeof data !== 'object' || !data) {
    return ''
  }

  if ('choices' in data && Array.isArray((data as { choices?: unknown[] }).choices)) {
    const delta = ((data as { choices: Array<{ delta?: { content?: unknown } }> }).choices[0]?.delta?.content)
    if (typeof delta === 'string') {
      return delta
    }
    if (Array.isArray(delta)) {
      return delta
        .map((item) => {
          if (typeof item === 'object' && item && 'text' in item && typeof item.text === 'string') {
            return item.text
          }
          return ''
        })
        .join('')
    }
  }

  return ''
}

export async function streamChatCompletion(
  payload: {
    model: string
    group?: string
    reasoningEffort?: string
    messages: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string | ChatContentPart[]
    }>
    temperature?: number
  },
  handlers: {
    signal: AbortSignal
    onDelta: (text: string) => void
    onDone?: (usage?: ChatCompletionResponse['usage']) => void
  }
) {
  const { reasoningEffort, ...rest } = payload
  const serverBaseUrl = await desktopBridge().getServerBaseUrl()
  const userId = getStoredDesktopUserId()
  const response = await fetch(`${serverBaseUrl}/pg/chat/completions`, {
    method: 'POST',
    credentials: 'include',
    signal: handlers.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'New-Api-User': userId } : {}),
    },
    body: JSON.stringify({
      ...rest,
      reasoning_effort: reasoningEffort,
      stream: true,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    let message = `请求失败（${response.status}）`
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: { message?: string } }
      message = parsed.message || parsed.error?.message || message
    } catch {
      if (text.trim()) {
        message = text.trim()
      }
    }
    throw new Error(message)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('当前环境不支持流式响应。')
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let usage: ChatCompletionResponse['usage'] | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''

    for (const rawEvent of events) {
      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      for (const line of dataLines) {
        if (!line || line === '[DONE]') {
          continue
        }

        try {
          const parsed = JSON.parse(line) as ChatCompletionResponse & { usage?: ChatCompletionResponse['usage'] }
          const deltaText = resolveStreamDeltaText(parsed)
          if (deltaText) {
            handlers.onDelta(deltaText)
          }
          if (parsed.usage) {
            usage = parsed.usage
          }
        } catch {
          continue
        }
      }
    }
  }

  handlers.onDone?.(usage)
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

export async function requireEnvelopeData<T>(promise: Promise<ApiEnvelope<T>>) {
  const response = await promise
  if (!response.success) {
    throw new Error(response.message || '请求失败')
  }
  return response.data
}
