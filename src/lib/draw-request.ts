export type PendingDrawRetryRequest =
  | {
      kind: 'edit'
      model: string
      prompt: string
      group: string
      imageName: string
      mimeType?: string
      filePath: string
      size?: string
      quality?: string
    }
  | {
      kind: 'generate'
      model: string
      prompt: string
      group: string
      size?: string
      quality?: string
      seed?: number
      response_format: 'b64_json'
    }

export interface PendingDrawAttachmentInput {
  name: string
  mimeType?: string
  filePath: string
}

export function buildPendingDrawRetryRequest(input: {
  model: string
  prompt: string
  group: string
  size?: string
  quality?: string
  seed?: number
  imageAttachment?: PendingDrawAttachmentInput | null
}): PendingDrawRetryRequest {
  const group = input.group.trim()

  if (input.imageAttachment) {
    return {
      kind: 'edit',
      model: input.model,
      prompt: input.prompt,
      group,
      imageName: input.imageAttachment.name,
      mimeType: input.imageAttachment.mimeType,
      filePath: input.imageAttachment.filePath,
      size: input.size,
      quality: input.quality,
    }
  }

  return {
    kind: 'generate',
    model: input.model,
    prompt: input.prompt,
    group,
    size: input.size,
    quality: input.quality,
    seed: input.seed,
    response_format: 'b64_json',
  }
}

export function resolvePendingDrawRequestGroup(request: Pick<PendingDrawRetryRequest, 'group'>, fallbackGroup = '') {
  return request.group.trim() || fallbackGroup.trim()
}
