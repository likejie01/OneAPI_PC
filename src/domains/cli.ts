import { desktopBridge } from '../lib/desktop-client'
import type {
  AssistantHistoryScope,
  AssistantHistorySnapshotEntry,
  CliClient,
  CliDeployRequest,
  CliProgressPayload,
  CliRunRequest,
  CliSessionDetails,
  CliSessionMessage,
  CliExtensionEntry,
  CliExtensionInstallRequest,
  DesktopDeleteCliMessageRequest,
  DeployProgressPayload,
} from '../shared/desktop'

export function getCliStatus() {
  return desktopBridge().getCliStatus()
}

export function listCliHistory(client: CliClient, limit = 10) {
  return desktopBridge().listCliHistory(client, limit)
}

export function getCliSession(client: CliClient, sessionId: string): Promise<CliSessionDetails | null> {
  return desktopBridge().getCliSession(client, sessionId)
}

export function deleteCliMessage(
  client: CliClient,
  sessionId: string,
  message: Pick<
    CliSessionMessage,
    'id' | 'role' | 'content' | 'createdAt' | 'sourceFilePath' | 'sourceLineNumber' | 'sourceTimestamp'
  >
): Promise<CliSessionDetails | null> {
  return desktopBridge().deleteCliMessage({
    client,
    sessionId,
    message,
  } satisfies DesktopDeleteCliMessageRequest)
}

export function openCliSessionFolder(client: CliClient, sessionId: string) {
  return desktopBridge().openCliSessionFolder(client, sessionId)
}

export function openAssistantHistoryFolder(scope: AssistantHistoryScope, sessionId: string) {
  return desktopBridge().openAssistantHistoryFolder(scope, sessionId)
}

export function syncAssistantHistory(scope: AssistantHistoryScope, entries: AssistantHistorySnapshotEntry[]) {
  return desktopBridge().syncAssistantHistory(scope, entries)
}

export function pickProjectDirectory() {
  return desktopBridge().pickProjectDirectory()
}

export function runCliPrompt(input: CliRunRequest) {
  return desktopBridge().runCliPrompt(input)
}

export function stopCliPrompt(requestId: string) {
  return desktopBridge().stopCliPrompt(requestId)
}

export function onCliProgress(listener: (payload: CliProgressPayload) => void) {
  return desktopBridge().onCliProgress(listener)
}

export function setDesktopWindowTitle(projectName?: string) {
  return desktopBridge().setWindowTitle(projectName)
}

export function deployCli(input: CliDeployRequest) {
  return desktopBridge().deployCli(input)
}

export function readDesktopFilePreview(targetPath: string) {
  return desktopBridge().readFilePreview(targetPath)
}

export function getCliDeployPreset(client: CliClient) {
  return desktopBridge().getCliDeployPreset(client)
}

export function listCliExtensions(client: CliClient) {
  return desktopBridge().listCliExtensions(client) as Promise<CliExtensionEntry[]>
}

export function installCliExtension(input: CliExtensionInstallRequest) {
  return desktopBridge().installCliExtension(input)
}

export function onDeployProgress(listener: (payload: DeployProgressPayload) => void) {
  return desktopBridge().onDeployProgress(listener)
}
