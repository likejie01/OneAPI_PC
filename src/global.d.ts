/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    desktopBridge?: Record<string, (...args: any[]) => any>
  }
}

export {}
