import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCliSetupPeerState,
  selectReusableDesktopApiKey,
  shouldUseWindowsCommandShimForPath,
} from './desktop-service.ts'

test('shouldUseWindowsCommandShimForPath handles Windows script commands', () => {
  assert.equal(shouldUseWindowsCommandShimForPath('C:\\toolchains\\node-runtime\\npm.cmd', 'win32'), true)
  assert.equal(shouldUseWindowsCommandShimForPath('npm', 'win32'), true)
  assert.equal(shouldUseWindowsCommandShimForPath('codex', 'win32'), true)
  assert.equal(shouldUseWindowsCommandShimForPath('/usr/bin/npm', 'linux'), false)
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
