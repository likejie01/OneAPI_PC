import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCliExecutionPrompt, CLI_EXECUTION_POLICY } from './cli-prompt.ts'

test('CLI execution policy defaults CLI replies to simplified Chinese', () => {
  assert.match(CLI_EXECUTION_POLICY, /默认使用简体中文回复/)
})

test('buildCliExecutionPrompt trims user prompt and appends it after the policy', () => {
  const prompt = buildCliExecutionPrompt('  帮我修复这个 bug  \n')
  assert.match(prompt, /用户任务：\n帮我修复这个 bug$/)
})
