export type MessageLinkChip = {
  url: string
  label: string
  hostLabel: string
  kind: 'github' | 'website'
}

function normalizeStandaloneUrl(value: string) {
  return value.replace(/^<|>$/g, '').replace(/[),.;，。；、]+$/g, '')
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

function isLinkLabelOnlyLine(value: string) {
  return /^\s*[-*]?\s*[\p{L}\p{N}\s_-]{0,24}(?:地址|网址|链接|URL|url|官网|文档|GitHub|仓库|云服务)\s*[:：]?\s*$/u.test(value)
}

export function extractMessageLinkChips(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const chips: MessageLinkChip[] = []
  const visibleLines: string[] = []
  const seenUrls = new Set<string>()

  for (const line of lines) {
    const trimmed = line.trim()
    const lineMatches = Array.from(trimmed.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|<?(https?:\/\/[^\s<>)]+)>?/gi))

    if (!lineMatches.length) {
      visibleLines.push(line)
      continue
    }

    let visibleLine = line

    for (const match of lineMatches) {
      const markdownLabel = match[1]?.trim()
      const resolvedUrl = match[2] || match[3]

      if (!resolvedUrl) {
        continue
      }

      const rawMatch = match[0]
      const before = visibleLine.slice(0, Math.max(0, visibleLine.indexOf(rawMatch))).trim()
      const shouldRemoveFromBody =
        trimmed === rawMatch ||
        isLinkLabelOnlyLine(before)

      if (shouldRemoveFromBody) {
        visibleLine = visibleLine.replace(rawMatch, '')
      }

      try {
        const parsed = new URL(normalizeStandaloneUrl(resolvedUrl))
        const normalizedUrl = parsed.toString()
        if (seenUrls.has(normalizedUrl)) {
          continue
        }
        seenUrls.add(normalizedUrl)
        chips.push({
          url: normalizedUrl,
          label: markdownLabel || buildLinkLabel(parsed),
          hostLabel: buildHostLabel(parsed),
          kind: parsed.hostname.toLowerCase() === 'github.com' ? 'github' : 'website',
        })
      } catch {
        /* keep the original line visible below */
      }
    }

    const cleanedLine = visibleLine.replace(/[ \t]+$/g, '')
    if (cleanedLine.trim() && !isLinkLabelOnlyLine(cleanedLine)) {
      visibleLines.push(cleanedLine)
    }
  }

  return {
    chips,
    content: visibleLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }
}
