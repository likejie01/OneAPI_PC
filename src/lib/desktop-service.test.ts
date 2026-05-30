import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeCliWorkspaceStatus,
  isCliStatusInstalled,
  MIN_DESKTOP_CLI_NODE_MAJOR,
  buildCodexSandboxArgs,
  buildNodeBackedCliScriptPath,
  buildWindowsNodeExecutableCandidates,
  buildWindowsNpmGlobalCliCandidates,
  buildWindowsCommandShimArgs,
  isDesktopCliNodeVersionSupported,
  parseNodeMajorVersion,
  quoteWindowsCommandArg,
  resolveWindowsCommandShimCommand,
  resolveCliSetupPeerState,
  sanitizeCliNpmEnvironment,
  selectReusableDesktopApiKey,
  shouldUseWindowsCommandShimForPath,
  supportsCodexAskForApprovalFlag,
} from './desktop-service.ts'

test('parseNodeMajorVersion reads common node version formats', () => {
  assert.equal(parseNodeMajorVersion('v18.20.8'), 18)
  assert.equal(parseNodeMajorVersion('20.11.1'), 20)
  assert.equal(parseNodeMajorVersion('node is not installed'), null)
})

test('isDesktopCliNodeVersionSupported enforces desktop CLI minimum node version', () => {
  assert.equal(MIN_DESKTOP_CLI_NODE_MAJOR, 18)
  assert.equal(isDesktopCliNodeVersionSupported('v16.20.2'), false)
  assert.equal(isDesktopCliNodeVersionSupported('v18.0.0'), true)
  assert.equal(isDesktopCliNodeVersionSupported('v24.14.0'), true)
})

test('shouldUseWindowsCommandShimForPath handles Windows script commands', () => {
  assert.equal(shouldUseWindowsCommandShimForPath('C:\\toolchains\\node-runtime\\npm.cmd', 'win32'), true)
  assert.equal(shouldUseWindowsCommandShimForPath('npm', 'win32'), true)
  assert.equal(shouldUseWindowsCommandShimForPath('codex', 'win32'), true)
  assert.equal(shouldUseWindowsCommandShimForPath('/usr/bin/npm', 'linux'), false)
})

test('buildWindowsCommandShimArgs uses call for command shims with spaces', () => {
  assert.equal(
    quoteWindowsCommandArg('C:\\Users\\Honor Elite\\AppData\\Roaming\\oneapi-pc\\toolchains\\npm-global\\claude.cmd'),
    '"C:\\Users\\Honor Elite\\AppData\\Roaming\\oneapi-pc\\toolchains\\npm-global\\claude.cmd"'
  )
  assert.deepEqual(
    buildWindowsCommandShimArgs(
      'C:\\Users\\Honor Elite\\AppData\\Roaming\\oneapi-pc\\toolchains\\npm-global\\claude.cmd',
      ['--version']
    ),
    [
      '/d',
      '/c',
      'call "C:\\Users\\Honor Elite\\AppData\\Roaming\\oneapi-pc\\toolchains\\npm-global\\claude.cmd" --version',
    ]
  )
})

test('resolveWindowsCommandShimCommand avoids PATH-dependent cmd lookup', () => {
  assert.equal(
    resolveWindowsCommandShimCommand({
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATH: 'D:\\OneAPI\\toolchains\\npm-global;D:\\OneAPI\\toolchains\\node',
    }),
    'C:\\Windows\\System32\\cmd.exe'
  )
  assert.equal(
    resolveWindowsCommandShimCommand({
      SystemRoot: 'C:\\Windows',
      PATH: 'D:\\OneAPI\\toolchains\\npm-global',
    }),
    'C:\\Windows\\System32\\cmd.exe'
  )
})

test('buildNodeBackedCliScriptPath resolves npm CLI wrapper targets on Windows', () => {
  assert.equal(
    buildNodeBackedCliScriptPath('claude', 'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude'),
    'C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
  )
  assert.equal(
    buildNodeBackedCliScriptPath('claude', 'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.cmd'),
    'C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
  )
  assert.equal(
    buildNodeBackedCliScriptPath('codex', 'C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd'),
    'C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'
  )
})

test('buildWindowsNpmGlobalCliCandidates finds user npm cli shims without PATH', () => {
  assert.deepEqual(
    buildWindowsNpmGlobalCliCandidates('claude', {
      APPDATA: 'C:\\Users\\demo\\AppData\\Roaming',
      USERPROFILE: 'C:\\Users\\demo',
    }),
    [
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.cmd',
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.exe',
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude',
    ]
  )
  assert.deepEqual(
    buildWindowsNpmGlobalCliCandidates('claude', {
      USERPROFILE: 'C:\\Users\\demo',
    }),
    [
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.cmd',
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.exe',
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude',
    ]
  )
})

test('buildWindowsNodeExecutableCandidates finds common Node installs without PATH', () => {
  assert.deepEqual(
    buildWindowsNodeExecutableCandidates({
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local',
    }),
    [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      'C:\\Users\\demo\\AppData\\Local\\Programs\\nodejs\\node.exe',
    ]
  )
})

test('buildCodexSandboxArgs removes client-side permission restrictions for every mode', () => {
  assert.deepEqual(buildCodexSandboxArgs(false, false), ['--dangerously-bypass-approvals-and-sandbox'])
  assert.deepEqual(buildCodexSandboxArgs(false, true), ['--dangerously-bypass-approvals-and-sandbox'])
  assert.deepEqual(buildCodexSandboxArgs(true, false), ['--dangerously-bypass-approvals-and-sandbox'])
  assert.deepEqual(buildCodexSandboxArgs(true, true), ['--dangerously-bypass-approvals-and-sandbox'])
})

test('supportsCodexAskForApprovalFlag detects help output capability', () => {
  assert.equal(supportsCodexAskForApprovalFlag('Options:\n  --ask-for-approval <MODE>\n'), true)
  assert.equal(supportsCodexAskForApprovalFlag('... --sandbox <SANDBOX_MODE> ...'), false)
})

test('sanitizeCliNpmEnvironment forces online npm fetches for CLI tasks', () => {
  const env = sanitizeCliNpmEnvironment(
    {
      PATH: 'C:\\Windows',
      npm_config_offline: 'true',
      NPM_CONFIG_PREFER_OFFLINE: 'true',
      npm_config_cache_mode: 'only-if-cached',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      npm_config_https_proxy: 'http://127.0.0.1:7890',
    },
    {
      registry: 'https://registry.npmmirror.com',
      prefix: 'D:\\prefix',
      cache: 'D:\\cache',
      userConfig: 'D:\\npm\\user.npmrc',
      globalConfig: 'D:\\npm\\global.npmrc',
    }
  )

  assert.equal(env.PATH, 'C:\\Windows')
  assert.equal(env.NPM_CONFIG_PREFER_OFFLINE, undefined)
  assert.equal(env.npm_config_cache_mode, undefined)
  assert.equal(env.npm_config_offline, 'false')
  assert.equal(env.npm_config_prefer_offline, 'false')
  assert.equal(env.npm_config_prefer_online, 'true')
  assert.equal(env.HTTP_PROXY, '')
  assert.equal(env.HTTPS_PROXY, '')
  assert.equal(env.ALL_PROXY, '')
  assert.equal(env.NO_PROXY, '*')
  assert.equal(env.http_proxy, '')
  assert.equal(env.https_proxy, '')
  assert.equal(env.npm_config_proxy, '')
  assert.equal(env.npm_config_http_proxy, '')
  assert.equal(env.npm_config_https_proxy, '')
  assert.equal(env.npm_config_noproxy, '*')
  assert.equal(env.npm_config_registry, 'https://registry.npmmirror.com')
  assert.equal(env.npm_config_prefix, 'D:\\prefix')
  assert.equal(env.npm_config_cache, 'D:\\cache')
  assert.equal(env.npm_config_userconfig, 'D:\\npm\\user.npmrc')
  assert.equal(env.NPM_CONFIG_USERCONFIG, 'D:\\npm\\user.npmrc')
  assert.equal(env.npm_config_globalconfig, 'D:\\npm\\global.npmrc')
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, 'D:\\npm\\global.npmrc')
})

test('selectReusableDesktopApiKey prefers active matching-group keys', () => {
  const selected = selectReusableDesktopApiKey(
    [
      { id: 1, name: '旧 Key', status: 1, group: 'default', created_time: 10 },
      { id: 2, name: '桌面端专用 Key', status: 1, group: 'vip', created_time: 20 },
      { id: 3, name: '新 Key', status: 1, group: 'vip', created_time: 30 },
    ],
    {
      group: 'vip',
      preferredNames: ['桌面端专用 Key'],
    }
  )

  assert.equal(selected?.id, 2)
})

test('resolveCliSetupPeerState hides peer placeholder during opposite deployment', () => {
  assert.deepEqual(resolveCliSetupPeerState('claude', 'codex'), {
    isActiveDeploy: false,
    isPeerDeploying: true,
    disableDeployButton: true,
    showDeployPlaceholder: false,
  })
})

test('isCliStatusInstalled accepts configured legacy cli footprints', () => {
  assert.equal(
    isCliStatusInstalled({
      client: 'codex',
      installed: false,
      version: '',
      executablePath: '',
      configPath: 'C:\\Users\\demo\\.codex\\config.toml',
      dataPath: 'C:\\Users\\demo\\.codex',
      hasConfig: true,
      hasDataDirectory: true,
      hasApiKey: true,
      baseUrl: 'https://legacy.example/v1',
      managedByDesktop: false,
      brokenInstallation: false,
    }),
    true
  )
})

test('describeCliWorkspaceStatus explains mismatched server instead of treating it as undeployed', () => {
  const status = describeCliWorkspaceStatus(
    {
      client: 'claude',
      installed: true,
      version: '1.0.0',
      executablePath: 'C:\\tools\\claude.cmd',
      configPath: 'C:\\Users\\demo\\.claude.json',
      dataPath: 'C:\\Users\\demo\\.claude',
      hasConfig: true,
      hasDataDirectory: true,
      hasApiKey: true,
      baseUrl: 'https://legacy.example',
      managedByDesktop: false,
      brokenInstallation: false,
    },
    'https://ai.oneapi.center'
  )

  assert.equal(status.level, 'config')
  assert.equal(status.title, '已安装，但服务器配置不一致')
})
