import { desktopBridge } from '../lib/desktop-client'
import type {
  CliClient,
  CliDeployRequest,
  CliRunRequest,
  DeployProgressPayload,
} from '../shared/desktop'

export function getCliStatus() {
  return desktopBridge().getCliStatus()
}

export function listCliHistory(client: CliClient, limit = 10) {
  return desktopBridge().listCliHistory(client, limit)
}

export function pickProjectDirectory() {
  return desktopBridge().pickProjectDirectory()
}

export function runCliPrompt(input: CliRunRequest) {
  return desktopBridge().runCliPrompt(input)
}

export function deployCli(input: CliDeployRequest) {
  return desktopBridge().deployCli(input)
}

export function onDeployProgress(listener: (payload: DeployProgressPayload) => void) {
  return desktopBridge().onDeployProgress(listener)
}
