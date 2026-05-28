import type { DesktopImageEditRequest } from '../../types.ts'
import { resolveEditableModelCapability } from './resolve-model-capability.ts'

export interface BuildEditRequestInput {
  apiKey: string
  userId?: string
  model: string
  fallbackModel?: string
  prompt: string
  imageName: string
  mimeType?: string
  dataBase64: string
  size?: string
  quality?: string
}

export function buildImageEditRequest(input: BuildEditRequestInput): DesktopImageEditRequest {
  const requested = resolveEditableModelCapability(input.model)
  const fallback = input.fallbackModel ? resolveEditableModelCapability(input.fallbackModel) : null

  if (!requested.editable && !fallback?.editable) {
    throw new Error(`当前模型 ${input.model} 不支持图片编辑`)
  }

  return {
    apiKey: input.apiKey,
    userId: input.userId,
    model: requested.editable ? input.model : input.fallbackModel || input.model,
    prompt: input.prompt,
    imageName: input.imageName,
    mimeType: input.mimeType,
    dataBase64: input.dataBase64,
    size: input.size,
    quality: input.quality,
  }
}
