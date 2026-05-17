export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type CliClient = 'codex' | 'claude'
export type DeployStatus = 'pending' | 'running' | 'success' | 'error'

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
}

export interface CliSessionDetails {
  id: string
  client: CliClient
  preview: string
  updatedAt: number
  projectName: string
  projectPath: string
  messages: CliSessionMessage[]
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
}

export interface CliRunRequest {
  client: CliClient
  requestId: string
  projectPath: string
  prompt: string
  sessionId?: string
  model?: string
  reasoningEffort?: string
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
  message: string
  createdAt: number
  done?: boolean
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
  step: 'detect' | 'install' | 'config' | 'test' | 'complete'
  status: DeployStatus
  message: string
  detail?: string
}
