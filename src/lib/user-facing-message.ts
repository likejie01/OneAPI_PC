const TECHNICAL_ERROR_PATTERNS: Array<[RegExp, string]> = [
  [/bad_response_status_code|openai_error|upstream|502|503|504/i, '服务器暂时异常，请稍后重试。'],
  [/rate limit|too many requests|quota|limit exceeded|billing/i, '请求过于频繁或额度不足，请稍后再试。'],
  [/fetch failed|networkerror|econnrefused|econnreset|etimedout|timed out|dns|tls|certificate/i, '网络连接异常，请检查网络后重试。'],
  [/authentication failed|unauthorized|forbidden|\b401\b|\b403\b/i, '鉴权失败，请重新登录或检查密钥。'],
  [/parse|invalid toml|invalid json|failed to parse|expected value at line/i, '本地配置有问题，请重新部署或检查配置。'],
  [/permission denied|access denied|operation not permitted/i, '当前没有权限访问目标位置。'],
  [/not found|path not found|路径不存在|找不到/i, '找不到目标内容，请检查后重试。'],
]

function extractStructuredMessage(input: string) {
  const trimmed = input.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return ''
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return ''
    }

    const source = parsed as Record<string, unknown>
    const nestedError = typeof source.error === 'object' && source.error ? (source.error as Record<string, unknown>) : null
    const candidate =
      (typeof nestedError?.message === 'string' && nestedError.message.trim()) ||
      (typeof source.message === 'string' && source.message.trim()) ||
      (typeof source.detail === 'string' && source.detail.trim()) ||
      ''
    return candidate
  } catch {
    return ''
  }
}

function resolveTechnicalMessage(input: string) {
  for (const [pattern, replacement] of TECHNICAL_ERROR_PATTERNS) {
    if (pattern.test(input)) {
      return replacement
    }
  }

  return ''
}

export function formatUserFacingMessage(input: string, fallback = '操作失败，请稍后重试。') {
  const trimmed = input.trim()
  if (!trimmed) {
    return fallback
  }

  const structured = extractStructuredMessage(trimmed)
  const candidate = structured || trimmed
  const technicalMessage = resolveTechnicalMessage(candidate)
  if (technicalMessage) {
    return technicalMessage
  }

  if (structured) {
    if (/^[a-z0-9_.:-]+$/i.test(candidate) && !/[\u4e00-\u9fa5\s]/.test(candidate)) {
      return fallback
    }
    return candidate.length > 160 ? fallback : candidate
  }

  if (
    trimmed.length > 24 &&
    ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']')))
  ) {
    return fallback
  }

  return candidate
}
