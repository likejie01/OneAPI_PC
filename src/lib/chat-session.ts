import type { ChatContentPart, ChatMessage } from '../shared/contracts'

export type AssistantSwitchChatSessionLike = {
  assistantId: string
  model: string
  group: string
  updatedAt: number
  messages: Array<unknown>
}

export type ChatAssistantIdentity = {
  id: string
}

export const OMITTED_INLINE_DATA_URL = '__oneapi_inline_data_omitted__'
export const MAX_ASSISTANT_STORAGE_SESSIONS = 32
export const MAX_ASSISTANT_STORAGE_MESSAGES_PER_SESSION = 64
export const MAX_ASSISTANT_STORAGE_TEXT_CHARS = 80_000
export const ASSISTANT_STREAM_UI_FLUSH_INTERVAL_MS = 80

export type SaveInlineImageAttachment = (input: {
  name: string
  mimeType?: string
  dataBase64: string
}) => Promise<{ path: string }>

function truncateAssistantStorageText(value: string | undefined) {
  if (!value || value.length <= MAX_ASSISTANT_STORAGE_TEXT_CHARS) {
    return value
  }
  return `${value.slice(0, MAX_ASSISTANT_STORAGE_TEXT_CHARS - 1).trimEnd()}…`
}

function isInlineDataUrl(value: string | undefined) {
  return !!value && /^data:[^;]+;base64,/i.test(value)
}

function parseInlineImageDataUrl(value: string | undefined) {
  const match = value?.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]+)$/i)
  if (!match) {
    return null
  }
  const mimeType = match[1].toLowerCase()
  const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'png'
  return {
    mimeType,
    extension: extension === 'jpeg' ? 'jpg' : extension,
    dataBase64: match[2],
  }
}

export function toRenderableLocalFileUrl(filePath: string) {
  const normalized = filePath.trim().replace(/\\/g, '/')
  if (!normalized) {
    return ''
  }
  if (/^file:\/\//i.test(normalized)) {
    return normalized
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`)
  }
  if (normalized.startsWith('/')) {
    return encodeURI(`file://${normalized}`)
  }
  return encodeURI(normalized)
}

function compactRequestContentPart(part: ChatContentPart): ChatContentPart {
  if (part.type === 'text') {
    return {
      ...part,
      text: truncateAssistantStorageText(part.text) || '',
    }
  }

  if (part.type === 'image_url') {
    return {
      ...part,
      image_url: {
        ...part.image_url,
        url: isInlineDataUrl(part.image_url.url) ? OMITTED_INLINE_DATA_URL : part.image_url.url,
      },
    }
  }

  return {
    ...part,
    file: {
      ...part.file,
      file_data: isInlineDataUrl(part.file.file_data)
        ? OMITTED_INLINE_DATA_URL
        : truncateAssistantStorageText(part.file.file_data) || '',
    },
  }
}

function compactRequestContent(requestContent: ChatMessage['requestContent']) {
  if (typeof requestContent === 'string') {
    return truncateAssistantStorageText(requestContent)
  }
  if (Array.isArray(requestContent)) {
    return requestContent.map((part) => compactRequestContentPart(part))
  }
  return requestContent
}

export function compactAssistantMessageForStorage<T extends ChatMessage>(message: T): T {
  return {
    ...message,
    content: truncateAssistantStorageText(message.content) || '',
    reasoningContent: truncateAssistantStorageText(message.reasoningContent),
    imageUrl: isInlineDataUrl(message.imageUrl) ? OMITTED_INLINE_DATA_URL : message.imageUrl,
    requestContent: compactRequestContent(message.requestContent),
  }
}

export function compactAssistantSessionsForStorage<
  TSession extends { updatedAt: number; messages: ChatMessage[] }
>(sessions: TSession[]): TSession[] {
  return [...sessions]
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, MAX_ASSISTANT_STORAGE_SESSIONS)
    .map((session) => ({
      ...session,
      messages: session.messages
        .slice(-MAX_ASSISTANT_STORAGE_MESSAGES_PER_SESSION)
        .map((message) => compactAssistantMessageForStorage(message)),
    }) as TSession)
}

export async function persistInlineImageMessageToFileUrl<T extends ChatMessage>(
  message: T,
  saveAttachment: SaveInlineImageAttachment,
): Promise<T> {
  const inlineImage = parseInlineImageDataUrl(message.imageUrl)
  if (!inlineImage) {
    return message
  }

  const saved = await saveAttachment({
    name: `oneapi-image-${message.createdAt || Date.now()}.${inlineImage.extension}`,
    mimeType: inlineImage.mimeType,
    dataBase64: inlineImage.dataBase64,
  })
  const imageUrl = toRenderableLocalFileUrl(saved.path)
  return imageUrl ? { ...message, imageUrl } : message
}

export function shouldFlushAssistantStreamUpdate(input: {
  now: number
  lastFlushAt: number
  force?: boolean
}) {
  return !!input.force || input.lastFlushAt <= 0 || input.now - input.lastFlushAt >= ASSISTANT_STREAM_UI_FLUSH_INTERVAL_MS
}

export function shouldCreateAssistantSwitchChatSession(
  currentSession: AssistantSwitchChatSessionLike | null,
  nextAssistantId: string
) {
  if (!currentSession) {
    return true
  }

  if (currentSession.assistantId === nextAssistantId) {
    return false
  }

  return currentSession.messages.length > 0
}

export function applyAssistantSelectionToEmptyChatSession<T extends AssistantSwitchChatSessionLike>(
  session: T,
  nextAssistantId: string,
  nextModel: string,
  nextGroup: string,
  now = Date.now()
) {
  return {
    ...session,
    assistantId: nextAssistantId,
    model: nextModel,
    group: nextGroup,
    updatedAt: Math.max(now, session.updatedAt),
  }
}

export function resolveChatSessionAssistant<T extends ChatAssistantIdentity>(
  assistants: T[],
  currentSession: { assistantId?: string | null } | null,
  fallbackAssistantId?: string | null
) {
  const sessionAssistant = currentSession?.assistantId
    ? assistants.find((item) => item.id === currentSession.assistantId)
    : null
  if (sessionAssistant) {
    return sessionAssistant
  }

  return (
    (fallbackAssistantId ? assistants.find((item) => item.id === fallbackAssistantId) : null) ??
    assistants[0] ??
    null
  )
}
