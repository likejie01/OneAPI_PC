import type { CliDeployPreset } from '../shared/desktop'

const DESKTOP_CLI_SECRET_PATTERN = /^[A-Za-z0-9]{48}$/

export function normalizeDesktopCliApiKey(apiKey: string) {
  const trimmed = apiKey.trim()
  const secret = trimmed.startsWith('sk-') ? trimmed.slice(3) : trimmed

  if (!secret) {
    throw new Error('一键部署未拿到有效 API Key，请重新登录后再部署。')
  }

  if (/^test[_-]/i.test(secret) || /^sk-test[_-]/i.test(trimmed)) {
    throw new Error('一键部署拿到的是测试 Key，已拒绝写入本地 CLI 配置。请检查服务器 token 生成接口。')
  }

  if (!DESKTOP_CLI_SECRET_PATTERN.test(secret)) {
    throw new Error('一键部署拿到的 API Key 格式异常，已拒绝写入本地 CLI 配置。')
  }

  return `sk-${secret}`
}

export function resolveCliDeploySettings(input: {
  preset: CliDeployPreset | null
  generatedApiKey: string
  defaultBaseUrl: string
  defaultModel: string
}) {
  const { preset, generatedApiKey, defaultBaseUrl, defaultModel } = input

  return {
    apiKey: normalizeDesktopCliApiKey(generatedApiKey),
    baseUrl:
      preset?.managedByDesktop && preset.baseUrl?.trim()
        ? preset.baseUrl.trim()
        : defaultBaseUrl,
    model: preset?.model?.trim() || defaultModel,
  }
}
