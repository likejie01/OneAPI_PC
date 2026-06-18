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
