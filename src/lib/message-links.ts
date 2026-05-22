export type MessageLinkChip = {
  url: string
  label: string
  hostLabel: string
  kind: 'github' | 'website'
}

function normalizeStandaloneUrl(value: string) {
  return value.replace(/^<|>$/g, '')
}

function buildLinkLabel(url: URL) {
  if (url.hostname.toLowerCase() === 'github.com') {
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length >= 2) {
      return `${segments[0]}/${segments[1]}`
    }
  }

  const trimmedPath = url.pathname.replace(/\/$/, '')
  if (!trimmedPath || trimmedPath === '/') {
    return url.hostname.replace(/^www\./i, '')
  }
  const shortPath = trimmedPath.length > 26 ? `${trimmedPath.slice(0, 26)}...` : trimmedPath
  return `${url.hostname.replace(/^www\./i, '')}${shortPath}`
}

function buildHostLabel(url: URL) {
  return url.hostname.toLowerCase() === 'github.com' ? 'GitHub' : url.hostname.replace(/^www\./i, '')
}

export function extractMessageLinkChips(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const chips: MessageLinkChip[] = []
  const visibleLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    const markdownMatch = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i)
    const urlOnlyMatch = trimmed.match(/^<?(https?:\/\/[^\s>]+)>?$/i)
    const resolvedUrl = markdownMatch?.[2] || urlOnlyMatch?.[1]

    if (!resolvedUrl) {
      visibleLines.push(line)
      continue
    }

    try {
      const parsed = new URL(normalizeStandaloneUrl(resolvedUrl))
      chips.push({
        url: parsed.toString(),
        label: markdownMatch?.[1]?.trim() || buildLinkLabel(parsed),
        hostLabel: buildHostLabel(parsed),
        kind: parsed.hostname.toLowerCase() === 'github.com' ? 'github' : 'website',
      })
    } catch {
      visibleLines.push(line)
    }
  }

  return {
    chips,
    content: visibleLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }
}
