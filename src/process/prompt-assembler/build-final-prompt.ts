import type { CliClient } from '../../shared/desktop.ts'

export const CLI_EXECUTION_POLICY = [
  '执行策略：',
  '1. 先选择最小修改量、最高成功率、最少副作用的方案。',
  '2. 如果当前方案失败，先分析失败原因，再列出可替代方案。',
  '3. 将替代方案按“最小修改量、最高有效性、最低风险”的顺序排序后继续尝试。',
  '4. 只有在问题解决，或已穷尽所有合理方案仍无法解决时，才结束任务。',
  '5. 回复中要明确写出失败原因、尝试顺序、最终采用的方案或无法解决的结论。',
  '6. 除非用户明确指定其他语言，否则默认使用简体中文回复。',
  '7. 客户端不再附加读写限制；如果命令失败，先读取错误信息并按真实失败原因处理。',
  '8. 优先使用当前项目目录内的相对路径；不要无理由扫描用户主目录、密钥目录、缓存目录或系统目录。',
  '9. 在 Windows PowerShell 受限语言模式下，不要执行 [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 或类似 .NET 属性设置；如需处理编码，优先使用 chcp 65001 或直接执行原命令。',
  '10. 在 Windows PowerShell 中读取或写入文件时，路径包含空格、括号、方括号、中文或通配符字符必须使用单引号和 -LiteralPath，例如 Get-Content -LiteralPath \'D:\\\\WorkSpace\\\\Demo\\\\src\\\\app\\\\(main)\\\\page.tsx\'；不要把 $null 作为参数传给 PowerShell 命令，参数没有值时应直接省略。',
  '11. 需要 npm/npx 安装依赖时必须允许在线拉取；如果出现 ENOTCACHED、only-if-cached 或 offline 缓存错误，改用在线模式重试，例如 npm_config_offline=false npm_config_prefer_online=true，并优先使用当前 npm registry。',
].join('\n')

export const EXTENSION_CONSTRAINT_MARKER = '以下内容是 OneAPI 客户端附加的扩展调用要求'
export const EXECUTION_CONSTRAINT_MARKER = '以下内容是 OneAPI 客户端附加的执行约束'
export const ORIGINAL_USER_PROMPT_MARKER = '以下内容是用户真实需求原文（保留格式）'

export interface PromptAssemblerExtension {
  client: CliClient
  kind: 'command' | 'skill' | 'plugin'
  name: string
}

export interface PromptAssemblerAttachment {
  id: string
  name: string
  filePath: string
  kind: 'image' | 'file'
}

export interface BuildFinalPromptInput {
  prompt: string
  client: CliClient
  projectPath?: string
  fullAccess?: boolean
  directCommand?: boolean
  attachments?: PromptAssemblerAttachment[]
  extensions?: PromptAssemblerExtension[]
}

export interface PromptAssemblySnapshot {
  visiblePrompt: string
  finalPrompt: string
  extensionBlock: string
  attachmentBlock: string
  permissionBlock: string
}

function buildAttachmentReferenceText(attachments: PromptAssemblerAttachment[]) {
  if (!attachments.length) {
    return ''
  }
  return [
    '附件引用：',
    ...attachments.map((item, index) => `${index + 1}. ${item.name} -> ${item.filePath}`),
  ].join('\n')
}

function buildExtensionPromptBlock(items: PromptAssemblerExtension[]) {
  const normalized = items
    .map((item) => ({ ...item, name: item.name.trim() }))
    .filter((item) => item.name)

  if (!normalized.length) {
    return ''
  }

  return [
    EXTENSION_CONSTRAINT_MARKER,
    ...normalized.map((item, index) => {
      const prefix = `${index + 1}. `
      if (item.kind === 'skill') {
        return `${prefix}本次任务如适用，请优先调用已安装 skill "${item.name}"。`
      }
      if (item.kind === 'command') {
        return `${prefix}本次任务请按该命令既定用途使用 "${item.name}" 命令。`
      }
      return `${prefix}如任务需要，请调用已安装插件 "${item.name}"。`
    }),
  ].join('\n')
}

function normalizeVisiblePrompt(prompt: string) {
  return prompt.replace(/\s+/g, ' ').trim()
}

function buildVisiblePrompt(prompt: string, attachments: PromptAssemblerAttachment[], extensionBlock: string) {
  const attachmentBlock = buildAttachmentReferenceText(attachments)
  const promptWithAttachment = attachmentBlock ? `${prompt}\n\n${attachmentBlock}` : prompt
  if (!extensionBlock) {
    return promptWithAttachment.trim()
  }
  const visiblePreview = normalizeVisiblePrompt(promptWithAttachment)
  if (visiblePreview === promptWithAttachment.trim()) {
    return `${promptWithAttachment.trim()}\n\n${extensionBlock}`.trim()
  }
  return [
    visiblePreview,
    '',
    ORIGINAL_USER_PROMPT_MARKER,
    promptWithAttachment.trim(),
    '',
    extensionBlock,
  ].join('\n')
}

function buildPermissionBlock(input: Pick<BuildFinalPromptInput, 'fullAccess' | 'projectPath'>) {
  return [
    '权限上下文：',
    input.fullAccess
      ? '当前为全权限模式：客户端不再附加读写限制；按用户需求访问必要路径。'
      : '当前为受限模式：客户端不再附加读写限制；按用户需求访问必要路径。',
    input.projectPath?.trim() ? `当前项目目录：${input.projectPath.trim()}` : '',
  ].filter(Boolean).join('\n')
}

export function buildFinalPrompt(input: BuildFinalPromptInput): PromptAssemblySnapshot {
  const cleanedPrompt = input.prompt.trim()
  const attachments = input.attachments || []
  const extensions = input.extensions || []
  const extensionBlock = input.directCommand ? '' : buildExtensionPromptBlock(extensions)
  const visiblePrompt = buildVisiblePrompt(cleanedPrompt, attachments, extensionBlock)
  const permissionBlock = buildPermissionBlock(input)

  if (input.directCommand) {
    return {
      visiblePrompt,
      finalPrompt: visiblePrompt,
      extensionBlock,
      attachmentBlock: buildAttachmentReferenceText(attachments),
      permissionBlock,
    }
  }

  return {
    visiblePrompt,
    finalPrompt: [
      visiblePrompt,
      '',
      EXECUTION_CONSTRAINT_MARKER,
      '上方内容是用户真实需求；请直接完成上方需求，不要把本段约束当成用户问题回复。',
      '',
      permissionBlock,
      '',
      CLI_EXECUTION_POLICY,
    ].join('\n'),
    extensionBlock,
    attachmentBlock: buildAttachmentReferenceText(attachments),
    permissionBlock,
  }
}

function stripAttachmentReferenceSection(value: string) {
  const attachmentIndex = value.indexOf('附件引用：')
  if (attachmentIndex >= 0) {
    return value.slice(0, attachmentIndex).trim()
  }
  return value.trim()
}

function stripLeadingExtensionSection(value: string) {
  const trimmed = value.trim()
  const markers = [EXTENSION_CONSTRAINT_MARKER, '扩展调用要求：']
  const matchedMarker = markers.find((marker) => trimmed.startsWith(marker))
  if (!matchedMarker) {
    return trimmed
  }
  const afterMarker = trimmed.slice(matchedMarker.length).trimStart()
  if (!/^\d+\.\s/.test(afterMarker)) {
    return trimmed
  }
  const blankLineIndex = afterMarker.indexOf('\n\n')
  if (blankLineIndex < 0) {
    return trimmed
  }
  return afterMarker.slice(blankLineIndex).trim()
}

export function extractUserTaskFromFinalPrompt(raw: string) {
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ''
  }
  const next = stripLeadingExtensionSection(normalized)
  const legacyTaskMarker = '用户任务：'
  if (next.startsWith('执行策略：') && next.includes(legacyTaskMarker)) {
    return stripAttachmentReferenceSection(
      next.slice(next.indexOf(legacyTaskMarker) + legacyTaskMarker.length).trim(),
    )
  }
  const constraintIndexes = [
    next.indexOf(EXECUTION_CONSTRAINT_MARKER),
    next.indexOf(EXTENSION_CONSTRAINT_MARKER),
  ].filter((index) => index > 0)
  if (constraintIndexes.length) {
    const taskSection = next.slice(0, Math.min(...constraintIndexes)).trim()
    const originalPromptIndex = taskSection.indexOf(ORIGINAL_USER_PROMPT_MARKER)
    if (originalPromptIndex >= 0) {
      return stripAttachmentReferenceSection(
        taskSection.slice(originalPromptIndex + ORIGINAL_USER_PROMPT_MARKER.length).trim(),
      )
    }
    return stripAttachmentReferenceSection(taskSection)
  }
  return stripAttachmentReferenceSection(next)
}
