export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type CliClient = 'codex' | 'claude'
export type DeployStatus = 'pending' | 'running' | 'success' | 'error'

export interface DesktopApiRequest {
  method: ApiMethod
  path: string
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
  projectPath?: string
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
  projectPath: string
  prompt: string
}

export interface CliRunResponse {
  success: boolean
  output: string
  error: string
  raw: string
  metadata: Record<string, unknown>
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
