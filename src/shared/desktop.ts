export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type CliClient = 'codex' | 'claude'
export type CliExtensionKind = 'skill' | 'command' | 'plugin'
export type AssistantHistoryScope = 'chat' | 'draw'
export type DeployStatus = 'pending' | 'running' | 'success' | 'error'
export type DeployLogKind = 'info' | 'command' | 'stdout' | 'stderr' | 'result'
import type { ChatCompletionResponse, ChatContentPart } from './contracts'
export type CliLogKind =
  | 'intent'
  | 'command'
  | 'stdout'
  | 'stderr'
  | 'result'
  | 'tool'
  | 'status'
  | 'error'

export interface DesktopApiRequest {
  method: ApiMethod
  path: string
  requestId?: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  headers?: Record<string, string>
}

export interface DesktopApiResponse {
  ok: boolean
  status: number
  headers: Record<string, string>
  data: unknown
}

export interface DesktopChatStreamRequest {
  requestId: string
  userId?: string
  model: string
  group?: string
  reasoningEffort?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | ChatContentPart[]
  }>
  temperature?: number
}

export interface DesktopChatStreamPayload {
  requestId: string
  type: 'delta' | 'reasoning' | 'done' | 'error'
  text?: string
  message?: string
  status?: number
  usage?: ChatCompletionResponse['usage']
}

export interface CliHistoryEntry {
  id: string
  title: string
  preview: string
  updatedAt: number
  projectName: string
  projectPath?: string
}

export interface CliSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  modelLabel?: string
  sourceFilePath?: string
  sourceLineNumber?: number
  sourceTimestamp?: string | number
  attachments?: Array<{
    id: string
    name: string
    filePath: string
    kind: 'image' | 'file'
  }>
  files?: CliFileChange[]
  fileChanges?: CliFileChange[]
}

export interface CliFileChange {
  path: string
  kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  content?: string
  diff?: string
}

export interface CliSessionDetails {
  id: string
  client: CliClient
  preview: string
  updatedAt: number
  projectName: string
  projectPath: string
  messages: CliSessionMessage[]
  fileChanges?: CliFileChange[]
}

export interface CliStatus {
  client: CliClient
  installed: boolean
  version: string
  executablePath: string
  configPath: string
  dataPath: string
  hasConfig: boolean
  hasDataDirectory: boolean
  brokenInstallation?: boolean
}

export interface CliExtensionEntry {
  id: string
  client: CliClient
  kind: CliExtensionKind
  name: string
  description: string
  path: string
  source?: string
}

export interface CliRunRequest {
  client: CliClient
  requestId: string
  projectPath: string
  prompt: string
  sessionId?: string
  model?: string
  reasoningEffort?: string
  fullAccess?: boolean
}

export interface CliRunResponse {
  success: boolean
  requestId: string
  output: string
  error: string
  raw: string
  sessionId?: string
  metadata: Record<string, unknown>
}

export interface CliProgressPayload {
  client: CliClient
  requestId: string
  sessionId?: string
  kind: 'status' | 'partial' | 'error'
  logKind?: CliLogKind
  sourceKind?: string
  message: string
  createdAt: number
  done?: boolean
  files?: CliFileChange[]
  detail?: string
  command?: string
  exitCode?: number
}

export interface CliDeployRequest {
  client: CliClient
  apiKey: string
  model?: string
  baseUrl?: string
}

export interface DeployProgressPayload {
  jobId: string
  client: CliClient
  step: 'detect' | 'node' | 'install' | 'config' | 'diagnose' | 'test' | 'complete'
  status: DeployStatus
  message: string
  createdAt: number
  kind?: DeployLogKind
  detail?: string
  command?: string
  exitCode?: number
}

export interface DesktopAttachmentSaveRequest {
  name: string
  mimeType?: string
  dataBase64: string
}

export interface DesktopAttachmentSaveResult {
  path: string
}

export interface DesktopImageEditRequest {
  userId?: string
  model: string
  prompt: string
  imageName: string
  mimeType?: string
  dataBase64: string
  size?: string
  quality?: string
}

export interface DesktopSaveImageRequest {
  suggestedName: string
  sourceUrl?: string
  dataBase64?: string
}

export interface DesktopSaveImageResult {
  path: string
}

export interface DesktopFilePreview {
  path: string
  name: string
  content: string
}

export interface CliDeployPreset {
  client: CliClient
  apiKey: string
  model: string
  baseUrl: string
}

export interface DesktopDeleteCliMessageRequest {
  client: CliClient
  sessionId: string
  message: Pick<
    CliSessionMessage,
    'id' | 'role' | 'content' | 'createdAt' | 'sourceFilePath' | 'sourceLineNumber' | 'sourceTimestamp'
  >
}

export interface AssistantHistorySnapshotEntry {
  id: string
  title: string
  updatedAt: number
  data: string
}
