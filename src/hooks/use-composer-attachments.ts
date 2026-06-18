import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent } from 'react'
import type { ChatContentPart, ChatMessage } from '../shared/contracts'

export type ComposerAttachment = {
  id: string
  name: string
  filePath: string
  size: number
  kind: 'image' | 'file'
  mimeType?: string
  dataBase64: string
  previewUrl?: string
}

type SaveAttachment = (input: {
  name: string
  mimeType?: string
  dataBase64: string
}) => Promise<{ path: string }>

export function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize)
      binary += String.fromCharCode(...chunk)
    }

    return window.btoa(binary)
  })
}

function guessAttachmentKind(file: File, filePath: string) {
  if (file.type.startsWith('image/')) {
    return 'image' as const
  }

  return /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(filePath) ? 'image' as const : 'file' as const
}

function normalizeAttachmentMimeType(attachment: ComposerAttachment) {
  if (attachment.mimeType?.trim()) {
    return attachment.mimeType.trim()
  }
  return attachment.kind === 'image' ? 'image/png' : 'application/octet-stream'
}

function buildAttachmentDataUrl(attachment: ComposerAttachment) {
  return `data:${normalizeAttachmentMimeType(attachment)};base64,${attachment.dataBase64}`
}

function decodeAttachmentText(attachment: ComposerAttachment) {
  const mimeType = normalizeAttachmentMimeType(attachment).toLowerCase()
  const textLike =
    mimeType.startsWith('text/') ||
    /(?:json|xml|csv|yaml|yml|markdown|javascript|typescript|x-sh|x-python)/i.test(mimeType) ||
    /\.(txt|md|markdown|json|csv|tsv|xml|yml|yaml|js|jsx|ts|tsx|css|html|py|java|go|rs|c|cpp|h|hpp|cs|php|rb|sh|ps1|sql|log)$/i.test(attachment.name)
  if (!textLike || !attachment.dataBase64) {
    return ''
  }

  try {
    const binary = window.atob(attachment.dataBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 80_000)
  } catch {
    return ''
  }
}

function buildFileAttachmentText(attachment: ComposerAttachment) {
  const decodedText = decodeAttachmentText(attachment).trim()
  const header = [
    `[附件] ${attachment.name}`,
    attachment.filePath ? `路径：${attachment.filePath}` : '',
    `类型：${normalizeAttachmentMimeType(attachment)}`,
  ].filter(Boolean).join('\n')

  if (!decodedText) {
    return `${header}\n内容：当前接口不支持直接上传普通文件，客户端已改为文本引用；如需分析文件内容，请粘贴文本或使用可读取的文本文件。`
  }

  return `${header}\n内容：\n${decodedText}`
}

export function buildChatAttachmentContent(
  text: string,
  attachments: ComposerAttachment[],
): string | ChatContentPart[] {
  if (!attachments.length) {
    return text
  }

  const parts: ChatContentPart[] = [
    {
      type: 'text',
      text,
    },
  ]

  for (const attachment of attachments) {
    if (!attachment.dataBase64) {
      continue
    }

    if (attachment.kind === 'image') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: buildAttachmentDataUrl(attachment),
        },
      })
      continue
    }

    parts.push({
      type: 'text',
      text: buildFileAttachmentText(attachment),
    })
  }

  return parts.length === 1 ? text : parts
}

export function buildPersistedChatRequestContent(
  text: string,
  attachments: ComposerAttachment[],
): string | ChatContentPart[] | undefined {
  const fileAttachments = attachments.filter((item) => item.kind === 'file')
  if (!fileAttachments.length) {
    return undefined
  }
  const content = buildChatAttachmentContent(text, fileAttachments)
  return content === text ? undefined : content
}

export function resolveChatMessageRequestContent(message: ChatMessage) {
  return message.requestContent ?? message.content
}

export function toMessageAttachments(attachments: ComposerAttachment[]) {
  return attachments.map((item) => ({
    id: item.id,
    name: item.name,
    filePath: item.filePath,
    kind: item.kind,
  }))
}

export function toRenderableFileUrl(filePath: string) {
  if (!filePath.trim()) {
    return ''
  }
  const normalized = filePath.replace(/\\/g, '/')
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

export function rehydrateCliComposerAttachments(
  attachments: Array<{
    id: string
    name: string
    filePath: string
    kind: 'image' | 'file'
  }> = [],
): ComposerAttachment[] {
  return attachments.map((item) => ({
    id: item.id || globalThis.crypto.randomUUID(),
    name: item.name,
    filePath: item.filePath,
    size: 0,
    kind: item.kind,
    dataBase64: '',
    previewUrl: item.kind === 'image' ? toRenderableFileUrl(item.filePath) : undefined,
  }))
}

export function isInlinePreviewableFile(targetPath: string) {
  const normalized = targetPath.trim().toLowerCase()
  const fileName = normalized.split(/[\\/]/).filter(Boolean).at(-1) || normalized
  if (fileName === 'dockerfile' || fileName === '.env' || fileName.endsWith('.env')) {
    return true
  }

  return /\.(txt|md|markdown|json|ya?ml|toml|ini|conf|cfg|log|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|less|html|htm|xml|vue|py|java|kt|kts|go|rs|rb|php|swift|sh|bash|zsh|ps1|sql|c|cc|cpp|h|hpp)$/i.test(normalized)
}

export function isImagePreviewableFile(targetPath: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(targetPath.trim().toLowerCase())
}

export function isMarkdownPreviewableFile(targetPath: string) {
  return /\.(md|markdown)$/i.test(targetPath.trim().toLowerCase())
}

export function isEmbeddedPreviewableFile(targetPath: string) {
  return /\.(pdf)$/i.test(targetPath.trim().toLowerCase())
}

export function useComposerAttachments(toast: (message: string) => void, saveAttachment: SaveAttachment) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      setAttachments((current) => {
        current.forEach((item) => {
          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl)
          }
        })
        return current
      })
    }
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
        }
      })
      return []
    })
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) =>
      current.filter((item) => {
        if (item.id === attachmentId && item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
        }
        return item.id !== attachmentId
      }),
    )
  }, [])

  const replaceAttachments = useCallback((nextAttachments: ComposerAttachment[]) => {
    setAttachments((current) => {
      current.forEach((item) => {
        if (item.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl)
        }
      })
      return nextAttachments
    })
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [])

  const appendFiles = useCallback(async (incomingFiles: File[]) => {
    if (!incomingFiles.length) {
      return
    }

    try {
      const nextAttachments = await Promise.all(
        incomingFiles.map(async (file) => {
          const fileWithPath = file as File & { path?: string }
          const dataBase64 = await fileToBase64(file)
          const filePath =
            fileWithPath.path?.trim() ||
            (
              await saveAttachment({
                name: file.name || 'clipboard-file',
                mimeType: file.type,
                dataBase64,
              })
            ).path

          return {
            id: globalThis.crypto.randomUUID(),
            name: file.name || filePath.split(/[\\/]/).filter(Boolean).at(-1) || '未命名附件',
            filePath,
            size: file.size,
            kind: guessAttachmentKind(file, filePath),
            mimeType: file.type || undefined,
            dataBase64,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
          } satisfies ComposerAttachment
        }),
      )

      setAttachments((current) => {
        const seen = new Set(current.map((item) => `${item.name}:${item.filePath}:${item.size}`))
        return [
          ...current,
          ...nextAttachments.filter((item) => {
            const key = `${item.name}:${item.filePath}:${item.size}`
            if (seen.has(key)) {
              if (item.previewUrl) {
                URL.revokeObjectURL(item.previewUrl)
              }
              return false
            }
            seen.add(key)
            return true
          }),
        ]
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '附件处理失败')
    }
  }, [saveAttachment, toast])

  const handleInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    await appendFiles(files)
    event.target.value = ''
  }, [appendFiles])

  const handlePaste = useCallback(async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files || [])
    if (!files.length) {
      return
    }

    event.preventDefault()
    await appendFiles(files)
  }, [appendFiles])

  const handleDrop = useCallback(async (event: DragEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    const files = Array.from(event.dataTransfer.files || [])
    if (!files.length) {
      return
    }

    event.preventDefault()
    await appendFiles(files)
  }, [appendFiles])

  return {
    attachments,
    inputRef,
    clearAttachments,
    removeAttachment,
    replaceAttachments,
    handleInputChange,
    handlePaste,
    handleDrop,
    openPicker: () => inputRef.current?.click(),
  }
}
