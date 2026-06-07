import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const appSource = readFileSync(resolve(projectRoot, 'src', 'App.tsx'), 'utf8')
const mainSource = readFileSync(resolve(projectRoot, 'electron', 'main.ts'), 'utf8')

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

test('restricted cli runs receive user-authorized directories without bypassing sandbox', () => {
  assert.match(mainSource, /const cliUserAuthorizedDirectories = new Set<string>\(\)/)
  assert.match(mainSource, /function rememberCliAuthorizedDirectory\(targetPath: string\)/)
  assert.match(mainSource, /async function rememberCliAuthorizedOpenTarget\(targetPath: string\)/)
  assert.match(mainSource, /rememberCliAuthorizedDirectory\(stat\?\.isFile\(\) \? path\.dirname\(normalized\) : normalized\)/)
  assert.match(mainSource, /await rememberCliAuthorizedOpenTarget\(resolved\)/)
  assert.match(mainSource, /resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(mainSource, /buildCodexSandboxArgs\([\s\S]*?resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
  assert.match(mainSource, /buildClaudePermissionArgs\([\s\S]*?resolveCliAdditionalAccessDirectories\(input\.projectPath\)/)
})

test('inactive windows pause aurora and hidden cli panes poll less often', () => {
  assert.match(appSource, /document\.documentElement\.dataset\.windowActive = active \? 'active' : 'inactive'/)
  assert.match(appSource, /const shouldPollActively = active \|\| running/)
  assert.match(appSource, /const intervalMs = shouldPollActively \? 30000 : 180000/)
})
