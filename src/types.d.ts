export {}
import type {
  CliClient,
  CliDeployRequest,
  CliHistoryEntry,
  CliSessionDetails,
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
      getCliSession: (client: CliClient, sessionId: string) => Promise<CliSessionDetails | null>
      runCliPrompt: (input: CliRunRequest) => Promise<CliRunResponse>
      setWindowTitle: (projectName?: string) => Promise<void>
      deployCli: (input: CliDeployRequest) => Promise<{ jobId: string }>
      onDeployProgress: (
        listener: (payload: DeployProgressPayload) => void
      ) => () => void
    }
  }
}
