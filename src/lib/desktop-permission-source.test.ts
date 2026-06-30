import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const appSource = readFileSync(resolve(projectRoot, 'src', 'App.tsx'), 'utf8')
const assistantChatDrawSource = readFileSync(resolve(projectRoot, 'src', 'features', 'assistants', 'AssistantChatDrawWorkspaces.tsx'), 'utf8')
const activeKeyModelSource = readFileSync(resolve(projectRoot, 'src', 'features', 'desktop-api-key-models.ts'), 'utf8')
const desktopBoundariesSource = readFileSync(resolve(projectRoot, 'electron', 'desktop-boundaries.ts'), 'utf8')
const desktopServiceSource = readFileSync(resolve(projectRoot, 'src', 'lib', 'desktop-service.ts'), 'utf8')
const mainSource = readFileSync(resolve(projectRoot, 'electron', 'main.ts'), 'utf8')
const cliServicesSource = readFileSync(resolve(projectRoot, 'electron', 'main-cli-services.ts'), 'utf8')
const mobileBridgeSource = readFileSync(resolve(projectRoot, 'electron', 'mobile-bridge.ts'), 'utf8')
const cliRuntimeSources = `${mainSource}\n${cliServicesSource}\n${desktopServiceSource}`
const rendererRuntimeSources = `${appSource}\n${assistantChatDrawSource}`

test('desktop file preview keeps arbitrary path support with a 10MB safety cap', () => {
  assert.match(desktopBoundariesSource, /export const FILE_PREVIEW_MAX_BYTES = 10 \* 1024 \* 1024/)
  assert.match(desktopBoundariesSource, /export async function readFilePreview\(targetPath: string\)/)
  assert.match(desktopBoundariesSource, /const resolved = path\.resolve\(targetPath\)/)
  assert.match(desktopBoundariesSource, /stat\.size > FILE_PREVIEW_MAX_BYTES/)
  assert.match(desktopBoundariesSource, /文件超过 10MB/)
})

test('external links are limited to browser-safe protocols', () => {
  assert.match(desktopBoundariesSource, /const EXTERNAL_URL_PROTOCOL_ALLOWLIST = new Set\(\['http:', 'https:', 'mailto:'\]\)/)
  assert.match(desktopBoundariesSource, /export function assertAllowedExternalUrl\(url: string\)/)
  assert.match(mainSource, /shell\.openExternal\(assertAllowedExternalUrl\(url\)\)/)
})

test('cli runs use full-access flags even when stale callers pass restricted state', () => {
  assert.match(mainSource, /const cliAccessDirectories = createCliAccessDirectoryResolver\(getDesktopAttachmentDirectory\)/)
  assert.match(mainSource, /function rememberCliAuthorizedDirectory\(targetPath: string\)/)
  assert.match(mainSource, /async function rememberCliAuthorizedOpenTarget\(targetPath: string\)/)
  assert.match(desktopBoundariesSource, /const authorizedDirectories = new Set<string>\(\)/)
  assert.match(desktopBoundariesSource, /rememberDirectory\(stat\?\.isFile\(\) \? path\.dirname\(normalized\) : normalized\)/)
  assert.match(mainSource, /await rememberCliAuthorizedOpenTarget\(resolved\)/)
  assert.match(mainSource, /function resolveCliAdditionalAccessDirectories\(projectPath: string\)/)
  assert.match(desktopBoundariesSource, /if \(projectRoot\) \{\s*directories\.add\(projectRoot\)\s*\}/)
  assert.match(cliServicesSource, /resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(cliServicesSource, /buildCodexSandboxArgs\([\s\S]*?resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(cliServicesSource, /buildClaudePermissionArgs\([\s\S]*?resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(cliServicesSource, /args\.push\('--json', '-C', input\.projectPath, '--skip-git-repo-check'\)/)
  assert.match(cliServicesSource, /if \(resumeSessionId\) \{\s*args\.push\('resume', resumeSessionId, input\.prompt\)\s*\}/)
  assert.doesNotMatch(cliRuntimeSources, /function buildCliPermissionDiagnostic/)
  assert.doesNotMatch(cliRuntimeSources, /sourceKind: 'runtime\.permission'/)
  assert.doesNotMatch(cliRuntimeSources, /权限诊断/)
  assert.match(desktopServiceSource, /--dangerously-bypass-approvals-and-sandbox/)
  assert.match(desktopServiceSource, /--dangerously-skip-permissions/)
  assert.doesNotMatch(cliRuntimeSources, /args\.includes\('--sandbox'\) && args\.includes\('workspace-write'\)/)
  assert.doesNotMatch(cliRuntimeSources, /args\.includes\('--permission-mode'\) && args\.includes\('acceptEdits'\)/)
})

test('stopped cli runs return aborted result before waiting for session persistence', () => {
  assert.match(mainSource, /ipcMain\.handle\('desktop:stop-cli'[\s\S]*?stoppedCliRequests\.add\(requestId\)[\s\S]*?stopChildProcess\(activeCliProcesses\.get\(requestId\)\)/)
  assert.match(cliServicesSource, /const aborted = stoppedCliRequests\.delete\(input\.requestId\)[\s\S]*?if \(aborted\) \{[\s\S]*?sourceKind: 'request\.aborted'[\s\S]*?metadata: \{[\s\S]*?aborted: true/)
  assert.match(cliServicesSource, /if \(aborted\) \{[\s\S]*?return \{[\s\S]*?error: '用户已停止当前回复'/)
  assert.doesNotMatch(cliServicesSource, /activeCliRequestStates\.delete\(input\.requestId\)[\s\S]{0,220}?void syncMobileBridgeSessionsSnapshot\(true\)/)
})

test('cli runs resolve when terminal json events arrive', () => {
  assert.match(mainSource, /function createLineConsumer\(listener\?: \(line: string\) => boolean \| void\)/)
  assert.match(cliServicesSource, /parsed\.type === 'turn\.completed'[\s\S]*?sawCodexCompletion = true[\s\S]*?stopCodexAfterCompletion\(\)[\s\S]*?return true/)
  assert.match(cliServicesSource, /parsed\.type === 'result'[\s\S]*?sawClaudeResult = true[\s\S]*?stopClaudeAfterResult\(\)[\s\S]*?return true/)
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
  assert.match(cliServicesSource, /state\.mobileBridgeLogs\.push\(/)
  assert.match(mainSource, /logs: state\.mobileBridgeLogs\.slice\(-MOBILE_BRIDGE_MAX_SESSION_LOGS\)/)
  assert.match(mainSource, /const logCount = session\.logs\.length/)
  assert.match(mainSource, /async finish\(result: CliRunResponse\)[\s\S]*?postMobileBridgeJobEvent\(jobId, result\.success \?[\s\S]*?await syncMobileBridgeSessionsSnapshot\(true\)/)
})

test('mobile bridge executes desktop jobs in background so polling and heartbeat are not blocked', () => {
  assert.match(mainSource, /const activeMobileBridgeJobIds = new Set<string>\(\)/)
  assert.match(mainSource, /if \(!jobId \|\| activeMobileBridgeJobIds\.has\(jobId\)\)/)
  assert.match(mainSource, /activeMobileBridgeJobIds\.add\(jobId\)/)
  assert.match(mainSource, /void executeMobileBridgeJob\(job\)[\s\S]*?\.finally\(\(\) => \{[\s\S]*?activeMobileBridgeJobIds\.delete\(jobId\)/)
  assert.doesNotMatch(mainSource, /for \(const job of jobs\) \{\s*await executeMobileBridgeJob\(job\)/)
})

test('mobile bridge prioritizes fast job polling while throttling snapshots', () => {
  assert.match(mainSource, /const MOBILE_BRIDGE_PENDING_JOB_IDLE_INTERVAL_MS = 2000/)
  assert.match(mainSource, /const MOBILE_BRIDGE_PENDING_JOB_ACTIVE_INTERVAL_MS = 1000/)
  assert.match(mainSource, /const MOBILE_BRIDGE_HEARTBEAT_INTERVAL_MS = 30000/)
  assert.match(mainSource, /const MOBILE_BRIDGE_SNAPSHOT_FALLBACK_INTERVAL_MS = 10 \* 60 \* 1000/)
  assert.doesNotMatch(mainSource, /const MOBILE_BRIDGE_LOOP_INTERVAL_MS = 5000/)
  assert.match(mainSource, /const nextLoopDelay = jobs\.length > 0 \|\| activeMobileBridgeJobIds\.size > 0[\s\S]*?MOBILE_BRIDGE_PENDING_JOB_ACTIVE_INTERVAL_MS[\s\S]*?MOBILE_BRIDGE_PENDING_JOB_IDLE_INTERVAL_MS/)
  assert.match(mainSource, /await wait\(nextLoopDelay\)/)
})

test('mobile bridge uploads extensions assistants and sessions only when changed or on sparse fallback', () => {
  assert.match(mainSource, /const MOBILE_BRIDGE_AUX_SNAPSHOT_FALLBACK_INTERVAL_MS = 5 \* 60 \* 1000/)
  assert.match(mainSource, /shouldUploadMobileBridgeAuxSnapshot\('extensions', signature\)/)
  assert.match(mainSource, /shouldUploadMobileBridgeAuxSnapshot\('assistants', signature\)/)
  assert.match(mainSource, /shouldUploadMobileBridgeSessionsSnapshot\(signature, force\)/)
  assert.match(mainSource, /const MOBILE_BRIDGE_MAX_SESSION_SNAPSHOTS = 20/)
  assert.match(mainSource, /const MOBILE_BRIDGE_MAX_SESSION_MESSAGES = 5/)
  assert.match(mainSource, /const MOBILE_BRIDGE_MAX_SESSION_LOGS = 5/)
  assert.match(mainSource, /lastUploadedVersion/)
  assert.match(mainSource, /sessionUpdatedAt/)
  assert.match(mainSource, /messageCount/)
  assert.match(mainSource, /logCount/)
  assert.match(mainSource, /\.slice\(0, MOBILE_BRIDGE_MAX_SESSION_SNAPSHOTS\)/)
})

test('cli runtime emits keepalive progress while long codex and claude runs are silent', () => {
  assert.match(cliServicesSource, /codexKeepAliveTimer = setInterval\(\(\) => \{[\s\S]*?Codex 仍在执行，正在等待新的输出。[\s\S]*?sourceKind: 'runtime\.keepalive'/)
  assert.match(cliServicesSource, /claudeKeepAliveTimer = setInterval\(\(\) => \{[\s\S]*?Claude 仍在执行，正在等待新的输出。[\s\S]*?sourceKind: 'runtime\.keepalive'/)
  assert.match(cliServicesSource, /clearCodexKeepAliveTimer\(\)/)
  assert.match(cliServicesSource, /clearClaudeKeepAliveTimer\(\)/)
})

test('split cli services receive mobile bridge snapshot synchronizer from main process', () => {
  assert.match(cliServicesSource, /syncMobileBridgeSessionsSnapshot/)
  assert.match(
    cliServicesSource,
    /const \{[\s\S]*?syncMobileBridgeSessionsSnapshot,[\s\S]*?\} = deps/,
  )
  assert.match(
    mainSource,
    /createCliServices\(\{[\s\S]*?syncMobileBridgeSessionsSnapshot,[\s\S]*?\}\)/,
  )
})

test('split cli services import shared cli history parsing helpers', () => {
  assert.match(
    cliServicesSource,
    /import \{[\s\S]*?extractCodexAssistantTextFromEvent[\s\S]*?extractCodexFileChanges[\s\S]*?extractClaudeFileChanges[\s\S]*?mergeFileChanges[\s\S]*?shouldIgnoreCodexMessage[\s\S]*?\} from '\.\/main-cli-history\.ts'/
  )
  assert.match(
    readFileSync(resolve(projectRoot, 'electron', 'main-cli-history.ts'), 'utf8'),
    /export function extractCodexAssistantTextFromEvent/
  )
  assert.match(
    readFileSync(resolve(projectRoot, 'electron', 'main-cli-history.ts'), 'utf8'),
    /export function shouldIgnoreCodexMessage/
  )
})

test('cli deploy and runtime use the explicitly selected desktop api key', () => {
  assert.match(rendererRuntimeSources, /activeApiKey: ActiveDesktopApiKeySummary/)
  assert.match(appSource, /const authenticatedUserId = auth\.user\.id/)
  assert.match(appSource, /readSelectedDesktopApiKeyId\(authenticatedUserId, readJsonStorage\)/)
  assert.match(appSource, /oneapi:desktop-api-key-selection/)
  assert.match(
    appSource,
    /resolveActiveDesktopApiKeySummary\(keyPage\?\.items \?\? \[\], persistedSelectedApiKeyId\)/
  )
  assert.match(assistantChatDrawSource, /activeApiKey: ActiveDesktopApiKeySummary/)
  assert.match(appSource, /fetchApiKeySecret\(activeApiKey\.id\)/)
  assert.match(appSource, /loadOneApiModelsForActiveKey\(activeApiKey\)/)
  assert.match(activeKeyModelSource, /const apiKey = await loader\.fetchApiKeySecret\(activeApiKey\.id\)/)
  assert.match(activeKeyModelSource, /scopedModels = await loader\.getApiKeyModels\(apiKey\)/)
  assert.match(activeKeyModelSource, /const fallbackModels = await loader\.getUserModels\(\)/)
  assert.match(activeKeyModelSource, /mergeModelOptions\(scopedModels, filterModelsForDesktopApiKey\(fallbackModels, activeApiKey\)\)/)
  assert.doesNotMatch(rendererRuntimeSources, /ACTIVE_KEY_MODEL_CACHE_TTL_MS/)
  assert.doesNotMatch(rendererRuntimeSources, /activeKeyModelCache/)
  assert.doesNotMatch(rendererRuntimeSources, /activeKeyModelRequests/)
  assert.match(appSource, /runtimeBaseUrl = client === 'codex' \? DEFAULT_CODEX_BASE_URL : DEFAULT_CLAUDE_BASE_URL/)
  assert.match(appSource, /apiKey: runtimeApiKey/)
  assert.match(appSource, /baseUrl: runtimeBaseUrl/)
  assert.doesNotMatch(cliRuntimeSources, /ensureCliApiKeyEnabled/)
  assert.doesNotMatch(cliRuntimeSources, /path: '\/api\/usage\/token'/)
  assert.match(cliServicesSource, /baseUrl: codexProxy\?\.baseUrl \|\| runtimeBaseUrl/)
  assert.match(cliServicesSource, /ANTHROPIC_BASE_URL: runtimeBaseUrl/)
  assert.match(cliServicesSource, /\.\.\.\(claudeProxy \? \{ ANTHROPIC_BASE_URL: claudeProxy\.baseUrl \} : \{\}\)/)
  assert.match(cliServicesSource, /const runtimeApiKey = resolveRuntimeCliApiKey\(input, currentConfig\?\.apiKey\)/)
  assert.match(cliServicesSource, /const runtimeApiKey = resolveRuntimeCliApiKey\(input, pickClaudeApiKey\(claudeSettings\?\.env \|\| \{\}\)\)/)
  assert.doesNotMatch(rendererRuntimeSources, /generated = useCustomProvider[\s\S]*?ensureDesktopServiceKey/)
  assert.doesNotMatch(rendererRuntimeSources, /previouslyEnabledKeys[\s\S]*?updateApiKeyStatus\(key\.id, API_KEY_STATUS_DISABLED\)/)
  assert.doesNotMatch(rendererRuntimeSources, /启用该 Key 并关闭其他 Key/)
})

test('custom provider cli models come from local provider config without login', () => {
  assert.match(appSource, /listCustomAiChatProviderModels\(providerState\)/)
  assert.match(assistantChatDrawSource, /listCustomAiChatProviderModels\(providerState\)/)
  assert.doesNotMatch(appSource, /aiChatProviderMode === 'custom'[\s\S]{0,80}await getUserModels\(\)/)
})

test('cli prompt cache proxy is available inside split cli services', () => {
  assert.match(cliServicesSource, /async function createCliPromptCacheProxy\(/)
  assert.match(cliServicesSource, /apiKey: string/)
  assert.match(cliServicesSource, /headers\.set\('authorization', `Bearer \$\{input\.apiKey\}`\)/)
  assert.match(cliServicesSource, /buildCliPromptCacheKey\(/)
  assert.match(cliServicesSource, /injectCliPromptCacheKeyIntoJsonBody\(/)
  assert.match(cliServicesSource, /createCliPromptCacheProxy\([\s\S]*?targetBaseUrl: runtimeBaseUrl[\s\S]*?apiKey: runtimeApiKey/)
})

test('cli proxy bridges codex responses and claude messages to openai compatible chat completions', () => {
  assert.match(cliServicesSource, /function convertResponsesRequestToChatRequest\(/)
  assert.match(cliServicesSource, /function convertClaudeMessagesRequestToChatRequest\(/)
  assert.match(cliServicesSource, /const CLI_BRIDGE_CHINESE_SYSTEM_PROMPT =/)
  assert.match(cliServicesSource, /所有回复、过程说明、工具调用前的意图\/目的必须使用简体中文/)
  assert.match(cliServicesSource, /role: 'system', content: CLI_BRIDGE_CHINESE_SYSTEM_PROMPT/)
  assert.match(cliServicesSource, /function normalizeResponsesUsage\(/)
  assert.match(cliServicesSource, /shouldBridgeResponses = input\.client === 'codex'[\s\S]*?\/\\\/responses\$\/i/)
  assert.match(cliServicesSource, /shouldBridgeClaudeMessages = input\.client === 'claude'[\s\S]*?\/\\\/messages\$\/i/)
  assert.match(cliServicesSource, /const bridgedPath = shouldBridgeResponses \|\| shouldBridgeClaudeMessages \? '\/v1\/chat\/completions'/)
  assert.match(cliServicesSource, /responsesInputToChatMessages[\s\S]*?type === 'function_call' \|\| type === 'custom_tool_call'/)
  assert.match(cliServicesSource, /convertResponsesToolsToChatTools\(body\.tools\)/)
  assert.match(cliServicesSource, /convertClaudeMessagesRequestToChatRequest[\s\S]*?tool_use[\s\S]*?tool_result/)
  assert.match(cliServicesSource, /pipeConvertedChatSse\(upstream, response, input\.client, requestBodyObject\?\.model, requestBodyObject\)/)
  assert.match(cliServicesSource, /convertChatResponseToResponses\(data, requestBodyObject\?\.model, requestBodyObject\)/)
  assert.match(cliServicesSource, /convertChatResponseToClaude\(data, requestBodyObject\?\.model\)/)
  assert.match(cliServicesSource, /usage: normalizeResponsesUsage\(usage\)/)
  assert.match(cliServicesSource, /usage: normalizeResponsesUsage\(\(data as Record<string, unknown>\)\?\.usage\)/)
  assert.doesNotMatch(rendererRuntimeSources, /该模型需要登录并使用 OneAPI 专用桥接服务/)
})

test('cli intent logs preserve the complete normalized process text', () => {
  assert.match(cliServicesSource, /function summarizeCliIntentStep\(value: string\)/)
  assert.match(cliServicesSource, /return summarizeCliIntentForLog\(value, Number\.MAX_SAFE_INTEGER\)/)
  assert.doesNotMatch(cliServicesSource, /function summarizeCliIntentStep\(value: string, maxLength = 120\)/)
  assert.doesNotMatch(cliServicesSource, /const lastSegment = segments\.at\(-1\)/)
})

test('codex bridge completion can finish successfully even when the child process is stopped after completion', () => {
  assert.match(cliServicesSource, /const success =[\s\S]*?output\.length > 0[\s\S]*?completionReached/)
  assert.match(cliServicesSource, /const completedWithWarnings =[\s\S]*?output\.length > 0[\s\S]*?completionReached[\s\S]*?result\.exitCode !== 0/)
  assert.match(cliServicesSource, /return \{\s*success: success \|\| completedWithWarnings/)
})

test('custom provider cli runtime keeps third-party api keys unchanged', () => {
  assert.match(cliServicesSource, /function resolveRuntimeCliApiKey/)
  assert.match(cliServicesSource, /function normalizeRuntimeCliApiKey/)
  assert.match(appSource, /apiKeySource: aiChatProviderMode === 'custom' \? 'custom' : 'oneapi'/)
  assert.match(cliServicesSource, /apiKeySource === 'custom'[\s\S]*?return trimmed/)
  assert.match(cliServicesSource, /function resolveDeployCliApiKey[\s\S]*?request\.apiKeySource === 'custom'[\s\S]*?return trimmed/)
  assert.match(cliServicesSource, /DESKTOP_CLI_RUNTIME_ONEAPI_KEY_PATTERN\.test\(trimmed\)/)
  assert.match(cliServicesSource, /return trimmed/)
  assert.doesNotMatch(cliServicesSource, /return resolveDesktopCliKeyRecord\(requested\)/)
  assert.doesNotMatch(cliServicesSource, /const apiKey = normalizeDesktopCliApiKey\(runtimeConfig\.apiKey\)/)
  assert.match(cliServicesSource, /const apiKey = runtimeConfig\.apiKey\.trim\(\)/)
  assert.match(cliServicesSource, /ONEAPI_API_KEY_SOURCE: request\.apiKeySource \|\| 'oneapi'/)
  assert.match(cliServicesSource, /normalizeClaudeApiKeyForSource\(apiKey, configEnv\.ONEAPI_API_KEY_SOURCE\)/)
  assert.match(cliServicesSource, /normalizeCliApiKeyForSource\(current\.apiKey, request\.apiKeySource\) === resolvedKey/)
})

test('chat pending messages do not render placeholder thinking when reasoning is empty', () => {
  assert.doesNotMatch(assistantChatDrawSource, /PendingMessageContent label=\{CHAT_PENDING_MESSAGE_LABEL\.replace/)
  assert.doesNotMatch(assistantChatDrawSource, /content: hasVisibleContent \? visibleContent : CHAT_PENDING_MESSAGE_LABEL/)
})

test('claude bridge output with a cli error is downgraded to warning instead of failed', () => {
  assert.match(
    cliServicesSource,
    /const completedWithWarnings =[\s\S]*?output\.length > 0[\s\S]*?\(!!runtimeDiagnostics\.policyIssue \|\| \(sawClaudeResult && finalResult\?\.is_error === true\)\)/
  )
  assert.match(cliServicesSource, /sourceKind: 'result\.with_warnings'/)
  assert.match(cliServicesSource, /return \{\s*success: success \|\| completedWithWarnings/)
})

test('desktop image requests resolve async poll_url tasks before returning to renderer', () => {
  assert.match(mainSource, /function isImageApiPath\(pathname: string\)/)
  assert.match(mainSource, /resolveImagePendingPollUrl/)
  assert.match(mainSource, /resolveImagePendingStatus/)
  assert.match(mainSource, /async function requestApi[\s\S]*?const data = await parseResponse\(response\)[\s\S]*?isImageApiPath\(input\.path\)[\s\S]*?resolveAsyncImageGenerationResponse\(data/)
  assert.match(mainSource, /async function requestImageEdit[\s\S]*?return resolveAsyncImageGenerationResponse\(data/)
  assert.match(mainSource, /status === 'completed'[\s\S]*?图片任务已完成但未返回可展示图片/)
})

test('custom provider image edit uses desktop multipart bridge instead of oneapi-only path', () => {
  assert.match(mainSource, /async function requestCustomImageEdit\(input: DesktopCustomImageEditRequest\)/)
  assert.match(mainSource, /buildOpenAICompatibleUrl\(input\.baseUrl, '\/images\/edits'\)/)
  assert.match(mainSource, /ipcMain\.handle\('desktop:custom-image-edit'/)
  assert.match(assistantChatDrawSource, /providerState\.mode === 'custom'[\s\S]*?sendAiImageEdit\(providerState, editRequest\)/)
  assert.doesNotMatch(assistantChatDrawSource, /自定义 API 通道当前仅支持文本生图/)
})

test('cli submit cleanup clears local Coding partial after ipc errors', () => {
  assert.match(appSource, /setPersistedCliPartialMap\(\(current\) => \(\{\s*\.\.\.current,\s*\[currentSessionKey\]: CLI_PENDING_MESSAGE_LABEL/)
  assert.match(appSource, /finally \{[\s\S]*?setPersistedCliPartialMap\(\(current\) => \(\{\s*\.\.\.current,\s*\[finalSessionKey\]: '',\s*\}\)\)/)
})

test('cli submit resumes the resolved current session instead of stale active session', () => {
  assert.match(appSource, /const projectSessionMapRef = useRef\(projectSessionMap\)/)
  assert.match(appSource, /function updateProjectSessionMap\(/)
  assert.match(appSource, /projectSessionMapRef\.current = updater\(projectSessionMapRef\.current\)/)
  assert.match(
    appSource,
    /const currentSessionKey =[\s\S]*?projectSessionMapRef\.current\[requestProjectKey\]\?\.trim\(\)[\s\S]*?\|\|[\s\S]*?activeSessionId[\s\S]*?\|\|[\s\S]*?`draft-\$\{client\}-\$\{Date\.now\(\)\}`/,
  )
  assert.match(appSource, /sessionId: getCliResumeSessionId\(currentSessionKey\)/)
  assert.doesNotMatch(appSource, /sessionId: getCliResumeSessionId\(activeSessionId\)/)
})

test('draw workspace also uses the active enabled desktop api key', () => {
  assert.match(assistantChatDrawSource, /function DrawWorkspace\(props: \{[\s\S]*?activeApiKey: ActiveDesktopApiKeySummary/)
  assert.match(assistantChatDrawSource, /const \{ toast, active, providerState, activeApiKey, onRunningChange \} = props/)
  const drawExecutor = assistantChatDrawSource.match(/async function executeDrawRequest[\s\S]*?\r?\n  }\r?\n\r?\n  function buildResolvedDrawAssistantMessage/)?.[0] || ''
  assert.match(drawExecutor, /if \(!activeApiKey\?\.id\) \{[\s\S]*?请先在已有 Key 中启用一个 Key/)
  assert.match(drawExecutor, /const activeApiKeySecret = await fetchApiKeySecret\(activeApiKey\.id\)/)
  assert.doesNotMatch(drawExecutor, /ensureDesktopServiceKey/)
})

test('inactive windows pause aurora and hidden cli panes poll less often', () => {
  assert.match(appSource, /document\.documentElement\.dataset\.windowActive = active \? 'active' : 'inactive'/)
  assert.match(appSource, /const shouldPollActively = active \|\| effectiveRunning/)
  assert.match(appSource, /const intervalMs = shouldPollActively \? 30000 : 180000/)
})

test('settings persists explicit desktop api key selection per user', () => {
  const settingsSource = readFileSync(resolve(projectRoot, 'src', 'features', 'settings', 'SettingsWorkspaces.tsx'), 'utf8')
  assert.match(settingsSource, /readSelectedDesktopApiKeyId\(user\.id, readJsonStorage\)/)
  assert.match(settingsSource, /writeSelectedDesktopApiKeyId\(user\.id, nextId, writeJsonStorage\)/)
  assert.match(settingsSource, /clearSelectedDesktopApiKeyId\(user\.id, removeStorage\)/)
  assert.match(settingsSource, /oneapi:desktop-api-key-selection/)
  const automaticApiKeyRefreshEffect =
    settingsSource.match(/useEffect\(\(\) => \{\s*setSelectedApiKeyId\(\(current\) => \{[\s\S]*?\}\)\s*\}, \[apiKeys, user\.id\]\)/)?.[0] || ''
  assert.match(automaticApiKeyRefreshEffect, /readSelectedDesktopApiKeyId\(user\.id, readJsonStorage\)/)
  assert.match(automaticApiKeyRefreshEffect, /return resolveSelectedDesktopApiKeyId\(apiKeys, current\)/)
  assert.doesNotMatch(automaticApiKeyRefreshEffect, /writeSelectedDesktopApiKeyId/)
  assert.doesNotMatch(automaticApiKeyRefreshEffect, /clearSelectedDesktopApiKeyId/)
})
