import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'App.tsx'), 'utf8')

function readFunctionSource(name: string) {
  const start = appSource.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} should exist`)
  const nextFunction = appSource.indexOf('\nfunction ', start + 1)
  return appSource.slice(start, nextFunction === -1 ? undefined : nextFunction)
}

test('chat file attachments are downgraded to text parts instead of unsupported file parts', () => {
  const source = readFunctionSource('buildChatAttachmentContent')

  assert.match(source, /type:\s*'image_url'/)
  assert.match(source, /type:\s*'text'/)
  assert.match(source, /buildFileAttachmentText\(attachment\)/)
  assert.doesNotMatch(source, /type:\s*'file'/)
  assert.doesNotMatch(source, /file_data/)
})

test('chat keeps parsed file attachment content available for later context turns', () => {
  assert.match(appSource, /function buildPersistedChatRequestContent/)
  assert.match(appSource, /requestContent: persistedRequestContent/)
  assert.match(appSource, /function resolveChatMessageRequestContent\(message: ChatMessage\)/)
  assert.match(appSource, /resolveChatMessageRequestContent\(item\)/)
  assert.match(appSource, /buildChatAttachmentContent\(item\.content, attachments\)/)
})

test('performance mode toggle displays the current mode label', () => {
  assert.match(appSource, /className='ghost-button tiny performance-mode-button'/)
  assert.match(appSource, /<span>\{performanceMode === 'efficiency' \? '效率' : '性能'\}<\/span>/)
})
