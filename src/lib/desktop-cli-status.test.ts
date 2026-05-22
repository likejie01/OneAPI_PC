import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCliProbeResult } from './desktop-service.ts'

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
