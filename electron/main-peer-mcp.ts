// @ts-nocheck
import { promises as fs } from 'node:fs'
import path from 'node:path'

export function createPeerMcpBridgeServices(deps) {
  const { app, cliConfig, pathExists, inspectCli, readResolvedClaudeSettingsDocument, mergeCodexPeerMcpConfig, createDeployLogger } = deps

function getPeerMcpServerPath() {
  return path.join(app.getPath('userData'), 'peer-mcp', 'oneapi-peer-mcp-server.cjs')
}

function peerMcpServerSource() {
  return String.raw`#!/usr/bin/env node
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')

const target = process.argv[2] === 'codex' ? 'codex' : 'claude'
const toolName = target === 'codex' ? 'ask_codex' : 'ask_claude'
const commandEnv = target === 'codex' ? 'ONEAPI_CODEX_COMMAND' : 'ONEAPI_CLAUDE_COMMAND'
const command = process.env[commandEnv] || target

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function asText(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory()
  } catch {
    return false
  }
}

function resolveProjectPath(args) {
  const requested = asText(args && (args.cwd || args.projectPath)).trim()
  const fallback = isDirectory(process.cwd()) ? process.cwd() : os.homedir()
  if (!requested) {
    return { projectPath: fallback, error: '' }
  }
  if (!isDirectory(requested)) {
    return { projectPath: fallback, error: '项目目录不存在或不可访问：' + requested }
  }
  return { projectPath: requested, error: '' }
}

function toolDefinition() {
  return {
    name: toolName,
    description: target === 'codex'
      ? 'Ask Codex to inspect or execute a delegated software engineering task in a project directory, then return its summary and execution output.'
      : 'Ask Claude to inspect or execute a delegated software engineering task in a project directory, then return its summary and execution output.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The concrete task to delegate.' },
        cwd: { type: 'string', description: 'Optional working directory for the delegated CLI task.' },
        projectPath: { type: 'string', description: 'Optional project directory. Defaults to the current working directory.' },
        permissionMode: { type: 'string', description: 'Optional permission mode: restricted or full.' }
      },
      required: ['prompt']
    }
  }
}

function isFullAccess(args) {
  void args
  return true
}

function buildPeerCliArgs(projectPath, prompt, fullAccess) {
  void fullAccess
  if (target === 'codex') {
    return ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-C', projectPath, '--skip-git-repo-check', prompt]
  }
  return ['-p', '--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', '--output-format', 'text', prompt]
}

function runPeer(args) {
  return new Promise((resolve) => {
    const prompt = asText(args && args.prompt).trim()
    if (!prompt) {
      resolve('缺少 prompt，未执行。')
      return
    }
    const resolvedPath = resolveProjectPath(args)
    if (resolvedPath.error) {
      resolve(resolvedPath.error)
      return
    }
    const projectPath = resolvedPath.projectPath
    const childArgs = buildPeerCliArgs(projectPath, prompt, isFullAccess(args))
    const child = spawn(command, childArgs, {
      cwd: projectPath,
      shell: process.platform === 'win32',
      env: { ...process.env }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch {}
    }, 600000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve('执行失败：' + (error && error.message ? error.message : String(error)))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const parts = [
        target.toUpperCase() + ' exitCode=' + code,
        stdout.trim(),
        stderr.trim() ? 'stderr:\n' + stderr.trim() : ''
      ].filter(Boolean)
      resolve(parts.join('\n\n').slice(0, 60000))
    })
  })
}

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
  drain()
})

function dispatch(line) {
  if (!line) return
  let request
  try { request = JSON.parse(line) } catch { return }
  handle(request).catch((error) => {
    write({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error && error.message ? error.message : String(error) } })
  })
}

function drain() {
  while (buffer.length) {
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd >= 0) {
      const header = buffer.subarray(0, headerEnd).toString('utf8')
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (match) {
        const length = Number(match[1])
        const bodyStart = headerEnd + 4
        if (buffer.length < bodyStart + length) return
        const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
        buffer = buffer.subarray(bodyStart + length)
        dispatch(body.trim())
        continue
      }
    }
    const index = buffer.indexOf(10)
    if (index < 0) return
    const line = buffer.subarray(0, index).toString('utf8').trim()
    buffer = buffer.subarray(index + 1)
    dispatch(line)
  }
}

async function handle(request) {
  const id = request.id
  if (request.method === 'initialize') {
    const protocolVersion = request.params && typeof request.params.protocolVersion === 'string'
      ? request.params.protocolVersion
      : '2024-11-05'
    write({ jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'oneapi-peer-agent', version: '1.0.0' } } })
    return
  }
  if (request.method === 'notifications/initialized') {
    return
  }
  if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id, result: { tools: [toolDefinition()] } })
    return
  }
  if (request.method === 'tools/call') {
    const name = request.params && request.params.name
    if (name !== toolName) {
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown tool: ' + name } })
      return
    }
    const text = await runPeer(request.params && request.params.arguments)
    write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })
    return
  }
  write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
}
`
}

async function writePeerMcpServer() {
  const serverPath = getPeerMcpServerPath()
  await fs.mkdir(path.dirname(serverPath), { recursive: true })
  await fs.writeFile(serverPath, peerMcpServerSource(), 'utf8')
  return serverPath
}

async function installPeerMcpBridge(runtime: NodeRuntimeInfo, logger: ReturnType<typeof createDeployLogger>) {
  logger.info('mcp', 'running', '正在安装 Codex / Claude 互联 MCP 服务')
  const serverPath = await writePeerMcpServer()
  const [codexStatus, claudeStatus] = await Promise.all([
    inspectCli('codex').catch(() => null),
    inspectCli('claude').catch(() => null),
  ])
  const codexCommand = codexStatus?.executablePath || 'codex'
  const claudeCommand = claudeStatus?.executablePath || 'claude'
  const claudeSettingsDocument = await readResolvedClaudeSettingsDocument().catch(() => null)

  await fs.mkdir(cliConfig.codex.dataPath, { recursive: true })
  const codexRaw = (await pathExists(cliConfig.codex.configPath))
    ? await fs.readFile(cliConfig.codex.configPath, 'utf8')
    : ''
  await fs.writeFile(
    cliConfig.codex.configPath,
    mergeCodexPeerMcpConfig(codexRaw, runtime.nodePath, serverPath, claudeCommand, claudeSettingsDocument),
    'utf8'
  )

  await fs.mkdir(path.dirname(cliConfig.claude.configPath), { recursive: true })
  const claudeRaw = (await pathExists(cliConfig.claude.configPath))
    ? await fs.readFile(cliConfig.claude.configPath, 'utf8')
    : '{}'
  let claudeSettings: Record<string, unknown>
  try {
    claudeSettings = JSON.parse(claudeRaw) as Record<string, unknown>
  } catch {
    claudeSettings = {}
  }
  const currentServers = typeof claudeSettings.mcpServers === 'object' && claudeSettings.mcpServers
    ? claudeSettings.mcpServers as Record<string, unknown>
    : {}
  claudeSettings.mcpServers = {
    ...currentServers,
    oneapi_codex: {
      command: runtime.nodePath,
      args: [serverPath, 'codex'],
      env: { ONEAPI_CODEX_COMMAND: codexCommand },
    },
  }
  await fs.writeFile(cliConfig.claude.configPath, JSON.stringify(claudeSettings, null, 2), 'utf8')
  logger.info(
    'mcp',
    'success',
    'Codex / Claude 互联 MCP 服务已配置',
    [
      `MCP 服务脚本：${serverPath}`,
      `Codex 可调用 Claude：mcp_servers.oneapi_claude`,
      `Claude 可调用 Codex：mcpServers.oneapi_codex`,
    ].join('\n')
  )
}

  return { installPeerMcpBridge }
}
