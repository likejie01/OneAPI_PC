import type {
  AssistantHistoryScope,
  AssistantHistorySnapshotEntry,
  CliClient,
  CliDeployPreset,
  CliDeployRequest,
  CliExtensionEntry,
  CliExtensionInstallRequest,
  CliExtensionInstallResult,
  CliHistoryEntry,
  CliInteractionResponseRequest,
  CliProgressPayload,
  CliRunRequest,
  CliRunResponse,
  CliSessionDetails,
  CliStatus,
  DeployProgressPayload,
  DesktopApiRequest,
  DesktopApiResponse,
  DesktopAppMeta,
  DesktopAttachmentSaveRequest,
  DesktopAttachmentSaveResult,
  DesktopChatStreamPayload,
  DesktopChatStreamRequest,
  DesktopCustomChatCompletionRequest,
  DesktopCustomChatStreamRequest,
  DesktopCustomImageEditRequest,
  DesktopCustomImageGenerationRequest,
  DesktopCustomModelListRequest,
  DesktopCopyImageRequest,
  DesktopDeleteCliMessageRequest,
  DesktopDeleteCliSessionsRequest,
  DesktopDeleteCliSessionsResult,
  DesktopExportTextFileRequest,
  DesktopExportTextFileResult,
  DesktopFileBase64,
  DesktopFilePreview,
  DesktopImageEditRequest,
  DesktopOpenHtmlRequest,
  DesktopPathInfo,
  DesktopSaveImageRequest,
  DesktopSaveImageResult,
  DesktopTranslateSelectionPayload,
  DesktopUpdateState,
  DesktopMobileBridgeDevice,
} from './shared/desktop'
import type { ChatCompletionResponse, ImageGenerationResponse } from './shared/contracts'

type Unsubscribe = () => void

declare global {
  interface Window {
    desktopBridge?: {
      getPlatform: () => Promise<string>
      getAppMeta: () => Promise<DesktopAppMeta>
      getUpdateState: () => Promise<DesktopUpdateState>
      checkForUpdates: (input?: { userInitiated?: boolean }) => Promise<DesktopUpdateState>
      startUpdateDownload: () => Promise<DesktopUpdateState>
      installUpdate: () => Promise<void>
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
      streamCustomChatCompletion: (input: DesktopCustomChatStreamRequest) => Promise<void>
      sendCustomChatCompletion: (input: DesktopCustomChatCompletionRequest) => Promise<ChatCompletionResponse>
      sendCustomImageGeneration: (input: DesktopCustomImageGenerationRequest) => Promise<ImageGenerationResponse>
      editCustomImage: (input: DesktopCustomImageEditRequest) => Promise<ImageGenerationResponse>
      listCustomProviderModels: (input: DesktopCustomModelListRequest) => Promise<string[]>
      stopRequest: (requestId: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      openHtml: (input: DesktopOpenHtmlRequest) => Promise<void>
      openPath: (targetPath: string) => Promise<void>
      openFile: (targetPath: string) => Promise<void>
      openAssistantHistoryFolder: (scope: AssistantHistoryScope, sessionId: string) => Promise<void>
      syncAssistantHistory: (scope: AssistantHistoryScope, entries: AssistantHistorySnapshotEntry[]) => Promise<void>
      pickProjectDirectory: () => Promise<string>
      getCliStatus: () => Promise<{ codex: CliStatus; claude: CliStatus }>
      listCliHistory: (client: CliClient, limit?: number) => Promise<CliHistoryEntry[]>
      getCliSession: (client: CliClient, sessionId: string) => Promise<CliSessionDetails | null>
      deleteCliMessage: (input: DesktopDeleteCliMessageRequest) => Promise<CliSessionDetails | null>
      deleteCliSessions: (input: DesktopDeleteCliSessionsRequest) => Promise<DesktopDeleteCliSessionsResult>
      getMobileBridgeDevice: () => Promise<DesktopMobileBridgeDevice>
      resetMobileBridgeDevice: () => Promise<DesktopMobileBridgeDevice>
      openCliSessionFolder: (client: CliClient, sessionId: string) => Promise<void>
      runCliPrompt: (input: CliRunRequest) => Promise<CliRunResponse>
      stopCliPrompt: (requestId: string) => Promise<void>
      respondCliInteraction: (input: CliInteractionResponseRequest) => Promise<void>
      onCliProgress: (listener: (payload: CliProgressPayload) => void) => Unsubscribe
      openFiles: (paths: string[]) => Promise<void>
      setWindowTitle: (projectName?: string) => Promise<void>
      setThemeMode: (mode: 'light' | 'dark') => Promise<void>
      deployCli: (input: CliDeployRequest) => Promise<{ jobId: string }>
      saveAttachment: (input: DesktopAttachmentSaveRequest) => Promise<DesktopAttachmentSaveResult>
      readFileBase64: (targetPath: string) => Promise<DesktopFileBase64>
      editImage: (input: DesktopImageEditRequest) => Promise<ImageGenerationResponse>
      saveImage: (input: DesktopSaveImageRequest) => Promise<DesktopSaveImageResult>
      copyImageToClipboard: (input: DesktopCopyImageRequest) => Promise<void>
      exportTextFile: (input: DesktopExportTextFileRequest) => Promise<DesktopExportTextFileResult>
      readFilePreview: (targetPath: string) => Promise<DesktopFilePreview>
      statPath: (targetPath: string) => Promise<DesktopPathInfo>
      getCliDeployPreset: (client: CliClient) => Promise<CliDeployPreset>
      listCliExtensions: (client: CliClient) => Promise<CliExtensionEntry[]>
      installCliExtension: (input: CliExtensionInstallRequest) => Promise<CliExtensionInstallResult>
      onDeployProgress: (listener: (payload: DeployProgressPayload) => void) => Unsubscribe
      onChatStream: (listener: (payload: DesktopChatStreamPayload) => void) => Unsubscribe
      onTranslateSelectionRequested: (listener: (payload: DesktopTranslateSelectionPayload) => void) => Unsubscribe
      onUpdateState: (listener: (payload: DesktopUpdateState) => void) => Unsubscribe
    }
  }
}

export {}
