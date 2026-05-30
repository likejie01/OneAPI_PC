import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCliExecutionPrompt, CLI_EXECUTION_POLICY, extractCliUserTask } from './cli-prompt.ts'

test('CLI execution policy defaults CLI replies to simplified Chinese', () => {
  assert.match(CLI_EXECUTION_POLICY, /默认使用简体中文回复/)
  assert.doesNotMatch(CLI_EXECUTION_POLICY, /不要请求提升权限/)
  assert.match(CLI_EXECUTION_POLICY, /OutputEncoding/)
  assert.match(CLI_EXECUTION_POLICY, /ENOTCACHED/)
})

test('buildCliExecutionPrompt puts the user task before execution policy', () => {
  const prompt = buildCliExecutionPrompt('  帮我修复这个 bug  \n')
  assert.match(prompt, /^帮我修复这个 bug\n\n以下内容是 OneAPI 客户端附加的执行约束/)
  assert.equal(prompt.includes('用户任务：'), false)
  assert.ok(prompt.indexOf('帮我修复这个 bug') < prompt.indexOf('执行策略：'))
})

test('buildCliExecutionPrompt describes restricted project permissions', () => {
  const prompt = buildCliExecutionPrompt('检查目录', {
    fullAccess: false,
    projectPath: 'D:\\WorkSpace\\Demo',
  })
  assert.match(prompt, /当前为受限模式/)
  assert.match(prompt, /当前项目目录：D:\\WorkSpace\\Demo/)
})

test('extractCliUserTask supports the new task-first wrapper', () => {
  const prompt = buildCliExecutionPrompt('请修复登录问题', {
    fullAccess: true,
    projectPath: 'D:\\WorkSpace\\NewAPI',
  })
  assert.equal(extractCliUserTask(prompt), '请修复登录问题')
})

test('buildCliExecutionPrompt keeps long real user demand at the very beginning', () => {
  const realDemand = '我准备基于当前客户端功能，做一个安卓和 iOS 版本，请评估可行性。'
  const prompt = buildCliExecutionPrompt(realDemand)
  assert.equal(prompt.startsWith(realDemand), true)
  assert.equal(extractCliUserTask(prompt), realDemand)
})

test('extractCliUserTask strips appended extension constraints from task-first prompt', () => {
  const realDemand = '移动端需要支持调用 PC 端已安装的 skill/plugin，并按三期规划执行'
  const prompt = buildCliExecutionPrompt([
    realDemand,
    '',
    '以下内容是 OneAPI 客户端附加的扩展调用要求',
    '1. 本次任务请主动使用已安装技能 "superpowers:brainstorming"。',
  ].join('\n'))

  assert.equal(extractCliUserTask(prompt), realDemand)
})

test('extractCliUserTask keeps user demand that starts with extension wording', () => {
  const realDemand = '扩展调用要求：移动端需要支持调用 PC 端已安装的 skill/plugin，其他按照三期功能规划执行'
  const prompt = buildCliExecutionPrompt([
    realDemand,
    '',
    '以下内容是 OneAPI 客户端附加的扩展调用要求',
    '1. 本次任务请主动使用已安装技能 "superpowers:brainstorming"。',
  ].join('\n'))

  assert.equal(extractCliUserTask(prompt), realDemand)
})

test('extractCliUserTask returns preserved original demand from visible summary package', () => {
  const realDemand = [
    '那接下来直接做手机端的内容：',
    '1、手机端直接做完整功能',
    '2、手机端需要支持调用 PC 端已安装的 skill/plugin',
  ].join('\n')
  const prompt = buildCliExecutionPrompt([
    '那接下来直接做手机端的内容： 1、手机端直接做完整功能 2、手机端需要支持调用 PC 端已安装的 skill/plugin',
    '',
    '以下内容是用户真实需求原文（保留格式）',
    realDemand,
    '',
    '以下内容是 OneAPI 客户端附加的扩展调用要求',
    '1. 本次任务请主动使用已安装技能 "appkit-interop"。',
  ].join('\n'))

  assert.equal(extractCliUserTask(prompt), realDemand)
})

test('extractCliUserTask recovers user demand from legacy extension-first prompt', () => {
  const realDemand = '检查提示词拼装，确保真实需求发送给 Codex 和 Claude'
  const legacy = buildCliExecutionPrompt([
    '扩展调用要求：',
    '1. 本次任务请主动使用已安装技能 "superpowers:systematic-debugging"。',
    '',
    realDemand,
  ].join('\n'))

  assert.equal(extractCliUserTask(legacy), realDemand)
})

test('extractCliUserTask supports the legacy policy-first wrapper', () => {
  const legacy = `${CLI_EXECUTION_POLICY}\n\n权限上下文：\n当前为全权限模式，可在用户任务需要时执行项目外读写。\n\n用户任务：\n继续处理这个问题\n\n附件引用：\n1. a -> D:\\a.txt`
  assert.equal(extractCliUserTask(legacy), '继续处理这个问题')
})
