import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const libDir = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(resolve(libDir, '..', 'App.tsx'), 'utf8')
const assistantSupportSource = readFileSync(resolve(libDir, '..', 'features', 'assistants', 'AssistantWorkspaceSupport.tsx'), 'utf8')
const chatDomainSource = readFileSync(resolve(libDir, '..', 'domains', 'chat.ts'), 'utf8')
const electronCliServicesSource = readFileSync(resolve(libDir, '..', '..', 'electron', 'main-cli-services.ts'), 'utf8')

test('reasoning effort exposes a true off state and an xhigh option', () => {
  assert.match(appSource + assistantSupportSource, /\{ label: '关闭', value: 'off' \}/)
  assert.match(appSource + assistantSupportSource, /\{ label: '极高', value: 'xhigh' \}/)
  assert.doesNotMatch(appSource + assistantSupportSource, /\{ label: '极限', value: 'max' \}/)
})

test('chat reasoning off is sent as none instead of falling back to provider defaults', () => {
  assert.match(chatDomainSource, /case 'off':[\s\S]*?return 'none'/)
  assert.match(chatDomainSource, /case 'xhigh':[\s\S]*?return 'xhigh'/)
  assert.doesNotMatch(chatDomainSource, /reasoningEffort && reasoningEffort !== 'off' \? reasoningEffort : undefined/)
})

test('cli reasoning off omits effort flags and xhigh maps to the strongest supported mode', () => {
  assert.match(electronCliServicesSource, /case 'off':[\s\S]*?return ''/)
  assert.match(electronCliServicesSource, /case 'xhigh':[\s\S]*?return 'high'/)
  assert.match(electronCliServicesSource, /case 'xhigh':[\s\S]*?return 'max'/)
  assert.match(electronCliServicesSource, /if \(parsedReasoningEffort\) \{[\s\S]*?model_reasoning_effort/)
  assert.match(electronCliServicesSource, /if \(parsedEffort\) \{[\s\S]*?args\.push\('--effort', parsedEffort\)/)
})
