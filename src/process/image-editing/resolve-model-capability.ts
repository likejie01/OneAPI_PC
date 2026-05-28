const EDIT_CAPABLE_MODELS = new Set([
  'gpt-image-1',
  'gpt-image-2',
  'gpt-image-2-edit',
])

export function resolveEditableModelCapability(model: string) {
  const normalized = model.trim().toLowerCase()
  return {
    requestedModel: model,
    normalizedModel: normalized,
    editable: EDIT_CAPABLE_MODELS.has(normalized),
  }
}
