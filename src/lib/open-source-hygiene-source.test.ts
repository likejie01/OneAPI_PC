import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const gitignoreSource = readFileSync(resolve(projectRoot, '.gitignore'), 'utf8')
const officialServiceSource = readFileSync(resolve(projectRoot, 'src', 'shared', 'official-service.ts'), 'utf8')
const officialServiceNodeSource = readFileSync(resolve(projectRoot, 'src', 'shared', 'official-service-node.ts'), 'utf8')
const mainSource = readFileSync(resolve(projectRoot, 'electron', 'main.ts'), 'utf8')
const assistantSupportSource = readFileSync(
  resolve(projectRoot, 'src', 'features', 'assistants', 'AssistantWorkspaceSupport.tsx'),
  'utf8',
)
const loginSource = readFileSync(resolve(projectRoot, 'src', 'features', 'auth', 'LoginScreen.tsx'), 'utf8')
const settingsSource = readFileSync(resolve(projectRoot, 'src', 'features', 'settings', 'SettingsWorkspaces.tsx'), 'utf8')
const desktopServiceSource = readFileSync(resolve(projectRoot, 'src', 'lib', 'desktop-service.ts'), 'utf8')
const checklistSource = readFileSync(resolve(projectRoot, 'docs', 'open-source-security-checklist.md'), 'utf8')

test('official service defaults are centralized and overridable for open source builds', () => {
  assert.match(officialServiceSource, /OFFICIAL_SERVER_BASE_URL = 'https:\/\/ai\.oneapi\.center'/)
  assert.match(officialServiceSource, /readViteEnv\('VITE_ONEAPI_SERVER_BASE_URL'\)/)
  assert.match(officialServiceSource, /readViteEnv\('VITE_ONEAPI_CODEX_BASE_URL'\)/)
  assert.match(officialServiceSource, /readViteEnv\('VITE_ONEAPI_CLAUDE_BASE_URL'\)/)
  assert.match(officialServiceNodeSource, /process\.env\.ONEAPI_SERVER_BASE_URL/)
  assert.match(officialServiceNodeSource, /process\.env\.ONEAPI_CODEX_BASE_URL/)
  assert.match(officialServiceNodeSource, /process\.env\.ONEAPI_CLAUDE_BASE_URL/)
})

test('runtime code imports official service constants instead of scattering service literals', () => {
  assert.match(mainSource, /from '\.\.\/src\/shared\/official-service-node\.ts'/)
  assert.match(assistantSupportSource, /from '\.\.\/\.\.\/shared\/official-service\.ts'/)
  assert.match(loginSource, /from '\.\.\/\.\.\/shared\/official-service\.ts'/)
  assert.match(settingsSource, /from '\.\.\/\.\.\/shared\/official-service\.ts'/)
  assert.match(desktopServiceSource, /from '\.\.\/shared\/official-service\.ts'/)
  assert.doesNotMatch(mainSource, /const DEFAULT_SERVER_BASE_URL = 'https:\/\/ai\.oneapi\.center'/)
  assert.doesNotMatch(assistantSupportSource, /export const DEFAULT_SERVER_BASE_URL = 'https:\/\/ai\.oneapi\.center'/)
  assert.doesNotMatch(loginSource, /const DEFAULT_SERVER_BASE_URL = 'https:\/\/ai\.oneapi\.center'/)
  assert.doesNotMatch(settingsSource, /const DEFAULT_SERVER_BASE_URL = 'https:\/\/ai\.oneapi\.center'/)
  assert.doesNotMatch(desktopServiceSource, /return normalized \|\| 'https:\/\/ai\.oneapi\.center'/)
})

test('gitignore excludes local secrets, screenshots, release outputs, and AI state', () => {
  for (const pattern of [
    'server.env',
    '.env.*',
    'release/',
    'dist/',
    'dist-electron/',
    'alipay/',
    'images/Snipaste_*.png',
    '.claude/',
    '.codex/',
    '.cache/',
  ]) {
    assert.match(gitignoreSource, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('open source checklist documents accepted local credential storage and required cleanup', () => {
  assert.match(checklistSource, /Accepted client-local storage/)
  assert.match(checklistSource, /server.env/)
  assert.match(checklistSource, /alipay\//)
  assert.match(checklistSource, /images\/Snipaste_\*\.png/)
  assert.match(checklistSource, /VITE_ONEAPI_SERVER_BASE_URL/)
  assert.match(checklistSource, /ONEAPI_SERVER_BASE_URL/)
})
