export {}
import type {
  CliClient,
  CliDeployRequest,
  CliHistoryEntry,
  CliProgressPayload,
  CliSessionDetails,
  CliRunRequest,
  CliRunResponse,
  CliStatus,
  DesktopAttachmentSaveRequest,
  DesktopAttachmentSaveResult,
  DesktopFilePreview,
  CliDeployPreset,
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
        iconPath: string
      }>
      request: (input: DesktopApiRequest) => Promise<DesktopApiResponse>
      stopRequest: (requestId: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      openPath: (targetPath: string) => Promise<void>
      pickProjectDirectory: () => Promise<string>
      getCliStatus: () => Promise<{
        codex: CliStatus
        claude: CliStatus
      }>
      listCliHistory: (client: CliClient, limit?: number) => Promise<CliHistoryEntry[]>
      getCliSession: (client: CliClient, sessionId: string) => Promise<CliSessionDetails | null>
      runCliPrompt: (input: CliRunRequest) => Promise<CliRunResponse>
      stopCliPrompt: (requestId: string) => Promise<void>
      onCliProgress: (
        listener: (payload: CliProgressPayload) => void
      ) => () => void
      openFiles: (paths: string[]) => Promise<void>
      setWindowTitle: (projectName?: string) => Promise<void>
      deployCli: (input: CliDeployRequest) => Promise<{ jobId: string }>
      saveAttachment: (
        input: DesktopAttachmentSaveRequest
      ) => Promise<DesktopAttachmentSaveResult>
      readFilePreview: (targetPath: string) => Promise<DesktopFilePreview>
      getCliDeployPreset: (client: CliClient) => Promise<CliDeployPreset>
      onDeployProgress: (
        listener: (payload: DeployProgressPayload) => void
      ) => () => void
    }
  }
}
