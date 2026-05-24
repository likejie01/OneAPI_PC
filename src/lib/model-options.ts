import type { ChatModelOption } from '../shared/contracts'

export type PricingModelLike = {
  model_name: string
  supported_endpoint_types?: string[]
}

export function mergePricingAndUserModels(
  pricingModels: PricingModelLike[],
  userModels: string[]
): ChatModelOption[] {
  const merged: ChatModelOption[] = []
  const seen = new Set<string>()

  for (const item of pricingModels) {
    const modelName = item.model_name?.trim()
    if (!modelName || seen.has(modelName)) {
      continue
    }
    seen.add(modelName)
    merged.push({
      label: modelName,
      value: modelName,
      supportedEndpointTypes: Array.isArray(item.supported_endpoint_types)
        ? item.supported_endpoint_types
        : undefined,
    })
  }

  for (const model of userModels) {
    const modelName = model.trim()
    if (!modelName || seen.has(modelName)) {
      continue
    }
    seen.add(modelName)
    merged.push({
      label: modelName,
      value: modelName,
    })
  }

  return merged
}
