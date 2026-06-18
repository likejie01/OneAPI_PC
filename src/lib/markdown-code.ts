export function normalizeMarkdownCodeBlockContent(content: string) {
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

export function isMermaidMarkdownCodeBlock(className: string | undefined) {
  return /(^|\s)language-mermaid(\s|$)/.test(className || '')
}

export function shouldRenderMarkdownCodeBlock(className: string | undefined, content: string) {
  const isBlock = /(^|\s)language-/.test(className || '') || /\n/.test(content)
  if (!isBlock) {
    return false
  }

  return normalizeMarkdownCodeBlockContent(content).trim().length > 0
}
