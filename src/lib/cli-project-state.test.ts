import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeCliProjectKey,
  resolveCliHistorySessionForProject,
  resolvePreferredCliSessionId,
} from './cli-project-state.ts'

test('normalizeCliProjectKey normalizes slash and case differences', () => {
  assert.equal(normalizeCliProjectKey('D:\\Workspace\\NewAPI\\'), 'd:/workspace/newapi')
})

test('resolveCliHistorySessionForProject prefers the last opened mapped session when it still exists', () => {
  const history = [
    { id: 'session-new', title: '', preview: '', updatedAt: 200, projectName: 'NewAPI', projectPath: 'D:/Workspace/NewAPI' },
    { id: 'session-old', title: '', preview: '', updatedAt: 100, projectName: 'NewAPI', projectPath: 'd:\\workspace\\newapi' },
  ]

  assert.equal(
    resolveCliHistorySessionForProject({
      history,
      projectPath: 'D:/Workspace/NewAPI',
      preferredSessionId: 'session-old',
    })?.id,
    'session-old'
  )
})

test('resolveCliHistorySessionForProject falls back to latest project session when preferred one is missing', () => {
  const history = [
    { id: 'session-a', title: '', preview: '', updatedAt: 100, projectName: 'NewAPI', projectPath: 'D:/Workspace/NewAPI' },
    { id: 'session-b', title: '', preview: '', updatedAt: 300, projectName: 'NewAPI', projectPath: 'D:/Workspace/NewAPI' },
  ]

  assert.equal(
    resolveCliHistorySessionForProject({
      history,
      projectPath: 'D:/Workspace/NewAPI',
      preferredSessionId: 'missing',
    })?.id,
    'session-b'
  )
})

test('resolvePreferredCliSessionId falls back to the last opened session when the project map is empty', () => {
  assert.equal(
    resolvePreferredCliSessionId({
      projectPath: 'D:/Workspace/NewAPI',
      projectSessionMap: {},
      lastOpenedSessionId: 'session-last',
      lastOpenedProjectPath: 'd:\\workspace\\newapi',
    }),
    'session-last'
  )
})

test('resolvePreferredCliSessionId ignores the last opened session when it belongs to another project', () => {
  assert.equal(
    resolvePreferredCliSessionId({
      projectPath: 'D:/Workspace/NewAPI',
      projectSessionMap: {},
      lastOpenedSessionId: 'session-other',
      lastOpenedProjectPath: 'D:/Workspace/Another',
    }),
    ''
  )
})
