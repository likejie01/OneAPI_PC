import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildServiceStatusItems,
  classifyConfiguredService,
  collectConfiguredServices,
  hydrateServiceStatusItems,
} from './service-status.ts'

test('classifyConfiguredService infers configured services from channel type and text', () => {
  assert.equal(classifyConfiguredService({ id: 1, type: 14, models: 'claude-sonnet-4' }), 'claude')
  assert.equal(classifyConfiguredService({ id: 2, type: 57, name: 'codex official' }), 'codex')
  assert.equal(classifyConfiguredService({ id: 3, type: 24, name: 'gemini-2.5-pro' }), 'gemini')
  assert.equal(classifyConfiguredService({ id: 4, type: 43, base_url: 'https://api.deepseek.com' }), 'deepseek')
  assert.equal(classifyConfiguredService({ id: 5, type: 58, models: 'mimo-v2.5' }), 'mimo')
  assert.equal(classifyConfiguredService({ id: 6, type: 1, models: 'gpt-4.1' }), null)
  assert.equal(
    classifyConfiguredService({ id: 7, type: 14, name: 'Anthropic', base_url: 'https://code.newcli.com/codex' }),
    'claude'
  )
})

test('collectConfiguredServices groups configured channels by service', () => {
  const grouped = collectConfiguredServices([
    { id: 1, type: 14, name: 'Claude' },
    { id: 2, type: 14, name: 'Claude 2' },
    { id: 3, type: 57, name: 'Codex' },
  ])

  assert.equal(grouped.get('claude')?.length, 2)
  assert.equal(grouped.get('codex')?.length, 1)
  assert.equal(grouped.has('gemini'), false)
})

test('buildServiceStatusItems keeps only configured status-page services and emits one fallback card per channel', () => {
  const items = buildServiceStatusItems({
    channels: [
      { id: 1, type: 14, name: 'Claude' },
      { id: 2, type: 43, name: 'DeepSeek' },
      { id: 3, type: 43, name: 'DeepSeek 2' },
    ],
    statusPage: {
      publicGroupList: [
        {
          id: 1,
          name: 'Claude Code 分组',
          monitorList: [
            { id: 101, name: 'Claude Code 官方专用线路' },
          ],
        },
        {
          id: 2,
          name: 'Codex 分组',
          monitorList: [
            { id: 201, name: 'Codex 官方线路' },
          ],
        },
      ],
    },
    heartbeat: {
      heartbeatList: {
        '101': [{ status: 1, ping: 123, time: 1_717_171_717 }],
        '201': [{ status: 0, ping: 999, time: 1_717_171_717 }],
      },
    },
    fallbackResults: {
      deepseek: {
        ok: true,
        responseTime: 245,
        message: 'DeepSeek channel ok',
        checkedAt: 1_717_171_900_000,
        channelId: 2,
      },
    },
  })

  assert.equal(items.length, 3)
  assert.equal(items[0].serviceKey, 'claude')
  assert.equal(items[0].source, 'status-page')
  assert.equal(items[0].history?.length, 1)
  assert.equal(items[1].serviceKey, 'deepseek')
  assert.equal(items[1].source, 'channel-test')
  assert.equal(items[2].serviceKey, 'deepseek')
  assert.equal(items[2].source, 'channel-test')
})

test('hydrateServiceStatusItems preserves cached history and appends latest snapshot', () => {
  const items = hydrateServiceStatusItems(
    [
      {
        id: 'status-page:101',
        serviceKey: 'claude',
        title: 'Claude Code 官方专用线路',
        subtitle: 'Claude Code 分组',
        tone: 'down',
        checkedAt: 1_717_171_800_000,
        latencyMs: 321,
        source: 'status-page',
      },
    ],
    [
      {
        id: 'status-page:101',
        serviceKey: 'claude',
        title: 'Claude Code 官方专用线路',
        subtitle: 'Claude Code 分组',
        tone: 'up',
        checkedAt: 1_717_171_700_000,
        latencyMs: 123,
        source: 'status-page',
        history: [
          {
            tone: 'up',
            checkedAt: 1_717_171_700_000,
            latencyMs: 123,
          },
        ],
      },
    ]
  )

  assert.equal(items.length, 1)
  assert.equal(items[0].history?.length, 2)
  assert.equal(items[0].history?.[0].tone, 'up')
  assert.equal(items[0].history?.[1].tone, 'down')
})
