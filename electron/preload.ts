import { contextBridge, ipcRenderer } from 'electron'
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
} from '../src/shared/desktop'

contextBridge.exposeInMainWorld('desktopBridge', {
  getPlatform: () => ipcRenderer.invoke('app:get-platform') as Promise<string>,
  getAppMeta: () =>
    ipcRenderer.invoke('app:get-meta') as Promise<{
      platform: string
      productName: string
      serverBaseUrl: string
      iconPath: string
    }>,
  request: (input: DesktopApiRequest) =>
    ipcRenderer.invoke('desktop:api-request', input) as Promise<DesktopApiResponse>,
  stopRequest: (requestId: string) =>
    ipcRenderer.invoke('desktop:stop-api-request', requestId) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('desktop:open-external', url) as Promise<void>,
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('desktop:open-path', targetPath) as Promise<void>,
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
  runCliPrompt: (input: CliRunRequest) =>
    ipcRenderer.invoke('desktop:run-cli', input) as Promise<CliRunResponse>,
  stopCliPrompt: (requestId: string) =>
    ipcRenderer.invoke('desktop:stop-cli', requestId) as Promise<void>,
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
  deployCli: (input: CliDeployRequest) =>
    ipcRenderer.invoke('desktop:deploy-cli', input) as Promise<{ jobId: string }>,
  saveAttachment: (input: DesktopAttachmentSaveRequest) =>
    ipcRenderer.invoke('desktop:save-attachment', input) as Promise<DesktopAttachmentSaveResult>,
  readFilePreview: (targetPath: string) =>
    ipcRenderer.invoke('desktop:file-preview', targetPath) as Promise<DesktopFilePreview>,
  getCliDeployPreset: (client: CliClient) =>
    ipcRenderer.invoke('desktop:cli-deploy-preset', client) as Promise<CliDeployPreset>,
  onDeployProgress: (listener: (payload: DeployProgressPayload) => void) => {
    const channel = 'desktop:deploy-progress'
    const wrapped = (_event: unknown, payload: DeployProgressPayload) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
})
