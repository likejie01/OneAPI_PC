import type { CliDeployPreset } from '../shared/desktop'

export function resolveCliDeploySettings(input: {
  preset: CliDeployPreset | null
  generatedApiKey: string
  defaultBaseUrl: string
  defaultModel: string
}) {
  const { preset, generatedApiKey, defaultBaseUrl, defaultModel } = input

  return {
    apiKey: generatedApiKey,
    baseUrl:
      preset?.managedByDesktop && preset.baseUrl?.trim()
        ? preset.baseUrl.trim()
        : defaultBaseUrl,
    model: preset?.model?.trim() || defaultModel,
  }
}
