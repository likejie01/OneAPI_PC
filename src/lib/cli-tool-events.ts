type CliPayloadRecord = Record<string, unknown>

export interface CliToolUseEntry {
  id: string
  name: string
  input: unknown
  textBefore: string
}

function asRecord(value: unknown): CliPayloadRecord | null {
  return value && typeof value === 'object' ? value as CliPayloadRecord : null
}

export function parseCliToolInput(value: unknown) {
  if (typeof value !== 'string') {
    return value
  }

  const normalized = value.trim()
  if (!normalized) {
    return value
  }

  try {
    return JSON.parse(normalized) as unknown
  } catch {
    return value
  }
}

export function normalizeCliToolInputForDetail(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCliToolInputForDetail(item))
  }

  const record = asRecord(value)
  if (!record) {
    return value
  }

  const next: CliPayloadRecord = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === 'replace_all' && item === false) {
      continue
    }
    next[key] = normalizeCliToolInputForDetail(item)
  }
  return next
}

export function extractCodexFunctionCallToolUseEntries(record: Record<string, unknown>): CliToolUseEntry[] {
  const payload = asRecord(record.payload)
  if (!payload || payload.type !== 'function_call') {
    return []
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (!name) {
    return []
  }

  const input = 'arguments' in payload
    ? parseCliToolInput(payload.arguments)
    : parseCliToolInput(payload.input)

  return [
    {
      id: typeof payload.call_id === 'string'
        ? payload.call_id.trim()
        : typeof payload.id === 'string'
          ? payload.id.trim()
          : '',
      name,
      input,
      textBefore: '',
    },
  ]
}

export function extractCodexCommandExecutionToolUseEntries(record: Record<string, unknown>): CliToolUseEntry[] {
  if (record.type !== 'item.started' && record.type !== 'item.completed') {
    return []
  }

  const item = asRecord(record.item)
  if (!item || item.type !== 'command_execution') {
    return []
  }

  const command = typeof item.command === 'string' ? item.command.trim() : ''
  if (!command) {
    return []
  }

  return [
    {
      id: typeof item.id === 'string' ? item.id.trim() : '',
      name: 'shell_command',
      input: { command },
      textBefore: '',
    },
  ]
}
