import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCliExtensionAugmentedPrompt,
  buildCliExtensionPromptBlock,
  buildCliExtensionInsertText,
  resolveCliSlashTriggerState,
  translateCliExtensionDescription,
  parseMarkdownFrontmatterMeta,
} from './cli-extensions.ts'

test('parseMarkdownFrontmatterMeta reads name and description from frontmatter', () => {
  const parsed = parseMarkdownFrontmatterMeta(`---
name: ContinueCoding
description: Use when resuming work on a project.
version: 1.0.0
---

# ContinueCoding
`)

  assert.deepEqual(parsed, {
    name: 'ContinueCoding',
    description: 'Use when resuming work on a project.',
  })
})

test('buildCliExtensionInsertText names codex skills so the cli can trigger them', () => {
  assert.equal(
    buildCliExtensionInsertText({
      client: 'codex',
      kind: 'skill',
      name: 'superpowers:brainstorming',
    }),
    '请在本次任务中使用技能 "superpowers:brainstorming"。'
  )
})

test('buildCliExtensionInsertText uses slash command form for claude commands', () => {
  assert.equal(
    buildCliExtensionInsertText({
      client: 'claude',
      kind: 'command',
      name: 'ContinueCoding',
    }),
    '/ContinueCoding '
  )
})

test('buildCliExtensionInsertText does not invent prompt syntax for plugins', () => {
  assert.equal(
    buildCliExtensionInsertText({
      client: 'codex',
      kind: 'plugin',
      name: 'superpowers',
    }),
    ''
  )
})

test('buildCliExtensionPromptBlock serializes selected extensions for runtime prompt', () => {
  assert.equal(
    buildCliExtensionPromptBlock([
      {
        id: 'codex:skill:frontend-design',
        client: 'codex',
        kind: 'skill',
        name: 'Frontend Design',
        description: '',
        path: 'C:\\skills\\frontend-design',
      },
      {
        id: 'claude:plugin:superpowers',
        client: 'claude',
        kind: 'plugin',
        name: 'superpowers',
        description: '',
        path: 'C:\\plugins\\superpowers',
      },
    ]),
    [
      '扩展调用要求：',
      '1. 本次任务请主动使用已安装技能 "Frontend Design"。',
      '2. 如任务需要，请调用已安装插件 "superpowers"。',
    ].join('\n')
  )
})

test('buildCliExtensionAugmentedPrompt prepends extension instructions before user prompt', () => {
  assert.equal(
    buildCliExtensionAugmentedPrompt(
      '修复当前项目中的构建报错',
      [
        {
          id: 'codex:skill:superpowers:systematic-debugging',
          client: 'codex',
          kind: 'skill',
          name: 'superpowers:systematic-debugging',
          description: '',
          path: 'C:\\skills\\systematic-debugging',
        },
      ]
    ),
    [
      '扩展调用要求：',
      '1. 本次任务请主动使用已安装技能 "superpowers:systematic-debugging"。',
      '',
      '修复当前项目中的构建报错',
    ].join('\n')
  )
})

test('resolveCliSlashTriggerState only triggers on blank current line slash', () => {
  assert.deepEqual(resolveCliSlashTriggerState('/', 1), {
    active: true,
    lineStart: 0,
    lineEnd: 1,
  })

  assert.deepEqual(resolveCliSlashTriggerState('hello /', 7), {
    active: false,
    lineStart: 0,
    lineEnd: 7,
  })

  assert.deepEqual(resolveCliSlashTriggerState('hello\n/', 7), {
    active: true,
    lineStart: 6,
    lineEnd: 7,
  })
})

test('translateCliExtensionDescription provides Chinese translation text for known descriptions', () => {
  const translated = translateCliExtensionDescription(
    'ContinueCoding',
    'Use when resuming work on a project. Reads PROJECT_CONTEXT.md to quickly understand the project state, then continues development.'
  )

  assert.match(translated, /适用于继续当前项目开发/)
})
