declare global {
  interface Window {
    desktopBridge?: Record<string, (...args: any[]) => any>
  }
}

export {}
