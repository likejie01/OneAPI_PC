import type { CliClient, CliExtensionEntry, CliExtensionKind, CliSessionMessage } from '../shared/desktop'

export type CliMessageOverlay = Pick<
  CliSessionMessage,
  'role' | 'content' | 'attachments' | 'selectedExtensions' | 'requestId'
>

export type CliExtensionViewItem = CliExtensionEntry & {
  favorite: boolean
  note: string
  displayName: string
}

export function canUseCliExtension(item: Pick<CliExtensionEntry, 'installed'>) {
  return item.installed !== false
}

export function buildCliExtensionDedupeKey(
  item: Pick<CliExtensionEntry, 'kind' | 'installKey' | 'name' | 'id'>
) {
  const normalizedInstallKey = item.installKey?.trim().toLowerCase() || ''
  if (item.kind === 'plugin' && normalizedInstallKey) {
    return `plugin:${normalizedInstallKey}`
  }
  if ((item.kind === 'skill' || item.kind === 'command') && normalizedInstallKey) {
    return `${item.kind}:${normalizedInstallKey}:${item.name.trim().toLowerCase()}`
  }
  return item.id
}

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

export function buildCliExtensionDisplayName(name: string, note?: string) {
  const normalizedName = name.trim()
  const normalizedNote = (note || '').trim()
  if (!normalizedNote) {
    return normalizedName
  }
  return `${normalizedName} · ${normalizedNote}`
}

function containsChinese(value: string) {
  return /[\u3400-\u9fff]/.test(value)
}

const knownDescriptionTranslations: Array<{
  pattern: RegExp
  replacement: string
}> = [
  {
    pattern: /^Use when resuming work on a project\./i,
    replacement: '适用于继续当前项目开发。',
  },
  {
    pattern: /^Use when implementing any feature or bugfix, before writing implementation code$/i,
    replacement: '适用于实现新功能或修复缺陷前，先按测试驱动方式编写测试。',
  },
  {
    pattern: /^Use when about to claim work is complete.*$/i,
    replacement: '适用于准备宣称任务完成前，先做最终验证并确认结果。',
  },
  {
    pattern: /^An agentic skills framework.*$/i,
    replacement: '一个面向编码代理的技能与工作流框架，覆盖规划、TDD、调试和交付。'
  },
  {
    pattern: /^Planning, TDD, debugging, and delivery workflows for coding agents$/i,
    replacement: '面向编码代理的规划、测试驱动、调试与交付工作流。'
  },
]

export function translateCliExtensionDescription(name: string, description: string) {
  const normalized = description.trim()
  if (!normalized) {
    return ''
  }

  if (containsChinese(normalized)) {
    return normalized
  }

  for (const item of knownDescriptionTranslations) {
    if (item.pattern.test(normalized)) {
      return item.replacement
    }
  }

  const normalizedName = name.trim().toLowerCase()
  if (normalizedName === 'frontend design') {
    return '适用于构建高质量前端界面、组件、页面和交互样式。'
  }
  if (normalizedName === 'continuecoding') {
    return '适用于恢复项目上下文后继续开发，并维护 PROJECT_CONTEXT.md。'
  }
  if (normalizedName === 'superpowers') {
    return '提供规划、测试驱动、调试、并行开发与交付校验等工作流能力。'
  }

  return normalized
}

export function decorateCliExtensions(
  entries: CliExtensionEntry[],
  favoriteIds: string[],
  noteMap: Record<string, string>
): CliExtensionViewItem[] {
  const favoriteIndex = new Map(favoriteIds.map((id, index) => [id, index]))

  return entries
    .map((item) => {
      const note = (noteMap[item.id] || '').trim()
      return {
        ...item,
        favorite: favoriteIndex.has(item.id),
        note,
        displayName: buildCliExtensionDisplayName(item.name, note),
      } satisfies CliExtensionViewItem
    })
    .sort((left, right) => {
      const leftInstalled = canUseCliExtension(left) ? 1 : 0
      const rightInstalled = canUseCliExtension(right) ? 1 : 0
      if (leftInstalled !== rightInstalled) {
        return rightInstalled - leftInstalled
      }

      const leftRank = favoriteIndex.has(left.id) ? 1 : 0
      const rightRank = favoriteIndex.has(right.id) ? 1 : 0
      if (leftRank !== rightRank) {
        return rightRank - leftRank
      }
      if (leftRank && rightRank) {
        return (favoriteIndex.get(left.id) || 0) - (favoriteIndex.get(right.id) || 0)
      }
      return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN')
    })
}

export function buildCliExtensionPromptBlock(items: Array<{
  client: CliClient
  kind: CliExtensionKind
  name: string
}>) {
  if (!items.length) {
    return ''
  }

  const lines = items.map((item, index) => {
    const prefix = `${index + 1}. `
    if (item.kind === 'skill') {
      return `${prefix}本次任务请主动使用已安装技能 "${item.name}"。`
    }
    if (item.kind === 'command') {
      return `${prefix}本次任务请按该命令的既定用途使用 "${item.name}" 命令。`
    }
    return `${prefix}如任务需要，请调用已安装插件 "${item.name}"。`
  })

  return ['扩展调用要求：', ...lines].join('\n')
}

export function buildCliExtensionAugmentedPrompt(
  prompt: string,
  items: Array<{
    client: CliClient
    kind: CliExtensionKind
    name: string
  }>
) {
  const cleanedPrompt = prompt.trim()
  const extensionBlock = buildCliExtensionPromptBlock(items)
  if (!extensionBlock) {
    return cleanedPrompt
  }
  return `${extensionBlock}\n\n${cleanedPrompt}`
}

function buildCliOverlayMatchKey(role: CliSessionMessage['role'], content: string) {
  return `${role}:${content.replace(/\s+/g, ' ').trim()}`
}

export function applyCliMessageOverlays<T extends CliSessionMessage>(
  messages: T[],
  overlays: CliMessageOverlay[]
) {
  const overlayQueues = overlays.reduce<Map<string, CliMessageOverlay[]>>((map, item) => {
    const key = buildCliOverlayMatchKey(item.role, item.content)
    const current = map.get(key) || []
    current.push(item)
    map.set(key, current)
    return map
  }, new Map())

  return messages.map((message) => {
    const key = buildCliOverlayMatchKey(message.role, message.content)
    const queue = overlayQueues.get(key)
    const overlay = queue?.shift()
    if (!overlay) {
      return message
    }
    return {
      ...message,
      attachments: overlay.attachments || message.attachments,
      selectedExtensions: overlay.selectedExtensions || message.selectedExtensions,
      requestId: overlay.requestId || message.requestId,
    }
  })
}

export function collectCliToolNames(sourceKinds: Array<string | undefined>) {
  const seen = new Set<string>()
  const names: string[] = []

  for (const item of sourceKinds) {
    const match = item?.match(/tool_use\.([A-Za-z0-9_-]+)/)
    const toolName = match?.[1]?.trim()
    if (!toolName || seen.has(toolName)) {
      continue
    }
    seen.add(toolName)
    names.push(toolName)
  }

  return names
}

export function resolveCliSlashTriggerState(value: string, caretIndex: number) {
  const safeCaret = Math.max(0, Math.min(caretIndex, value.length))
  const lineStart = value.lastIndexOf('\n', safeCaret - 1) + 1
  const nextBreak = value.indexOf('\n', safeCaret)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const currentLine = value.slice(lineStart, lineEnd)

  return {
    active: currentLine === '/',
    lineStart,
    lineEnd,
  }
}
