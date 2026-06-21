import { contextBridge, ipcRenderer } from 'electron'
import type {
  AssistantHistoryScope,
  AssistantHistorySnapshotEntry,
  CliClient,
  CliDeployRequest,
  CliInteractionResponseRequest,
  CliHistoryEntry,
  CliProgressPayload,
  CliSessionDetails,
  CliRunRequest,
  CliRunResponse,
  CliStatus,
  DesktopAttachmentSaveRequest,
  DesktopAttachmentSaveResult,
  DesktopCopyImageRequest,
  DesktopFilePreview,
  DesktopPathInfo,
  DesktopImageEditRequest,
  DesktopSaveImageRequest,
  DesktopSaveImageResult,
  CliDeployPreset,
  CliExtensionEntry,
  CliExtensionInstallRequest,
  CliExtensionInstallResult,
  DeployProgressPayload,
  DesktopAppMeta,
  DesktopApiRequest,
  DesktopApiResponse,
  DesktopChatStreamPayload,
  DesktopChatStreamRequest,
  DesktopCustomChatCompletionRequest,
  DesktopCustomChatStreamRequest,
  DesktopCustomImageEditRequest,
  DesktopCustomImageGenerationRequest,
  DesktopCustomModelListRequest,
  DesktopDeleteCliMessageRequest,
  DesktopDeleteCliSessionsRequest,
  DesktopDeleteCliSessionsResult,
  DesktopExportTextFileRequest,
  DesktopExportTextFileResult,
  DesktopTranslateSelectionPayload,
  DesktopUpdateState,
  DesktopMobileBridgeDevice,
} from '../src/shared/desktop'
import type { ChatCompletionResponse, ImageGenerationResponse } from '../src/shared/contracts'

contextBridge.exposeInMainWorld('desktopBridge', {
  getPlatform: () => ipcRenderer.invoke('app:get-platform') as Promise<string>,
  getAppMeta: () =>
    ipcRenderer.invoke('app:get-meta') as Promise<DesktopAppMeta>,
  getUpdateState: () =>
    ipcRenderer.invoke('app:get-update-state') as Promise<DesktopUpdateState>,
  checkForUpdates: (input?: { userInitiated?: boolean }) =>
    ipcRenderer.invoke('app:check-update', input) as Promise<DesktopUpdateState>,
  startUpdateDownload: () =>
    ipcRenderer.invoke('app:start-update-download') as Promise<DesktopUpdateState>,
  installUpdate: () => ipcRenderer.invoke('app:install-update') as Promise<void>,
  minimizeWindow: () => ipcRenderer.invoke('app:window-minimize') as Promise<void>,
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke('app:window-toggle-maximize') as Promise<{ maximized: boolean }>,
  startWindowDrag: (screenX: number, screenY: number) =>
    ipcRenderer.invoke('app:window-start-drag', { screenX, screenY }) as Promise<void>,
  endWindowDrag: () =>
    ipcRenderer.invoke('app:window-end-drag') as Promise<void>,
  getWindowBounds: () =>
    ipcRenderer.invoke('app:window-get-bounds') as Promise<{
      x: number
      y: number
      width: number
      height: number
      maximized: boolean
    }>,
  setWindowPosition: (x: number, y: number) =>
    ipcRenderer.invoke('app:window-set-position', { x, y }) as Promise<void>,
  closeWindow: () => ipcRenderer.invoke('app:window-close') as Promise<void>,
  getServerBaseUrl: () => ipcRenderer.invoke('app:get-server-base-url') as Promise<string>,
  setServerBaseUrl: (value: string) =>
    ipcRenderer.invoke('app:set-server-base-url', value) as Promise<{ serverBaseUrl: string }>,
  resetServerBaseUrl: () =>
    ipcRenderer.invoke('app:reset-server-base-url') as Promise<{ serverBaseUrl: string }>,
  request: (input: DesktopApiRequest) =>
    ipcRenderer.invoke('desktop:api-request', input) as Promise<DesktopApiResponse>,
  streamChatCompletion: (input: DesktopChatStreamRequest) =>
    ipcRenderer.invoke('desktop:chat-stream', input) as Promise<void>,
  streamCustomChatCompletion: (input: DesktopCustomChatStreamRequest) =>
    ipcRenderer.invoke('desktop:custom-chat-stream', input) as Promise<void>,
  sendCustomChatCompletion: (input: DesktopCustomChatCompletionRequest) =>
    ipcRenderer.invoke('desktop:custom-chat-completion', input) as Promise<ChatCompletionResponse>,
  sendCustomImageGeneration: (input: DesktopCustomImageGenerationRequest) =>
    ipcRenderer.invoke('desktop:custom-image-generation', input) as Promise<ImageGenerationResponse>,
  editCustomImage: (input: DesktopCustomImageEditRequest) =>
    ipcRenderer.invoke('desktop:custom-image-edit', input) as Promise<ImageGenerationResponse>,
  listCustomProviderModels: (input: DesktopCustomModelListRequest) =>
    ipcRenderer.invoke('desktop:custom-provider-models', input) as Promise<string[]>,
  stopRequest: (requestId: string) =>
    ipcRenderer.invoke('desktop:stop-api-request', requestId) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('desktop:open-external', url) as Promise<void>,
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('desktop:open-path', targetPath) as Promise<void>,
  openAssistantHistoryFolder: (scope: AssistantHistoryScope, sessionId: string) =>
    ipcRenderer.invoke('desktop:open-assistant-history-folder', {
      scope,
      sessionId,
    }) as Promise<void>,
  syncAssistantHistory: (scope: AssistantHistoryScope, entries: AssistantHistorySnapshotEntry[]) =>
    ipcRenderer.invoke('desktop:sync-assistant-history', {
      scope,
      entries,
    }) as Promise<void>,
  pickProjectDirectory: () =>
    ipcRenderer.invoke('desktop:pick-project') as Promise<string>,
  getCliStatus: () =>
    ipcRenderer.invoke('desktop:cli-status') as Promise<{
      codex: CliStatus
      claude: CliStatus
    }>,
  listCliHistory: (client: CliClient, limit?: number) =>
    ipcRenderer.invoke('desktop:list-cli-history', {
      client,
      limit,
    }) as Promise<CliHistoryEntry[]>,
  getCliSession: (client: CliClient, sessionId: string) =>
    ipcRenderer.invoke('desktop:get-cli-session', {
      client,
      sessionId,
    }) as Promise<CliSessionDetails | null>,
  deleteCliMessage: (input: DesktopDeleteCliMessageRequest) =>
    ipcRenderer.invoke('desktop:delete-cli-message', input) as Promise<CliSessionDetails | null>,
  deleteCliSessions: (input: DesktopDeleteCliSessionsRequest) =>
    ipcRenderer.invoke('desktop:delete-cli-sessions', input) as Promise<DesktopDeleteCliSessionsResult>,
  getMobileBridgeDevice: () =>
    ipcRenderer.invoke('desktop:get-mobile-bridge-device') as Promise<DesktopMobileBridgeDevice>,
  resetMobileBridgeDevice: () =>
    ipcRenderer.invoke('desktop:reset-mobile-bridge-device') as Promise<DesktopMobileBridgeDevice>,
  openCliSessionFolder: (client: CliClient, sessionId: string) =>
    ipcRenderer.invoke('desktop:open-cli-session-folder', {
      client,
      sessionId,
    }) as Promise<void>,
  runCliPrompt: (input: CliRunRequest) =>
    ipcRenderer.invoke('desktop:run-cli', input) as Promise<CliRunResponse>,
  stopCliPrompt: (requestId: string) =>
    ipcRenderer.invoke('desktop:stop-cli', requestId) as Promise<void>,
  respondCliInteraction: (input: CliInteractionResponseRequest) =>
    ipcRenderer.invoke('desktop:respond-cli-interaction', input) as Promise<void>,
  onCliProgress: (listener: (payload: CliProgressPayload) => void) => {
    const channel = 'desktop:cli-progress'
    const wrapped = (_event: unknown, payload: CliProgressPayload) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  openFiles: (paths: string[]) =>
    ipcRenderer.invoke('desktop:open-files', paths) as Promise<void>,
  setWindowTitle: (projectName?: string) =>
    ipcRenderer.invoke('desktop:set-window-title', projectName) as Promise<void>,
  setThemeMode: (mode: 'light' | 'dark') =>
    ipcRenderer.invoke('app:set-theme-mode', mode) as Promise<void>,
  deployCli: (input: CliDeployRequest) =>
    ipcRenderer.invoke('desktop:deploy-cli', input) as Promise<{ jobId: string }>,
  saveAttachment: (input: DesktopAttachmentSaveRequest) =>
    ipcRenderer.invoke('desktop:save-attachment', input) as Promise<DesktopAttachmentSaveResult>,
  editImage: (input: DesktopImageEditRequest) =>
    ipcRenderer.invoke('desktop:image-edit', input) as Promise<ImageGenerationResponse>,
  saveImage: (input: DesktopSaveImageRequest) =>
    ipcRenderer.invoke('desktop:save-image', input) as Promise<DesktopSaveImageResult>,
  copyImageToClipboard: (input: DesktopCopyImageRequest) =>
    ipcRenderer.invoke('desktop:copy-image', input) as Promise<void>,
  exportTextFile: (input: DesktopExportTextFileRequest) =>
    ipcRenderer.invoke('desktop:export-text-file', input) as Promise<DesktopExportTextFileResult>,
  readFilePreview: (targetPath: string) =>
    ipcRenderer.invoke('desktop:file-preview', targetPath) as Promise<DesktopFilePreview>,
  statPath: (targetPath: string) =>
    ipcRenderer.invoke('desktop:stat-path', targetPath) as Promise<DesktopPathInfo>,
  getCliDeployPreset: (client: CliClient) =>
    ipcRenderer.invoke('desktop:cli-deploy-preset', client) as Promise<CliDeployPreset>,
  listCliExtensions: (client: CliClient) =>
    ipcRenderer.invoke('desktop:list-cli-extensions', client) as Promise<CliExtensionEntry[]>,
  installCliExtension: (input: CliExtensionInstallRequest) =>
    ipcRenderer.invoke('desktop:install-cli-extension', input) as Promise<CliExtensionInstallResult>,
  onDeployProgress: (listener: (payload: DeployProgressPayload) => void) => {
    const channel = 'desktop:deploy-progress'
    const wrapped = (_event: unknown, payload: DeployProgressPayload) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  onChatStream: (listener: (payload: DesktopChatStreamPayload) => void) => {
    const channel = 'desktop:chat-stream'
    const wrapped = (_event: unknown, payload: DesktopChatStreamPayload) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  onTranslateSelectionRequested: (listener: (payload: DesktopTranslateSelectionPayload) => void) => {
    const channel = 'desktop:translate-selection-requested'
    const wrapped = (_event: unknown, payload: DesktopTranslateSelectionPayload) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  onUpdateState: (listener: (payload: DesktopUpdateState) => void) => {
    const channel = 'desktop:update-state'
    const wrapped = (_event: unknown, payload: DesktopUpdateState) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
})
