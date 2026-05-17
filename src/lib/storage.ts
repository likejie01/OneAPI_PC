export function readJsonStorage<T>(key: string, fallback: T) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJsonStorage<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function removeStorage(key: string) {
  window.localStorage.removeItem(key)
}
