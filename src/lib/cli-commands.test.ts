import test from 'node:test'
import assert from 'node:assert/strict'
import { listCliBuiltinCommands, matchCliBuiltinCommand } from './cli-commands.ts'

test('listCliBuiltinCommands exposes resume compact and plan', () => {
  assert.deepEqual(
    listCliBuiltinCommands('codex').map((item) => item.command),
    ['/resume', '/compact', '/plan']
  )
})

test('matchCliBuiltinCommand detects known commands with optional arguments', () => {
  assert.equal(matchCliBuiltinCommand('claude', '/compact')?.id, 'compact')
  assert.equal(matchCliBuiltinCommand('claude', '/resume latest')?.id, 'resume')
  assert.equal(matchCliBuiltinCommand('claude', 'hello')?.id, undefined)
})
