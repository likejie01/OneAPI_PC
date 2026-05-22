import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCliExtensionInsertText,
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
