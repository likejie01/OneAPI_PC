import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const stylesPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'base.css')
const polishStylesPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'polish.css')
const appPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'App.tsx')
const assistantSupportPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'features', 'assistants', 'AssistantWorkspaceSupport.tsx')
const assistantChatDrawPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'features', 'assistants', 'AssistantChatDrawWorkspaces.tsx')
const styles = readFileSync(stylesPath, 'utf8')
const polishStyles = readFileSync(polishStylesPath, 'utf8')
const appSource = readFileSync(appPath, 'utf8')
const assistantSupportSource = readFileSync(assistantSupportPath, 'utf8')
const assistantChatDrawSource = readFileSync(assistantChatDrawPath, 'utf8')

function readRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1] ?? ''
}

test('conversation scroll dock renders in a fixed top-level layer', () => {
  const rule = readRule('.conversation-scroll-dock')

  assert.match(rule, /position:\s*fixed;/)
  assert.match(rule, /z-index:\s*120;/)
  assert.doesNotMatch(rule, /right:\s*-/)
})

test('conversation scroll dock is pinned to the client right edge', () => {
  assert.match(assistantSupportSource, /CONVERSATION_SCROLL_DOCK_VIEWPORT_INSET\s*=\s*8/)
  assert.doesNotMatch(assistantSupportSource, /viewportWidth\s*-\s*rect\.right\s*\+\s*CONVERSATION_SCROLL_DOCK_CONTENT_GAP/)
})

test('conversation scroll dock throttles global layout recalculation', () => {
  assert.match(assistantSupportSource, /CONVERSATION_SCROLL_DOCK_UPDATE_THROTTLE_MS\s*=\s*140/)
  assert.match(assistantSupportSource, /document\.addEventListener\('scroll', scheduleDockPositionUpdate, \{ capture: true, passive: true \}\)/)
  assert.match(assistantSupportSource, /new ResizeObserver\(scheduleDockPositionUpdate\)/)
})

test('conversation scroll dock only renders for the active workspace', () => {
  assert.match(assistantSupportSource, /active\?:\s*boolean/)
  assert.match(assistantSupportSource, /if \(!active \|\| !node\)/)
  assert.match(assistantSupportSource, /return portalRoot && active && dockStyle\.visibility !== 'hidden'/)
  assert.match(appSource, /<DrawWorkspace[\s\S]*?active=\{visible && mode === 'draw'\}/)
  assert.equal(
    ((appSource + assistantChatDrawSource).match(/<ConversationScrollDock[\s\S]*?active=\{active\}/g) || []).length,
    3
  )
})

test('conversation scroll buttons remain icon-only with no visual surface', () => {
  const rule = readRule('.conversation-scroll-button') + readRule('.conversation-scroll-dock .conversation-scroll-button') + polishStyles

  assert.match(rule, /background:\s*transparent;/)
  assert.match(rule, /border:\s*0;/)
  assert.match(rule, /box-shadow:\s*none;/)
  assert.match(rule, /backdrop-filter:\s*none;/)
  assert.match(rule, /-webkit-backdrop-filter:\s*none;/)
})
