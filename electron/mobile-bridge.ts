import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  CliExtensionEntry,
  CliInteractionPrompt,
} from '../src/shared/desktop'
import type {
  PromptAssemblerAttachment,
  PromptAssemblerExtension,
} from '../src/process/prompt-assembler/build-final-prompt.ts'

export type MobileBridgeCliClient = 'codex' | 'claude'

export interface MobileBridgeExtensionRef {
  id: string
  kind: 'command' | 'skill' | 'plugin'
  name: string
  description?: string
  client?: string
}

export interface MobileBridgeAttachment {
  id?: string
  name?: string
  mime?: string
  kind?: 'image' | 'file'
  dataUrl?: string
  data_url?: string
  text?: string
  source?: string
}

export interface MobileBridgeJob {
  job_id?: string
  jobId?: string
  device_id?: string
  deviceId?: string
  client?: string
  session_id?: string
  sessionId?: string
  project_path?: string
  projectPath?: string
  origin?: string
  source?: string
  client_request_id?: string
  clientRequestId?: string
  prompt?: string
  model?: string
  reasoning_effort?: string
  reasoningEffort?: string
  permission_mode?: string
  permissionMode?: string
  extension_refs?: MobileBridgeExtensionRef[]
  extensionRefs?: MobileBridgeExtensionRef[]
  attachments?: MobileBridgeAttachment[]
}

export interface MobileBridgeProgressPayload {
  client: MobileBridgeCliClient
  requestId: string
  sessionId?: string
  kind: string
  logKind?: string
  sourceKind?: string
  message: string
  detail?: string
  command?: string
  done?: boolean
  createdAt: number
  assistantChunk?: string
  indentLevel?: number
  interaction?: CliInteractionPrompt
}

export function safeMobileAttachmentName(value: string, fallback: string) {
  const clean = (value || '')
    .trim()
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char
    })
    .join('')
  return clean || fallback
}

export function extensionFromMime(mime: string, fallbackName: string) {
  const ext = path.extname(fallbackName).replace(/^\./, '').trim()
  if (ext) return ext
  const clean = mime.toLowerCase()
  if (clean.includes('png')) return 'png'
  if (clean.includes('jpeg') || clean.includes('jpg')) return 'jpg'
  if (clean.includes('webp')) return 'webp'
  if (clean.includes('gif')) return 'gif'
  if (clean.includes('pdf')) return 'pdf'
  if (clean.includes('json')) return 'json'
  if (clean.includes('markdown')) return 'md'
  if (clean.startsWith('text/')) return 'txt'
  return 'txt'
}

export function decodeMobileAttachmentDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!match) return null
  const mime = match[1] || 'application/octet-stream'
  const base64 = !!match[2]
  const payload = match[3] || ''
  return {
    mime,
    bytes: base64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8'),
  }
}

export async function materializeMobileBridgeAttachments(input: {
  userDataPath: string
  jobId: string
  attachments: MobileBridgeAttachment[]
}) {
  const { userDataPath, jobId, attachments } = input
  if (!attachments.length) return [] as PromptAssemblerAttachment[]
  const root = path.join(userDataPath, 'mobile-bridge-attachments', safeMobileAttachmentName(jobId, randomUUID()))
  await fs.mkdir(root, { recursive: true })
  const out: PromptAssemblerAttachment[] = []
  for (let index = 0; index < attachments.length; index += 1) {
    const item = attachments[index]
    const name = safeMobileAttachmentName(item.name || `attachment-${index + 1}`, `attachment-${index + 1}`)
    const dataUrl = (item.dataUrl || item.data_url || '').trim()
    const text = (item.text || '').trim()
    try {
      let filePath = ''
      if (dataUrl) {
        const decoded = decodeMobileAttachmentDataUrl(dataUrl)
        if (!decoded) continue
        const ext = extensionFromMime(item.mime || decoded.mime, name)
        filePath = path.join(root, path.extname(name) ? name : `${name}.${ext}`)
        await fs.writeFile(filePath, decoded.bytes)
      } else if (text) {
        const ext = extensionFromMime(item.mime || 'text/plain', name)
        filePath = path.join(root, path.extname(name) ? name : `${name}.${ext}`)
        await fs.writeFile(filePath, text, 'utf8')
      }
      if (filePath) {
        out.push({
          id: item.id || `${jobId}-attachment-${index + 1}`,
          name,
          filePath,
          kind: item.kind === 'image' ? 'image' : 'file',
        })
      }
    } catch {
      /* skip unreadable attachment */
    }
  }
  return out
}

export function resolveMobileBridgeExtensionRefs(input: {
  client: MobileBridgeCliClient
  refs: MobileBridgeExtensionRef[]
  installed: CliExtensionEntry[]
}) {
  const { client, refs } = input
  if (!refs.length) return [] as PromptAssemblerExtension[]
  const installed = input.installed.filter((item) => item.installed !== false)
  const resolved: PromptAssemblerExtension[] = []
  for (const ref of refs) {
    const kind = ref.kind
    const id = (ref.id || '').trim().toLowerCase()
    const name = (ref.name || '').trim().toLowerCase()
    const match = installed.find((item) => item.kind === kind && (
      item.id.trim().toLowerCase() === id ||
      item.name.trim().toLowerCase() === name ||
      item.installKey?.trim().toLowerCase() === id
    ))
    if (match) {
      resolved.push({ client, kind, name: match.name })
    }
  }
  return resolved
}

export function normalizeMobileBridgeJob(raw: MobileBridgeJob) {
  return {
    jobId: raw.jobId || raw.job_id || '',
    deviceId: raw.deviceId || raw.device_id || '',
    client: (raw.client || '').trim().toLowerCase() as MobileBridgeCliClient,
    sessionId: raw.sessionId || raw.session_id || '',
    projectPath: raw.projectPath || raw.project_path || '',
    origin: raw.origin || raw.source || '',
    clientRequestId: raw.clientRequestId || raw.client_request_id || '',
    prompt: raw.prompt || '',
    model: raw.model || '',
    reasoningEffort: raw.reasoningEffort || raw.reasoning_effort || '',
    permissionMode: raw.permissionMode || raw.permission_mode || '',
    extensionRefs: (raw.extensionRefs || raw.extension_refs || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      description: item.description,
    })),
    attachments: (raw.attachments || []).map((item) => ({
      id: item.id || '',
      name: item.name || '',
      mime: item.mime || '',
      kind: item.kind === 'image' ? 'image' as const : 'file' as const,
      dataUrl: item.dataUrl || item.data_url || '',
      text: item.text || '',
      source: item.source || '',
    })),
  }
}

export function resolveMobileBridgePhase(payload: Pick<MobileBridgeProgressPayload, 'logKind' | 'sourceKind' | 'kind' | 'interaction'>) {
  if (payload.interaction?.status === 'pending') {
    return 'interaction_required'
  }
  const sourceKind = (payload.sourceKind || '').trim().toLowerCase()
  if (sourceKind.startsWith('orchestrator.')) {
    return sourceKind.slice('orchestrator.'.length)
  }
  if (sourceKind.startsWith('intent.') || payload.logKind === 'intent') {
    return 'intent'
  }
  if (payload.logKind === 'command' || payload.logKind === 'tool') {
    return 'invoke'
  }
  if (payload.logKind === 'stdout' || sourceKind.includes('prepare') || sourceKind.includes('thread.started') || sourceKind.includes('session.connected')) {
    return 'prepare'
  }
  if (payload.logKind === 'result') {
    return 'result'
  }
  if (payload.kind === 'error' || payload.logKind === 'error' || payload.logKind === 'stderr') {
    return 'error'
  }
  return 'prepare'
}

export function createMobileBridgeEventMapper(jobId: string) {
  const assistantTextByRequestId = new Map<string, string>()
  let sequence = 0

  const createAssistantDeltaEvent = (payload: MobileBridgeProgressPayload, text: string) => ({
    id: `${jobId}-${payload.requestId}-${payload.createdAt}-${payload.kind}-assistant-${++sequence}`,
    sessionId: payload.sessionId,
    type: 'message_delta',
    phase: 'assistant',
    role: 'assistant',
    text,
    source: payload.requestId.startsWith('mobile-') ? 'mobile' : 'desktop',
    origin: payload.requestId.startsWith('mobile-') ? 'mobile' : 'desktop',
    createdAt: payload.createdAt,
  })

  const takePartialDelta = (payload: MobileBridgeProgressPayload) => {
    const snapshot = payload.message || ''
    const previous = assistantTextByRequestId.get(payload.requestId) || ''

    if (!snapshot) {
      return ''
    }
    if (!previous) {
      assistantTextByRequestId.set(payload.requestId, snapshot)
      return snapshot
    }
    if (snapshot.startsWith(previous)) {
      const delta = snapshot.slice(previous.length)
      assistantTextByRequestId.set(payload.requestId, snapshot)
      return delta
    }
    assistantTextByRequestId.set(payload.requestId, snapshot)
    return snapshot
  }

  const takeAssistantChunkDelta = (payload: MobileBridgeProgressPayload, chunk: string) => {
    const previous = assistantTextByRequestId.get(payload.requestId) || ''
    if (!chunk) {
      return ''
    }
    if (previous && (previous.endsWith(chunk) || (chunk.length > 16 && previous.includes(chunk)))) {
      return ''
    }
    assistantTextByRequestId.set(payload.requestId, `${previous}${chunk}`)
    return chunk
  }

  return (payload: MobileBridgeProgressPayload): Array<Record<string, unknown>> => {
    const events: Array<Record<string, unknown>> = []
    const assistantChunk = payload.assistantChunk?.trim() || ''

    if (payload.client === 'claude' && payload.sourceKind === 'runtime.spawn') {
      return events
    }

    if (payload.kind === 'partial') {
      const delta = assistantChunk || takePartialDelta(payload)
      if (delta.trim()) {
        events.push(createAssistantDeltaEvent(payload, delta))
      }
      if (payload.done) {
        assistantTextByRequestId.delete(payload.requestId)
      }
      return events
    }

    if (assistantChunk) {
      const delta = takeAssistantChunkDelta(payload, assistantChunk)
      if (delta) {
        events.push(createAssistantDeltaEvent(payload, delta))
      }
    }

    const logEvent = mapCliPayloadToMobileBridgeLogEvent(jobId, payload, ++sequence)
    if (logEvent) {
      events.push(logEvent)
    }
    if (payload.done) {
      assistantTextByRequestId.delete(payload.requestId)
    }
    return events
  }
}

export function mapCliPayloadToMobileBridgeLogEvent(
  jobId: string,
  payload: MobileBridgeProgressPayload,
  sequence = 0,
): Record<string, unknown> | null {
  if (payload.kind === 'partial') {
    return null
  }
  const phase = resolveMobileBridgePhase(payload)
  const type =
    payload.interaction?.status === 'pending'
      ? 'interaction_required'
      : phase === 'intent'
        ? 'intent'
        : payload.kind === 'error'
          ? 'error'
          : payload.done && payload.logKind === 'status'
            ? 'complete'
            : 'log'
  return {
    id: `${jobId}-${payload.requestId}-${payload.createdAt}-${payload.kind}-${phase}-${sequence}`,
    sessionId: payload.sessionId,
    type,
    phase,
    level: payload.kind === 'error' ? 2 : payload.logKind === 'stderr' ? 1 : 0,
    title: payload.message,
    body: payload.detail || payload.message,
    command: payload.command,
    interactionId: payload.interaction?.id,
    interactionStatus: payload.interaction?.status,
    indentLevel: payload.indentLevel || 0,
    source: payload.requestId.startsWith('mobile-') ? 'mobile' : 'desktop',
    origin: payload.requestId.startsWith('mobile-') ? 'mobile' : 'desktop',
    createdAt: payload.createdAt,
  }
}
