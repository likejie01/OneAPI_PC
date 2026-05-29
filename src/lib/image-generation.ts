type ImagePayloadRecord = Record<string, unknown>

const IMAGE_URL_KEYS = ['url', 'image_url', 'imageUrl']
const IMAGE_BASE64_KEYS = ['b64_json', 'b64Json', 'image_base64', 'binary_data_base64', 'base64']
const IMAGE_PROMPT_KEYS = ['revised_prompt', 'revisedPrompt', 'prompt']

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function firstNonEmptyString(values: unknown[]) {
  for (const value of values) {
    const normalized = readString(value)
    if (normalized) {
      return normalized
    }
  }
  return ''
}

function asRecord(value: unknown): ImagePayloadRecord | null {
  return value && typeof value === 'object' ? value as ImagePayloadRecord : null
}

function toDisplayableItems(value: unknown): Array<{
  prompt: string
  source: string
}> {
  if (typeof value === 'string') {
    const source = readString(value)
    return source ? [{ prompt: '', source }] : []
  }

  const record = asRecord(value)
  if (!record) {
    return []
  }

  const directUrl = firstNonEmptyString(IMAGE_URL_KEYS.map((key) => record[key]))
  const directBase64 = firstNonEmptyString(IMAGE_BASE64_KEYS.map((key) => record[key]))
  const prompt = firstNonEmptyString(IMAGE_PROMPT_KEYS.map((key) => record[key]))

  if (directUrl || directBase64) {
    const source = directUrl || (
      directBase64.startsWith('data:image/')
        ? directBase64
        : `data:image/png;base64,${directBase64}`
    )
    return [{ prompt, source }]
  }

  const nestedData = record.data
  if (Array.isArray(nestedData)) {
    return nestedData.flatMap((item) => toDisplayableItems(item))
  }

  const nestedRecord = asRecord(nestedData)
  if (!nestedRecord) {
    return []
  }

  return [
    ...['image_urls'].flatMap((key) =>
      Array.isArray(nestedRecord[key])
        ? (nestedRecord[key] as unknown[]).flatMap((item) => toDisplayableItems({ url: item, prompt }))
        : []
    ),
    ...['image_base64', 'binary_data_base64'].flatMap((key) =>
      Array.isArray(nestedRecord[key])
        ? (nestedRecord[key] as unknown[]).flatMap((item) => toDisplayableItems({ b64_json: item, prompt }))
        : []
    ),
    ...toDisplayableItems({
      ...nestedRecord,
      revised_prompt: nestedRecord.revised_prompt ?? prompt,
    }),
  ]
}

export function resolveImageMessageSource(item: unknown) {
  return toDisplayableItems(item)[0]?.source || ''
}

export function resolveImageGenerationResult(response: unknown, fallbackPrompt = '') {
  const displayable = toDisplayableItems(response)
  const first = displayable[0]
  if (!first) {
    return null
  }

  return {
    imageUrl: first.source,
    prompt: first.prompt || fallbackPrompt,
  }
}
