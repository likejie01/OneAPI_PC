import type { CliClient, CliExtensionKind } from '../shared/desktop'

export function parseMarkdownFrontmatterMeta(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    return {
      name: '',
      description: '',
    }
  }

  const lines = match[1].split(/\r?\n/)
  let name = ''
  let description = ''

  for (const line of lines) {
    const nameMatch = line.match(/^\s*name\s*:\s*(.+?)\s*$/)
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
      continue
    }

    const descriptionMatch = line.match(/^\s*description\s*:\s*(.+?)\s*$/)
    if (descriptionMatch) {
      description = descriptionMatch[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }

  return {
    name,
    description,
  }
}

export function buildCliExtensionInsertText(input: {
  client: CliClient
  kind: CliExtensionKind
  name: string
}) {
  const normalizedName = input.name.trim()
  if (!normalizedName) {
    return ''
  }

  if (input.client === 'claude' && input.kind === 'command') {
    return `/${normalizedName} `
  }

  if (input.client === 'codex' && input.kind === 'skill') {
    return `请在本次任务中使用技能 "${normalizedName}"。`
  }

  return ''
}
