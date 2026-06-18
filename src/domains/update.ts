import { desktopBridge } from '../lib/desktop-client'

export function getUpdateState() {
  return desktopBridge().getUpdateState()
}

export function checkForUpdates(input?: { userInitiated?: boolean }) {
  return desktopBridge().checkForUpdates(input)
}

export function startUpdateDownload() {
  return desktopBridge().startUpdateDownload()
}

export function installUpdate() {
  return desktopBridge().installUpdate()
}

export function onUpdateState(listener: Parameters<ReturnType<typeof desktopBridge>['onUpdateState']>[0]) {
  return desktopBridge().onUpdateState(listener)
}
