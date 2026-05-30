type ImagePayloadRecord = Record<string, unknown>

const IMAGE_URL_KEYS = ['url', 'image_url', 'imageUrl']
const IMAGE_BASE64_KEYS = ['b64_json', 'b64Json', 'image_base64', 'binary_data_base64', 'base64']
const IMAGE_PROMPT_KEYS = ['revised_prompt', 'revisedPrompt', 'prompt']
const IMAGE_OUTPUT_KEYS = ['output', 'images', 'result']

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

  const outputType = readString(record.type)
  const outputResult = firstNonEmptyString([
    record.result,
    record.image,
    record.output_image,
  ])
  if (
    outputResult &&
    (
      outputType === 'image_generation_call' ||
      outputType === 'output_image' ||
      outputType === 'image'
    )
  ) {
    return toDisplayableItems({ b64_json: outputResult, revised_prompt: prompt })
  }

  for (const key of IMAGE_OUTPUT_KEYS) {
    const nestedOutput = record[key]
    if (Array.isArray(nestedOutput)) {
      const items = nestedOutput.flatMap((item) => toDisplayableItems(item))
      if (items.length) {
        return items
      }
    }
    const nestedOutputRecord = asRecord(nestedOutput)
    if (nestedOutputRecord) {
      const items = toDisplayableItems(nestedOutputRecord)
      if (items.length) {
        return items
      }
    }
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

export function resolveImageResponseErrorMessage(response: unknown) {
  const record = asRecord(response)
  if (!record) {
    return ''
  }

  const directMessage = readString(record.message)
  if (directMessage) {
    return directMessage
  }

  const nestedError = asRecord(record.error)
  if (nestedError) {
    return firstNonEmptyString([
      nestedError.message,
      nestedError.detail,
      nestedError.type,
    ])
  }

  return ''
}
