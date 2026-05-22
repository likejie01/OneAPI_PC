import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuiltinAssistants, decorateAssistants, mergeAssistantsWithBuiltins } from './assistants.ts'

test('createBuiltinAssistants exposes only the requested Cherry-based assistant set', () => {
  const assistants = createBuiltinAssistants(100)

  assert.equal(assistants.length, 18)
  assert.ok(assistants.some((item) => item.name === '律师'))
  assert.ok(assistants.some((item) => item.name === '推文快写'))
  assert.ok(assistants.some((item) => item.name === '心理模型专家'))
  assert.equal(assistants.some((item) => item.name === '通用助手'), false)
  assert.equal(assistants.some((item) => item.name === '开发助手'), false)
})

test('mergeAssistantsWithBuiltins keeps builtin overrides and custom assistants', () => {
  const merged = mergeAssistantsWithBuiltins(
    [
      {
        id: 'assistant-cherry-marketing',
        name: '市场营销-已修改',
        description: 'keep managed override',
        prompt: 'override prompt',
        model: 'gpt-5.5',
        temperature: 0.4,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'custom-1',
        name: '我的助手',
        description: 'keep',
        prompt: 'keep',
        model: '',
        temperature: 0.5,
        createdAt: 3,
        updatedAt: 3,
      },
    ],
    200
  )

  assert.equal(merged.some((item) => item.id === 'assistant-general'), false)
  assert.equal(
    merged.find((item) => item.id === 'assistant-cherry-marketing')?.name,
    '市场营销-已修改'
  )
  assert.ok(merged.some((item) => item.id === 'custom-1'))
  assert.ok(merged.some((item) => item.name === '网页生成'))
})

test('decorateAssistants prioritizes favorites in stored order and searches prompt text', () => {
  const builtins = createBuiltinAssistants(300)
  const resolved = decorateAssistants(
    builtins,
    ['assistant-cherry-marketing', 'assistant-cherry-web-generator'],
    'tailwindcss'
  )

  assert.deepEqual(
    resolved.map((item) => ({
      id: item.id,
      favorite: item.favorite,
      name: item.name,
    })),
    [
      {
        id: 'assistant-cherry-web-generator',
        favorite: true,
        name: '网页生成',
      },
    ]
  )
})
