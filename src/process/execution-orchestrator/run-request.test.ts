import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExecutionCycleEvents } from './run-request.ts'

test('buildExecutionCycleEvents keeps runtime-only status logs without echoing the user prompt', () => {
  const events = buildExecutionCycleEvents({
    sessionId: 'session-1',
    requestId: 'request-1',
    intent: '请检查项目结构',
    finalPrompt: '请检查项目结构',
    commandTitle: '扩展与上下文准备',
    extensions: [{ kind: 'skill', name: 'systematic-debugging' }],
  })

  assert.equal(events.length, 3)
  assert.equal(events[0]?.title, '分析需求')
  assert.equal(events[1]?.detail?.includes('systematic-debugging'), true)
  assert.equal(events.some((item) => item.detail?.includes('请检查项目结构')), false)
})
