import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const appSource = readFileSync(resolve(projectRoot, 'src', 'App.tsx'), 'utf8')
const mainSource = readFileSync(resolve(projectRoot, 'electron', 'main.ts'), 'utf8')
const mobileBridgeSource = readFileSync(resolve(projectRoot, 'electron', 'mobile-bridge.ts'), 'utf8')

test('desktop file preview keeps arbitrary path support with a 10MB safety cap', () => {
  assert.match(mainSource, /const FILE_PREVIEW_MAX_BYTES = 10 \* 1024 \* 1024/)
  assert.match(mainSource, /async function readFilePreview\(targetPath: string\)/)
  assert.match(mainSource, /const resolved = path\.resolve\(targetPath\)/)
  assert.match(mainSource, /stat\.size > FILE_PREVIEW_MAX_BYTES/)
  assert.match(mainSource, /文件超过 10MB/)
})

test('external links are limited to browser-safe protocols', () => {
  assert.match(mainSource, /const EXTERNAL_URL_PROTOCOL_ALLOWLIST = new Set\(\['http:', 'https:', 'mailto:'\]\)/)
  assert.match(mainSource, /function assertAllowedExternalUrl\(url: string\)/)
  assert.match(mainSource, /shell\.openExternal\(assertAllowedExternalUrl\(url\)\)/)
})

test('cli runs use full-access flags even when stale callers pass restricted state', () => {
  assert.match(mainSource, /const cliUserAuthorizedDirectories = new Set<string>\(\)/)
  assert.match(mainSource, /function rememberCliAuthorizedDirectory\(targetPath: string\)/)
  assert.match(mainSource, /async function rememberCliAuthorizedOpenTarget\(targetPath: string\)/)
  assert.match(mainSource, /rememberCliAuthorizedDirectory\(stat\?\.isFile\(\) \? path\.dirname\(normalized\) : normalized\)/)
  assert.match(mainSource, /await rememberCliAuthorizedOpenTarget\(resolved\)/)
  assert.match(mainSource, /function resolveCliAdditionalAccessDirectories\(projectPath: string\)/)
  assert.match(mainSource, /if \(projectRoot\) \{\s*directories\.add\(projectRoot\)\s*\}/)
  assert.match(mainSource, /resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(mainSource, /buildCodexSandboxArgs\([\s\S]*?resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(mainSource, /buildClaudePermissionArgs\([\s\S]*?resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(mainSource, /args\.push\('--json', '-C', input\.projectPath, '--skip-git-repo-check'\)/)
  assert.match(mainSource, /if \(resumeSessionId\) \{\s*args\.push\('resume', resumeSessionId, input\.prompt\)\s*\}/)
  assert.doesNotMatch(mainSource, /function buildCliPermissionDiagnostic/)
  assert.doesNotMatch(mainSource, /sourceKind: 'runtime\.permission'/)
  assert.doesNotMatch(mainSource, /权限诊断/)
  assert.match(mainSource, /--dangerously-bypass-approvals-and-sandbox/)
  assert.match(mainSource, /--dangerously-skip-permissions/)
  assert.doesNotMatch(mainSource, /args\.includes\('--sandbox'\) && args\.includes\('workspace-write'\)/)
  assert.doesNotMatch(mainSource, /args\.includes\('--permission-mode'\) && args\.includes\('acceptEdits'\)/)
})

test('stopped cli runs return aborted result before waiting for session persistence', () => {
  assert.match(mainSource, /ipcMain\.handle\('desktop:stop-cli'[\s\S]*?stoppedCliRequests\.add\(requestId\)[\s\S]*?stopChildProcess\(activeCliProcesses\.get\(requestId\)\)/)
  assert.match(mainSource, /const aborted = stoppedCliRequests\.delete\(input\.requestId\)[\s\S]*?if \(aborted\) \{[\s\S]*?sourceKind: 'request\.aborted'[\s\S]*?metadata: \{[\s\S]*?aborted: true/)
  assert.match(mainSource, /if \(aborted\) \{[\s\S]*?return \{[\s\S]*?error: '用户已停止当前回复'[\s\S]*?\}[\s\S]*?const events = parseJsonObjectsFromText\(result\.stdout\)/)
})

test('cli runs resolve when terminal json events arrive', () => {
  assert.match(mainSource, /function createLineConsumer\(listener\?: \(line: string\) => boolean \| void\)/)
  assert.match(mainSource, /const finishFromCompletedStreamEvent = \(\) => \{[\s\S]*?finish\(0\)[\s\S]*?stopChildProcess\(child\)/)
  assert.match(mainSource, /parsed\.type === 'turn\.completed'[\s\S]*?sawCodexCompletion = true[\s\S]*?return true/)
  assert.match(mainSource, /parsed\.type === 'result'[\s\S]*?sawClaudeResult = true[\s\S]*?return true/)
})

test('mobile bridge forwards requested project path and permission mode', () => {
  assert.match(mobileBridgeSource, /project_path\?: string/)
  assert.match(mobileBridgeSource, /permission_mode\?: string/)
  assert.match(mobileBridgeSource, /projectPath: raw\.projectPath \|\| raw\.project_path \|\| ''/)
  assert.match(mobileBridgeSource, /permissionMode: raw\.permissionMode \|\| raw\.permission_mode \|\| ''/)
  assert.match(mainSource, /const projectPath = job\.projectPath\.trim\(\) \|\| \(await readBridgeClientProjectPath\(job\.client\)\)\.trim\(\) \|\| os\.homedir\(\)/)
  assert.match(mainSource, /const fullAccess = job\.permissionMode === 'full' \|\| job\.permissionMode === 'full_access'/)
  assert.match(mainSource, /buildFinalPrompt\(\{[\s\S]*?fullAccess,[\s\S]*?\}\)/)
})

test('mobile bridge marks cli jobs as running before cli output arrives', () => {
  assert.match(mainSource, /id: `\$\{requestId\}-running`[\s\S]*?phase: 'running'[\s\S]*?title: `\$\{job\.client === 'codex' \? 'Codex' : 'Claude'\} 正在执行`/)
  assert.match(mainSource, /id: `\$\{request\.requestId\}-running`[\s\S]*?phase: 'running'[\s\S]*?title: `\$\{request\.client === 'codex' \? 'Codex' : 'Claude'\} 正在执行`/)
})

test('mobile bridge active session snapshots include running logs', () => {
  assert.match(mainSource, /mobileBridgeLogs: Array<Record<string, unknown>>/)
  assert.match(mainSource, /state\.mobileBridgeLogs\.push\(/)
  assert.match(mainSource, /logs: state\.mobileBridgeLogs\.slice\(-80\)/)
  assert.match(mainSource, /logCount: item\.logs\.length/)
})

test('cli deploy and runtime use only the active enabled desktop api key', () => {
  assert.match(appSource, /activeApiKey: ActiveDesktopApiKeySummary/)
  assert.match(appSource, /fetchApiKeySecret\(activeApiKey\.id\)/)
  const modelLoader = appSource.match(/async function loadOneApiModelsForActiveKey[\s\S]*?\n}\n\nfunction AssistantsChatWorkspace/)?.[0] || ''
  assert.match(modelLoader, /const apiKey = await fetchApiKeySecret\(activeApiKey\.id\)/)
  assert.match(modelLoader, /const models = await getApiKeyModels\(apiKey\)/)
  assert.doesNotMatch(modelLoader, /const models = await getUserModels\(\)/)
  assert.doesNotMatch(appSource, /ACTIVE_KEY_MODEL_CACHE_TTL_MS/)
  assert.doesNotMatch(appSource, /activeKeyModelCache/)
  assert.doesNotMatch(appSource, /activeKeyModelRequests/)
  assert.match(appSource, /runtimeBaseUrl = client === 'codex' \? DEFAULT_CODEX_BASE_URL : DEFAULT_CLAUDE_BASE_URL/)
  assert.match(appSource, /apiKey: runtimeApiKey/)
  assert.match(appSource, /baseUrl: runtimeBaseUrl/)
  assert.doesNotMatch(mainSource, /ensureCliApiKeyEnabled/)
  assert.doesNotMatch(mainSource, /path: '\/api\/usage\/token'/)
  assert.match(mainSource, /baseUrl: `http:\/\/127\.0\.0\.1:\$\{address\.port\}`/)
  assert.doesNotMatch(mainSource, /baseUrl: `http:\/\/127\.0\.0\.1:\$\{address\.port\}\$\{targetBase\.pathname/)
  assert.match(mainSource, /const runtimeApiKey = resolveRuntimeCliApiKey\(input, currentConfig\?\.apiKey\)/)
  assert.match(mainSource, /const runtimeApiKey = resolveRuntimeCliApiKey\(input, pickClaudeApiKey\(claudeSettings\?\.env \|\| \{\}\)\)/)
  assert.doesNotMatch(appSource, /generated = useCustomProvider[\s\S]*?ensureDesktopServiceKey/)
  assert.doesNotMatch(appSource, /previouslyEnabledKeys[\s\S]*?updateApiKeyStatus\(key\.id, API_KEY_STATUS_DISABLED\)/)
  assert.doesNotMatch(appSource, /启用该 Key 并关闭其他 Key/)
})

test('draw workspace also uses the active enabled desktop api key', () => {
  assert.match(appSource, /function DrawWorkspace\(props: \{[\s\S]*?activeApiKey: ActiveDesktopApiKeySummary/)
  assert.match(appSource, /const \{ toast, active, providerState, activeApiKey \} = props/)
  const drawExecutor = appSource.match(/async function executeDrawRequest[\s\S]*?\r?\n  }\r?\n\r?\n  function buildResolvedDrawAssistantMessage/)?.[0] || ''
  assert.match(drawExecutor, /if \(!activeApiKey\?\.id\) \{[\s\S]*?请先在已有 Key 中启用一个 Key/)
  assert.match(drawExecutor, /const activeApiKeySecret = await fetchApiKeySecret\(activeApiKey\.id\)/)
  assert.doesNotMatch(drawExecutor, /ensureDesktopServiceKey/)
})

test('inactive windows pause aurora and hidden cli panes poll less often', () => {
  assert.match(appSource, /document\.documentElement\.dataset\.windowActive = active \? 'active' : 'inactive'/)
  assert.match(appSource, /const shouldPollActively = active \|\| effectiveRunning/)
  assert.match(appSource, /const intervalMs = shouldPollActively \? 30000 : 180000/)
})
