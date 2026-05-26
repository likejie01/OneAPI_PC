export const CLI_EXECUTION_POLICY = [
  '执行策略：',
  '1. 先选择最小修改量、最高成功率、最少副作用的方案。',
  '2. 如果当前方案失败，先分析失败原因，再列出可替代方案。',
  '3. 将替代方案按“最小修改量、最高有效性、最低风险”的顺序排序后继续尝试。',
  '4. 只有在问题解决，或已穷尽所有合理方案仍无法解决时，才结束任务。',
  '5. 回复中要明确写出失败原因、尝试顺序、最终采用的方案或无法解决的结论。',
  '6. 除非用户明确指定其他语言，否则默认使用简体中文回复。',
  '7. 不要请求提升权限；如果命令被策略拒绝，换用当前权限允许的读写方式，最多重试一次。',
  '8. 优先使用当前项目目录内的相对路径；不要无理由扫描用户主目录、密钥目录、缓存目录或系统目录。',
  '9. 在 Windows PowerShell 受限语言模式下，不要执行 [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 或类似 .NET 属性设置；如需处理编码，优先使用 chcp 65001 或直接执行原命令。',
  '10. 需要 npm/npx 安装依赖时必须允许在线拉取；如果出现 ENOTCACHED、only-if-cached 或 offline 缓存错误，改用在线模式重试，例如 npm_config_offline=false npm_config_prefer_online=true，并优先使用当前 npm registry。',
].join('\n')

function stripAttachmentReferenceSection(value: string) {
  const attachmentIndex = value.indexOf('附件引用：')
  if (attachmentIndex >= 0) {
    return value.slice(0, attachmentIndex).trim()
  }
  return value.trim()
}

const executionConstraintMarker = '以下内容是 OneAPI 客户端附加的执行约束'
const originalUserPromptMarker = '以下内容是用户真实需求原文（保留格式）'
const extensionConstraintMarkers = [
  '以下内容是 OneAPI 客户端附加的扩展调用要求',
  '扩展调用要求：',
]

function stripLeadingExtensionSection(value: string) {
  const trimmed = value.trim()
  const matchedMarker = extensionConstraintMarkers.find((marker) => trimmed.startsWith(marker))
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

export function extractCliUserTask(raw: string) {
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ''
  }

  const taskMarker = '用户任务：'
  const policyMarker = '执行策略：'
  let next = stripLeadingExtensionSection(normalized)

  const constraintIndexes = [
    next.indexOf(executionConstraintMarker),
    ...extensionConstraintMarkers.map((marker) => next.indexOf(marker)),
  ].filter((index) => index > 0)
  if (constraintIndexes.length) {
    const firstConstraintIndex = Math.min(...constraintIndexes)
    const taskSection = next.slice(0, firstConstraintIndex).trim()
    const originalPromptIndex = taskSection.indexOf(originalUserPromptMarker)
    if (originalPromptIndex >= 0) {
      return stripAttachmentReferenceSection(
        taskSection.slice(originalPromptIndex + originalUserPromptMarker.length).trim()
      )
    }
    return stripAttachmentReferenceSection(taskSection)
  }

  if (next.startsWith(taskMarker)) {
    const policyIndex = next.indexOf(policyMarker, taskMarker.length)
    if (policyIndex >= 0) {
      let taskSection = next.slice(taskMarker.length, policyIndex).trim()
      const instructionIndex = taskSection.indexOf('以下内容是执行约束')
      if (instructionIndex >= 0) {
        taskSection = taskSection.slice(0, instructionIndex).trim()
      }
      return stripAttachmentReferenceSection(taskSection)
    }
    return stripAttachmentReferenceSection(next.slice(taskMarker.length).trim())
  }

  if (next.startsWith(policyMarker) && next.includes(taskMarker)) {
    return stripAttachmentReferenceSection(next.slice(next.indexOf(taskMarker) + taskMarker.length).trim())
  }

  return stripAttachmentReferenceSection(next)
}

export function buildCliExecutionPrompt(prompt: string, options: {
  fullAccess?: boolean
  projectPath?: string
} = {}) {
  const permissionPolicy = [
    '权限上下文：',
    options.fullAccess
      ? '当前为全权限模式，可在用户任务需要时执行项目外读写。'
      : '当前为受限模式，仅假定当前项目目录可读写；不要申请提升权限。',
    options.projectPath?.trim() ? `当前项目目录：${options.projectPath.trim()}` : '',
  ].filter(Boolean).join('\n')

  return [
    prompt.trim(),
    '',
    executionConstraintMarker,
    '上方内容是用户真实需求；请直接完成上方需求，不要把本段约束当成用户问题回复。',
    '',
    permissionPolicy,
    '',
    CLI_EXECUTION_POLICY,
  ].join('\n')
}
