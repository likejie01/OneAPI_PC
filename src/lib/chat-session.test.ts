import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAssistantSelectionToEmptyChatSession,
  compactAssistantSessionsForStorage,
  OMITTED_INLINE_DATA_URL,
  persistInlineImageMessageToFileUrl,
  resolveChatSessionAssistant,
  shouldFlushAssistantStreamUpdate,
  shouldCreateAssistantSwitchChatSession,
} from './chat-session.ts'

test('shouldCreateAssistantSwitchChatSession forks only when switching away from a non-empty session', () => {
  assert.equal(shouldCreateAssistantSwitchChatSession(null, 'assistant-b'), true)
  assert.equal(
    shouldCreateAssistantSwitchChatSession(
      { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 10, messages: [] },
      'assistant-b'
    ),
    false
  )
  assert.equal(
    shouldCreateAssistantSwitchChatSession(
      { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 10, messages: [{}] },
      'assistant-b'
    ),
    true
  )
  assert.equal(
    shouldCreateAssistantSwitchChatSession(
      { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 10, messages: [{}] },
      'assistant-a'
    ),
    false
  )
})

test('applyAssistantSelectionToEmptyChatSession updates assistant binding without shrinking timestamp', () => {
  const updated = applyAssistantSelectionToEmptyChatSession(
    { assistantId: 'assistant-a', model: 'gpt-5.4', group: 'default', updatedAt: 20, messages: [] },
    'assistant-b',
    'deepseek-chat',
    'vip',
    15
  )

  assert.deepEqual(updated, {
    assistantId: 'assistant-b',
    model: 'deepseek-chat',
    group: 'vip',
    updatedAt: 20,
    messages: [],
  })
})

test('resolveChatSessionAssistant prefers the assistant bound to the active session', () => {
  const assistants = [
    { id: 'assistant-global', name: 'global' },
    { id: 'assistant-session', name: 'session' },
  ]

  assert.equal(
    resolveChatSessionAssistant(
      assistants,
      { assistantId: 'assistant-session' },
      'assistant-global'
    )?.id,
    'assistant-session'
  )
})

test('resolveChatSessionAssistant falls back to global assistant and first assistant', () => {
  const assistants = [
    { id: 'assistant-first', name: 'first' },
    { id: 'assistant-global', name: 'global' },
  ]

  assert.equal(resolveChatSessionAssistant(assistants, null, 'assistant-global')?.id, 'assistant-global')
  assert.equal(resolveChatSessionAssistant(assistants, { assistantId: 'missing' }, 'missing')?.id, 'assistant-first')
})

test('compactAssistantSessionsForStorage strips large inline image data only from persisted copies', () => {
  const hugeDataUrl = `data:image/png;base64,${'a'.repeat(180_000)}`
  const sessions = [
    {
      id: 'session-1',
      title: 'image session',
      assistantId: 'assistant-a',
      model: 'gpt-image-2',
      group: 'default',
      updatedAt: 100,
      messages: [
        {
          id: 'assistant-image',
          role: 'assistant' as const,
          content: 'generated image',
          createdAt: 100,
          imageUrl: hugeDataUrl,
        },
        {
          id: 'assistant-url',
          role: 'assistant' as const,
          content: 'remote image',
          createdAt: 101,
          imageUrl: 'https://example.com/image.png',
        },
        {
          id: 'assistant-pending',
          role: 'assistant' as const,
          content: 'pending',
          createdAt: 102,
          imageUrl: '__oneapi_draw_pending__',
          pending: true,
        },
      ],
    },
  ]

  const compacted = compactAssistantSessionsForStorage(sessions)

  assert.notEqual(compacted, sessions)
  assert.equal(compacted[0]?.messages[0]?.imageUrl, OMITTED_INLINE_DATA_URL)
  assert.equal(compacted[0]?.messages[1]?.imageUrl, 'https://example.com/image.png')
  assert.equal(compacted[0]?.messages[2]?.imageUrl, '__oneapi_draw_pending__')
  assert.equal(sessions[0]?.messages[0]?.imageUrl, hugeDataUrl)
  assert.ok(JSON.stringify(compacted).length < 10_000)
  assert.ok(!JSON.stringify(compedOrEmpty(compacted)).includes('a'.repeat(50_000)))
})

test('compactAssistantSessionsForStorage removes inline request payloads from persisted copies', () => {
  const imageDataUrl = `data:image/png;base64,${'b'.repeat(120_000)}`
  const fileData = `data:application/pdf;base64,${'c'.repeat(120_000)}`
  const sessions = [
    {
      id: 'session-1',
      title: 'attachment session',
      assistantId: 'assistant-a',
      model: 'gpt-5.4',
      group: 'default',
      updatedAt: 100,
      messages: [
        {
          id: 'user-1',
          role: 'user' as const,
          content: 'read this',
          requestContent: [
            { type: 'text' as const, text: 'read this' },
            { type: 'image_url' as const, image_url: { url: imageDataUrl } },
            { type: 'file' as const, file: { filename: 'large.pdf', file_data: fileData } },
          ],
          createdAt: 100,
        },
      ],
    },
  ]

  const compacted = compactAssistantSessionsForStorage(sessions)
  const compactedMessage = compacted[0]?.messages[0]

  assert.deepEqual(compactedMessage?.requestContent, [
    { type: 'text', text: 'read this' },
    { type: 'image_url', image_url: { url: OMITTED_INLINE_DATA_URL } },
    { type: 'file', file: { filename: 'large.pdf', file_data: OMITTED_INLINE_DATA_URL } },
  ])
  assert.notEqual(compactedMessage?.requestContent, sessions[0]?.messages[0]?.requestContent)
  assert.ok(!JSON.stringify(compacted).includes('b'.repeat(50_000)))
  assert.ok(!JSON.stringify(compacted).includes('c'.repeat(50_000)))
})

test('compactAssistantSessionsForStorage bounds retained sessions and messages by updated time', () => {
  const sessions = Array.from({ length: 40 }, (_, sessionIndex) => ({
    id: `session-${sessionIndex}`,
    title: `session ${sessionIndex}`,
    assistantId: 'assistant-a',
    model: 'gpt-5.4',
    group: 'default',
    updatedAt: sessionIndex,
    messages: Array.from({ length: 90 }, (_, messageIndex) => ({
      id: `message-${sessionIndex}-${messageIndex}`,
      role: 'user' as const,
      content: `message ${messageIndex}`,
      createdAt: messageIndex,
    })),
  }))

  const compacted = compactAssistantSessionsForStorage(sessions)

  assert.equal(compacted.length, 32)
  assert.equal(compacted[0]?.id, 'session-39')
  assert.equal(compacted.at(-1)?.id, 'session-8')
  assert.equal(compacted[0]?.messages.length, 64)
  assert.equal(compacted[0]?.messages[0]?.id, 'message-39-26')
  assert.equal(compacted[0]?.messages.at(-1)?.id, 'message-39-89')
})

test('persistInlineImageMessageToFileUrl saves data url images outside renderer state', async () => {
  const inlineImage = `data:image/png;base64,${'i'.repeat(120_000)}`
  const saved: Array<{ name: string; mimeType?: string; dataBase64: string }> = []

  const message = await persistInlineImageMessageToFileUrl(
    {
      id: 'assistant-image',
      role: 'assistant',
      content: 'generated image',
      createdAt: 100,
      imageUrl: inlineImage,
      imagePrompt: 'a quiet dashboard',
    },
    async (input) => {
      saved.push(input)
      return { path: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC\\attachments\\oneapi-image.png' }
    },
  )

  assert.equal(saved.length, 1)
  assert.equal(saved[0]?.mimeType, 'image/png')
  assert.equal(saved[0]?.dataBase64, 'i'.repeat(120_000))
  assert.equal(message.imageUrl, 'file:///D:/WorkSpace/NewAPI/OneAPI_PC/attachments/oneapi-image.png')
  assert.equal(message.imagePrompt, 'a quiet dashboard')
  assert.ok(!JSON.stringify(message).includes('i'.repeat(50_000)))
})

test('shouldFlushAssistantStreamUpdate throttles streaming UI updates but allows forced flushes', () => {
  assert.equal(shouldFlushAssistantStreamUpdate({ now: 1000, lastFlushAt: 0 }), true)
  assert.equal(shouldFlushAssistantStreamUpdate({ now: 1040, lastFlushAt: 1000 }), false)
  assert.equal(shouldFlushAssistantStreamUpdate({ now: 1080, lastFlushAt: 1000 }), true)
  assert.equal(shouldFlushAssistantStreamUpdate({ now: 1040, lastFlushAt: 1000, force: true }), true)
})

function compedOrEmpty(value: unknown) {
  return value || []
}
