import type { CliClient, CliPlanState, CliSessionMessage } from '../shared/desktop'

export interface CliRuntimeDiagnostics {
  networkIssue?: boolean
  upstreamIssue?: boolean
  sessionIssue?: boolean
  authIssue?: boolean
  configIssue?: boolean
  policyIssue?: boolean
  dependencyIssue?: boolean
  probableCause?: string
}

export type CliInteractionAction = 'approve' | 'approve_always' | 'reject'

export interface CliRuntimeInteractionPrompt {
  kind: 'approval'
  title: string
  message: string
  command: string
  autoApproveEligible: boolean
}

export function classifyCliStderrLine(line: string) {
  const normalized = line.trim()
  const lower = normalized.toLowerCase()

  if (!normalized) {
    return {
      level: 'status' as const,
      logKind: 'stderr' as const,
      sourceKind: 'stderr',
      title: 'CLI 输出了诊断信息',
    }
  }

  if (lower.includes('warn')) {
    return {
      level: 'status' as const,
      logKind: 'stderr' as const,
      sourceKind: 'stderr.warn',
      title: 'CLI 输出了警告信息',
    }
  }

  if (
    /PropertySetterNotSupportedInConstrainedLanguage/i.test(normalized) ||
    /ItemNotFoundException/i.test(normalized) ||
    /ObjectNotFound/i.test(normalized) ||
    /At line:\d+ char:\d+/i.test(normalized) ||
    /\[Get-Content\], ItemNotFoundException/i.test(normalized) ||
    /CategoryInfo\s*:\s*ObjectNotFound/i.test(normalized) ||
    /FullyQualifiedErrorId\s*:\s*PathNotFound/i.test(normalized)
  ) {
    return {
      level: 'status' as const,
      logKind: 'stderr' as const,
      sourceKind: 'stderr.command',
      title: 'CLI 输出了命令诊断信息',
    }
  }

  return {
    level: 'status' as const,
    logKind: 'stderr' as const,
    sourceKind: 'stderr',
    title: 'CLI 输出了诊断信息',
  }
}

export function summarizeCliFailure(rawText: string, stderrText: string): CliRuntimeDiagnostics {
  const combined = `${rawText}\n${stderrText}`.trim()
  const networkIssue =
    /stream disconnected before completion/i.test(combined) ||
    /error sending request for url/i.test(combined) ||
    /reconnecting\.\.\./i.test(combined) ||
    /timed out/i.test(combined) ||
    /tls/i.test(combined) ||
    /certificate/i.test(combined) ||
    /dns/i.test(combined) ||
    /econnrefused/i.test(combined) ||
    /econnreset/i.test(combined)
  const upstreamIssue =
    /bad_response_status_code/i.test(combined) ||
    /openai_error/i.test(combined) ||
    /upstream/i.test(combined) ||
    /502/i.test(combined) ||
    /503/i.test(combined) ||
    /504/i.test(combined)
  const sessionIssue =
    /failed to record rollout items/i.test(combined) ||
    /state db returned stale rollout path/i.test(combined) ||
    /no rollout found for thread id/i.test(combined) ||
    /thread\/resume failed/i.test(combined) ||
    /thread .* not found/i.test(combined) ||
    /session .* not found/i.test(combined)
  const authIssue =
    /authentication failed/i.test(combined) ||
    /request not allowed/i.test(combined) ||
    /forbidden/i.test(combined) ||
    /unauthorized/i.test(combined) ||
    /401/i.test(combined) ||
    /403/i.test(combined)
  const configIssue =
    /expected value at line/i.test(combined) ||
    /failed to parse/i.test(combined) ||
    /invalid toml/i.test(combined) ||
    (/json/i.test(combined) && /parse/i.test(combined))
  const policyIssue =
    /blocked by policy/i.test(combined) ||
    /rejected: blocked/i.test(combined) ||
    /PropertySetterNotSupportedInConstrainedLanguage/i.test(combined) ||
    /此语言模式仅支持核心类型的属性设置/i.test(combined)
  const dependencyIssue =
    /ENOTCACHED/i.test(combined) ||
    /only-if-cached/i.test(combined) ||
    /npm error/i.test(combined)

  let probableCause = ''
  if (networkIssue) {
    probableCause = '网络 / 代理 / TLS / 反向代理流式转发异常'
  } else if (upstreamIssue) {
    probableCause = '上游模型网关返回异常状态码，常见于流式代理、模型路由或额度侧瞬时异常'
  } else if (sessionIssue) {
    probableCause = '本地会话状态目录异常，或会话落盘未完成'
  } else if (authIssue) {
    probableCause = 'Key 或上游鉴权不通过'
  } else if (configIssue) {
    probableCause = '本地配置文件格式无效'
  } else if (policyIssue) {
    probableCause = 'CLI 本地执行策略拦截了部分命令'
  } else if (dependencyIssue) {
    probableCause = 'npm/npx 依赖安装失败，常见原因是被离线缓存模式或 registry 网络问题拦截'
  }

  return {
    networkIssue,
    upstreamIssue,
    sessionIssue,
    authIssue,
    configIssue,
    policyIssue,
    dependencyIssue,
    probableCause,
  }
}

export function detectCliInteractionFromToolUse(name: string, input: unknown): CliRuntimeInteractionPrompt | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const source = input as Record<string, unknown>
  const command =
    typeof source.command === 'string' && source.command.trim()
      ? source.command.trim()
      : typeof source.cmd === 'string' && source.cmd.trim()
        ? source.cmd.trim()
        : ''
  const justification =
    typeof source.justification === 'string' && source.justification.trim()
      ? source.justification.trim()
      : typeof source.reason === 'string' && source.reason.trim()
        ? source.reason.trim()
        : ''
  const needsEscalation =
    typeof source.sandbox_permissions === 'string' &&
    source.sandbox_permissions.trim().toLowerCase() === 'require_escalated'

  if (!needsEscalation && !/^(shell_command|exec_command|bash)$/i.test(name.trim())) {
    return null
  }

  if (!needsEscalation && !justification) {
    return null
  }

  return {
    kind: 'approval',
    title: '命令执行需要确认',
    message: justification || 'CLI 请求执行需要确认的命令。',
    command,
    autoApproveEligible: true,
  }
}

export function detectCliInteractionFromText(line: string): CliRuntimeInteractionPrompt | null {
  const normalized = line.trim()
  if (!normalized) {
    return null
  }

  const yesNoPrompt = normalized.match(
    /^(?<message>.*?(?:allow|approve|continue|proceed|confirm|是否继续|是否允许|确认继续).*)(?:\s*[[(](?:y\/n|y\/N|Y\/n)[\])])$/i
  )
  if (!yesNoPrompt?.groups?.message) {
    return null
  }

  return {
    kind: 'approval',
    title: 'CLI 正在等待确认',
    message: yesNoPrompt.groups.message.trim(),
    command: '',
    autoApproveEligible: true,
  }
}

export function buildCliInteractionResponse(action: CliInteractionAction) {
  if (action === 'approve_always') {
    return 'a\n'
  }
  return action === 'reject' ? 'n\n' : 'y\n'
}

export function shouldAutoRetryCliRequest(input: {
  diagnostics: CliRuntimeDiagnostics
  attempt: number
  aborted: boolean
  exitCode: number
  output: string
}) {
  if (input.aborted || input.exitCode === 0 || input.output.trim() || input.attempt > 0) {
    return false
  }

  return !!(input.diagnostics.networkIssue || input.diagnostics.upstreamIssue)
}

export function isDirectCliCommandPrompt(prompt: string) {
  return /^\s*\/[^\s/][^\n]*/.test(prompt)
}

export function estimateCliSessionContextUsage(
  client: CliClient,
  messages: Array<Pick<CliSessionMessage, 'content' | 'attachments' | 'selectedExtensions'>>,
  plan?: CliPlanState | null
) {
  const textChars = messages.reduce((total, item) => total + item.content.length, 0)
  const attachmentChars = messages.reduce(
    (total, item) =>
      total +
      (item.attachments || []).reduce((attachmentTotal, attachment) => attachmentTotal + attachment.filePath.length + attachment.name.length, 0),
    0
  )
  const extensionChars = messages.reduce(
    (total, item) =>
      total +
      (item.selectedExtensions || []).reduce((extensionTotal, extension) => extensionTotal + extension.name.length + (extension.note?.length || 0), 0),
    0
  )
  const planChars =
    (plan?.explanation.length || 0) +
    (plan?.items || []).reduce((total, item) => total + item.step.length, 0)
  const estimatedTokens = Math.ceil((textChars + attachmentChars + extensionChars + planChars) / 4)
  const softLimitTokens = client === 'claude' ? 40_000 : 32_000
  const ratio = softLimitTokens > 0 ? Math.min(1, estimatedTokens / softLimitTokens) : 0

  return {
    estimatedTokens,
    softLimitTokens,
    ratio,
  }
}
