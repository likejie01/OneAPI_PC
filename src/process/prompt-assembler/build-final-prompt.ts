import type { CliClient } from '../../shared/desktop.ts'

export const CLI_EXECUTION_POLICY = [
  '执行策略：',
  '1. 先选择最小修改量、最高成功率、最少副作用的方案。',
  '2. 如果当前方案失败，先分析失败原因，再列出可替代方案。',
  '3. 将替代方案按“最小修改量、最高有效性、最低风险”的顺序排序后继续尝试。',
  '4. 只有在问题解决，或已穷尽所有合理方案仍无法解决时，才结束任务。',
  '5. 回复中要明确写出失败原因、尝试顺序、最终采用的方案或无法解决的结论。',
  '6. 除非用户明确指定其他语言，否则所有最终回复、所有过程说明、工具调用前的意图/目的说明都必须使用简体中文；即使三方模型或底层模型默认英文，也不要输出英文过程段落。',
  '7. 代码、命令、文件名、库名、错误原文可保留英文；除此之外的解释性文本必须中文。',
  '8. 文件读写范围以“权限上下文”为准；如果命令失败，先读取错误信息并按真实失败原因处理。',
  '9. 优先使用当前项目目录内的相对路径；不要无理由扫描用户主目录、密钥目录、缓存目录或系统目录。',
  '10. 在 Windows PowerShell 受限语言模式下，不要执行 [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 或类似 .NET 属性设置；如需处理编码，优先使用 chcp 65001 或直接执行原命令。',
  '11. 在 Windows PowerShell 中读取或写入文件时，路径包含空格、括号、方括号、中文或通配符字符必须使用单引号和 -LiteralPath，例如 Get-Content -LiteralPath \'D:\\\\WorkSpace\\\\Demo\\\\src\\\\app\\\\(main)\\\\page.tsx\'；不要把 $null 作为参数传给 PowerShell 命令，参数没有值时应直接省略。',
  '12. 需要 npm/npx 安装依赖时必须允许在线拉取；如果出现 ENOTCACHED、only-if-cached 或 offline 缓存错误，改用在线模式重试，例如 npm_config_offline=false npm_config_prefer_online=true，并优先使用当前 npm registry。',
].join('\n')

export const EXTENSION_CONSTRAINT_MARKER = '以下内容是 OneAPI 客户端附加的扩展调用要求'
export const EXECUTION_CONSTRAINT_MARKER = '以下内容是 OneAPI 客户端附加的执行约束'
export const ORIGINAL_USER_PROMPT_MARKER = '以下内容是用户真实需求原文（保留格式）'
export const PLAN_MODE_CONSTRAINT_MARKER = '以下内容是 OneAPI 客户端附加的计划模式要求'

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
  planMode?: boolean
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
    '当前为全权限模式：客户端不附加读写限制；电脑中的所有文件夹都可按用户需求读取、修改和新建文件。',
    input.projectPath?.trim() ? `当前项目目录：${input.projectPath.trim()}` : '',
    '本段权限上下文覆盖历史会话中的旧权限判断；禁止在未实际尝试写入或读取错误信息前声称当前环境只读、不能修改文件或只能给源码。',
    '当用户要求创建或修改文件时，必须优先直接执行文件写入；只有真实命令失败后，才可说明失败原因并给出错误信息。',
  ].filter(Boolean).join('\n')
}

function stripPlanCommandPrompt(prompt: string) {
  const stripped = prompt.replace(/^\s*\/plan(?:\s+|$)/i, '').trim()
  return stripped || '请先基于当前会话与项目状态制定执行计划。'
}

function buildPlanModeBlock(input: Pick<BuildFinalPromptInput, 'client' | 'planMode'>) {
  if (!input.planMode) {
    return ''
  }
  const toolHint = input.client === 'codex'
    ? '如运行环境支持 update_plan 工具，必须先调用 update_plan 创建计划，并在步骤状态变化时继续更新。'
    : '如运行环境支持任务/计划工具，必须先创建计划，并在步骤状态变化时继续更新。'
  return [
    PLAN_MODE_CONSTRAINT_MARKER,
    '本次任务进入计划模式：在执行前先给出可操作方案，执行中保持步骤状态同步。',
    toolHint,
    '不要只在最终回复里用自然语言列计划；需要让客户端能收到计划状态更新。',
  ].join('\n')
}

export function buildFinalPrompt(input: BuildFinalPromptInput): PromptAssemblySnapshot {
  const cleanedPrompt = input.planMode ? stripPlanCommandPrompt(input.prompt) : input.prompt.trim()
  const attachments = input.attachments || []
  const extensions = input.extensions || []
  const extensionBlock = input.directCommand ? '' : buildExtensionPromptBlock(extensions)
  const visiblePrompt = buildVisiblePrompt(cleanedPrompt, attachments, extensionBlock)
  const permissionBlock = buildPermissionBlock(input)
  const planModeBlock = buildPlanModeBlock(input)

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
      ...(planModeBlock ? [planModeBlock, ''] : []),
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
    next.indexOf(PLAN_MODE_CONSTRAINT_MARKER),
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
