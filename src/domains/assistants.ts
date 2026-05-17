import { readJsonStorage, writeJsonStorage } from '../lib/storage'
import type { AssistantRecord } from '../shared/contracts'

const STORAGE_KEY = 'oneapi-desktop-assistants'
const ACTIVE_KEY = 'oneapi-desktop-active-assistant'

export function getDefaultAssistants(): AssistantRecord[] {
  const now = Date.now()
  return [
    {
      id: 'assistant-general',
      name: '通用助手',
      description: '适合日常问答、总结与灵感整理。',
      prompt: '你是一名专业、简洁、可靠的中文 AI 助手，请优先给出清晰结论和可执行建议。',
      model: '',
      temperature: 0.7,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'assistant-dev',
      name: '开发助手',
      description: '适合代码分析、调试与开发规划。',
      prompt: '你是一名资深中文技术助手，请在回答中优先考虑工程可行性、风险点和具体落地步骤。',
      model: '',
      temperature: 0.4,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function loadAssistants() {
  const assistants = readJsonStorage<AssistantRecord[]>(STORAGE_KEY, [])
  return assistants.length > 0 ? assistants : getDefaultAssistants()
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
