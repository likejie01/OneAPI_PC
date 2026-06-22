import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCliMessageOverlays,
  buildCliExtensionAugmentedPrompt,
  buildCliExtensionDedupeKey,
  buildCliExtensionDisplayName,
  buildCliExtensionPromptBlock,
  canUseCliExtension,
  collectCliToolNames,
  decorateCliExtensions,
  buildCliExtensionInsertText,
  resolveCliSlashTriggerState,
  translateCliExtensionDescription,
  parseMarkdownFrontmatterMeta,
  recommendCliExtensionsForPrompt,
} from './cli-extensions.ts'
import { buildCliExecutionPrompt } from './cli-prompt.ts'

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
      '以下内容是 OneAPI 客户端附加的扩展调用要求',
      '1. 本次任务请主动使用已安装技能 "Frontend Design"。',
      '2. 如任务需要，请调用已安装插件 "superpowers"。',
    ].join('\n')
  )
})

test('buildCliExtensionAugmentedPrompt appends extension instructions after user prompt', () => {
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
      '修复当前项目中的构建报错',
      '',
      '以下内容是 OneAPI 客户端附加的扩展调用要求',
      '1. 本次任务请主动使用已安装技能 "superpowers:systematic-debugging"。',
    ].join('\n')
  )
})

test('full cli prompt chain starts with real user demand when extensions are selected', () => {
  const realDemand = '移动端需要支持调用 PC 端已安装的 skill/plugin，并按三期功能规划执行'
  const prompt = buildCliExecutionPrompt(
    buildCliExtensionAugmentedPrompt(realDemand, [
      {
        id: 'codex:skill:superpowers:brainstorming',
        client: 'codex',
        kind: 'skill',
        name: 'superpowers:brainstorming',
        description: '',
        path: 'C:\\skills\\brainstorming',
      },
    ])
  )

  assert.equal(prompt.startsWith(realDemand), true)
  assert.equal(prompt.startsWith('扩展调用要求：'), false)
  assert.equal(prompt.startsWith('用户任务：'), false)
  assert.equal(prompt.startsWith('执行策略：'), false)
  assert.match(prompt, /以下内容是 OneAPI 客户端附加的扩展调用要求/)
})

test('full cli prompt chain makes multiline demand visible before extension references', () => {
  const realDemand = [
    '那接下来直接做手机端的内容：',
    '1、手机端直接做完整功能',
    '2、手机端需要支持调用 PC 端已安装的 skill/plugin',
  ].join('\n')
  const visibleDemand = '那接下来直接做手机端的内容： 1、手机端直接做完整功能 2、手机端需要支持调用 PC 端已安装的 skill/plugin'
  const prompt = buildCliExecutionPrompt(
    buildCliExtensionAugmentedPrompt(realDemand, [
      {
        id: 'codex:plugin:build-macos-apps',
        client: 'codex',
        kind: 'plugin',
        name: 'Build macOS Apps',
        description: '',
        path: 'C:\\plugins\\build-macos-apps',
      },
      {
        id: 'codex:skill:appkit-interop',
        client: 'codex',
        kind: 'skill',
        name: 'appkit-interop',
        description: '',
        path: 'C:\\skills\\appkit-interop',
      },
    ])
  )

  assert.equal(prompt.startsWith(visibleDemand), true)
  assert.match(prompt, /以下内容是用户真实需求原文（保留格式）\n那接下来直接做手机端的内容：\n1、手机端直接做完整功能/)
  assert.match(prompt, /插件 "Build macOS Apps"/)
  assert.match(prompt, /技能 "appkit-interop"/)
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

test('buildCliExtensionDisplayName appends note after extension name', () => {
  assert.equal(buildCliExtensionDisplayName('algorithmic-art', '绘制算法海报'), 'algorithmic-art · 绘制算法海报')
  assert.equal(buildCliExtensionDisplayName('algorithmic-art', ''), 'algorithmic-art')
})

test('canUseCliExtension treats explicit uninstalled entries as unavailable', () => {
  assert.equal(canUseCliExtension({ installed: false }), false)
  assert.equal(canUseCliExtension({ installed: true }), true)
  assert.equal(canUseCliExtension({}), true)
})

test('buildCliExtensionDedupeKey collapses installed and uninstalled variants for the same install target', () => {
  assert.equal(
    buildCliExtensionDedupeKey({
      id: 'skill-installed',
      kind: 'skill',
      name: 'playwright',
      installKey: 'codex-curated-skill:playwright',
    }),
    buildCliExtensionDedupeKey({
      id: 'skill-marketplace',
      kind: 'skill',
      name: 'playwright',
      installKey: 'codex-curated-skill:playwright',
    })
  )

  assert.equal(
    buildCliExtensionDedupeKey({
      id: 'plugin-installed',
      kind: 'plugin',
      name: 'browser',
      installKey: 'browser@openai-bundled',
    }),
    'plugin:browser@openai-bundled'
  )
})

test('buildCliExtensionDedupeKey collapses plugin aliases with the same catalog source', () => {
  assert.equal(
    buildCliExtensionDedupeKey({
      id: 'plugin-rc',
      kind: 'plugin',
      name: 'rc',
      installKey: 'rc@claude-plugins-official',
      catalogSource: {
        repoUrl: 'https://github.com/RevenueCat/rc-claude-code-plugin.git',
        subdir: 'revenuecat',
      },
    }),
    buildCliExtensionDedupeKey({
      id: 'plugin-revenuecat',
      kind: 'plugin',
      name: 'revenuecat',
      installKey: 'revenuecat@claude-plugins-official',
      catalogSource: {
        repoUrl: 'https://github.com/RevenueCat/rc-claude-code-plugin.git',
        rawSource: {
          path: 'revenuecat',
        },
      },
    })
  )
})

test('decorateCliExtensions keeps installed entries ahead of uninstalled entries and applies notes', () => {
  const resolved = decorateCliExtensions(
    [
      {
        id: 'a',
        client: 'codex',
        kind: 'skill',
        name: 'alpha',
        description: '',
        path: 'C:\\alpha',
      },
      {
        id: 'b',
        client: 'codex',
        kind: 'skill',
        name: 'beta',
        description: '',
        path: 'C:\\beta',
        installed: false,
      },
      {
        id: 'c',
        client: 'codex',
        kind: 'plugin',
        name: 'charlie',
        description: '',
        path: 'C:\\charlie',
      },
    ],
    ['c', 'a'],
    {
      a: '项目默认调试流',
    }
  )

  assert.deepEqual(
    resolved.map((item) => ({
      id: item.id,
      favorite: item.favorite,
      note: item.note,
      displayName: item.displayName,
      installed: item.installed,
    })),
    [
      { id: 'c', favorite: true, note: '', displayName: 'charlie', installed: undefined },
      { id: 'a', favorite: true, note: '项目默认调试流', displayName: 'alpha · 项目默认调试流', installed: undefined },
      { id: 'b', favorite: false, note: '', displayName: 'beta', installed: false },
    ]
  )
})

test('applyCliMessageOverlays restores attachments and selected extensions onto matching user messages', () => {
  const restored = applyCliMessageOverlays(
    [
      {
        id: 'm1',
        role: 'user',
        content: '请检查构建错误',
        createdAt: 1,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: '我先看一下',
        createdAt: 2,
      },
    ],
    [
      {
        role: 'user',
        content: '请检查构建错误',
        requestId: 'req-1',
        attachments: [
          {
            id: 'file-1',
            name: 'error.log',
            filePath: 'C:\\tmp\\error.log',
            kind: 'file',
          },
        ],
        selectedExtensions: [
          {
            id: 'skill-1',
            client: 'codex',
            kind: 'skill',
            name: 'superpowers:systematic-debugging',
            description: '',
            path: 'C:\\skills\\debug',
            note: '优先使用',
          },
        ],
      },
    ]
  )

  assert.deepEqual(restored[0].attachments, [
    {
      id: 'file-1',
      name: 'error.log',
      filePath: 'C:\\tmp\\error.log',
      kind: 'file',
    },
  ])
  assert.equal(restored[0].selectedExtensions?.[0]?.note, '优先使用')
  assert.equal(restored[0].requestId, 'req-1')
})

test('applyCliMessageOverlays restores persisted assistant replies when native history omits them', () => {
  const restored = applyCliMessageOverlays(
    [
      {
        id: 'm1',
        role: 'user',
        content: '请生成页面',
        createdAt: 1,
        requestId: 'req-1',
      },
    ],
    [
      {
        id: 'assistant-req-1',
        role: 'assistant',
        content: '页面已经创建完成。',
        createdAt: 2,
        requestId: 'req-1',
        modelLabel: 'deepseek-v4-pro',
      },
    ]
  )

  assert.deepEqual(
    restored.map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      requestId: item.requestId,
      modelLabel: item.modelLabel,
    })),
    [
      {
        id: 'm1',
        role: 'user',
        content: '请生成页面',
        requestId: 'req-1',
        modelLabel: undefined,
      },
      {
        id: 'assistant-req-1',
        role: 'assistant',
        content: '页面已经创建完成。',
        requestId: 'req-1',
        modelLabel: 'deepseek-v4-pro',
      },
    ]
  )
})

test('collectCliToolNames extracts unique tool names from source kinds', () => {
  assert.deepEqual(
    collectCliToolNames([
      'assistant.tool_use.read_file',
      'stream.tool_use.edit_file',
      'assistant.tool_use.read_file',
      'request.started',
    ]),
    ['read_file', 'edit_file']
  )
})

test('recommendCliExtensionsForPrompt selects installed debugging-related extensions for bugfix prompts', () => {
  const result = recommendCliExtensionsForPrompt(
    '请修复当前项目的构建报错，并补上测试确保问题不再回归',
    [
      {
        id: 'debug',
        client: 'codex',
        kind: 'skill',
        name: 'superpowers:systematic-debugging',
        description: 'Root cause debugging workflow',
        path: 'C:\\skills\\debug',
        installed: true,
      },
      {
        id: 'tdd',
        client: 'codex',
        kind: 'skill',
        name: 'superpowers:test-driven-development',
        description: 'Write failing tests first',
        path: 'C:\\skills\\tdd',
        installed: true,
      },
      {
        id: 'front',
        client: 'codex',
        kind: 'skill',
        name: 'frontend-design',
        description: 'Build polished interfaces',
        path: 'C:\\skills\\front',
        installed: true,
      },
    ]
  )

  assert.deepEqual(result.map((item) => item.id), ['debug', 'tdd'])
})

test('recommendCliExtensionsForPrompt skips uninstalled entries even if they match strongly', () => {
  const result = recommendCliExtensionsForPrompt(
    '请用浏览器验证 localhost 页面并截图',
    [
      {
        id: 'browser-uninstalled',
        client: 'codex',
        kind: 'plugin',
        name: 'browser',
        description: 'Browser automation for localhost',
        path: 'C:\\plugins\\browser',
        installed: false,
      },
      {
        id: 'playwright-installed',
        client: 'codex',
        kind: 'skill',
        name: 'playwright-testing',
        description: 'browser testing and screenshot verification',
        path: 'C:\\skills\\playwright',
        installed: true,
      },
    ]
  )

  assert.deepEqual(result.map((item) => item.id), ['playwright-installed'])
})
