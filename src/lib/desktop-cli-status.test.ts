import test from 'node:test'
import assert from 'node:assert/strict'
import { isCliStatusReadyForWorkspace, resolveCliProbeResult } from './desktop-service.ts'

test('resolveCliProbeResult treats runnable binaries as installed', () => {
  assert.deepEqual(
    resolveCliProbeResult({
      executablePath: 'C:\\tools\\codex.cmd',
      version: '1.2.3',
      versionExitCode: 0,
    }),
    {
      installed: true,
      version: '1.2.3',
      brokenInstallation: false,
    }
  )
})

test('resolveCliProbeResult treats broken binaries as not installed', () => {
  assert.deepEqual(
    resolveCliProbeResult({
      executablePath: 'C:\\tools\\codex.cmd',
      version: '',
      versionExitCode: 1,
    }),
    {
      installed: false,
      version: '',
      brokenInstallation: true,
    }
  )
})

test('isCliStatusReadyForWorkspace accepts legacy desktop Codex configs that still target the current server', () => {
  assert.equal(
    isCliStatusReadyForWorkspace(
      {
        client: 'codex',
        installed: true,
        version: '1.2.3',
        executablePath: 'C:\\tools\\codex.cmd',
        configPath: 'C:\\Users\\demo\\.codex\\config.toml',
        dataPath: 'C:\\Users\\demo\\.codex',
        hasConfig: true,
        hasDataDirectory: true,
        hasApiKey: true,
        baseUrl: 'https://ai.oneapi.center/v1',
      },
      'https://ai.oneapi.center'
    ),
    true
  )
})

test('isCliStatusReadyForWorkspace rejects historical Codex configs that still point to another endpoint', () => {
  assert.equal(
    isCliStatusReadyForWorkspace(
      {
        client: 'codex',
        installed: true,
        version: '1.2.3',
        executablePath: 'C:\\tools\\codex.cmd',
        configPath: 'C:\\Users\\demo\\.codex\\config.toml',
        dataPath: 'C:\\Users\\demo\\.codex',
        hasConfig: true,
        hasDataDirectory: true,
        hasApiKey: true,
        baseUrl: 'https://example.test/v1',
      },
      'https://ai.oneapi.center'
    ),
    false
  )
})
