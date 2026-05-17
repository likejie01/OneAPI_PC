export {}
import type {
  CliClient,
  CliDeployRequest,
  CliHistoryEntry,
  CliRunRequest,
  CliRunResponse,
  CliStatus,
  DeployProgressPayload,
  DesktopApiRequest,
  DesktopApiResponse,
} from './shared/desktop'

declare global {
  interface Window {
    desktopBridge?: {
      getPlatform: () => Promise<string>
      getAppMeta: () => Promise<{
        platform: string
        productName: string
        serverBaseUrl: string
      }>
      request: (input: DesktopApiRequest) => Promise<DesktopApiResponse>
      openExternal: (url: string) => Promise<void>
      pickProjectDirectory: () => Promise<string>
      getCliStatus: () => Promise<{
        codex: CliStatus
        claude: CliStatus
      }>
      listCliHistory: (client: CliClient, limit?: number) => Promise<CliHistoryEntry[]>
      runCliPrompt: (input: CliRunRequest) => Promise<CliRunResponse>
      deployCli: (input: CliDeployRequest) => Promise<{ jobId: string }>
      onDeployProgress: (
        listener: (payload: DeployProgressPayload) => void
      ) => () => void
    }
  }
}
