import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExecutionCycleEvents } from './run-request.ts'

test('execution cycle keeps fixed phase order', () => {
  const phases = buildExecutionCycleEvents({
    sessionId: 'session-1',
    requestId: 'req-1',
    intent: '修复登录问题',
    finalPrompt: '修复登录问题\n\n执行策略：...',
    commandTitle: '创建修复脚本',
    command: 'npm test',
    resultDetail: '测试已通过',
  }).map((item) => item.phase)

  assert.deepEqual(phases, ['intent'])
})

test('execution cycle does not emit invoke without a prepared command', () => {
  const events = buildExecutionCycleEvents({
    sessionId: 'session-1',
    requestId: 'req-2',
    intent: '仅分析问题',
    finalPrompt: '仅分析问题',
  })

  assert.equal(events.some((item) => item.phase === 'invoke'), false)
  assert.equal(events.some((item) => item.phase === 'assembly'), false)
  assert.equal(events.some((item) => item.phase === 'result'), false)
})
