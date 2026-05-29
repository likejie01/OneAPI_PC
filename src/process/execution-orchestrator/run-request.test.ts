import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExecutionCycleEvents } from './run-request.ts'

test('buildExecutionCycleEvents does not synthesize prompt echo logs', () => {
  assert.deepEqual(
    buildExecutionCycleEvents({
      sessionId: 'session-1',
      requestId: 'request-1',
      intent: '请检查项目结构',
      finalPrompt: '请检查项目结构',
      commandTitle: '扩展与上下文准备',
    }),
    []
  )
})
