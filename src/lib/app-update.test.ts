import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDesktopReleaseManifestUrlCandidates,
  compareDesktopVersions,
  shouldAutoCheckDesktopUpdate,
} from './app-update.ts'

test('compareDesktopVersions handles semantic and prefixed versions', () => {
  assert.equal(compareDesktopVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareDesktopVersions('0.1.0', '0.1.1'), -1)
  assert.equal(compareDesktopVersions('v1.2.0', '1.1.9'), 1)
  assert.equal(compareDesktopVersions('1.0', '1.0.0'), 0)
})

test('shouldAutoCheckDesktopUpdate only allows one auto check after noon per day', () => {
  const morning = new Date('2026-05-23T11:30:00+08:00')
  const noon = new Date('2026-05-23T12:00:00+08:00')
  const evening = new Date('2026-05-23T18:40:00+08:00')
  const nextDay = new Date('2026-05-24T12:30:00+08:00')

  assert.equal(shouldAutoCheckDesktopUpdate(morning, 12, null), false)
  assert.equal(shouldAutoCheckDesktopUpdate(noon, 12, null), true)
  assert.equal(shouldAutoCheckDesktopUpdate(evening, 12, '2026-05-23'), false)
  assert.equal(shouldAutoCheckDesktopUpdate(nextDay, 12, '2026-05-23'), true)
})

test('buildDesktopReleaseManifestUrlCandidates falls back to official server and dedupes', () => {
  assert.deepEqual(
    buildDesktopReleaseManifestUrlCandidates('https://custom.example.com/', 'https://ai.oneapi.center'),
    [
      'https://custom.example.com/api/download/desktop-release',
      'https://ai.oneapi.center/api/download/desktop-release',
    ]
  )
  assert.deepEqual(
    buildDesktopReleaseManifestUrlCandidates('https://ai.oneapi.center', 'https://ai.oneapi.center'),
    ['https://ai.oneapi.center/api/download/desktop-release']
  )
})

test('buildDesktopReleaseManifestUrlCandidates ignores invalid relative current base url', () => {
  assert.deepEqual(
    buildDesktopReleaseManifestUrlCandidates('/api', 'https://ai.oneapi.center'),
    ['https://ai.oneapi.center/api/download/desktop-release']
  )
})
