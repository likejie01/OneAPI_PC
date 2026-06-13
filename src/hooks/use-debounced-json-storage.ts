import { useEffect } from 'react'
import { writeJsonStorage } from '../lib/storage'

export function useDebouncedJsonStorage<T>(key: string, value: T, delayMs = 350) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeJsonStorage(key, value)
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, key, value])
}
