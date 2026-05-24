import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCliExecutionPrompt, CLI_EXECUTION_POLICY } from './cli-prompt.ts'

test('CLI execution policy defaults CLI replies to simplified Chinese', () => {
  assert.match(CLI_EXECUTION_POLICY, /默认使用简体中文回复/)
  assert.match(CLI_EXECUTION_POLICY, /不要请求提升权限/)
  assert.match(CLI_EXECUTION_POLICY, /OutputEncoding/)
  assert.match(CLI_EXECUTION_POLICY, /ENOTCACHED/)
})

test('buildCliExecutionPrompt trims user prompt and appends it after the policy', () => {
  const prompt = buildCliExecutionPrompt('  帮我修复这个 bug  \n')
  assert.match(prompt, /用户任务：\n帮我修复这个 bug$/)
})

test('buildCliExecutionPrompt describes restricted project permissions', () => {
  const prompt = buildCliExecutionPrompt('检查目录', {
    fullAccess: false,
    projectPath: 'D:\\WorkSpace\\Demo',
  })
  assert.match(prompt, /当前为受限模式/)
  assert.match(prompt, /当前项目目录：D:\\WorkSpace\\Demo/)
})
