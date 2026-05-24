import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_DESKTOP_CLI_NODE_MAJOR,
  buildWindowsCommandShimArgs,
  isDesktopCliNodeVersionSupported,
  parseNodeMajorVersion,
  quoteWindowsCommandArg,
  resolveCliSetupPeerState,
  sanitizeCliNpmEnvironment,
  selectReusableDesktopApiKey,
  shouldUseWindowsCommandShimForPath,
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

test('sanitizeCliNpmEnvironment forces online npm fetches for CLI tasks', () => {
  const env = sanitizeCliNpmEnvironment(
    {
      PATH: 'C:\\Windows',
      npm_config_offline: 'true',
      NPM_CONFIG_PREFER_OFFLINE: 'true',
      npm_config_cache_mode: 'only-if-cached',
    },
    {
      registry: 'https://registry.npmmirror.com',
      prefix: 'D:\\prefix',
      cache: 'D:\\cache',
    }
  )

  assert.equal(env.PATH, 'C:\\Windows')
  assert.equal(env.NPM_CONFIG_PREFER_OFFLINE, undefined)
  assert.equal(env.npm_config_cache_mode, undefined)
  assert.equal(env.npm_config_offline, 'false')
  assert.equal(env.npm_config_prefer_offline, 'false')
  assert.equal(env.npm_config_prefer_online, 'true')
  assert.equal(env.npm_config_registry, 'https://registry.npmmirror.com')
  assert.equal(env.npm_config_prefix, 'D:\\prefix')
  assert.equal(env.npm_config_cache, 'D:\\cache')
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
