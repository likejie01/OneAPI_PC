import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainSource = readFileSync(resolve(projectRoot, 'electron', 'main.ts'), 'utf8')

test('assistant history sync skips unchanged session writes', () => {
  assert.match(mainSource, /const assistantHistoryWriteSignatures = new Map<string, string>\(\)/)
  assert.match(mainSource, /const signatureKey = `\$\{scope\}:\$\{item\.id\}`/)
  assert.match(mainSource, /const signature = `\$\{item\.title\}\\n\$\{item\.updatedAt\}\\n\$\{item\.data\.length\}`/)
  assert.match(mainSource, /assistantHistoryWriteSignatures\.get\(signatureKey\) === signature/)
  assert.match(mainSource, /assistantHistoryWriteSignatures\.set\(signatureKey, signature\)/)
  assert.match(mainSource, /assistantHistoryWriteSignatures\.delete\(`\$\{scope\}:\$\{item\.name\}`\)/)
})
