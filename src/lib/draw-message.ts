export function resolveVisibleDrawMessageContent(input: {
  role: 'system' | 'user' | 'assistant'
  content: string
  imageUrl?: string
  pending?: boolean
}) {
  if (input.role === 'assistant' && input.imageUrl && !input.pending) {
    return ''
  }
  return input.content
}
