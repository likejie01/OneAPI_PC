export type ResolvedMarkdownLink =
  | { kind: 'local'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'ignored' }

export type BareFilePathPart =
  | { kind: 'text'; text: string }
  | { kind: 'local'; text: string; path: string }

const knownFileExtensionPattern =
  /\.(?:md|markdown|txt|json|jsonc|ya?ml|toml|tsx?|jsx?|css|scss|less|html?|vue|svelte|rs|go|py|java|kt|swift|c|cc|cpp|cxx|h|hpp|cs|php|rb|sh|ps1|bat|cmd|sql|xml|ini|env|lock|mjs|cjs|mts|cts)\b/i

const bareFilePathPattern =
  /(?:[A-Za-z]:[\\/][^\s<>"'`]+)|(?:(?:\.{1,2}[\\/])?(?:[\p{L}\p{N}_@+~.-]+[\\/])+[\p{L}\p{N}_@+~.-]+\.[A-Za-z0-9]{1,12}(?:[#?][^\s<>"'`]*)?)|(?<![\p{L}\p{N}_@+~.-])[\p{L}\p{N}_@+~.-]+\.(?:md|markdown|txt|json|jsonc|ya?ml|toml|tsx?|jsx?|css|scss|less|html?|vue|svelte|rs|go|py|java|kt|swift|c|cc|cpp|cxx|h|hpp|cs|php|rb|sh|ps1|bat|cmd|sql|xml|ini|env|lock)(?:[#?][^\s<>"'`]*)?/giu

function stripFileProtocol(value: string) {
  return value.replace(/^file:\/\/\/?/i, '')
}

function decodeLinkPath(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeBasePath(value?: string) {
  return (value || '').trim().replace(/[\\/]+$/, '')
}

function isPartOfUrl(text: string, index: number) {
  const previousText = text.slice(Math.max(0, index - 24), index)
  return /[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]*$/i.test(previousText)
}

function trimBareFilePathCandidate(value: string) {
  const match = value.match(/^(.+?)([),.;:!?，。；：！？、）\]]*)$/u)
  return {
    candidate: match?.[1] || value,
    trailing: match?.[2] || '',
  }
}

function recoverSplitBareFileExtension(candidate: string, trailing: string, followingText: string) {
  if (trailing !== '.' || knownFileExtensionPattern.test(candidate)) {
    return { candidate, trailing, consumedLength: 0 }
  }

  const match = followingText.match(/^(\s*[A-Za-z0-9]{1,12})([),.;:!?，。；：！？、）\]\s]|$)/u)
  if (!match) {
    return { candidate, trailing, consumedLength: 0 }
  }

  const extension = `.${match[1].replace(/\s+/g, '')}`
  if (!knownFileExtensionPattern.test(extension)) {
    return { candidate, trailing, consumedLength: 0 }
  }

  return {
    candidate: `${candidate}${extension}`,
    trailing: '',
    consumedLength: match[1].length + (match[2].trim() ? match[2].length : 0),
  }
}

export function appendMarkdownLinkSuffix(href: string, trailingChildren: string[]) {
  const normalizedHref = (href || '').trim()
  const firstText = trailingChildren.find((item) => item.length > 0) || ''
  const match = firstText.match(/^(\s*\.\s*[A-Za-z0-9]{1,12})([),.;:!?，。；：！？、）\]\s]|$)/u)
  if (!normalizedHref || !match) {
    return { href: normalizedHref, consumedChildren: [] as string[] }
  }

  const extension = match[1].replace(/\s+/g, '')
  if (!knownFileExtensionPattern.test(extension)) {
    return { href: normalizedHref, consumedChildren: [] as string[] }
  }
  if (!isAbsoluteLocalPath(normalizedHref) && !isRelativeLocalPath(normalizedHref)) {
    return { href: normalizedHref, consumedChildren: [] as string[] }
  }
  if (knownFileExtensionPattern.test(normalizedHref)) {
    return { href: normalizedHref, consumedChildren: [] as string[] }
  }

  const consumedText = firstText.slice(0, match[1].length + (match[2].trim() ? match[2].length : 0))
  return {
    href: `${normalizedHref}${extension}`,
    consumedChildren: [consumedText],
  }
}

export function isAbsoluteLocalPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\/(Users|home|var|private|Volumes)\//.test(value)
}

export function isRelativeLocalPath(value: string) {
  const normalized = value.trim()
  if (!normalized || normalized.startsWith('#') || normalized.startsWith('?')) {
    return false
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return false
  }
  if (normalized.startsWith('//')) {
    return false
  }
  return /[\\/]/.test(normalized) || /^[.]{1,2}[\\/]/.test(normalized) || /^[\w.-]+\.[A-Za-z0-9]{1,12}(#.*)?$/.test(normalized)
}

export function resolveMarkdownLinkTarget(href: string | undefined, localPathBase?: string): ResolvedMarkdownLink {
  const target = (href || '').trim()
  if (!target) {
    return { kind: 'ignored' }
  }

  if (/^file:\/\//i.test(target)) {
    return { kind: 'local', path: decodeLinkPath(stripFileProtocol(target)) }
  }

  if (isAbsoluteLocalPath(target)) {
    return { kind: 'local', path: decodeLinkPath(target) }
  }

  if (/^(https?:|mailto:)/i.test(target)) {
    return { kind: 'external', url: target }
  }

  if (isRelativeLocalPath(target)) {
    const basePath = normalizeBasePath(localPathBase)
    if (!basePath) {
      return { kind: 'external', url: target }
    }
    const cleanTarget = target.replace(/[?#].*$/, '')
    return { kind: 'local', path: `${basePath}\\${decodeLinkPath(cleanTarget)}` }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return { kind: 'external', url: target }
  }

  return { kind: 'ignored' }
}

export function splitBareFilePathLinks(text: string, localPathBase?: string): BareFilePathPart[] {
  if (!text || !normalizeBasePath(localPathBase)) {
    return [{ kind: 'text', text }]
  }

  const parts: BareFilePathPart[] = []
  let lastIndex = 0

  for (const match of text.matchAll(bareFilePathPattern)) {
    const rawCandidate = match[0]
    const matchIndex = match.index ?? 0

    if (matchIndex < lastIndex || isPartOfUrl(text, matchIndex)) {
      continue
    }

    const trimmed = trimBareFilePathCandidate(rawCandidate)
    const recovered = recoverSplitBareFileExtension(
      trimmed.candidate,
      trimmed.trailing,
      text.slice(matchIndex + rawCandidate.length),
    )
    const resolvedTarget = resolveMarkdownLinkTarget(recovered.candidate, localPathBase)
    if (resolvedTarget.kind !== 'local') {
      continue
    }

    if (matchIndex > lastIndex) {
      parts.push({ kind: 'text', text: text.slice(lastIndex, matchIndex) })
    }

    parts.push({ kind: 'local', text: recovered.candidate, path: resolvedTarget.path })

    if (recovered.trailing) {
      parts.push({ kind: 'text', text: recovered.trailing })
    }
    lastIndex = matchIndex + rawCandidate.length + recovered.consumedLength
  }

  if (lastIndex < text.length) {
    parts.push({ kind: 'text', text: text.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ kind: 'text', text }]
}
