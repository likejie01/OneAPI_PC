import test from 'node:test'
import assert from 'node:assert/strict'
import { groupDrawSessionsByAssistant, resolveDrawSessionAssistantGroup } from './draw-history.ts'

test('resolveDrawSessionAssistantGroup uses the most recent styled user message', () => {
  assert.equal(
    resolveDrawSessionAssistantGroup({
      id: 'session-1',
      title: 'session',
      updatedAt: 1,
      messages: [
        { id: '1', role: 'user', content: 'a', createdAt: 1, imageStylePresetTitle: '电影与动画' },
        { id: '2', role: 'assistant', content: 'b', createdAt: 2 },
        { id: '3', role: 'user', content: 'c', createdAt: 3, imageStylePresetTitle: '摄影' },
      ],
    }),
    '摄影'
  )
})

test('groupDrawSessionsByAssistant groups sessions by selected preset title', () => {
  const groups = groupDrawSessionsByAssistant([
    {
      id: 'session-a',
      title: 'a',
      updatedAt: 1,
      messages: [{ id: '1', role: 'user', content: 'a', createdAt: 1, imageStylePresetTitle: '摄影' }],
    },
    {
      id: 'session-b',
      title: 'b',
      updatedAt: 2,
      messages: [{ id: '2', role: 'user', content: 'b', createdAt: 2 }],
    },
  ])

  assert.deepEqual(
    groups.map(([key, value]) => [key, value.map((item) => item.id)]),
    [
      ['摄影', ['session-a']],
      ['未使用提示词助手', ['session-b']],
    ]
  )
})

test('resolveDrawSessionAssistantGroup falls back to the preset id when historical sessions do not persist the title', () => {
  assert.equal(
    resolveDrawSessionAssistantGroup(
      {
        id: 'session-legacy',
        title: 'legacy',
        updatedAt: 1,
        messages: [{ id: '1', role: 'user', content: 'a', createdAt: 1, imageStylePresetId: 'preset-photo' }],
      },
      {
        'preset-photo': '摄影',
      }
    ),
    '摄影'
  )
})
