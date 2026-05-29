import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFinalPrompt, extractUserTaskFromFinalPrompt } from './build-final-prompt.ts'

test('buildFinalPrompt keeps real demand before execution policy', () => {
  const result = buildFinalPrompt({
    prompt: '请修复登录问题',
    client: 'codex',
    fullAccess: true,
    projectPath: 'D:\\WorkSpace\\NewAPI',
    extensions: [{ client: 'codex', kind: 'skill', name: 'systematic-debugging' }],
  })
  assert.equal(result.finalPrompt.startsWith('请修复登录问题'), true)
  assert.equal(result.finalPrompt.includes('执行策略：'), true)
})

test('extractUserTaskFromFinalPrompt preserves multiline original demand', () => {
  const result = buildFinalPrompt({
    prompt: '请处理这个问题：\n1. 修复登录\n2. 增加日志',
    client: 'claude',
    extensions: [{ client: 'claude', kind: 'plugin', name: 'Browser' }],
  })
  assert.equal(
    extractUserTaskFromFinalPrompt(result.finalPrompt),
    '请处理这个问题：\n1. 修复登录\n2. 增加日志',
  )
})

test('direct command stays as one prompt without execution policy', () => {
  const result = buildFinalPrompt({
    prompt: '/resume',
    client: 'codex',
    directCommand: true,
  })
  assert.equal(result.finalPrompt, '/resume')
})

test('buildFinalPrompt clarifies Claude identity and workspace write scope', () => {
  const result = buildFinalPrompt({
    prompt: '修复日志问题',
    client: 'claude',
    projectPath: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC_Rebuild',
    fullAccess: false,
  })

  assert.match(result.finalPrompt, /Claude 编码助手/)
  assert.match(result.finalPrompt, /不要自称 Kiro、Codex、ChatGPT/)
  assert.match(result.permissionBlock, /允许读取、创建、修改、删除文件与目录/)
})
