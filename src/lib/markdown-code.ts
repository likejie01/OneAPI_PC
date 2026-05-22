export function normalizeMarkdownCodeBlockContent(content: string) {
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '')
}
