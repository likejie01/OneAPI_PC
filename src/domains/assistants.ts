import { readJsonStorage, writeJsonStorage } from '../lib/storage'
import { createBuiltinAssistants, mergeAssistantsWithBuiltins } from '../lib/assistants'
import type { AssistantRecord } from '../shared/contracts'

const STORAGE_KEY = 'oneapi-desktop-assistants'
const ACTIVE_KEY = 'oneapi-desktop-active-assistant'

export function getDefaultAssistants(): AssistantRecord[] {
  return createBuiltinAssistants()
}

export function loadAssistants() {
  const assistants = readJsonStorage<AssistantRecord[]>(STORAGE_KEY, [])
  return assistants.length > 0 ? mergeAssistantsWithBuiltins(assistants) : getDefaultAssistants()
}

export function saveAssistants(assistants: AssistantRecord[]) {
  writeJsonStorage(STORAGE_KEY, assistants)
}

export function createAssistant(input: {
  name: string
  description: string
  prompt: string
  model: string
  temperature: number
}) {
  const now = Date.now()
  return {
    id: globalThis.crypto.randomUUID(),
    name: input.name,
    description: input.description,
    prompt: input.prompt,
    model: input.model,
    temperature: input.temperature,
    createdAt: now,
    updatedAt: now,
  } satisfies AssistantRecord
}

export function loadActiveAssistantId() {
  return window.localStorage.getItem(ACTIVE_KEY) || ''
}

export function saveActiveAssistantId(id: string) {
  window.localStorage.setItem(ACTIVE_KEY, id)
}
