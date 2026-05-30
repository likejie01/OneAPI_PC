import type { ChatMessage, ChatCompletionResponse } from '../shared/contracts'

const THINK_OPEN_TAG = '<think>'
const THINK_CLOSE_TAG = '</think>'

function extractTextDelta(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }
        if (typeof item === 'object' && item && 'text' in item && typeof item.text === 'string') {
          return item.text
        }
        return ''
      })
      .join('')
  }

  return ''
}

function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') {
    return ''
  }

  if ('reasoning_content' in delta) {
    return extractTextDelta(delta.reasoning_content)
  }

  if ('reasoning' in delta && typeof delta.reasoning === 'string') {
    return delta.reasoning
  }

  return ''
}

function parseThinkTags(content: string) {
  if (!content.includes(THINK_OPEN_TAG)) {
    return {
      visibleContent: content,
      reasoningContent: '',
      hasUnclosedReasoningTag: false,
    }
  }

  const visibleParts: string[] = []
  const reasoningParts: string[] = []
  let cursor = 0
  let hasUnclosedReasoningTag = false

  while (cursor < content.length) {
    const openIndex = content.indexOf(THINK_OPEN_TAG, cursor)
    if (openIndex === -1) {
      visibleParts.push(content.slice(cursor))
      break
    }

    if (openIndex > cursor) {
      visibleParts.push(content.slice(cursor, openIndex))
    }

    const reasoningStart = openIndex + THINK_OPEN_TAG.length
    const closeIndex = content.indexOf(THINK_CLOSE_TAG, reasoningStart)
    if (closeIndex === -1) {
      reasoningParts.push(content.slice(reasoningStart))
      hasUnclosedReasoningTag = true
      break
    }

    reasoningParts.push(content.slice(reasoningStart, closeIndex))
    cursor = closeIndex + THINK_CLOSE_TAG.length
  }

  return {
    visibleContent: visibleParts.join(''),
    reasoningContent: reasoningParts.join('\n\n'),
    hasUnclosedReasoningTag,
  }
}

export function deriveDesktopChatDisplayState(content: string, reasoningContent: string) {
  const parsed = parseThinkTags(content || '')
  const directReasoning = (reasoningContent || '').trim()

  return {
    visibleContent: parsed.visibleContent,
    reasoningContent: directReasoning || parsed.reasoningContent,
    hasUnclosedReasoningTag: parsed.hasUnclosedReasoningTag,
  }
}

export function normalizeStoredDesktopChatMessage(message: ChatMessage): ChatMessage {
  const displayState = deriveDesktopChatDisplayState(
    message.content || '',
    message.reasoningContent || ''
  )
  const normalizedReasoning = displayState.reasoningContent.trim()

  return {
    ...message,
    content: displayState.visibleContent,
    reasoningContent: normalizedReasoning || undefined,
    reasoningPending: false,
    pending: false,
  }
}

export type DesktopChatStreamParsedLine = {
  deltaText: string
  reasoningText: string
  done: boolean
  usage?: ChatCompletionResponse['usage']
}

export function parseDesktopChatStreamDataLine(line: string): DesktopChatStreamParsedLine | null {
  const normalized = line.trim()
  if (!normalized) {
    return null
  }

  if (normalized === '[DONE]') {
    return {
      deltaText: '',
      reasoningText: '',
      done: true,
    }
  }

  try {
    const parsed = JSON.parse(normalized) as ChatCompletionResponse & {
      choices?: Array<{
        delta?: {
          content?: unknown
          reasoning?: unknown
          reasoning_content?: unknown
        }
        finish_reason?: string | null
      }>
      usage?: ChatCompletionResponse['usage']
    }
    const choice = parsed.choices?.[0]
    const delta = choice?.delta

    return {
      deltaText: extractTextDelta(delta?.content),
      reasoningText: extractReasoningDelta(delta),
      done: typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0,
      usage: parsed.usage,
    }
  } catch {
    return null
  }
}

export function parseDesktopChatStreamEventBlock(rawEvent: string): DesktopChatStreamParsedLine[] {
  return rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .map((line) => parseDesktopChatStreamDataLine(line))
    .filter((item): item is DesktopChatStreamParsedLine => item !== null)
}
