export {}
import type {
  AssistantHistoryScope,
  AssistantHistorySnapshotEntry,
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
  DesktopImageEditRequest,
  DesktopSaveImageRequest,
  DesktopSaveImageResult,
  CliDeployPreset,
  DeployProgressPayload,
  DesktopApiRequest,
  DesktopApiResponse,
  DesktopChatStreamPayload,
  DesktopChatStreamRequest,
  DesktopDeleteCliMessageRequest,
} from './shared/desktop'
import type { ImageGenerationResponse } from './shared/contracts'

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
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<{ maximized: boolean }>
      startWindowDrag: (screenX: number, screenY: number) => Promise<void>
      endWindowDrag: () => Promise<void>
      getWindowBounds: () => Promise<{
        x: number
        y: number
        width: number
        height: number
        maximized: boolean
      }>
      setWindowPosition: (x: number, y: number) => Promise<void>
      closeWindow: () => Promise<void>
      getServerBaseUrl: () => Promise<string>
      setServerBaseUrl: (value: string) => Promise<{ serverBaseUrl: string }>
      resetServerBaseUrl: () => Promise<{ serverBaseUrl: string }>
      request: (input: DesktopApiRequest) => Promise<DesktopApiResponse>
      streamChatCompletion: (input: DesktopChatStreamRequest) => Promise<void>
      stopRequest: (requestId: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      openPath: (targetPath: string) => Promise<void>
      openAssistantHistoryFolder: (scope: AssistantHistoryScope, sessionId: string) => Promise<void>
      syncAssistantHistory: (scope: AssistantHistoryScope, entries: AssistantHistorySnapshotEntry[]) => Promise<void>
      pickProjectDirectory: () => Promise<string>
      getCliStatus: () => Promise<{
        codex: CliStatus
        claude: CliStatus
      }>
      listCliHistory: (client: CliClient, limit?: number) => Promise<CliHistoryEntry[]>
      getCliSession: (client: CliClient, sessionId: string) => Promise<CliSessionDetails | null>
      deleteCliMessage: (input: DesktopDeleteCliMessageRequest) => Promise<CliSessionDetails | null>
      openCliSessionFolder: (client: CliClient, sessionId: string) => Promise<void>
      runCliPrompt: (input: CliRunRequest) => Promise<CliRunResponse>
      stopCliPrompt: (requestId: string) => Promise<void>
      onCliProgress: (
        listener: (payload: CliProgressPayload) => void
      ) => () => void
      openFiles: (paths: string[]) => Promise<void>
      setWindowTitle: (projectName?: string) => Promise<void>
      setThemeMode: (mode: 'light' | 'dark') => Promise<void>
      deployCli: (input: CliDeployRequest) => Promise<{ jobId: string }>
      saveAttachment: (
        input: DesktopAttachmentSaveRequest
      ) => Promise<DesktopAttachmentSaveResult>
      editImage: (input: DesktopImageEditRequest) => Promise<ImageGenerationResponse>
      saveImage: (input: DesktopSaveImageRequest) => Promise<DesktopSaveImageResult>
      readFilePreview: (targetPath: string) => Promise<DesktopFilePreview>
      getCliDeployPreset: (client: CliClient) => Promise<CliDeployPreset>
      onDeployProgress: (
        listener: (payload: DeployProgressPayload) => void
      ) => () => void
      onChatStream: (
        listener: (payload: DesktopChatStreamPayload) => void
      ) => () => void
    }
  }
}
