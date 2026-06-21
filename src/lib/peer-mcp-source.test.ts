import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const libDir = dirname(fileURLToPath(import.meta.url))
const electronSources = [
  'main.ts',
  'main-cli-services.ts',
  'main-peer-mcp.ts',
]
  .map((fileName) => readFileSync(resolve(libDir, '..', '..', 'electron', fileName), 'utf8'))
  .join('\n')

test('peer mcp bridge is installed by one-click deploy for both cli clients', () => {
  assert.match(electronSources, /function createCodexPeerMcpSection/)
  assert.match(electronSources, /\[mcp_servers\.oneapi_claude\]/)
  assert.match(electronSources, /mcpServers[\s\S]*?oneapi_codex/)
  assert.match(electronSources, /await installPeerMcpBridge\(runtime, logger\)/)
})

test('codex to claude mcp config carries claude api environment', () => {
  assert.match(electronSources, /function createCodexPeerMcpEnv/)
  assert.doesNotMatch(electronSources, /ANTHROPIC_AUTH_TOKEN: resolvedKey/)
  assert.match(electronSources, /ANTHROPIC_API_KEY/)
  assert.match(electronSources, /ANTHROPIC_BASE_URL/)
  assert.match(electronSources, /readResolvedClaudeSettingsDocument\(\)\.catch\(\(\) => null\)/)
  assert.match(electronSources, /mergeCodexPeerMcpConfig\(codexRaw, runtime\.nodePath, serverPath, claudeCommand, claudeSettingsDocument\)/)
  assert.match(electronSources, /oneapi_codex: \{[\s\S]*?env: \{ ONEAPI_CODEX_COMMAND: codexCommand \}/)
})

test('codex cli runtime inherits claude api environment for peer calls', () => {
  assert.match(electronSources, /function buildCodexCliEnv/)
  assert.match(electronSources, /const claudeSettingsForCodex = await readResolvedClaudeSettingsDocument\(\)\.catch\(\(\) => null\)/)
  assert.match(electronSources, /const codexEnv = buildCodexCliEnv\(managedRuntime, claudeSettingsForCodex\)/)
  assert.match(electronSources, /env: codexEnv/)
})

test('claude cli env never reintroduces legacy auth token from config env', () => {
  assert.match(electronSources, /key === 'ANTHROPIC_AUTH_TOKEN' \|\| key === 'ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN'/)
  assert.match(electronSources, /delete nextEnv\.ANTHROPIC_AUTH_TOKEN[\s\S]*?delete nextEnv\.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN[\s\S]*?return nextEnv/)
})

test('claude deploy persists api environment and preflights auth', () => {
  assert.match(electronSources, /function persistClaudeApiEnvironment/)
  assert.match(electronSources, /SetEnvironmentVariable\(\$item\.Key, \$item\.Value, "User"\)/)
  assert.match(electronSources, /ANTHROPIC_API_KEY/)
  assert.match(electronSources, /unsetenv', 'ANTHROPIC_AUTH_TOKEN'/)
  assert.match(electronSources, /delete parsed\.ANTHROPIC_AUTH_TOKEN/)
  assert.match(electronSources, /delete parsed\.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN/)
  assert.match(electronSources, /function probeClaudeMessagesApi/)
  assert.match(electronSources, /buildClaudeMessagesApiUrl/)
  assert.match(electronSources, /Claude 兼容接口预检失败/)
})

test('peer mcp server speaks newline-delimited json-rpc over stdio', () => {
  assert.match(electronSources, /process\.stdout\.write\(JSON\.stringify\(message\) \+ '\\n'\)/)
  assert.doesNotMatch(electronSources, /process\.stdout\.write\('Content-Length: '/)
  assert.match(electronSources, /request\.method === 'initialize'/)
  assert.match(electronSources, /request\.method === 'tools\/list'/)
  assert.match(electronSources, /request\.method === 'tools\/call'/)
})

test('peer mcp tools invoke the peer cli with validated caller working directories', () => {
  assert.match(electronSources, /const \{ spawn \} = require\('node:child_process'\)/)
  assert.match(electronSources, /const fs = require\('node:fs'\)/)
  assert.match(electronSources, /cwd: projectPath/)
  assert.match(electronSources, /args && \(args\.cwd \|\| args\.projectPath\)/)
  assert.match(electronSources, /function resolveProjectPath/)
  assert.match(electronSources, /permissionMode: \{ type: 'string'/)
  assert.match(electronSources, /function buildPeerCliArgs/)
  assert.match(electronSources, /function isFullAccess\(args\) \{\s*void args\s*return true\s*\}/)
  assert.doesNotMatch(electronSources, /'--sandbox', 'workspace-write', '--add-dir', projectPath/)
  assert.doesNotMatch(electronSources, /'--permission-mode', 'acceptEdits', '--add-dir', projectPath/)
  assert.match(electronSources, /'--dangerously-bypass-approvals-and-sandbox'/)
  assert.match(electronSources, /'--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions'/)
  assert.match(electronSources, /ONEAPI_CODEX_COMMAND/)
  assert.match(electronSources, /ONEAPI_CLAUDE_COMMAND/)
  assert.doesNotMatch(electronSources, /D:\\\\WorkSpace\\\\claude/)
})
