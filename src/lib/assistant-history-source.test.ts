import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainSource = readFileSync(resolve(projectRoot, 'electron', 'main.ts'), 'utf8')
const cliHistorySource = readFileSync(resolve(projectRoot, 'electron', 'main-cli-history.ts'), 'utf8')

test('assistant history sync skips unchanged session writes', () => {
  assert.match(mainSource, /const assistantHistoryWriteSignatures = new Map<string, string>\(\)/)
  assert.match(mainSource, /const signatureKey = `\$\{scope\}:\$\{item\.id\}`/)
  assert.match(mainSource, /const signature = `\$\{item\.title\}\\n\$\{item\.updatedAt\}\\n\$\{item\.data\.length\}`/)
  assert.match(mainSource, /assistantHistoryWriteSignatures\.get\(signatureKey\) === signature/)
  assert.match(mainSource, /assistantHistoryWriteSignatures\.set\(signatureKey, signature\)/)
  assert.match(mainSource, /assistantHistoryWriteSignatures\.delete\(`\$\{scope\}:\$\{item\.name\}`\)/)
})

test('codex session hydration keeps assistant messages without a final_answer phase', () => {
  assert.match(
    cliHistorySource,
    /role === 'assistant' && typeof parsed\.payload\.phase === 'string' && parsed\.payload\.phase !== 'final_answer'/
  )
})

test('cli history lists stay lightweight and do not hydrate full sessions', () => {
  const codexListBody = cliHistorySource.match(/async function listCodexHistory[\s\S]*?async function getCodexSession/)?.[0] ?? ''
  const claudeListBody = cliHistorySource.match(/async function listClaudeHistory[\s\S]*?async function getClaudeSessionFile/)?.[0] ?? ''

  assert.ok(codexListBody, 'listCodexHistory source should be found')
  assert.ok(claudeListBody, 'listClaudeHistory source should be found')
  assert.match(cliHistorySource, /const previous = grouped\.get\(sessionId\)/)
  assert.match(cliHistorySource, /Math\.floor\(metadata\.mtimeMs \/ 1000\) \|\| previous\?\.updatedAt/)
  assert.match(cliHistorySource, /readCodexSessionMetaLine\(file\.filePath\)/)
  assert.match(cliHistorySource, /createReadStream\(filePath, \{ encoding: 'utf8', end: CODEX_SESSION_META_SCAN_BYTES - 1 \}\)/)
  assert.doesNotMatch(codexListBody, /getCodexSession\(/)
  assert.doesNotMatch(codexListBody, /readJsonLines\(file\.filePath\)/)
  assert.doesNotMatch(claudeListBody, /getClaudeSession\(/)
  assert.match(claudeListBody, /decodeClaudeProjectPathFromFilePath\(file\.filePath\)/)
})
