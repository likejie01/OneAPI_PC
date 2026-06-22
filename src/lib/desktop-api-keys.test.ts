import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSelectedDesktopApiKeyId,
  readSelectedDesktopApiKeyId,
  SELECTED_DESKTOP_API_KEY_FALLBACK_STORAGE_KEY,
  writeSelectedDesktopApiKeyId,
} from './desktop-api-keys.ts'

test('selected desktop api key falls back to the last explicit selection', () => {
  const storage = new Map<string, unknown>([
    [SELECTED_DESKTOP_API_KEY_FALLBACK_STORAGE_KEY, 42],
  ])
  const readJsonStorage = <T>(key: string, fallback: T) =>
    storage.has(key) ? storage.get(key) as T : fallback

  assert.equal(readSelectedDesktopApiKeyId(7, readJsonStorage), 42)
})

test('selected desktop api key writes and clears user scoped and fallback storage', () => {
  const storage = new Map<string, unknown>()
  const readJsonStorage = <T>(key: string, fallback: T) =>
    storage.has(key) ? storage.get(key) as T : fallback
  const writeJsonStorage = <T>(key: string, value: T) => {
    storage.set(key, value)
  }
  const removeStorage = (key: string) => {
    storage.delete(key)
  }

  writeSelectedDesktopApiKeyId(7, 99, writeJsonStorage)
  assert.equal(readSelectedDesktopApiKeyId(7, readJsonStorage), 99)

  clearSelectedDesktopApiKeyId(7, removeStorage)
  assert.equal(readSelectedDesktopApiKeyId(7, readJsonStorage), null)
})
