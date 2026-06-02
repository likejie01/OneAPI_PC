import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const libDir = dirname(fileURLToPath(import.meta.url))
const electronMainSource = readFileSync(resolve(libDir, '..', '..', 'electron', 'main.ts'), 'utf8')

test('peer mcp bridge is installed by one-click deploy for both cli clients', () => {
  assert.match(electronMainSource, /function createCodexPeerMcpSection/)
  assert.match(electronMainSource, /\[mcp_servers\.oneapi_claude\]/)
  assert.match(electronMainSource, /mcpServers[\s\S]*?oneapi_codex/)
  assert.match(electronMainSource, /await installPeerMcpBridge\(runtime, logger\)/)
})

test('codex to claude mcp config carries claude api environment', () => {
  assert.match(electronMainSource, /function createCodexPeerMcpEnv/)
  assert.match(electronMainSource, /ANTHROPIC_AUTH_TOKEN/)
  assert.match(electronMainSource, /ANTHROPIC_API_KEY/)
  assert.match(electronMainSource, /ANTHROPIC_BASE_URL/)
  assert.match(electronMainSource, /readResolvedClaudeSettingsDocument\(\)\.catch\(\(\) => null\)/)
  assert.match(electronMainSource, /mergeCodexPeerMcpConfig\(codexRaw, runtime\.nodePath, serverPath, claudeCommand, claudeSettingsDocument\)/)
  assert.match(electronMainSource, /oneapi_codex: \{[\s\S]*?env: \{ ONEAPI_CODEX_COMMAND: codexCommand \}/)
})

test('codex cli runtime inherits claude api environment for peer calls', () => {
  assert.match(electronMainSource, /function buildCodexCliEnv/)
  assert.match(electronMainSource, /const claudeSettingsForCodex = await readResolvedClaudeSettingsDocument\(\)\.catch\(\(\) => null\)/)
  assert.match(electronMainSource, /const codexEnv = buildCodexCliEnv\(managedRuntime, claudeSettingsForCodex\)/)
  assert.match(electronMainSource, /env: codexEnv/)
})

test('peer mcp server speaks newline-delimited json-rpc over stdio', () => {
  assert.match(electronMainSource, /process\.stdout\.write\(JSON\.stringify\(message\) \+ '\\n'\)/)
  assert.doesNotMatch(electronMainSource, /process\.stdout\.write\('Content-Length: '/)
  assert.match(electronMainSource, /request\.method === 'initialize'/)
  assert.match(electronMainSource, /request\.method === 'tools\/list'/)
  assert.match(electronMainSource, /request\.method === 'tools\/call'/)
})

test('peer mcp tools invoke the peer cli with validated caller working directories', () => {
  assert.match(electronMainSource, /const \{ spawn \} = require\('node:child_process'\)/)
  assert.match(electronMainSource, /const fs = require\('node:fs'\)/)
  assert.match(electronMainSource, /cwd: projectPath/)
  assert.match(electronMainSource, /args && \(args\.cwd \|\| args\.projectPath\)/)
  assert.match(electronMainSource, /function resolveProjectPath/)
  assert.match(electronMainSource, /ONEAPI_CODEX_COMMAND/)
  assert.match(electronMainSource, /ONEAPI_CLAUDE_COMMAND/)
  assert.doesNotMatch(electronMainSource, /D:\\\\WorkSpace\\\\claude/)
})
