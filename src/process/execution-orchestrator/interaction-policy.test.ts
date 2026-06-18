import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveInteractionDecision } from './interaction-policy.ts'

test('safe command auto approves in full access mode', () => {
  assert.equal(
    resolveInteractionDecision({
      fullAccess: true,
      autoApproveEligible: true,
      command: 'rg "TODO" src',
    }),
    'auto_approve',
  )
})

test('dangerous command stays manual', () => {
  assert.equal(
    resolveInteractionDecision({
      fullAccess: true,
      autoApproveEligible: true,
      command: 'Remove-Item -Recurse D:\\',
    }),
    'manual',
  )
})
