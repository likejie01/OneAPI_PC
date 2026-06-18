import type { CliClient } from '../shared/desktop'

export interface CliBuiltinCommand {
  id: string
  client: CliClient | 'both'
  command: string
  title: string
  description: string
}

const BUILTIN_COMMANDS: CliBuiltinCommand[] = [
  {
    id: 'resume',
    client: 'both',
    command: '/resume',
    title: '恢复当前会话',
    description: '继续当前或最近一次会话。',
  },
  {
    id: 'compact',
    client: 'both',
    command: '/compact',
    title: '压缩当前上下文',
    description: '让 CLI 主动整理并压缩当前会话上下文。',
  },
  {
    id: 'plan',
    client: 'both',
    command: '/plan',
    title: '进入规划模式',
    description: '要求 CLI 先给出计划，再逐步执行。',
  },
]

export function listCliBuiltinCommands(client: CliClient) {
  return BUILTIN_COMMANDS.filter((item) => item.client === 'both' || item.client === client)
}

export function matchCliBuiltinCommand(client: CliClient, prompt: string) {
  const normalized = prompt.trim().toLowerCase()
  return listCliBuiltinCommands(client).find((item) => normalized === item.command || normalized.startsWith(`${item.command} `)) || null
}
