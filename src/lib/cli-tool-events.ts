type CliPayloadRecord = Record<string, unknown>

export interface CliToolUseEntry {
  id: string
  name: string
  input: unknown
  textBefore: string
}

export interface CliToolOutputEntry {
  id: string
  output: string
  stdout: string
  stderr: string
  exitCode?: number
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

function readStringField(record: CliPayloadRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function readNumberField(record: CliPayloadRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return undefined
}

export function extractCodexFunctionCallOutputEntries(record: Record<string, unknown>): CliToolOutputEntry[] {
  const payload = asRecord(record.payload)
  if (record.type !== 'response_item' || !payload || payload.type !== 'function_call_output') {
    return []
  }

  const output =
    typeof payload.output === 'string'
      ? payload.output.trim()
      : payload.output === undefined || payload.output === null
        ? ''
        : JSON.stringify(payload.output, null, 2)

  if (!output) {
    return []
  }

  return [
    {
      id: typeof payload.call_id === 'string'
        ? payload.call_id.trim()
        : typeof payload.id === 'string'
          ? payload.id.trim()
          : '',
      output,
      stdout: output,
      stderr: '',
      exitCode: readNumberField(payload, ['exit_code', 'exitCode']),
    },
  ]
}

export function extractCodexCommandExecutionOutputEntries(record: Record<string, unknown>): CliToolOutputEntry[] {
  if (record.type !== 'item.completed') {
    return []
  }

  const item = asRecord(record.item)
  if (!item || item.type !== 'command_execution') {
    return []
  }

  const stdout = readStringField(item, ['stdout', 'output'])
  const stderr = readStringField(item, ['stderr', 'error'])
  const output = [stdout, stderr].filter(Boolean).join('\n\n')
  if (!output) {
    return []
  }

  return [
    {
      id: typeof item.id === 'string' ? item.id.trim() : '',
      output,
      stdout,
      stderr,
      exitCode: readNumberField(item, ['exit_code', 'exitCode']),
    },
  ]
}
