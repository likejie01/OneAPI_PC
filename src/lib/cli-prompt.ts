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

  return `${CLI_EXECUTION_POLICY}\n\n${permissionPolicy}\n\n用户任务：\n${prompt.trim()}`
}
