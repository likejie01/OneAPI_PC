import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildClaudePlanStateFromRecords,
  buildCodexPlanStateFromRecords,
  parseClaudePlanMutationFromRecord,
  parseCodexPlanStateFromRecord,
} from './cli-plan.ts'

test('parseCodexPlanStateFromRecord reads update_plan payloads', () => {
  const parsed = parseCodexPlanStateFromRecord({
    timestamp: '2026-05-22T07:00:55.916Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'update_plan',
      arguments: JSON.stringify({
        explanation: '正在整理实现步骤。',
        plan: [
          { step: '读取代码', status: 'completed' },
          { step: '实现改动', status: 'in_progress' },
          { step: '回归测试', status: 'pending' },
        ],
      }),
    },
  })

  assert.deepEqual(parsed, {
    explanation: '正在整理实现步骤。',
    items: [
      { id: '读取代码', step: '读取代码', status: 'completed' },
      { id: '实现改动', step: '实现改动', status: 'in_progress' },
      { id: '回归测试', step: '回归测试', status: 'pending' },
    ],
    updatedAt: Date.parse('2026-05-22T07:00:55.916Z'),
  })
})

test('buildCodexPlanStateFromRecords keeps the latest update_plan state', () => {
  const plan = buildCodexPlanStateFromRecords([
    {
      timestamp: '2026-05-22T07:00:55.916Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'update_plan',
        arguments: JSON.stringify({
          plan: [
            { step: '任务 A', status: 'in_progress' },
            { step: '任务 B', status: 'pending' },
          ],
        }),
      },
    },
    {
      timestamp: '2026-05-22T07:01:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'update_plan',
        arguments: JSON.stringify({
          explanation: '最后一次更新',
          plan: [
            { step: '任务 A', status: 'completed' },
            { step: '任务 B', status: 'in_progress' },
          ],
        }),
      },
    },
  ])

  assert.deepEqual(plan, {
    explanation: '最后一次更新',
    items: [
      { id: '任务 A', step: '任务 A', status: 'completed' },
      { id: '任务 B', step: '任务 B', status: 'in_progress' },
    ],
    updatedAt: Date.parse('2026-05-22T07:01:02.000Z'),
  })
})

test('parseClaudePlanMutationFromRecord reads task creation and status updates', () => {
  const created = parseClaudePlanMutationFromRecord({
    timestamp: '2026-05-17T18:58:22.345Z',
    type: 'user',
    toolUseResult: {
      task: {
        id: '1',
        subject: 'Offer visual companion',
      },
    },
  })
  const updated = parseClaudePlanMutationFromRecord({
    timestamp: '2026-05-17T18:58:51.225Z',
    type: 'user',
    toolUseResult: {
      taskId: '1',
      statusChange: {
        from: 'pending',
        to: 'in_progress',
      },
    },
  })

  assert.deepEqual(created, {
    kind: 'create',
    taskId: '1',
    subject: 'Offer visual companion',
    status: 'pending',
    updatedAt: Date.parse('2026-05-17T18:58:22.345Z'),
  })
  assert.deepEqual(updated, {
    kind: 'status',
    taskId: '1',
    status: 'in_progress',
    updatedAt: Date.parse('2026-05-17T18:58:51.225Z'),
  })
})

test('buildClaudePlanStateFromRecords reconstructs ordered todo state', () => {
  const plan = buildClaudePlanStateFromRecords([
    {
      timestamp: '2026-05-17T18:58:22.345Z',
      type: 'user',
      toolUseResult: {
        task: { id: '1', subject: 'Offer visual companion' },
      },
    },
    {
      timestamp: '2026-05-17T18:58:22.354Z',
      type: 'user',
      toolUseResult: {
        task: { id: '2', subject: 'Ask clarifying question' },
      },
    },
    {
      timestamp: '2026-05-17T18:58:51.225Z',
      type: 'user',
      toolUseResult: {
        taskId: '1',
        statusChange: { from: 'pending', to: 'in_progress' },
      },
    },
    {
      timestamp: '2026-05-17T19:00:26.892Z',
      type: 'user',
      toolUseResult: {
        taskId: '1',
        statusChange: { from: 'in_progress', to: 'completed' },
      },
    },
    {
      timestamp: '2026-05-17T19:00:36.820Z',
      type: 'user',
      toolUseResult: {
        taskId: '2',
        statusChange: { from: 'pending', to: 'in_progress' },
      },
    },
  ])

  assert.deepEqual(plan, {
    explanation: '',
    items: [
      { id: '1', step: 'Offer visual companion', status: 'completed' },
      { id: '2', step: 'Ask clarifying question', status: 'in_progress' },
    ],
    updatedAt: Date.parse('2026-05-17T19:00:36.820Z'),
  })
})
