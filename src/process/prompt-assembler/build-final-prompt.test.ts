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

test('buildFinalPrompt describes restricted project-folder permissions explicitly', () => {
  const result = buildFinalPrompt({
    prompt: '修改项目内文件',
    client: 'claude',
    fullAccess: false,
    projectPath: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC_Rebuild',
  })
  assert.match(result.permissionBlock, /当前为受限模式/)
  assert.match(result.permissionBlock, /客户端不再附加读写限制/)
})

test('buildFinalPrompt describes full-access user-requested path permissions', () => {
  const result = buildFinalPrompt({
    prompt: '修改 D:\\Temp\\x.txt',
    client: 'codex',
    fullAccess: true,
    projectPath: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC_Rebuild',
  })
  assert.match(result.permissionBlock, /当前为全权限模式/)
  assert.match(result.permissionBlock, /客户端不再附加读写限制/)
})

test('buildFinalPrompt tells CLI agents to quote PowerShell paths with special characters', () => {
  const result = buildFinalPrompt({
    prompt: '读取 D:\\WorkSpace\\Demo\\src\\app\\(main)\\page.tsx',
    client: 'codex',
    fullAccess: true,
    projectPath: 'D:\\WorkSpace\\Demo',
  })
  assert.match(result.finalPrompt, /-LiteralPath/)
  assert.match(result.finalPrompt, /路径包含空格、括号/)
  assert.match(result.finalPrompt, /不要把 \$null 作为参数传给 PowerShell 命令/)
})
