import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appSource = readFileSync(resolve(srcRoot, 'App.tsx'), 'utf8')
const attachmentSource = readFileSync(resolve(srcRoot, 'hooks', 'use-composer-attachments.ts'), 'utf8')
const assistantChatDrawSource = readFileSync(resolve(srcRoot, 'features', 'assistants', 'AssistantChatDrawWorkspaces.tsx'), 'utf8')

function readFunctionSource(name: string) {
  const start = attachmentSource.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} should exist`)
  const nextFunction = attachmentSource.indexOf('\nfunction ', start + 1)
  return attachmentSource.slice(start, nextFunction === -1 ? undefined : nextFunction)
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
  assert.match(attachmentSource, /function buildPersistedChatRequestContent/)
  assert.match(assistantChatDrawSource, /requestContent: persistedRequestContent/)
  assert.match(attachmentSource, /function resolveChatMessageRequestContent\(message: ChatMessage\)/)
  assert.match(assistantChatDrawSource, /resolveChatMessageRequestContent\(item\)/)
  assert.match(assistantChatDrawSource, /buildChatAttachmentContent\(item\.content, hydratedAttachments\)/)
})

test('composer attachments keep large base64 out of React state', () => {
  assert.match(attachmentSource, /export async function hydrateAttachmentDataBase64/)
  assert.match(attachmentSource, /MAX_COMPOSER_ATTACHMENT_BASE64_BYTES/)
  assert.match(attachmentSource, /if \(file\.size > MAX_COMPOSER_ATTACHMENT_BASE64_BYTES\)[\s\S]*?file\.arrayBuffer\(\)/)
  assert.match(attachmentSource, /dataBase64:\s*''/)
  assert.doesNotMatch(attachmentSource, /dataBase64,\s*\n\s*previewUrl:/)
  assert.match(assistantChatDrawSource, /const hydratedAttachments = await hydrateChatAttachmentsDataBase64\(attachments\)/)
  assert.match(assistantChatDrawSource, /buildChatAttachmentContent\(item\.content, hydratedAttachments\)/)
  assert.doesNotMatch(assistantChatDrawSource, /setPendingRetry\([\s\S]*?dataBase64/)
  assert.match(assistantChatDrawSource, /const hydratedImage = await readDesktopFileBase64\(request\.filePath\)/)
})

test('performance mode is fixed without an account-page toggle', () => {
  assert.match(appSource, /const performanceMode: AppPerformanceMode = 'performance'/)
  assert.doesNotMatch(appSource, /performance-mode-button/)
  assert.doesNotMatch(appSource, /onTogglePerformanceMode/)
})
