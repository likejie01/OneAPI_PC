export function shouldRenderCliLogEventRow(input: {
  duplicatedPrimary: boolean
  hasExpandableContent: boolean
  hasInteraction: boolean
}) {
  return !input.duplicatedPrimary || input.hasExpandableContent || input.hasInteraction
}

function normalizeComparable(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function extractJsonCommand(detail: string) {
  try {
    const parsed = JSON.parse(detail) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return ''
    }
    const command = (parsed as { command?: unknown }).command
    return typeof command === 'string' ? command : ''
  } catch {
    return ''
  }
}

export function shouldRenderCliLogCommandBlock(input: {
  command?: string
  detail?: string
}) {
  const command = input.command?.trim() || ''
  if (!command) {
    return false
  }
  const detailCommand = extractJsonCommand(input.detail?.trim() || '')
  if (!detailCommand) {
    return true
  }
  return normalizeComparable(detailCommand) !== normalizeComparable(command)
}

export function shouldRenderCliLogOutputEntry(input: {
  outputIndex: number
  entryHeadline: string
  entryDetail: string
  groupHeadline: string
}) {
  if (input.outputIndex !== 0) {
    return true
  }

  if (input.entryDetail.trim()) {
    return true
  }

  return normalizeComparable(input.entryHeadline) !== normalizeComparable(input.groupHeadline)
}
